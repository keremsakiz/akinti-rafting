import * as THREE from 'three';

// ---------------------------------------------------------------------------
// HDR scene target -> dual-filter bloom -> grade/vignette -> tone map to screen,
// plus the planar water reflection pass. Both degrade gracefully.
// ---------------------------------------------------------------------------

const FSQ_VS = /* glsl */`
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const PREFILTER_FS = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold, uKnee;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-0.5, -0.5)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.5, -0.5)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(-0.5, 0.5)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.5, 0.5)).rgb;
  c *= 0.25;
  c = min(c, vec3(40.0));
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float w = max(soft, br - uThreshold) / max(br, 1e-4);
  gl_FragColor = vec4(c * w, 1.0);
}`;

const DOWN_FS = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(c / 8.0, 1.0);
}`;

const UP_FS = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uWeight;
varying vec2 vUv;
void main() {
  vec3 c = vec3(0.0);
  c += texture2D(tSrc, vUv + uTexel * vec2(-2.0, 0.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(2.0, 0.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(0.0, -2.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(0.0, 2.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 2.0;
  c += texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb * 2.0;
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb * 2.0;
  c += texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb * 2.0;
  gl_FragColor = vec4(c / 12.0 * uWeight, 1.0);
}`;

const COMPOSITE_FS = /* glsl */`
uniform sampler2D tScene, tBloom;
uniform float uBloom, uSat, uVignette, uContrast;
uniform vec3 uTint;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  c += texture2D(tBloom, vUv).rgb * uBloom;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  c *= uTint;
  // gentle contrast around a mid grey (in linear light)
  c = 0.18 * pow(max(c, vec3(1e-5)) / 0.18, vec3(uContrast));
  vec2 q = vUv - 0.5;
  c *= 1.0 - dot(q, q) * uVignette;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
}`;

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    const caps = renderer.capabilities;
    const ext = renderer.extensions;
    this.hdr = caps.isWebGL2 && (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'));
    this.supported = this.hdr;
    this.enabled = this.supported;
    const type = this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.type = type;
    // how many MSAA samples does this GPU allow for the HDR format?
    let samples = 0;
    try {
      const gl = renderer.getContext();
      const fmt = this.hdr ? gl.RGBA16F : gl.RGBA8;
      const list = gl.getInternalformatParameter(gl.RENDERBUFFER, fmt, gl.SAMPLES);
      if (list && list.length) samples = Math.min(4, Math.max(...list));
    } catch (e) { samples = 0; }
    this.samples = samples;
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type, samples, depthBuffer: true });
    this.rt.texture.generateMipmaps = false;
    this.mips = [];
    for (let i = 0; i < 4; i++) {
      const t = new THREE.WebGLRenderTarget(1, 1, { type, depthBuffer: false });
      t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter;
      t.texture.generateMipmaps = false;
      this.mips.push(t);
    }
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(tri);
    this.quad.frustumCulled = false;
    const mk = (fs, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: FSQ_VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, toneMapped: false, ...extra });
    this.mPre = mk(PREFILTER_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.0 }, uKnee: { value: 0.5 } });
    this.mDown = mk(DOWN_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.mUp = mk(UP_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } }, { blending: THREE.AdditiveBlending, transparent: true });
    this.mComp = mk(COMPOSITE_FS, {
      tScene: { value: this.rt.texture }, tBloom: { value: this.mips[0].texture },
      uBloom: { value: 0.6 }, uSat: { value: 1.06 }, uVignette: { value: 0.55 }, uContrast: { value: 1.0 }, uTint: { value: new THREE.Color(1, 1, 1) },
    }, { toneMapped: true });
    this.w = 1; this.h = 1;
  }

  setSize(w, h) {
    this.w = w; this.h = h;
    this.rt.setSize(w, h);
    let mw = w, mh = h;
    for (const m of this.mips) { mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1); m.setSize(mw, mh); }
    if (!this.checked && this.supported) {
      this.checked = true;
      if (!this.validate()) { this.supported = false; this.enabled = false; }
    }
  }

  /** make sure the GPU can actually render into our targets (else fall back to direct rendering) */
  validate() {
    const r = this.renderer, gl = r.getContext();
    try {
      for (const t of [this.rt, this.mips[0]]) {
        r.setRenderTarget(t);
        r.clear();
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { r.setRenderTarget(null); return false; }
      }
      r.setRenderTarget(null);
      return gl.getError() === gl.NO_ERROR;
    } catch (e) { r.setRenderTarget(null); return false; }
  }

  pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quad, this.cam);
  }

  /** render scene through the HDR pipeline */
  render(scene, camera) {
    const r = this.renderer;
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    const ac = r.autoClear;
    // bloom: prefilter -> down chain -> additive up chain
    this.mPre.uniforms.tSrc.value = this.rt.texture;
    this.mPre.uniforms.uTexel.value.set(1 / this.w, 1 / this.h);
    this.pass(this.mPre, this.mips[0]);
    for (let i = 1; i < this.mips.length; i++) {
      const src = this.mips[i - 1];
      this.mDown.uniforms.tSrc.value = src.texture;
      this.mDown.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this.pass(this.mDown, this.mips[i]);
    }
    r.autoClear = false;
    for (let i = this.mips.length - 1; i > 0; i--) {
      const src = this.mips[i];
      this.mUp.uniforms.tSrc.value = src.texture;
      this.mUp.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this.mUp.uniforms.uWeight.value = 0.85;
      this.pass(this.mUp, this.mips[i - 1]);
    }
    r.autoClear = ac;
    this.pass(this.mComp, null);
  }
}

/** Planar reflection of the world in the river (mirrored camera, clipped below the water) */
export class Reflection {
  constructor(renderer, G, type) {
    this.renderer = renderer;
    this.G = G;
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: type || THREE.UnsignedByteType, depthBuffer: true });
    this.rt.texture.generateMipmaps = false;
    this.rt.texture.minFilter = this.rt.texture.magFilter = THREE.LinearFilter;
    this.cam = new THREE.PerspectiveCamera();
    this.scale = 0.5;
    this.enabled = true;
    this.w = 1; this.h = 1;
  }
  setSize(w, h) { this.w = w; this.h = h; this.rt.setSize(Math.max(2, Math.round(w * this.scale)), Math.max(2, Math.round(h * this.scale))); }
  setScale(s) { this.scale = s; this.setSize(this.w, this.h); }
  render(scene, camera, look) {
    const c = this.cam;
    c.copy(camera);
    c.layers.set(0);
    c.position.set(camera.position.x, -camera.position.y, camera.position.z);
    c.up.set(0, -1, 0);
    c.lookAt(look.x, -look.y, look.z);
    c.updateMatrixWorld();
    const u = this.G.uBendO.value;
    u.y = -1; u.z = 1;
    const r = this.renderer;
    r.setRenderTarget(this.rt);
    r.render(scene, c);
    u.y = 1; u.z = 0;
  }
}
