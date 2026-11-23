import * as THREE from 'three';
import { RIVER_HALF, RAFT_LIMIT, MAX_TRAIL, MAX_OBS, clamp, lerp, damp, speedAt, biomeStart } from './config.js';
import { BIOMES, biomeAt } from './biomes.js';
import { G } from './patch.js';
import { seedNoise } from './noise.js';
import { makeWaterTexture, makeDetailTexture, makeRippleTexture, makeFoamTexture } from './textures.js';
import { createSky, EnvLight } from './sky.js';
import { createWater } from './water.js';
import { Terrain, shoreWiggle } from './terrain.js';
import { Obstacles } from './obstacles.js';
import { Raft } from './raft.js';
import { Particles } from './particles.js';
import { createWeather } from './weather.js';
import { Life } from './life.js';
import { Sound } from './audio.js';
import { Post, Reflection } from './post.js';
import { loadAssets } from './assets.js';
import { save, ShopUI, CATS, CATALOG, item } from './shop.js';
// YÖNETİCİ MODU: only bundled with `node build.mjs --admin`; never ship it to the stores
import { installAdmin } from './admin.js';
import { feel, bump, SHAKE_STEPS } from './feel.js';
import { VolcanoLandmark } from './landmark.js';

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Renderer / scene
// ---------------------------------------------------------------------------
const canvas = $('c');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  $('nogl').style.display = 'flex';
  throw e;
}
const DPR = Math.min(window.devicePixelRatio || 1, 2);
let pixelRatio = DPR;
renderer.setPixelRatio(pixelRatio);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.info.autoReset = false;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xffffff, 60, 250);
scene.environmentIntensity = 0.7;
const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 1500);
camera.layers.enable(1);

const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.5);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 30, bottom: -24, near: 1, far: 160 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.04;
sun.shadow.radius = 2.5;
scene.add(sun, sun.target);
// headlamp of the raft (night biomes). Always present so materials never recompile.
const lamp = new THREE.SpotLight('#fff1d6', 0, 70, 0.42, 0.55, 1.2);
scene.add(lamp, lamp.target);

const waterTex = makeWaterTexture();
waterTex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
const rippleTex = makeRippleTexture();
rippleTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
const foamTex = makeFoamTexture();
const detailTex = makeDetailTexture();
const sky = createSky(waterTex);
scene.add(sky.sky, sky.mtn);
const env = new EnvLight(renderer, sky.sky.material);
const water = createWater(waterTex, rippleTex, foamTex);
scene.add(water.mesh);
const terrain = new Terrain(scene, detailTex);
const obstacles = new Obstacles(scene);
let raft = null;
const particles = new Particles(scene);
const weather = createWeather(scene);
const life = new Life(scene, particles);
const volcano = new VolcanoLandmark(scene);
const _vb = {};
// how much of the volcano biome is on screen (0..1)
function volcanoWeight(d) {
  biomeAt(d + 60, _vb);
  return (BIOMES[_vb.cur].id === 'volcano' ? _vb.t : 0) + (BIOMES[_vb.prev].id === 'volcano' ? 1 - _vb.t : 0);
}
const sound = new Sound();
const post = new Post(renderer);
const refl = new Reflection(renderer, G, post.type);
post.setSize(64, 64);
if (!post.supported) refl.rt.texture.type = THREE.UnsignedByteType;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const S = {
  mode: 'menu', prevMode: 'menu',
  dist: 0, speed: 0, x: 0, vx: 0, targetX: 0,
  time: 0, flow: 0, flowSpeed: 2.5,
  coins: 0, bonus: 0, combo: 0, comboTimer: 0, nearCount: 0,
  shield: 0, magnet: 0, invuln: 0, perk: {}, armor: 0, diveT: 0, diveCD: 0, shieldMax: 15, magnetMax: 10,
  biomeK: 0, best: 0, newBest: false,
  camX: 0, camBlend: 0, shake: 0, slow: 1, dieT: 0,
  seed: 1 + Math.floor(Math.random() * 9999),
  hintT: 0, dragged: false,
  flash: 0, lightningT: 6,
  waveT: 2, slapT: 0, slapS: 0, hitFoam: 0,
  camKick: 0, camKickV: 0, lensT: 0,
};
save.load();
feel.load();
S.best = save.data.best;
S.shopK = 0;

const score = () => Math.floor(S.dist) + S.coins * 10 + S.bonus;

// ---------------------------------------------------------------------------
// Atmosphere blending between biomes
// ---------------------------------------------------------------------------
const _v = new THREE.Vector3();
const atm = { biome: BIOMES[0], weather: {}, lantern: 0, rain: 0, wind: 1, night: 0, lampI: 0, envKey: 0 };
const C = (o, a, b, t) => o.copy(a).lerp(b, t);
const _c1 = new THREE.Color(), _c2 = new THREE.Color();
function updateAtmosphere(d) {
  const bb = biomeAt(d + 30);
  const A = BIOMES[bb.prev], B = BIOMES[bb.cur], t = bb.t;
  atm.biome = t > 0.5 ? B : A;
  atm.envKey = bb.k + t;
  const su = sky.u;
  C(su.uTop.value, A.sky.top, B.sky.top, t);
  C(su.uHorizon.value, A.sky.horizon, B.sky.horizon, t);
  C(su.uBottom.value, A.sky.bottom, B.sky.bottom, t);
  C(su.uCloud.value, A.sky.cloud, B.sky.cloud, t);
  C(su.uCloudShade.value, A.sky.cloudShade, B.sky.cloudShade, t);
  su.uCover.value = lerp(A.sky.cover, B.sky.cover, t);
  su.uStars.value = lerp(A.sky.stars, B.sky.stars, t);
  su.uSunDir.value.copy(A.sun.dir).lerp(B.sun.dir, t).normalize();
  C(su.uSunColor.value, A.sun.color, B.sun.color, t);
  su.uSunSize.value = lerp(A.sun.size, B.sun.size, t);
  su.uGlow.value = lerp(A.sun.glow, B.sun.glow, t);
  su.uMoon.value = lerp(A.sun.moon, B.sun.moon, t);
  const mu = sky.mu;
  C(mu.uColor.value, A.mountains.color, B.mountains.color, t);
  C(mu.uFar.value, A.mountains.far, B.mountains.far, t);
  mu.uBase.value = lerp(A.mountains.base, B.mountains.base, t);
  mu.uAmp.value = lerp(A.mountains.amp, B.mountains.amp, t);
  mu.uMesa.value = lerp(A.mountains.mesa, B.mountains.mesa, t);
  mu.uSnow.value = lerp(A.mountains.snow || 0, B.mountains.snow || 0, t);
  if (!A.mountains.snow && B.mountains.snow) mu.uSnow.value = t > 0.5 ? B.mountains.snow : 0;
  if (A.mountains.snow && !B.mountains.snow) mu.uSnow.value = t < 0.5 ? A.mountains.snow : 0;
  C(scene.fog.color, A.fog.color, B.fog.color, t);
  mu.uFog.value.copy(scene.fog.color);
  scene.fog.near = lerp(A.fog.near, B.fog.near, t);
  scene.fog.far = lerp(A.fog.far, B.fog.far, t);
  C(hemi.color, A.hemi.sky, B.hemi.sky, t);
  C(hemi.groundColor, A.hemi.ground, B.hemi.ground, t);
  hemi.intensity = lerp(A.hemi.intensity, B.hemi.intensity, t);
  C(sun.color, A.sun.color, B.sun.color, t);
  sun.intensity = lerp(A.sun.intensity, B.sun.intensity, t);
  const wu = water.uniforms;
  C(wu.uDeep.value, A.water.deep, B.water.deep, t);
  C(wu.uShallow.value, A.water.shallow, B.water.shallow, t);
  C(wu.uFoam.value, A.water.foam, B.water.foam, t);
  C(wu.uRefl.value, A.water.refl, B.water.refl, t);
  C(wu.uBed.value, A.water.bed, B.water.bed, t);
  C(wu.uGlow.value, A.water.glow, B.water.glow, t);
  wu.uSkyTop.value.copy(su.uTop.value);
  wu.uSkyHor.value.copy(su.uHorizon.value);
  wu.uSunDir.value.copy(su.uSunDir.value);
  wu.uSunColor.value.copy(su.uSunColor.value).multiplyScalar(lerp(A.water.sunGain, B.water.sunGain, t));
  wu.uWaveAmp.value = lerp(A.water.wave, B.water.wave, t);
  wu.uSpec.value = lerp(A.water.spec, B.water.spec, t);
  wu.uSunVis.value = lerp(A.water.caustics, B.water.caustics, t);
  atm.night = lerp(A.night, B.night, t);
  wu.uNight.value = atm.night;
  atm.exposure = lerp(A.exposure, B.exposure, t);
  atm.lampI = lerp(A.lamp, B.lamp, t);
  G.uWind.value = lerp(A.wind, B.wind, t);
  for (const k in weather) atm.weather[k] = lerp(A.weather[k] || 0, B.weather[k] || 0, t);
  atm.rain = atm.weather.rain || 0;
  atm.wind = Math.max(atm.weather.snow || 0, (atm.weather.dust || 0) * 0.8, (atm.weather.ash || 0) * 0.6);
  atm.lantern = lerp(A.lantern, B.lantern, t);
  atm.lightning = (A.lightning ? 1 - t : 0) + (B.lightning ? t : 0);
  atm.foam = wu.uFoam.value;
  // colour grading
  const pc = post.mComp.uniforms;
  C(pc.uTint.value, A.grade.tint, B.grade.tint, t);
  pc.uSat.value = lerp(A.grade.sat, B.grade.sat, t);
  pc.uBloom.value = lerp(A.grade.bloom, B.grade.bloom, t);
  pc.uContrast.value = lerp(A.grade.contrast, B.grade.contrast, t);
  post.mPre.uniforms.uThreshold.value = lerp(A.grade.threshold, B.grade.threshold, t);
  scene.environmentIntensity = lerp(A.envI, B.envI, t);
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
const ui = {
  hud: $('hud'), score: $('score'), dist: $('dist'), coins: $('coins'), combo: $('combo'),
  banner: $('banner'), bname: $('bname'), bsub: $('bsub'), menu: $('menu'), over: $('over'), pause: $('pause'),
  fade: $('fade'), best: $('best'), hint: $('hint'), pops: $('pops'), powers: $('powers'),
  pShield: $('pShield'), pMagnet: $('pMagnet'), pPerk: $('pPerk'), pPerkT: $('pPerkT'), mute: $('btnMute'), wallet: $('walletCoins'),
};
const refreshWallet = () => { ui.wallet.textContent = save.data.coins.toLocaleString('tr-TR'); ui.best.textContent = save.data.best; };
refreshWallet();
save.onChange(() => { S.best = Math.max(S.best, save.data.best); refreshWallet(); });
ui.best.textContent = S.best;
let lastScoreTxt = '';

function showBanner(k) {
  const B = BIOMES[k % BIOMES.length];
  ui.bname.textContent = B.name;
  ui.bsub.textContent = k === 0 ? 'BAŞLANGIÇ' : `${biomeStart(k).toLocaleString('tr-TR')} m`;
  ui.banner.classList.remove('show');
  void ui.banner.offsetWidth;
  ui.banner.classList.add('show');
}

function popup(text, sub, cls = '') {
  const el = document.createElement('div');
  el.className = 'pop ' + cls;
  el.innerHTML = `<b>${text}</b>${sub ? `<span>${sub}</span>` : ''}`;
  ui.pops.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

function updateHud() {
  const sc = String(score());
  if (sc !== lastScoreTxt) { ui.score.textContent = sc; lastScoreTxt = sc; }
  ui.dist.textContent = Math.floor(S.dist) + ' m';
  ui.coins.textContent = S.coins;
  ui.pShield.style.display = S.shield > 0 ? 'flex' : 'none';
  ui.pMagnet.style.display = S.magnet > 0 ? 'flex' : 'none';
  if (S.shield > 0) ui.pShield.style.setProperty('--p', (S.shield / S.shieldMax).toFixed(3));
  if (S.magnet > 0) ui.pMagnet.style.setProperty('--p', (S.magnet / S.magnetMax).toFixed(3));
  // vessel perk: armour left / dive ready
  const pk = S.perk || {};
  const showPerk = S.mode === 'play' && ((pk.armor && S.armor > 0) || pk.dive);
  ui.pPerk.style.display = showPerk ? 'flex' : 'none';
  if (showPerk) {
    const txt = pk.dive ? (S.diveCD > 0 ? 'DALIŞ' : 'DALIŞ HAZIR') : 'ZIRH';
    if (ui.pPerkT.textContent !== txt) ui.pPerkT.textContent = txt;
    ui.pPerk.style.setProperty('--p', pk.dive ? (1 - S.diveCD / 20).toFixed(3) : '1');
    ui.pPerk.classList.toggle('wait', !!(pk.dive && S.diveCD > 0));
  }
}

function setMuteIcon() { ui.mute.classList.toggle('off', sound.muted); }
setMuteIcon();

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------
function resetWorld(newSeed) {
  if (newSeed) {
    S.seed = 1 + Math.floor(Math.random() * 99999);
    seedNoise(S.seed);
  }
  terrain.setSeed(S.seed);
  terrain.reset(0);
  obstacles.reset();
  life.reset();
  particles.clear();
  water.shore.reset();
  Object.assign(S, { dist: 0, x: 0, vx: 0, targetX: 0, speed: 0, coins: 0, bonus: 0, combo: 0, comboTimer: 0, nearCount: 0,
    shield: 0, magnet: 0, invuln: 0, armor: 0, diveT: 0, diveCD: 0, biomeK: 0, newBest: false, dieT: 0, slow: 1, shake: 0, camX: 0, hintT: 0, dragged: false });
  feel.reset();
  if (raft) raft.crash = 0;
  for (const v of water.trail) v.set(0, 0, 1, 0);
  lastScoreTxt = '';
}

function startRun() {
  sound.init();
  sound.click();
  ui.menu.classList.add('hidden');
  ui.over.classList.add('hidden');
  ui.hud.classList.remove('hidden');
  S.mode = 'play';
  S.speed = 4;
  S.hintT = 3.5;
  S.perk = item('boat', save.data.equip.boat).perk || {};
  S.armor = S.perk.armor || 0;
  S.diveT = 0; S.diveCD = 0;
  S.shieldMax = 15 * (S.perk.pow || 1); S.magnetMax = 10 * (S.perk.pow || 1);
  ui.hint.classList.add('show');
  showBanner(0);
}

function restart() {
  sound.init();
  sound.click();
  ui.fade.classList.add('on');
  setTimeout(() => {
    resetWorld(true);
    startRun();
    S.camBlend = 1;
    ui.fade.classList.remove('on');
  }, 260);
}

function die(o) {
  S.mode = 'dying';
  S.dieT = 0;
  ui.hint.classList.remove('show');
  // large tier: full trauma, short freeze on the impact frame, then the slow-motion wreck
  feel.addTrauma(1);
  feel.hitStop(0.12);
  S.slow = 0.4;
  raft.crash = 0.001;
  raft.crashDir = Math.sign(S.x - (o ? o.x : 0)) || 1;
  const vid = raft.vid || 'raft';
  sound.crash(vid);
  const z = -S.dist;
  const foam = atm.foam || new THREE.Color('#fff');
  particles.burst(S.x, 0.4, z - 1.2, 60, 5, 6, 1.1, 0.16, foam, 1.6);
  particles.burst(S.x, 0.3, z - 1.2, 14, 2, 2, 1.4, 0.6, foam, 2.2, -2);
  sinkFx(vid, S.x, z);
  feel.buzz([60, 40, 90]);
}

// vessel-specific debris / bubbles / smoke so every sinking reads differently
const emberHot = new THREE.Color('#ffb050').multiplyScalar(2.2), steamC = new THREE.Color('#d8ccc4');
const _bubble = new THREE.Color('#bfefff'), _smoke = new THREE.Color('#3a3634'), _canvas = new THREE.Color('#f4efe2'), _spark = new THREE.Color('#ffb04a');
function sinkFx(vid, x, z) {
  const later = (ms, f) => setTimeout(() => { if (S.mode === 'dying' || S.mode === 'over') f(); }, ms);
  if (vid === 'raft') {
    // the flip throws a sheet of water over the top
    later(220, () => particles.burst(x, 0.9, z, 40, 3.2, 7, 1.0, 0.14, spray, 2.4));
  } else if (vid === 'rib') {
    // a spray fan from the spin-out + a puff from the dead motor
    for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; particles.emit(x + Math.cos(a) * 1.2, 0.2, z + Math.sin(a) * 1.6, Math.cos(a) * 5, 1.5 + Math.random() * 2, Math.sin(a) * 5, 0.7, 0.08, spray, -9, 1.2); }
    later(300, () => particles.burst(x, 0.8, z + 1.6, 10, 0.6, 1.5, 1.6, 0.5, _smoke, 0.6, 0.6));
  } else if (vid === 'sail') {
    // the sail slaps flat into the water on the low side
    const sd = raft.crashDir || 1;
    later(380, () => { for (let i = 0; i < 36; i++) particles.emit(x + sd * (1.5 + Math.random() * 3), 0.15, z + (Math.random() - 0.5) * 3, sd * Math.random() * 2, 1.5 + Math.random() * 3, (Math.random() - 0.5) * 2, 0.9, 0.12, i % 4 ? spray : _canvas, -9, 1.2); });
  } else if (vid === 'yacht') {
    // nose-dive: a tall bow plume, then the stern slams down
    particles.burst(x, 0.4, z - 2.2, 50, 2.2, 11, 1.3, 0.16, spray, 1.2);
    later(520, () => particles.burst(x, 0.3, z + 1.5, 46, 5, 5, 1.0, 0.15, spray, 2.4));
  } else if (vid === 'ship') {
    // hull groans, smoke from the funnel, debris on the water
    for (let k = 0; k < 4; k++) later(150 + k * 260, () => particles.burst(x, 2.6, z + 0.8, 8, 0.5, 2.0, 2.2, 0.8, _smoke, 0.8, 0.4));
    later(700, () => particles.burst(x, 0.3, z - 2, 30, 4, 3, 1.4, 0.14, spray, 3));
  } else if (vid === 'sub') {
    // hull breach: a fizz of sparks, then bubbles keep rising as it goes down
    particles.burst(x, 0.6, z, 14, 3, 3, 0.4, 0.06, _spark, 0.5);
    for (let k = 0; k < 7; k++) later(120 + k * 170, () => {
      for (let i = 0; i < 9; i++) particles.emit(x + (Math.random() - 0.5) * 1.6, 0.0, z + (Math.random() - 0.5) * 3, 0, 1.4 + Math.random() * 1.4, 0, 0.7, 0.09 + Math.random() * 0.1, _bubble, 2.5, 1.5);
    });
  }
}

function gameOver() {
  S.mode = 'over';
  const sc = score();
  if (sc > S.best) { S.best = sc; S.newBest = true; }
  // coins go to the wallet, plus 1 coin per 50 m travelled
  const bonus = (S.perk && S.perk.coin) || 0;
  const earned = Math.round((S.coins + Math.floor(S.dist / 50)) * (1 + bonus));
  save.data.coins += earned;
  save.data.best = Math.max(save.data.best, S.best);
  save.data.runs++;
  save.commit();
  $('oEarn').textContent = earned.toLocaleString('tr-TR');
  $('oBonus').textContent = bonus > 0 ? ` (${item('boat', save.data.equip.boat).name} +%${Math.round(bonus * 100)})` : '';
  $('oWallet').textContent = save.data.coins.toLocaleString('tr-TR');
  $('oScore').textContent = sc;
  $('oBest').textContent = S.best;
  $('oDist').textContent = Math.floor(S.dist) + ' m';
  $('oCoins').textContent = S.coins;
  $('oNear').textContent = S.nearCount;
  $('oBiome').textContent = BIOMES[biomeAt(S.dist).cur].name;
  $('oNew').style.display = S.newBest ? 'inline-block' : 'none';
  ui.best.textContent = S.best;
  ui.hud.classList.add('hidden');
  ui.over.classList.remove('hidden');
  focusEl($('btnAgain'));
}

function togglePause(force) {
  const p = force !== undefined ? force : S.mode !== 'paused';
  if (p && (S.mode === 'play' || S.mode === 'dying')) {
    S.prevMode = S.mode; S.mode = 'paused'; ui.pause.classList.remove('hidden');
    renderOpts();
    focusEl($('btnResume')); // keyboard/gamepad users land on a control
  } else if (!p && S.mode === 'paused') {
    S.mode = S.prevMode; ui.pause.classList.add('hidden'); last = performance.now();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }
}

// ---------------------------------------------------------------------------
// Input: drag left/right anywhere
// ---------------------------------------------------------------------------
let dragging = false, lastPX = 0, dragId = null;
const SENS = 15;
canvas.addEventListener('pointerdown', (e) => {
  if (S.mode !== 'play') return;
  dragging = true; dragId = e.pointerId; lastPX = e.clientX;
  try { canvas.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging || e.pointerId !== dragId || S.mode !== 'play') return;
  const dx = e.clientX - lastPX;
  lastPX = e.clientX;
  S.targetX = clamp(S.targetX + (dx / Math.max(320, window.innerWidth)) * SENS, -RAFT_LIMIT, RAFT_LIMIT);
  if (Math.abs(dx) > 2 && !S.dragged) { S.dragged = true; ui.hint.classList.remove('show'); }
});
const endDrag = (e) => { if (e.pointerId === dragId) { dragging = false; dragId = null; } };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if ((e.code === 'Space' || e.code === 'Enter') && e.target && e.target.tagName === 'BUTTON') return;
  if ((e.code === 'Space' || e.code === 'Enter') && S.mode === 'menu' && ready && !S.shopOpen) startRun();
  if (e.code === 'Escape' && S.shopOpen) { shop.hide(); return; }
  else if ((e.code === 'Space' || e.code === 'Enter') && S.mode === 'over') restart();
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

ui.menu.addEventListener('pointerdown', (e) => { e.preventDefault(); if (ready && !S.shopOpen) startRun(); });
ui.menu.addEventListener('click', () => sound.init());
$('btnAgain').addEventListener('click', restart);

// ---------------------------------------------------------------------------
// Marketplace
// ---------------------------------------------------------------------------
let trailSkin = item('trail', save.data.equip.trail);
function previewSkin(cat, it) {
  if (cat === 'trail') { trailSkin = it; return; }
  if (!raft) return;
  if (cat === 'boat') raft.setVessel(it.id);
  else if (cat === 'raft') raft.setSkin(it);
  else if (cat === 'crew') raft.setCrewSkin(it);
  else if (cat === 'paddle') raft.setPaddleSkin(it);
}
function applyEquipped() { for (const c of CATS) previewSkin(c.id, item(c.id, save.data.equip[c.id])); }
const shop = new ShopUI({
  preview: previewSkin,
  sound: (n) => { sound.init(); if (n === 'buy') sound.buy(); else if (n === 'no') sound.deny(); else sound.click(); },
  bought: (cat, it) => {
    popup('SATIN ALINDI!', it.name, 'hot');
    if (raft) particles.burst(S.x, 1.2, -S.dist, 50, 3.5, 4, 0.9, 0.12, gold.clone().multiplyScalar(2.5), 1, -4);
  },
  close: () => { document.body.classList.remove('shop-open'); S.shopOpen = false; },
});
function openShop(cat) {
  sound.init(); sound.click();
  if (S.mode === 'over') {
    // leave the wreck: back to a fresh river in menu state, then shop
    resetWorld(true);
    S.mode = 'menu';
    S.camBlend = 0;
    ui.over.classList.add('hidden');
    ui.menu.classList.remove('hidden');
  }
  S.shopOpen = true;
  document.body.classList.add('shop-open');
  shop.show(cat);
}
$('btnShop').addEventListener('pointerdown', (e) => e.stopPropagation());
$('btnShop').addEventListener('click', (e) => { e.stopPropagation(); openShop(); });
$('menuWallet').addEventListener('pointerdown', (e) => { e.stopPropagation(); openShop(); });
$('btnShopOver').addEventListener('click', () => openShop());
$('btnPause').addEventListener('click', () => togglePause());
$('btnResume').addEventListener('click', () => { sound.init(); togglePause(false); });

// comfort settings (pause screen): shake strength and vibration
function focusEl(el) { try { el.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
const shakeIdx = () => {
  let best = 0;
  SHAKE_STEPS.forEach((st, i) => { if (Math.abs(st.v - feel.shake) < Math.abs(SHAKE_STEPS[best].v - feel.shake)) best = i; });
  return best;
};
function renderOpts() {
  $('optShakeV').textContent = SHAKE_STEPS[shakeIdx()].label;
  $('optHapticV').textContent = feel.haptics ? 'AÇIK' : 'KAPALI';
}
if (!('vibrate' in navigator)) $('optHaptic').style.display = 'none';
$('optShake').addEventListener('click', () => {
  sound.init(); sound.click();
  feel.shake = SHAKE_STEPS[(shakeIdx() + 1) % SHAKE_STEPS.length].v;
  feel.commit(); renderOpts();
});
$('optHaptic').addEventListener('click', () => {
  sound.init(); sound.click();
  feel.haptics = !feel.haptics;
  feel.commit(); renderOpts();
  feel.buzz(30); // preview
});
renderOpts();
ui.mute.addEventListener('click', () => { sound.init(); sound.setMuted(!sound.muted); setMuteIcon(); });
['touchend', 'click'].forEach((ev) => document.addEventListener(ev, () => { if (S.mode !== 'menu') sound.init(); }, { passive: true }));
document.addEventListener('visibilitychange', () => { if (document.hidden) togglePause(true); });
document.addEventListener('touchmove', (e) => { if (e.target === canvas) e.preventDefault(); }, { passive: false });

// ---------------------------------------------------------------------------
// Quality management
// ---------------------------------------------------------------------------
let qLevel = 0, fpsT = 0, fpsN = 0;
const Q = [
  { pr: 2, post: true, refl: 0.5, shadows: true, weather: 1 },
  { pr: 1.6, post: true, refl: 0.36, shadows: true, weather: 1 },
  { pr: 1.3, post: true, refl: 0, shadows: true, weather: 0.6 },
  { pr: 1.0, post: false, refl: 0, shadows: false, weather: 0.5 },
];
function applyQuality() {
  const q = Q[qLevel];
  pixelRatio = Math.min(DPR, q.pr);
  for (const k in weather) weather[k].level = q.weather;
  sun.castShadow = q.shadows;
  post.enabled = post.supported && q.post;
  refl.enabled = q.refl > 0;
  if (q.refl > 0) refl.scale = q.refl;
  renderer.setPixelRatio(pixelRatio);
  resize();
}

let W = 1, H = 1;
const _sz = new THREE.Vector2();
function resize() {
  W = window.innerWidth; H = window.innerHeight;
  renderer.setSize(W, H);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  renderer.getDrawingBufferSize(_sz);
  post.setSize(_sz.x, _sz.y);
  refl.setSize(_sz.x, _sz.y);
  water.uniforms.uRes.value.copy(_sz);
}
window.addEventListener('resize', resize);

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------
let trailT = 0;
const spray = new THREE.Color('#ffffff');
const gold = new THREE.Color('#ffd447');
const cyan = new THREE.Color('#7ff3ff');

function stepPlay(dt) {
  // steering
  if (keys.ArrowLeft || keys.KeyA) { S.targetX = clamp(S.targetX - 13 * dt, -RAFT_LIMIT, RAFT_LIMIT); S.dragged = true; }
  if (keys.ArrowRight || keys.KeyD) { S.targetX = clamp(S.targetX + 13 * dt, -RAFT_LIMIT, RAFT_LIMIT); S.dragged = true; }
  S.speed = damp(S.speed, speedAt(S.dist), 1.6, dt);
  const steps = Math.max(1, Math.ceil((S.speed * dt) / 0.45));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const want = clamp((S.targetX - S.x) * 9, -17, 17);
    S.vx = damp(S.vx, want, 14, h);
    S.x += S.vx * h;
    if (S.x > RAFT_LIMIT) { S.x = RAFT_LIMIT; S.vx = Math.min(0, S.vx); }
    if (S.x < -RAFT_LIMIT) { S.x = -RAFT_LIMIT; S.vx = Math.max(0, S.vx); }
    S.dist += S.speed * h;
    const ev = obstacles.update(h, S.time, S.dist, S.x, { spawn: true, collide: true, magnet: S.magnet > 0 ? 1 : S.perk.wind ? 0.42 : 0 });
    if (ev.pull) S.targetX = clamp(S.targetX + ev.pull * h * 0.55, -RAFT_LIMIT, RAFT_LIMIT);
    if (ev.coins) {
      S.coins += ev.coins;
      sound.coin(S.combo);
      particles.burst(S.x, 0.9, -S.dist - 0.8, 8 * ev.coins, 2.2, 3, 0.5, 0.12, gold, 0.6, -6);
      bump(ui.coins);
    }
    for (const o of ev.near) {
      S.combo++; S.comboTimer = 2.6; S.nearCount++;
      const b = 25 * S.combo;
      S.bonus += b;
      popup('KIL PAYI!', `+${b}${S.combo > 1 ? ` · x${S.combo}` : ''}`, S.combo > 2 ? 'hot' : '');
      sound.near(S.combo);
      // small tier; from x3 combo up a brief slow-motion dip sells the close call
      const hot = S.combo > 2;
      feel.addTrauma(hot ? 0.18 : 0.1);
      if (hot) S.slow = Math.min(S.slow, 0.55);
      feel.buzz(hot ? 24 : 12);
      bump(ui.score, hot ? 'bump-hot' : 'bump');
    }
    for (const o of ev.erupts) {
      // lava geyser blows: droplets, steam, a whoosh, and a jolt when it is close
      const near = o.d - S.dist;
      if (near < 130) sound.erupt(clamp(1 - near / 130, 0.15, 1));
      if (near < 60) feel.addTrauma(0.05 + 0.13 * (1 - near / 60));
      particles.burst(o.x, 0.6, -o.d, 26, 3.2, 10, 1.4, 0.14, emberHot, 1.0);
      particles.burst(o.x, 0.4, -o.d, 8, 1.2, 2.5, 2.2, 0.8, steamC, 1.6, 0.6);
    }
    for (const o of ev.impacts) {
      if (o.d - S.dist < 90) { feel.addTrauma(0.25 * (1 - (o.d - S.dist) / 90) + 0.1); sound.splash(); }
    }
    for (const g of ev.gates) {
      S.bonus += g.bonus;
      popup(g.label, `+${g.bonus}`, 'cyan');
      sound.pickup();
      bump(ui.score);
      feel.buzz(10);
    }
    if (ev.pickup) {
      if (ev.pickup === 'shield') { S.shield = S.shieldMax; popup('KALKAN!', 'bir çarpışmayı affeder', 'cyan'); }
      else { S.magnet = S.magnetMax; popup('MIKNATIS!', 'altınlar sana gelir', 'red'); }
      sound.pickup();
      feel.buzz(18);
      particles.burst(S.x, 1.0, -S.dist - 0.5, 30, 3, 4, 0.8, 0.12, ev.pickup === 'shield' ? cyan : gold, 1, -4);
    }
    if (ev.hit) {
      const o = ev.hit;
      if (S.invuln > 0 || (__ADMIN__ && S.god)) { /* grace period (or admin god mode) */ }
      else if (S.shield > 0) {
        S.shield = 0; S.invuln = 1.2;
        feel.addTrauma(0.45); feel.hitStop(0.05); feel.buzz(40);
        obstacles.smash(o);
        sound.shieldBreak();
        particles.burst(o.x, 0.6, -o.d, 40, 6, 5, 0.9, 0.14, cyan, 1.2);
        particles.burst(o.x, 0.4, -o.d, 30, 4, 4, 1.0, 0.12, spray, 1.2);
        popup('KALKAN KIRILDI', '', 'cyan');
      } else if (S.armor > 0) {
        S.armor--; S.invuln = 1.4;
        feel.addTrauma(0.5); feel.hitStop(0.06); feel.buzz(45);
        obstacles.smash(o);
        sound.shieldBreak();
        particles.burst(o.x, 0.6, -o.d, 40, 6, 5, 0.9, 0.14, gold, 1.2);
        particles.burst(o.x, 0.4, -o.d, 30, 4, 4, 1.0, 0.12, spray, 1.2);
        popup('ZIRH!', 'gemi darbeyi aldı', 'hot');
      } else if (S.perk.dive && S.diveCD <= 0) {
        S.diveT = 1.35; S.invuln = 1.45; S.diveCD = 20;
        sound.wave(0.8);
        feel.addTrauma(0.2); feel.buzz(20);
        particles.burst(S.x, 0.3, -S.dist, 40, 3, 2.5, 0.8, 0.12, spray, 1.4);
        popup('DALIŞ!', 'engelin altından geçtin', 'cyan');
      } else { die(o); return; }
    }
  }
  for (const o of obstacles.erupting) {
    if (o.d - S.dist > 110 || Math.random() > 0.7) continue;
    particles.emit(o.x + (Math.random() - 0.5) * 0.7, 0.8 + Math.random() * o.erupt * 6, -o.d,
      (Math.random() - 0.5) * 3, 4 + Math.random() * 5, (Math.random() - 0.5) * 3, 1.0, 0.08 + Math.random() * 0.08, emberHot, -9.8, 0.4);
  }
  // magma crust hisses: steam wisps where hot rock meets the river
  if (Math.random() < dt * 9) {
    for (const o of obstacles.list) {
      if (o.type !== 'crust' || o.d - S.dist > 90 || o.d < S.dist - 4 || Math.random() > 0.35) continue;
      const a = Math.random() * Math.PI * 2;
      particles.emit(o.x + Math.cos(a) * o.r * 0.9, 0.15, -o.d + Math.sin(a) * o.r * 0.9,
        (Math.random() - 0.5) * 0.4, 0.9 + Math.random() * 0.8, -S.speed * 0.15, 1.6, 0.35 + Math.random() * 0.3, steamC, 0.3, 0.6, 0.45, 1.1);
    }
  }
  S.comboTimer -= dt;
  if (S.comboTimer <= 0) S.combo = 0;
  S.shield = Math.max(0, S.shield - dt);
  S.magnet = Math.max(0, S.magnet - dt);
  S.invuln = Math.max(0, S.invuln - dt);
  S.diveT = Math.max(0, S.diveT - dt);
  const dcd = S.diveCD;
  S.diveCD = Math.max(0, S.diveCD - dt);
  if (dcd > 0 && S.diveCD <= 0 && S.perk.dive) popup('DALIŞ HAZIR', '', 'cyan');
  if (S.hintT > 0) { S.hintT -= dt; if (S.hintT <= 0 || S.dragged) ui.hint.classList.remove('show'); }

  // biome change banner
  const k = biomeAt(S.dist + 20).k;
  if (k !== S.biomeK) { S.biomeK = k; showBanner(k); sound.biome(); }

  emitTrail(dt, false);
  // bow spray: fine droplets thrown up where the bow cuts the water; they ride along with the raft for a moment
  const z = -S.dist;
  const sp = Math.min(1, S.speed / 30);
  const vc = raft ? raft.cfg : { bowZ: -2, halfW: 0.9 }, vb = vc.bowZ, vw = vc.halfW / 0.9;
  const under = raft && raft.dive > 0.4;
  S.sprayAcc = under ? 0 : (S.sprayAcc || 0) + dt * (40 + 70 * sp);
  const nb = Math.min(8, Math.floor(S.sprayAcc));
  S.sprayAcc -= nb;
  for (let n = 0; n < nb; n++) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const t = Math.random();
    particles.emit(S.x + side * (0.25 + t * 0.8) * vw, 0.08 + Math.random() * 0.08, z + vb + t * t * 1.1,
      side * (0.6 + Math.random() * 1.8) + S.vx * 0.3, 0.9 + Math.random() * 2.0 * (0.4 + sp), -S.speed * (0.72 + Math.random() * 0.2),
      0.35 + Math.random() * 0.3, 0.035 + Math.random() * 0.05, spray, -9, 1.6);
  }
  // steering hard: the tube on the outside of the turn shoves water sideways
  if (Math.abs(S.vx) > 4) {
    const side = Math.sign(S.vx);
    const k = Math.min(1, (Math.abs(S.vx) - 4) / 9);
    S.sideAcc = (S.sideAcc || 0) + dt * 60 * k;
    const ns = Math.min(6, Math.floor(S.sideAcc));
    S.sideAcc -= ns;
    for (let n = 0; n < ns; n++) {
      particles.emit(S.x + side * (vc.halfW + 0.18), 0.08, z + (Math.random() - 0.7) * 2.8,
        side * (1.6 + Math.random() * 2.6) + S.vx * 0.15, 1.2 + Math.random() * 2.2 * k, -S.speed * (0.6 + Math.random() * 0.3),
        0.45, 0.04 + Math.random() * 0.06, spray, -9, 1.4);
    }
  }
  // motor vessels churn white water behind the stern
  if (vc.motor || vc.dive) {
    S.propAcc = (S.propAcc || 0) + dt * (18 + 40 * sp);
    const np = Math.min(6, Math.floor(S.propAcc));
    S.propAcc -= np;
    const zs = -vb + 0.1;
    for (let n = 0; n < np; n++) {
      particles.emit(S.x + (Math.random() - 0.5) * 0.35, 0.02, z + zs + Math.random() * 0.4,
        (Math.random() - 0.5) * 1.4, 0.6 + Math.random() * 1.4 * (0.4 + sp), -S.speed * (0.35 + Math.random() * 0.3),
        0.3 + Math.random() * 0.25, 0.05 + Math.random() * 0.06, spray, -8, 1.2, 0.8, 0.6);
    }
  }
}

/** waves hit the bow every few seconds: pitch up, a curtain of spray, then the slap as it drops back */
function stepWaves(dt) {
  const playing = S.mode === 'play';
  if (!raft || (S.mode !== 'play' && S.mode !== 'menu')) return;
  const sp = playing ? Math.min(1, S.speed / 30) : 0;
  const rapid = obstacles.rapidAt ? obstacles.rapidAt(S.dist) : 0;
  const amp = water.uniforms.uWaveAmp.value;
  S.hitFoam = Math.max(0, S.hitFoam - dt * 1.4);
  S.waveT -= dt;
  if (S.waveT <= 0) {
    S.waveT = playing ? (2.3 - 0.9 * rapid - 0.5 * sp) * (0.6 + Math.random() * 0.8) : 3.5 + Math.random() * 3;
    const s = playing ? 0.4 + 0.35 * sp + 0.45 * rapid + (amp - 0.1) * 2 + Math.random() * 0.25 : 0.22 + Math.random() * 0.12;
    waveHit(s, sp);
    S.slapT = 0.42; S.slapS = s;
  }
  if (S.slapT > 0) {
    S.slapT -= dt;
    if (S.slapT <= 0) slap(S.slapS, sp);
  }
}

// water thrown on the "lens" for big wave hits
let lensEl = null;
function lensSplash(s) {
  if (S.time - S.lensT < 2.5 || feel.shake === 0) return;
  S.lensT = S.time;
  if (!lensEl) lensEl = $('lens');
  if (!lensEl) return;
  const g = [];
  const n = 5 + Math.round(6 * s);
  for (let i = 0; i < n; i++) {
    const x = (Math.random() * 100).toFixed(1), y = (35 + Math.random() * 65).toFixed(1), r = Math.round(10 + Math.random() * 26);
    g.push(`radial-gradient(circle at ${x}% ${y}%, rgba(255,255,255,0) ${r - 6}px, rgba(235,248,255,.55) ${r - 2}px, rgba(255,255,255,.12) ${r}px, rgba(255,255,255,0) ${r + 3}px)`);
  }
  g.push('linear-gradient(to top, rgba(236,248,255,.55), rgba(236,248,255,0) 38%)');
  lensEl.style.background = g.join(',');
  lensEl.style.setProperty('--k', Math.min(1, 0.45 + s * 0.6).toFixed(2));
  bump(lensEl, 'on');
}

function waveHit(s, sp) {
  raft.waveHit(s);
  if (raft.dive > 0.4) return;
  s *= Math.min(1, 0.4 + (raft.cfg.mass ? 0.6 / raft.cfg.mass : 0.6)) ;
  S.hitFoam = Math.max(S.hitFoam, Math.min(1, s * 1.1));
  if (S.mode === 'play') {
    sound.wave(s);
    // make the hit readable, not just audible: the camera rides the bow, a light shake,
    // and big hits throw water on the "lens"
    S.camKickV += 2.2 * s;
    feel.addTrauma(0.06 + 0.12 * s);
    if (s > 0.55) { feel.buzz(Math.round(8 + 14 * s)); lensSplash(s); }
  }
  const z = -S.dist, fwd = S.speed;
  const vc = raft.cfg, vb = vc.bowZ, vw = vc.halfW / 0.9;
  const n = Math.round(10 + 34 * s);
  for (let i = 0; i < n; i++) {
    // curtain along the bow curve, thrown outward, up and back over the crew
    const u = (Math.random() * 2 - 1);
    const side = Math.sign(u) || 1;
    const lat = Math.abs(u);
    particles.emit(S.x + u * 0.9 * vw, 0.12, z + vb + lat * lat * 0.9,
      side * (0.5 + lat * 2.8) * (0.5 + s) + S.vx * 0.3, (2.2 + Math.random() * 3.2) * (0.55 + s * 0.8), -fwd * (0.55 + Math.random() * 0.35) + 0.6,
      0.55 + Math.random() * 0.45, 0.07 + Math.random() * 0.11 * (0.6 + s), spray, -9.5, 1.2);
  }
  // a tall white plume over the bow that stands out against the river and the sky
  if (S.mode === 'play') for (let i = 0; i < 6 + 14 * s; i++) {
    const u = Math.random() * 2 - 1;
    particles.emit(S.x + u * 0.7 * vw, 0.3, z + vb + 0.1,
      u * 1.2 + S.vx * 0.3, 3.4 + Math.random() * 2.8 * (0.6 + s), -fwd * 0.82 + 0.8,
      0.55 + Math.random() * 0.3, 0.22 + Math.random() * 0.22 * s, spray, -7, 1.6, 0.6, 1.2);
  }
  // white water mist bursting off the bow tube
  for (let i = 0; i < 4 + 10 * s; i++) {
    const u = Math.random() * 2 - 1;
    particles.emit(S.x + u * 0.85 * vw, 0.15 + Math.random() * 0.2, z + vb + 0.05 + u * u * 0.8,
      u * 1.6 + S.vx * 0.3, 1.2 + Math.random() * 1.8 * s, -fwd * (0.75 + Math.random() * 0.2) + 0.4,
      0.3 + Math.random() * 0.25, 0.17 + Math.random() * 0.17 * s, spray, -3, 2.2, 0.42, 1.4);
  }
  // a few heavier drops that land in the raft
  for (let i = 0; i < 5 * s; i++) {
    particles.emit(S.x + (Math.random() - 0.5) * 0.8, 0.3, z + vb + 0.1,
      (Math.random() - 0.5) * 1.2, 2.6 + Math.random() * 1.6, -fwd * (0.9 + Math.random() * 0.1) + 1.6 + Math.random() * 1.5,
      0.6, 0.05 + Math.random() * 0.04, spray, -9.5, 0.4);
  }
}

function slap(s, sp) {
  if (raft.dive > 0.4) return;
  const z = -S.dist, fwd = S.speed;
  const vc = raft.cfg;
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6 + 14 * s; i++) {
      particles.emit(S.x + side * (vc.halfW + 0.05 + Math.random() * 0.15), 0.05, z - 1.6 + Math.random() * 1.6,
        side * (1.2 + Math.random() * 2.4) * (0.5 + s), 1.0 + Math.random() * 2.0 * (0.5 + s), -fwd * (0.6 + Math.random() * 0.3) + 0.4,
        0.45 + Math.random() * 0.3, 0.04 + Math.random() * 0.06, spray, -9.5, 1.3);
    }
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 2 + 5 * s; i++) {
      particles.emit(S.x + side * (vc.halfW + 0.15), 0.12, z - 1.2 + Math.random() * 1.4,
        side * (0.8 + Math.random()) , 0.6 + Math.random() * s, -fwd * (0.8 + Math.random() * 0.15) + 0.3,
        0.28 + Math.random() * 0.2, 0.2 + Math.random() * 0.18 * s, spray, -2, 2.4, 0.4, 1.5);
    }
  }
  S.hitFoam = Math.max(S.hitFoam, s * 0.7);
}

const _tc = new THREE.Color();
function emitTrail(dt, preview) {
  const t = trailSkin;
  if (!t || (!t.color && !t.rainbow)) return;
  const z = -S.dist;
  S.trailAcc = (S.trailAcc || 0) + dt * 95; // particles per second, frame-rate independent
  const n = Math.min(12, Math.floor(S.trailAcc));
  S.trailAcc -= n;
  for (let i = 0; i < n; i++) {
    if (t.rainbow) _tc.setHSL((S.time * 0.35 + Math.random() * 0.12) % 1, 0.95, 0.6);
    else _tc.set(t.color);
    _tc.multiplyScalar(t.glow || 2);
    const side = Math.random() < 0.5 ? -1 : 1;
    particles.emit(S.x + side * (0.35 + Math.random() * 0.55), 0.25 + Math.random() * 0.5, z + 1.9 + Math.random() * 0.3,
      (Math.random() - 0.5) * 0.6, (t.up || 0.5) * (0.5 + Math.random()), preview ? 2.6 + Math.random() : (Math.random() - 0.5) * 0.4,
      0.9 + Math.random() * 0.6, 0.06 + Math.random() * 0.07, _tc, t.up > 1 ? 0.6 : -0.6, 1.4);
  }
}

function stepDying(dt, rdt) {
  S.dieT += rdt;
  S.slow = damp(S.slow, 1, 2, rdt);
  S.speed = damp(S.speed, 0, 2.5, dt);
  S.dist += S.speed * dt;
  raft.crash = Math.min(1, S.dieT * 1.6);
  obstacles.update(dt, S.time, S.dist, S.x, { spawn: false, collide: false });
  if (S.dieT > 1.5) gameOver();
}

function updateTrail(dt, z0) {
  // advect existing wake points with the current, age them
  const tr = water.trail;
  for (const v of tr) {
    if (v.w <= 0) continue;
    v.z = Math.min(1, v.z + dt / 0.85);
    v.y -= S.flowSpeed * 0.3 * dt;
    if (v.z >= 1) v.w = 0;
  }
  trailT += dt;
  if (trailT > 0.1) {
    trailT = 0;
    for (let i = MAX_TRAIL - 1; i > 1; i--) tr[i].copy(tr[i - 1]);
  }
  // newest point is glued to the stern so the wake starts right at the raft
  tr[0].set(S.x, z0 + (raft ? raft.cfg.hull[1] - 0.3 : 1.7), 0, S.mode === 'play' ? 1 : S.mode === 'menu' ? 0.25 : 0);
  if (trailT === 0) tr[1].copy(tr[0]);
}

function fillFoam() {
  const slots = water.obs;
  let n = 0;
  const z = -S.dist;
  if (raft) for (const b of raft.blades) if (n < MAX_OBS && b.s > 0.05) slots[n++].set(b.x, b.z, 0.14, -0.55 * b.s);
  return obstacles.fillFoam(slots, n, S.dist);
}

const look = new THREE.Vector3();
const shakeOff = { x: 0, y: 0, roll: 0 };
const _gp = new THREE.Vector3(), _gl = new THREE.Vector3(), _mp = new THREE.Vector3(), _ml = new THREE.Vector3();
function updateCamera(dt, rdt) {
  const aspect = W / H;
  let vfov = aspect < 1 ? 2 * Math.atan(Math.tan(21 * DEG) / aspect) / DEG : 55;
  vfov = clamp(vfov, 50, 78) + Math.max(0, S.speed - 13) * 0.2;
  if (Math.abs(camera.fov - vfov) > 0.01) { camera.fov = vfov; camera.updateProjectionMatrix(); }
  const z = -S.dist;
  const playing = S.mode !== 'menu';
  S.camBlend = damp(S.camBlend, playing ? 1 : 0, 2.2, rdt);
  S.camX = damp(S.camX, S.x * 0.6, 4, dt);
  // gameplay camera
  const lift = raft ? raft.cfg.camLift || 0 : 0;
  _gp.set(S.camX, 6.9 + lift, z + 8.4 + lift * 0.6);
  _gl.set(S.camX * 0.6 + S.x * 0.25, 0.4, z - 13);
  // menu camera: low, swaying around the crew
  S.shopK = damp(S.shopK, S.shopOpen ? 1 : 0, 4, rdt);
  S.shopSide = damp(S.shopSide || 0, S.shopOpen && shop.cat === 'trail' ? 1 : 0, 2.5, rdt);
  const a = Math.sin(S.time * 0.16) * 0.55 * (1 - S.shopSide) + S.shopK * Math.sin(S.time * 0.23) * 0.5 * (1 - S.shopSide) + S.shopSide * 1.25;
  const rad = 1 - S.shopK * 0.22;
  const tall = raft ? raft.cfg.camLift || 0 : 0;
  _mp.set(S.x + Math.sin(a) * 6.2 * (rad + tall * 0.12), 2.3 + S.shopK * 0.6 + tall * 0.8, z + Math.cos(a) * 6.6 * (rad + tall * 0.12) - 0.6);
  _ml.set(S.x, 0.9 - S.shopK * 0.2 + tall * 0.6, z - 1.6 + S.shopK * 1.4);
  const b = S.camBlend * S.camBlend * (3 - 2 * S.camBlend);
  camera.position.copy(_mp).lerp(_gp, b);
  look.copy(_ml).lerp(_gl, b);
  feel.offset(rdt, shakeOff);
  camera.position.x += shakeOff.x;
  camera.position.y += shakeOff.y;
  // wave hits: the camera rides up with the bow and drops back (damped spring, real time)
  S.camKickV += (-55 * S.camKick - 8.5 * S.camKickV) * Math.min(rdt, 1 / 30);
  S.camKick += S.camKickV * Math.min(rdt, 1 / 30);
  const kk = S.camKick * (0.35 + 0.65 * feel.shake);
  camera.position.y += kk * 0.45;
  look.y += kk * 1.1;
  if (window.__camOverride) {
    const o = window.__camOverride;
    camera.position.set(S.x + o[0], o[1], z + o[2]);
    look.set(S.x + o[3], o[4], z + o[5]);
  }
  camera.lookAt(look);
  if (shakeOff.roll) camera.rotateZ(shakeOff.roll);
  // shop: shift the picture so the raft sits beside the panel (landscape) or above the bottom sheet (portrait)
  const side = W > H * 1.1;
  const offX = side ? S.shopK * Math.min(430, W * 0.46) * 0.5 : 0;
  const offY = side ? 0 : S.shopK * H * 0.24;
  if (offX + offY > 0.5) camera.setViewOffset(W, H, offX, offY, W, H);
  else if (camera.view && camera.view.enabled) camera.clearViewOffset();
  particles.uniforms.uScale.value = (H * pixelRatio) / (2 * Math.tan((camera.fov * DEG) / 2));
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const rdt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  if (S.mode === 'paused') { render(); return; }
  // slow-motion dips recover in real time during play; hit-stop freezes game time only
  if (S.mode === 'play' && S.slow < 1) S.slow = Math.min(1, S.slow + rdt * 1.4);
  const dt = rdt * S.slow * feel.tick(rdt) * (__ADMIN__ ? S.timeMul || 1 : 1);
  const tStart = performance.now();
  S.time += dt;
  G.uTime.value = S.time;

  if (S.mode === 'play') stepPlay(dt);
  else if (S.mode === 'dying') stepDying(dt, rdt);
  else if (S.mode === 'menu' || S.mode === 'over') {
    obstacles.update(dt, S.time, S.dist, S.x, { spawn: false, collide: false });
    if (S.mode === 'menu' && S.shopOpen) emitTrail(dt, true);
  }
  stepWaves(dt);

  const z = -S.dist;
  S.flowSpeed = S.mode === 'menu' ? 3.0 : 2.5 + S.speed * 0.45;
  S.flow += S.flowSpeed * dt;
  terrain.update(S.dist);
  updateAtmosphere(S.dist);
  env.update(scene, rdt, atm.envKey);

  // lightning in storms
  if (atm.lightning > 0.5 && atm.rain > 0.5) {
    S.lightningT -= dt;
    if (S.lightningT <= 0) {
      S.lightningT = 5 + Math.random() * 8;
      S.flash = 1;
      setTimeout(() => { S.flash = Math.max(S.flash, 0.8); }, 140);
      sound.thunder(0.35 + Math.random() * 0.9);
    }
  }
  S.flash = Math.max(0, S.flash - rdt * 4.5);
  const fl = S.flash * S.flash;
  sky.u.uFlash.value = fl; sky.mu.uFlash.value = fl; water.uniforms.uFlash.value = fl;
  renderer.toneMappingExposure = (atm.exposure || 1) + fl * 0.7;
  hemi.intensity += fl * 1.5;

  // bend: the river seems to wind left and right
  const bx = 0.00068 * Math.sin(S.dist * 0.0043 + 1.1) + 0.00028 * Math.sin(S.dist * 0.011 + 2.0);
  G.uBend.value.set(bx, -0.0004);

  // water
  const wu = water.uniforms;
  wu.uTime.value = S.time;
  wu.uFlow.value = S.flow;
  wu.uRain.value = atm.rain;
  wu.uStreak.value = S.mode === 'play' ? clamp((S.speed - 14) / 30, 0, 0.7) : 0;
  wu.uRapid.value = obstacles.rapidAt ? obstacles.rapidAt(S.dist) : 0;
  const afloat = raft && raft.crash <= 0 && S.mode !== 'dying';
  wu.uRaft.value.set(S.x, z, raft ? raft.body.rotation.y : 0, afloat ? 1 : 0);
  if (raft) {
    const c = raft.cfg;
    wu.uHull.value.set(c.hull[0], c.hull[1], c.dry ? c.dry[0] : 0, c.dry ? c.dry[1] : 0);
  }
  wu.uRaftB.value.set(S.vx, S.mode === 'play' ? clamp(S.speed / 32, 0, 1) : 0.15, S.hitFoam, 0);
  water.mesh.position.set(0, 0, Math.round((z - 140) / 2) * 2);
  water.shore.fill(S.dist, shoreWiggle);
  wu.uObsCount.value = fillFoam();
  updateTrail(dt, z);

  // sun / shadows follow the raft
  sun.target.position.set(S.x * 0.5, 0, z - 12);
  sun.position.copy(sun.target.position).addScaledVector(sky.u.uSunDir.value, 90);

  // headlamp (night)
  const li = atm.lampI;
  lamp.intensity = li * 900;
  lamp.position.set(S.x, 2.3, z - 0.6);
  lamp.target.position.set(S.x + S.vx * 0.5, 0, z - 22);
  G.uLamp.value.set(lamp.position.x, lamp.position.y, lamp.position.z, li * 1.6);
  G.uLampDir.value.copy(lamp.target.position).sub(lamp.position).normalize();

  if (raft) {
    raft.setLantern(atm.lantern);
    raft.shield.visible = S.shield > 0 && (S.shield > 2.5 || Math.sin(S.time * 20) > 0);
    raft.dive = damp(raft.dive, S.diveT > 0.3 && S.mode === 'play' ? 1 : 0, S.diveT > 0.3 ? 9 : 4, dt);
    raft.racing = S.mode === 'play' || S.mode === 'paused';
    raft.update(dt, S.time, S.x, S.dist, S.vx, S.flow, wu.uWaveAmp.value, S.speed);
  }
  obstacles.render(S.time, atm);
  life.update(dt, S.time, S.dist, Math.max(S.speed, 0.0), atm.biome, atm.foam);
  volcano.update(rdt, S.dist, volcanoWeight(S.dist), S.mode === 'play' ? S.speed : 0, particles, () => {
    if (S.mode !== 'play') return;
    sound.thunder(0.05);
    feel.addTrauma(0.22);
    S.flash = Math.max(S.flash, 0.3);
  });
  particles.update(dt);
  sound.ambience(S.speed, atm.rain, atm.wind, S.mode === 'play');

  updateCamera(dt, rdt);
  for (const k in weather) weather[k].update(S.time, camera.position, atm.weather[k] || 0);
  // sky follows camera
  sky.sky.position.copy(camera.position);
  sky.mtn.position.copy(camera.position);
  sky.u.uTime.value = S.time;
  sky.u.uCloudOff.value = S.dist * 0.00035;
  G.uBendO.value.x = camera.position.z;

  if (S.mode === 'play') updateHud();
  S.cpuMs = (S.cpuMs || 0) * 0.9 + (performance.now() - tStart) * 0.1;
  render();

  // adaptive quality
  if (S.mode === 'play' && !window.__noAdapt) {
    fpsT += rdt; fpsN++;
    if (fpsT > 3) {
      const fps = fpsN / fpsT;
      if (fps < 45 && qLevel < Q.length - 1) { qLevel++; applyQuality(); }
      fpsT = 0; fpsN = 0;
    }
  }
}

const passInfo = { refl: 0, main: 0, reflCalls: 0, mainCalls: 0 };
function render() {
  renderer.info.reset();
  const wu = water.uniforms;
  // the reflection pass reuses last frame's shadow map; the main pass refreshes it
  renderer.shadowMap.needsUpdate = false;
  if (refl.enabled) {
    refl.render(scene, camera, look);
    wu.uReflTex.value = refl.rt.texture;
    wu.uReflOn.value = 1;
  } else wu.uReflOn.value = 0;
  passInfo.refl = renderer.info.render.triangles; passInfo.reflCalls = renderer.info.render.calls;
  renderer.shadowMap.needsUpdate = true;
  if (post.enabled) post.render(scene, camera);
  else { renderer.setRenderTarget(null); renderer.render(scene, camera); }
  passInfo.main = renderer.info.render.triangles - passInfo.refl; passInfo.mainCalls = renderer.info.render.calls - passInfo.reflCalls;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
let ready = false;
seedNoise(S.seed);
resetWorld(false);
updateAtmosphere(0);
applyQuality();
loadAssets().then((assets) => {
  raft = new Raft(scene, assets);
  obstacles.setProps(assets.props);
  const ember = new THREE.Color('#ff8a3a');
  const dust = new THREE.Color('#c08a62'), pebble = new THREE.Color('#7a3e26');
  obstacles.setFx((o) => {
    const c = o.fall.lava ? ember : atm.foam || spray;
    particles.burst(o.x, 0.3, -o.d, 46, 4.5, 8, 1.3, 0.12, c, 1.6);
    particles.burst(o.x, 0.2, -o.d, 12, 2, 3, 1.6, 0.5, atm.foam || spray, 2.4, -3);
    if (!o.fall.lava) {
      // canyon rockslide: a red dust cloud and flying pebbles
      particles.burst(o.x, 0.8, -o.d, 14, 1.6, 1.6, 2.4, 1.1, dust, 2.6, 0.3);
      particles.burst(o.x, 0.5, -o.d, 16, 5, 6, 1.1, 0.09, pebble, 1.2);
    }
  });
  terrain.setProps && terrain.setProps(assets.props);
  raft.onSplash = (x, zz, s) => {
    for (let i = 0; i < 7 * s; i++) {
      particles.emit(x + (Math.random() - 0.5) * 0.3, 0.05, zz + (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 1.6, 1.2 + Math.random() * 1.8, 0.8 + Math.random() * 1.2, 0.5, 0.04 + Math.random() * 0.05, spray, -9, 1.0);
    }
  };
}).catch((e) => { console.error('asset load failed', e); }).finally(() => {
  if (!raft) raft = new Raft(scene, null); // never leave the game without a raft
  applyEquipped();
  save.onChange(() => { if (!S.shopOpen) applyEquipped(); });
  save.initCloud();
  ready = true;
  env.update(scene, 1, atm.envKey, true);
  requestAnimationFrame((t) => { last = t; frame(t); });
  setTimeout(() => $('loading').classList.add('gone'), 200);
});

// debug hooks for automated tests
window.__akinti = {
  S, startRun, restart,
  jump(d, ahead = 40) { S.dist = d; terrain.reset(d); obstacles.reset(); obstacles.nextD = d + ahead; water.shore.reset(); },
  obstacles, life, weather, terrain,
  meshStats() { const out = []; scene.traverse((o) => { if (o.isMesh && o.visible) { const g = o.geometry; const tris = (g.index ? g.index.count : g.attributes.position.count) / 3; const n = o.isInstancedMesh ? o.count : 1; if (tris * n > 4000) out.push([o.name || o.material.type, Math.round(tris), n, Math.round(tris * n), o.castShadow ? 'S' : '', o.layers.mask]); } }); return out.sort((a, b) => b[3] - a[3]).slice(0, 25); },
  shop, save, openShop, get raft() { return raft; }, camera, scene, sun, shopItem: item,
  over: () => { S.coins = 37; S.nearCount = 5; S.bonus = 450; S.dist = 1234; gameOver(); },
  quality: () => ({ qLevel, pixelRatio, post: post.enabled, refl: refl.enabled, samples: post.samples, hdr: post.supported }),
  setQ(l) { qLevel = l; applyQuality(); },
  tm(n) { renderer.toneMapping = n; },
  steer(x) { S.targetX = x; },
  info: () => ({ pass: passInfo, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, obstacles: obstacles.list.length, coins: obstacles.coins.length, cpu: S.cpuMs }),
  feel,
  get ready() { return ready; },
};

// YÖNETİCİ MODU (test panel). Compiled out of normal/store builds: see README "Yayın öncesi".
if (__ADMIN__) {
  installAdmin({
    S, save, CATALOG, BIOMES, biomeStart, startRun, restart, togglePause, popup, sound, applyEquipped,
    jump: window.__akinti.jump,
    over: () => { S.coins = Math.max(S.coins, 37); S.nearCount = Math.max(S.nearCount, 5); S.dist = Math.max(S.dist, 1234); gameOver(); },
  });
}
