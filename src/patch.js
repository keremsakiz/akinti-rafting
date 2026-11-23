import * as THREE from 'three';

// Shared uniforms used by every patched material
export const G = {
  uBend: { value: new THREE.Vector2(0, 0) },
  // x: main camera z, y: mirror sign (+1 normal / -1 reflection pass), z: clip below water (reflection pass)
  uBendO: { value: new THREE.Vector4(0, 1, 0, 0) },
  uTime: { value: 0 },
  uWind: { value: 1 },
  // night headlamp of the raft: xyz = world position, w = intensity
  uLamp: { value: new THREE.Vector4(0, 0, 0, 0) },
  uLampDir: { value: new THREE.Vector3(0, -0.3, -1) },
};

/** World-space "curved world" bend. Mirrors the vertical term in the reflection pass. */
export const BEND_PARS = /* glsl */`
uniform vec2 uBend;
uniform vec4 uBendO;
vec4 bendWorld(vec4 w) {
  float dz = max(uBendO.x - w.z - 10.0, 0.0);
  w.x += uBend.x * dz * dz;
  w.y += uBend.y * dz * dz * uBendO.y;
  return w;
}
`;

/**
 * Injects the curved-world bend (+ optional sway / tint mask / glow / flapping / cloth) into a built-in material.
 * opts: sway, tint, glow (aGlow attribute -> emissive), vcEmissive (vertex color glows), flap, rock, cloth, lamp
 */
export function patchMaterial(mat, opts = {}) {
  const key = 'p2' + Object.keys(opts).filter((k) => opts[k]).sort().join('-');
  mat.customProgramCacheKey = () => key;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    shader.uniforms.uBend = G.uBend;
    shader.uniforms.uBendO = G.uBendO;
    shader.uniforms.uTime = G.uTime;
    shader.uniforms.uWind = G.uWind;
    shader.uniforms.uLamp = G.uLamp;
    shader.uniforms.uLampDir = G.uLampDir;
    if (opts.cloth) Object.assign(shader.uniforms, opts.cloth);
    let head = BEND_PARS + 'uniform float uTime;\nuniform float uWind;\nvarying float vWY;\nvarying vec3 vWP;\n';
    if (opts.tint) head += 'attribute float aTint;\n';
    if (opts.glow) head += 'attribute float aGlow;\nvarying float vGlow;\n';
    if (opts.flap) head += 'attribute float aWing;\n';
    if (opts.rock) head += 'attribute vec3 aTop;\nattribute float aRockGlow;\nvarying vec3 vTopGlow;\n';
    if (opts.cloth) head += 'attribute vec4 aCloth;\nvarying vec4 vCloth;\n';
    let vs = head + shader.vertexShader;

    let begin = '#include <begin_vertex>\n';
    if (opts.glow) begin += 'vGlow = aGlow;\n';
    if (opts.cloth) begin += 'vCloth = aCloth;\n';
    if (opts.sway) begin += `
      #ifdef USE_INSTANCING
        vec3 ip = instanceMatrix[3].xyz;
      #else
        vec3 ip = vec3(0.0);
      #endif
      float sw = sin(uTime * 1.7 + ip.x * 0.31 + ip.z * 0.17) + 0.5 * sin(uTime * 2.9 + ip.z * 0.43 + ip.x * 0.2);
      float hgt = max(position.y, 0.0);
      transformed.x += sw * 0.03 * hgt * uWind;
      transformed.z += sw * 0.015 * hgt * uWind;
    `;
    if (opts.flap) begin += `
      #ifdef USE_INSTANCING
        float fph = instanceMatrix[3].x * 1.7 + instanceMatrix[3].y * 2.3;
      #else
        float fph = 0.0;
      #endif
      float fl = sin(uTime * 13.0 + fph);
      transformed.y += aWing * fl * abs(position.x) * 0.85;
      transformed.x *= 1.0 - aWing * abs(fl) * 0.15;
    `;
    vs = vs.replace('#include <begin_vertex>', begin);

    if (opts.tint || opts.rock) {
      vs = vs.replace('#include <color_vertex>', `
        #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR )
          vColor = vec4( 1.0 );
        #endif
        #ifdef USE_COLOR
          vColor.rgb *= color;
        #endif
        ${opts.rock ? `
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb = mix(instanceColor.rgb, aTop, color.r) * color.g;
          vTopGlow = aTop * color.r * aRockGlow;
        #else
          vTopGlow = vec3(0.0);
        #endif
        ` : `
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, aTint);
        #endif
        `}
      `);
    }

    vs = vs.replace('#include <project_vertex>', `
      vec4 wpos = vec4( transformed, 1.0 );
      #ifdef USE_INSTANCING
        wpos = instanceMatrix * wpos;
      #endif
      wpos = modelMatrix * wpos;
      vWY = wpos.y;
      vWP = wpos.xyz;
      wpos = bendWorld(wpos);
      vec4 mvPosition = viewMatrix * wpos;
      gl_Position = projectionMatrix * mvPosition;
    `);
    shader.vertexShader = vs;

    let fs = shader.fragmentShader;
    fs = 'uniform vec4 uBendO;\nuniform vec4 uLamp;\nuniform vec3 uLampDir;\nvarying float vWY;\nvarying vec3 vWP;\n' + fs;
    fs = fs.replace('void main() {', 'void main() {\n  if (uBendO.z > 0.5 && vWY < -0.02) discard;\n');
    if (opts.glow) {
      fs = 'varying float vGlow;\n' + fs;
      fs = fs.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vColor.rgb * vGlow * 1.5;');
    }
    if (opts.vcEmissive) {
      fs = fs.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vColor.rgb * 1.7;');
    }
    if (opts.rock) {
      fs = 'varying vec3 vTopGlow;\n' + fs;
      fs = fs.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vTopGlow;');
    }
    if (opts.cloth) {
      fs = 'varying vec4 vCloth;\nuniform vec3 uJacket, uPants, uShoe, uSkin;\nuniform float uLongPants;\n' + fs;
      fs = fs.replace('#include <map_fragment>', `#include <map_fragment>
        {
          float jk = smoothstep(0.3, 0.7, vCloth.x);
          float pt = smoothstep(0.3, 0.7, vCloth.y + vCloth.z * uLongPants);
          float sh = smoothstep(0.3, 0.7, vCloth.w);
          float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
          vec3 skin = diffuseColor.rgb * uSkin;
          float fab = 0.82 + 0.4 * lum;
          vec3 c = skin;
          c = mix(c, uPants * fab, pt);
          c = mix(c, uJacket * fab, jk);
          c = mix(c, uShoe, sh);
          diffuseColor.rgb = c;
          vClothAmt = max(max(jk, pt), sh);
        }`);
      fs = fs.replace('void main() {', 'float vClothAmt = 0.0;\nvoid main() {');
      fs = fs.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.85, vClothAmt);');
    }
    if (opts.lamp) {
      // raft headlamp: cheap spot light added as extra diffuse radiance
      fs = fs.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        if (uLamp.w > 0.001) {
          vec3 Ld = uLamp.xyz - vWP;
          float dl = length(Ld);
          Ld /= dl;
          float cone = smoothstep(0.55, 0.9, dot(-Ld, uLampDir));
          float att = uLamp.w * cone / (1.0 + dl * dl * 0.02);
          float ndl = max(dot(normal, normalize((viewMatrix * vec4(Ld, 0.0)).xyz)), 0.0) * 0.8 + 0.2;
          reflectedLight.directDiffuse += BRDF_Lambert(diffuseColor.rgb) * vec3(1.0, 0.93, 0.8) * att * ndl;
        }`);
    }
    shader.fragmentShader = fs;
    if (prev) prev(shader, r);
  };
  return mat;
}

/** Vertex snippet for custom ShaderMaterials: world pos -> bend -> view */
export const BEND_PROJECT = /* glsl */`
  wpos = bendWorld(wpos);
  vec4 mvPosition = viewMatrix * wpos;
  gl_Position = projectionMatrix * mvPosition;
`;
