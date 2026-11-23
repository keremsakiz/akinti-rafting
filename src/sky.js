import * as THREE from 'three';

const SKY_VS = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
}`;

const SKY_FS = /* glsl */`
uniform vec3 uTop, uHorizon, uBottom, uSunDir, uSunColor, uCloud, uCloudShade;
uniform float uSunSize, uGlow, uMoon, uStars, uCover, uTime, uFlash, uCloudOff;
uniform sampler2D uNoise;
varying vec3 vDir;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55));
  col = mix(col, uBottom, smoothstep(0.0, -0.18, h));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 6.0) * 0.18 + pow(sd, 48.0) * 0.35 + pow(sd, 400.0) * 0.6) * uGlow;
  // stars
  if (uStars > 0.01 && h > 0.0) {
    vec3 sp = d * 260.0;
    vec3 cell = floor(sp);
    float r = hash(cell);
    float tw = 0.55 + 0.45 * sin(uTime * 2.5 + r * 60.0);
    float star = step(0.9972, r) * smoothstep(0.42, 0.0, length(fract(sp) - 0.5)) * tw;
    col += vec3(0.9, 0.95, 1.0) * star * uStars * 1.6 * smoothstep(0.02, 0.2, h);
  }
  // clouds (projected layer)
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.1) * 0.33 + vec2(uTime * 0.004, uTime * 0.0016 - uCloudOff);
    float n = texture2D(uNoise, uv).a * 0.62 + texture2D(uNoise, uv * 2.3 + 0.37).a * 0.28 + texture2D(uNoise, uv * 5.3 + 0.71).a * 0.1;
    float c = smoothstep(1.0 - uCover, 1.0 - uCover + 0.28, n) * smoothstep(0.0, 0.16, h);
    vec3 cc = mix(uCloudShade, uCloud, smoothstep(0.35, 0.95, n));
    cc += uSunColor * pow(sd, 5.0) * 0.35 * uGlow;
    col = mix(col, cc, c * 0.93);
  }
  // sun / moon disk (drawn over thin clouds)
  float disk = smoothstep(uSunSize, uSunSize + 0.00025, sd);
  vec3 diskCol = uMoon > 0.5 ? vec3(0.92, 0.95, 1.0) * 1.3 : uSunColor * 4.0;
  col = mix(col, diskCol, disk * (uMoon > 0.5 ? 1.0 : clamp(uGlow, 0.0, 1.0)));
  col += uFlash * vec3(0.75, 0.8, 1.0) * 0.9;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const MTN_FS = /* glsl */`
uniform vec3 uColor, uFar, uFog;
uniform float uBase, uAmp, uMesa, uSnow, uFlash;
uniform sampler2D uNoise;
varying vec3 vDir;
void main() {
  float e = vDir.y / length(vDir.xz);
  float a = atan(vDir.x, -vDir.z);
  float u = a / 6.2831853 + 0.5;
  float n1 = texture2D(uNoise, vec2(u * 3.0, 0.13)).a * 0.72 + texture2D(uNoise, vec2(u * 13.0, 0.41)).a * 0.28;
  float n2 = texture2D(uNoise, vec2(u * 5.0 + 0.3, 0.71)).a * 0.72 + texture2D(uNoise, vec2(u * 19.0, 0.93)).a * 0.28;
  float h1 = uBase + uAmp * pow(n1, 1.5) * 1.25;
  float h2 = uBase * 0.5 + uAmp * 0.62 * pow(n2, 1.3);
  float m1 = uBase + uAmp * (0.25 + 0.7 * smoothstep(0.47, 0.5, n1));
  float m2 = uBase * 0.5 + uAmp * 0.55 * (0.2 + 0.8 * smoothstep(0.5, 0.53, n2));
  h1 = mix(h1, m1, uMesa);
  h2 = mix(h2, m2, uMesa);
  vec3 col;
  if (e < h2) {
    col = uColor * (0.8 + 0.35 * clamp((e - uBase * 0.4) / max(h2 - uBase * 0.4, 0.001), 0.0, 1.0));
  } else if (e < h1) {
    col = uFar * (0.88 + 0.2 * clamp((e - uBase) / max(h1 - uBase, 0.001), 0.0, 1.0));
    if (uSnow > 0.0 && e > uBase + uAmp * uSnow) col = mix(col, vec3(0.93, 0.95, 0.98), 0.85);
  } else discard;
  col = mix(uFog, col, smoothstep(-0.03, 0.05, e));
  col += uFlash * 0.25;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createSky(noiseTex) {
  const u = {
    uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() },
    uSunSize: { value: 0.9994 }, uGlow: { value: 1 }, uMoon: { value: 0 }, uStars: { value: 0 },
    uCloud: { value: new THREE.Color() }, uCloudShade: { value: new THREE.Color() }, uCover: { value: 0.4 },
    uTime: { value: 0 }, uFlash: { value: 0 }, uNoise: { value: noiseTex }, uCloudOff: { value: 0 },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(800, 40, 24),
    new THREE.ShaderMaterial({ uniforms: u, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false })
  );
  sky.renderOrder = -10;
  sky.frustumCulled = false;

  const mu = {
    uColor: { value: new THREE.Color() }, uFar: { value: new THREE.Color() }, uFog: { value: new THREE.Color() },
    uBase: { value: 0.03 }, uAmp: { value: 0.1 }, uMesa: { value: 0 }, uSnow: { value: 0 }, uFlash: { value: 0 },
    uNoise: { value: noiseTex },
  };
  const mtn = new THREE.Mesh(
    new THREE.CylinderGeometry(700, 700, 500, 128, 1, true),
    new THREE.ShaderMaterial({ uniforms: mu, vertexShader: SKY_VS, fragmentShader: MTN_FS, side: THREE.BackSide, depthWrite: false })
  );
  mtn.renderOrder = -9;
  mtn.frustumCulled = false;
  return { sky, mtn, u, mu };
}

/** Image based lighting from the current sky (regenerated when the sky changes enough) */
export class EnvLight {
  constructor(renderer, skyMaterial) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMaterial));
    this.rt = null;
    this.key = null;
    this.cool = 0;
  }
  update(scene, dt, key, force) {
    this.cool -= dt;
    if (!force && (this.cool > 0 || (this.key !== null && Math.abs(this.key - key) < 0.06))) return;
    this.cool = 0.3;
    this.key = key;
    const rt = this.pmrem.fromScene(this.scene, 0.03, 0.1, 1000);
    if (this.rt) this.rt.dispose();
    this.rt = rt;
    scene.environment = rt.texture;
  }
}
