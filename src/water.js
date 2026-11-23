import * as THREE from 'three';
import { RIVER_HALF, MAX_OBS, MAX_TRAIL } from './config.js';
import { G, BEND_PARS, BEND_PROJECT } from './patch.js';

const SHORE_N = 1024; // shoreline ring buffer (1 m per texel)

const VS = /* glsl */`
${BEND_PARS}
uniform float uTime, uFlow, uWaveAmp, uRapid;
varying vec3 vWorld;
varying float vWave;
#include <fog_pars_vertex>
float waveH(vec2 p) {
  float z = p.y + uFlow;
  return sin(p.x * 0.7 + z * 0.32 + uTime * 1.1) * 0.5
       + sin(-p.x * 0.5 + z * 0.51 + uTime * 1.6) * 0.3
       + sin(p.x * 1.3 + z * 0.9 - uTime * 2.3) * 0.2;
}
void main() {
  vec4 wpos = modelMatrix * vec4(position, 1.0);
  float h = waveH(wpos.xz);
  // standing waves in rapids
  float sw = sin(wpos.z * 1.7 + sin(wpos.x * 0.9) * 1.2) * sin(wpos.x * 2.3 + uTime * 0.6);
  wpos.y += h * uWaveAmp + sw * uRapid * 0.06;
  vWave = h + sw * uRapid;
  vWorld = wpos.xyz;
  ${BEND_PROJECT}
  #include <fog_vertex>
}`;

const FS = /* glsl */`
uniform float uTime, uFlow, uWaveAmp, uHalfW, uSpec, uFlash, uRain, uStreak, uReflOn, uNight, uRapid, uSunVis;
uniform vec3 uDeep, uShallow, uFoam, uRefl, uSkyTop, uSkyHor, uSunDir, uSunColor, uBed, uGlow;
uniform sampler2D uTex, uRipple, uFoamTex, uReflTex, uShore;
uniform vec2 uRes;
uniform vec4 uObs[MAX_OBS];
uniform int uObsCount;
uniform vec4 uTrail[MAX_TRAIL];
uniform vec4 uLamp;
uniform vec3 uLampDir;
uniform vec4 uRaft;   // x, z, yaw, on (1 = afloat: hull foam + dry inside)
uniform vec4 uRaftB;  // lateral speed, forward speed 0..1, wave-hit foam, roll
uniform vec4 uHull;   // waterline half width/length, dry (cut-away) half width/length (0 = none)
varying vec3 vWorld;
varying float vWave;
#include <fog_pars_fragment>

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

void main() {
  vec2 P = vWorld.xz;
  vec2 pf = vec2(P.x, P.y + uFlow);

  // ---- raft hull in its own frame (superellipse |x/a|^3 + |z/b|^3 = 1, bow at -z)
  float hullD = 99.0, hullBow = 0.0, hullSide = 0.0;
  if (uRaft.w > 0.0) {
    vec2 d = P - uRaft.xy;
    float cs = cos(uRaft.z), sn = sin(uRaft.z);
    vec2 lp = vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs);
    vec2 q = abs(lp);
    // dry inside: the floor sits about at the waterline, the water must never show through it
    if (uHull.z > 0.0) {
      vec2 qi = q / uHull.zw;
      if (qi.x * qi.x * qi.x + qi.y * qi.y * qi.y < 1.0 && uRaft.w > 0.5) discard;
    }
    vec2 A = uHull.xy;
    vec2 qo = q / A;
    float e = pow(qo.x * qo.x * qo.x + qo.y * qo.y * qo.y, 1.0 / 3.0);
    float sc = mix(A.x, A.y, q.y / max(q.x + q.y, 1e-3));
    hullD = (e - 1.0) * sc;                       // ~metres from the tube's outer waterline
    hullBow = smoothstep(0.2, 1.6, -lp.y);         // front part
    hullSide = clamp(sign(lp.x) * uRaftB.x / 14.0, 0.0, 1.0); // side pushing against the water
  }
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float far = smoothstep(18.0, 110.0, dist);

  // ---- true shoreline (terrain wiggle per side) -> distance to the water's edge
  vec2 sh = texture2D(uShore, vec2((-vWorld.z + 0.5) / ${SHORE_N.toFixed(1)}, 0.5)).rg * 4.0;
  float wig = vWorld.x < 0.0 ? sh.r : sh.g;
  float edgeD = uHalfW + wig - abs(vWorld.x);

  // ---- normals: macro waves + flowing ripples (3 octaves)
  float z = pf.y;
  float a1 = P.x * 0.7 + z * 0.32 + uTime * 1.1;
  float a2 = -P.x * 0.5 + z * 0.51 + uTime * 1.6;
  float a3 = P.x * 1.3 + z * 0.9 - uTime * 2.3;
  float dhdx = (cos(a1) * 0.35 - cos(a2) * 0.15 + cos(a3) * 0.26) * uWaveAmp;
  float dhdz = (cos(a1) * 0.16 + cos(a2) * 0.153 + cos(a3) * 0.18) * uWaveAmp;
  vec2 r1 = texture2D(uRipple, pf * vec2(0.085, 0.05) + vec2(0.0, uTime * 0.012)).xy * 2.0 - 1.0;
  vec2 r2 = texture2D(uRipple, vec2(P.x, P.y + uFlow * 1.25) * vec2(0.23, 0.15) + vec2(uTime * 0.021, -uTime * 0.034)).xy * 2.0 - 1.0;
  vec2 r3 = texture2D(uRipple, vec2(P.x, P.y + uFlow * 0.8) * vec2(0.61, 0.45) + vec2(-uTime * 0.05, uTime * 0.03)).xy * 2.0 - 1.0;
  float calm = 1.0 - smoothstep(0.0, 2.2, edgeD) * 0.0;
  vec2 slope = r1 * 0.55 + r2 * 0.36 * (1.0 - far * 0.6) + r3 * 0.16 * (1.0 - far);
  slope *= (0.75 + uRapid * 0.6 + uWaveAmp * 1.5);
  vec3 N = normalize(vec3(-dhdx * 2.2 + slope.x, 1.0, -dhdz * 2.2 + slope.y));

  // ---- water body: depth from the shore, riverbed + caustics in the shallows
  float depth = clamp(edgeD * 0.42, 0.0, 8.0) + 0.04;
  vec2 bedUV = P * 0.32 + N.xz * 0.12;
  vec4 bt = texture2D(uFoamTex, bedUV);
  float c1 = texture2D(uFoamTex, P * 0.19 + vec2(uTime * 0.035, uTime * 0.02)).g;
  float c2 = texture2D(uFoamTex, P * 0.23 - vec2(uTime * 0.02, -uTime * 0.04)).g;
  float caus = c1 * c2 * 2.0;
  float absorb0 = 1.0 - exp(-depth * 1.05);
  vec3 bed = uBed * (0.55 + 0.75 * bt.b) * (1.0 + caus * 0.9 * uSunVis * (1.0 - absorb0) * (1.0 - far));
  float absorb = 1.0 - exp(-depth * 1.05);
  vec3 body = mix(bed, uDeep, absorb);
  body = mix(body, uShallow, (1.0 - absorb) * 0.45 * (1.0 - far));
  // light scattering in the wave crests
  body += uShallow * max(vWave, 0.0) * 0.16 * uSunVis;
  // hull contact: the water darkens in the raft's shade and its displaced trough
  float contact = exp(-max(hullD, 0.0) * 3.2) * step(-0.3, hullD);
  body *= 1.0 - contact * 0.45;

  // ---- reflection
  float NdV = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  fres = mix(fres, min(1.0, fres * 1.35 + 0.05), far);
  vec3 R = reflect(-V, N);
  vec3 skyR = mix(uSkyHor, uSkyTop, smoothstep(0.0, 0.5, R.y));
  vec3 refl;
  if (uReflOn > 0.5) {
    vec2 suv = gl_FragCoord.xy / uRes;
    suv.x = 1.0 - suv.x;
    suv += vec2(-N.x, N.z) * (0.022 - far * 0.008);
    refl = texture2D(uReflTex, clamp(suv, vec2(0.002), vec2(0.998))).rgb;
  } else {
    float bank = 1.0 - smoothstep(0.0, 4.5, edgeD);
    refl = mix(skyR, uRefl, bank * 0.8);
  }
  vec3 col = mix(body, refl, clamp(fres, 0.0, 1.0));

  // ---- sun glints (HDR: they bloom)
  vec3 H = normalize(uSunDir + V);
  float nh = max(dot(N, H), 0.0);
  vec3 glint = uSunColor * (pow(nh, 520.0) * 5.0 + pow(nh, 90.0) * 0.07) * uSpec * (0.35 + 0.65 * far);

  // ---- foam
  vec4 f1 = texture2D(uFoamTex, pf * vec2(0.34, 0.24) + vec2(0.0, uTime * 0.05));
  vec4 f2 = texture2D(uFoamTex, vec2(P.x, P.y + uFlow * 1.15) * vec2(0.71, 0.5) - vec2(uTime * 0.03, 0.0));
  float lace = f1.r * 0.65 + f2.r * 0.35;
  float bub = f2.a;
  float nB = texture2D(uTex, pf * vec2(0.05, 0.02)).a;
  // shore: thin broken band right at the water's edge + streaks drifting off it
  float shore = 1.0 - smoothstep(0.0, 0.32 + nB * 0.7, edgeD);
  float shoreStreak = (1.0 - smoothstep(0.0, 2.2, edgeD)) * smoothstep(0.55, 0.8, texture2D(uTex, pf * vec2(0.4, 0.035)).a);
  float foam = max(shore, shoreStreak * 0.6);
  float foamObs = 0.0;

  for (int i = 0; i < MAX_OBS; i++) {
    if (i >= uObsCount) break;
    vec4 o = uObs[i];
    vec2 d = vWorld.xz - o.xy;
    if (dot(d, d) > (o.z + 6.0) * (o.z + 6.0)) continue;
    // pillow in front, eddy tail trailing downstream (-z); w < 0 = no tail (raft / paddles)
    float st = abs(o.w);
    float tail = (o.w > 0.0 && d.y < 0.0) ? 1.0 : 0.0;
    vec2 dd = vec2(d.x, d.y * mix(1.0, 0.38, tail));
    float rr = length(dd) - o.z;
    float ring = 1.0 - smoothstep(0.0, 0.25 + st * 0.6, rr + (lace - 0.5) * 0.5);
    float wakeT = tail * (1.0 - smoothstep(0.0, 1.2 + o.z, abs(d.x) - o.z * 0.4)) * (1.0 - smoothstep(0.0, 5.0 + o.z * 2.0, -d.y)) * 0.55;
    foam = max(foam, (ring + wakeT) * st);
    foamObs = max(foamObs, (ring + wakeT * 0.6) * st);
  }
  // raft wake: V-shaped edges + turbulent core
  for (int i = 0; i < MAX_TRAIL - 1; i++) {
    vec4 a = uTrail[i], b = uTrail[i + 1];
    if (a.w <= 0.0 || b.w <= 0.0) continue;
    vec2 pa = vWorld.xz - a.xy, ba = b.xy - a.xy;
    float hh = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
    float lat = length(pa - ba * hh);
    if (lat > 4.5) continue;
    float age = mix(a.z, b.z, hh);
    float str = mix(a.w, b.w, hh) * (1.0 - age);
    float wv = 0.95 + age * 2.6;
    float edge = exp(-pow((lat - wv) / (0.16 + age * 0.3), 2.0)) * (1.0 - age);
    float core = exp(-lat * lat / (0.35 + age * 1.6)) * (1.0 - age) * (1.0 - age);
    foam = max(foam, (edge * 0.35 + core * 0.62) * str);
    foamObs = max(foamObs, (edge * 0.3 + core * 0.5) * str);
  }
  // hull: churned contact line, bow pillow, side push when steering, burst on a wave hit
  if (hullD < 3.5) {
    float hd = max(hullD, 0.0);
    float sp = uRaftB.y;
    float lineF = exp(-hd * 9.0) * (0.75 + 0.25 * lace);
    float spread = exp(-hd / (0.25 + 0.55 * sp + 0.6 * hullBow * sp + 0.5 * hullSide)) * (0.3 + 0.5 * sp);
    float pillow = hullBow * exp(-hd / (0.35 + 0.9 * sp)) * (0.35 + 0.65 * sp);
    float hit = uRaftB.z * exp(-hd / (0.5 + 0.9 * hullBow)) * (0.5 + 0.5 * hullBow);
    float hf = max(lineF, (spread + pillow * 0.8 + hullSide * exp(-hd * 2.2) * 0.8 + hit) * (0.55 + lace * 0.7));
    foam = max(foam, hf);
    foamObs = max(foamObs, hf * 0.8);
  }
  // rapids streaks
  float streak = smoothstep(0.62, 0.85, texture2D(uTex, pf * vec2(0.08, 0.009) + vec2(0.37, 0.0)).a) * (uStreak + uRapid * 0.5);
  foam = max(foam, streak * 0.9);
  foam += uRapid * smoothstep(0.55, 0.9, lace) * 0.25;

  float fm = smoothstep(0.3, 0.68, foam * (0.45 + lace * 0.85));
  vec3 foamCol = uFoam * (0.78 + 0.28 * lace);
  col = mix(col + glint * (1.0 - fm), foamCol, fm * 0.94);
  // bioluminescence at night: wakes and the water around obstacles glow softly
  float fmo = smoothstep(0.25, 0.7, foamObs * (0.45 + lace * 0.85));
  col += uGlow * (fmo * 0.55 + fm * 0.08) * uNight * (0.6 + 0.4 * lace);

  // ---- raft headlamp
  if (uLamp.w > 0.001) {
    vec3 Ld = uLamp.xyz - vWorld;
    float dl = length(Ld);
    Ld /= dl;
    float cone = smoothstep(0.78, 0.96, dot(-Ld, uLampDir));
    float att = uLamp.w * cone / (1.0 + dl * dl * 0.012);
    vec3 Hl = normalize(Ld + V);
    col += (body * 0.9 + foamCol * fm * 0.6) * att;
    col += vec3(1.0, 0.93, 0.8) * pow(max(dot(N, Hl), 0.0), 140.0) * att * 4.0;
  }

  // ---- rain ripples
  if (uRain > 0.01) {
    vec2 rp = vWorld.xz * 1.7 + vec2(0.0, uFlow * 1.7);
    vec2 cell = floor(rp);
    vec2 f = fract(rp) - 0.5;
    float h = hash12(cell);
    float ph = fract(uTime * 1.3 + h * 7.0);
    vec2 c = vec2(hash12(cell + 3.1), hash12(cell + 7.7)) - 0.5;
    float rr = length(f - c * 0.5);
    float ring = smoothstep(0.04, 0.0, abs(rr - ph * 0.42)) * (1.0 - ph) * step(0.35, h);
    col += ring * 0.14 * uRain * uFoam;
  }

  col += uFlash * 0.35;
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createWater(tex, ripple, foamTex) {
  const obs = [];
  for (let i = 0; i < MAX_OBS; i++) obs.push(new THREE.Vector4());
  const trail = [];
  for (let i = 0; i < MAX_TRAIL; i++) trail.push(new THREE.Vector4(0, 0, 1, 0));
  const shoreData = new Uint8Array(SHORE_N * 4);
  const shoreTex = new THREE.DataTexture(shoreData, SHORE_N, 1, THREE.RGBAFormat);
  shoreTex.wrapS = THREE.RepeatWrapping; shoreTex.wrapT = THREE.ClampToEdgeWrapping;
  shoreTex.magFilter = shoreTex.minFilter = THREE.LinearFilter;
  shoreTex.generateMipmaps = false;
  shoreTex.needsUpdate = true;
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 }, uFlow: { value: 0 }, uWaveAmp: { value: 0.12 }, uHalfW: { value: RIVER_HALF },
    uSpec: { value: 1 }, uFlash: { value: 0 }, uRain: { value: 0 }, uStreak: { value: 0 }, uReflOn: { value: 0 },
    uNight: { value: 0 }, uRapid: { value: 0 }, uSunVis: { value: 1 },
    uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() }, uFoam: { value: new THREE.Color() },
    uRefl: { value: new THREE.Color() }, uSkyTop: { value: new THREE.Color() }, uSkyHor: { value: new THREE.Color() },
    uBed: { value: new THREE.Color('#6b6450') }, uGlow: { value: new THREE.Color('#2fd6ff') },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() },
    uObsCount: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
  }]);
  // Arrays / textures must not be cloned by merge
  uniforms.uTex = { value: tex };
  uniforms.uRipple = { value: ripple };
  uniforms.uFoamTex = { value: foamTex };
  uniforms.uReflTex = { value: null };
  uniforms.uShore = { value: shoreTex };
  uniforms.uObs = { value: obs };
  uniforms.uTrail = { value: trail };
  uniforms.uBend = G.uBend;
  uniforms.uBendO = G.uBendO;
  uniforms.uRaft = { value: new THREE.Vector4(0, 0, 0, 0) };
  uniforms.uRaftB = { value: new THREE.Vector4(0, 0, 0, 0) };
  uniforms.uHull = { value: new THREE.Vector4(1.05, 2.02, 0.7, 1.68) };
  uniforms.uLamp = G.uLamp;
  uniforms.uLampDir = G.uLampDir;
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VS, fragmentShader: FS, fog: true,
    defines: { MAX_OBS, MAX_TRAIL },
  });
  const geo = new THREE.PlaneGeometry(RIVER_HALF * 2 + 10, 340, 44, 200).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.layers.set(1); // not rendered into its own reflection

  // shoreline ring buffer: fill() keeps [dist-40, dist+420] up to date (raft only moves forward)
  const shore = {
    hi: -Infinity,
    reset() { this.hi = -Infinity; },
    fill(dist, wiggleFn) {
      const a = Math.floor(dist - 40), b = Math.ceil(dist + 420);
      const start = Math.max(a, this.hi + 1);
      if (start > b) return;
      for (let d = start; d <= b; d++) {
        const i = ((d % SHORE_N) + SHORE_N) % SHORE_N;
        shoreData[i * 4] = Math.min(255, Math.max(0, (wiggleFn(d, -1) / 4) * 255));
        shoreData[i * 4 + 1] = Math.min(255, Math.max(0, (wiggleFn(d, 1) / 4) * 255));
      }
      this.hi = b;
      shoreTex.needsUpdate = true;
    },
  };
  return { mesh, uniforms, obs, trail, shore };
}
