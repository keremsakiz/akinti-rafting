import * as THREE from 'three';
import { BIOME_TRANS, biomeStart, biomeIndex, clamp, smooth01, lerp } from './config.js';

// Every 500 m the banks change (like Icy Tower's themes). The river stays.
const RAW = [
  {
    id: 'valley', name: 'YEŞİL VADİ',
    sky: { top: '#3c86da', horizon: '#cfe7f3', bottom: '#bcd9e4', cloud: '#ffffff', cloudShade: '#b9c9d6', cover: 0.42, stars: 0 },
    sun: { color: '#fff0d4', intensity: 2.9, elev: 40, azim: -58, size: 0.9994, glow: 1.0, moon: 0 },
    hemi: { sky: '#d2e8ff', ground: '#557a42', intensity: 1.15 },
    fog: { color: '#c8e2ee', near: 70, far: 255 },
    exposure: 1.0,
    water: { deep: '#0b5262', shallow: '#38a596', foam: '#f4fbff', refl: '#3b6b46', wave: 0.11, spec: 1.0, bed: '#7d7055', sunGain: 1.0 },
    ground: { wet: '#5e5a45', shore: '#c5b08a', grass1: '#6cb444', grass2: '#3d8a39', rock: '#8d8c84', snow: '#f4f7fb', lava: '#000000',
      strata: ['#8d8c84', '#8d8c84', '#8d8c84', '#8d8c84'] },
    terrain: { bank: 1.1, hill: 18, cliff: 0, cliffH: 0, wiggle: 1.6, rough: 1.0, snowLine: 999, mesa: 0, lava: 0, strata: 0 },
    mountains: { color: '#5f8f9f', far: '#9bbfcc', base: 0.035, amp: 0.11, mesa: 0, snow: 0.8 },
    grass: { n: 98, s: [0.3, 16], tints: ['#7cc04a', '#5aa83c', '#8fc85a'] },
    decorCount: 44,
    decor: [
      { type: 'pine', w: 5, s: [3, 70], sc: [0.85, 1.45], tints: ['#2f6b35', '#3a7a3a', '#28603a'] },
      { type: 'round', w: 3.5, s: [3, 60], sc: [0.8, 1.3], tints: ['#4f9a3a', '#5aa845', '#3f8a35', '#6aaa3a'] },
      { type: 'bush', w: 3, s: [1.2, 30], sc: [0.7, 1.3], tints: ['#4f9a3a', '#6aaa40', '#3f8a35'] },
      { type: 'reeds', w: 3, s: [-0.4, 1.4], sc: [0.8, 1.3], tints: ['#7aa64a', '#8ab04f'], minH: -0.5 },
      { type: 'boulder', w: 1.3, s: [-0.6, 25], sc: [0.4, 1.2], tints: ['#8a8a84', '#7a7a72'], minH: -0.6, maxSlope: 2 },
      { type: 'kRow', w: 1.2, s: [1.7, 3.4], sc: [1, 1], tints: ['#ffffff'], minH: -1.2, maxH: 0.15, maxSlope: 3 },
      { type: 'kFish', w: 0.9, s: [2.2, 3.6], sc: [1, 1], tints: ['#ffffff'], minH: -1.5, maxH: 0.05, maxSlope: 3 },
      { type: 'kSail', w: 0.6, s: [2.2, 3.6], sc: [1, 1], tints: ['#ffffff'], minH: -1.5, maxH: 0.05, maxSlope: 3 },
      { type: 'kDock', w: 1.0, s: [1.6, 2.6], sc: [1, 1], tints: ['#ffffff'], minH: -0.9, maxH: 0.2, maxSlope: 3 },
    ],
    weather: { pollen: 0.7 }, wind: 1.0, lightning: false,
    birds: '#26262a', fish: true,
    obstacles: { rock: 3, log: 1.4, whirl: 0, ice: 0, boat: 0.7, buoys: 0.6, bridge: 0.7, barrels: 0.5, slalom: 0.8 }, trees: 'leafy', treeTint: '#4f9a3a', bridge: 'wood',
    rock: { side: '#7d7e78', top: '#5a8a38', glow: 0 },
    log: '#ffffff', lantern: 0,
  },
  {
    id: 'autumn', name: 'SONBAHAR ORMANI',
    sky: { top: '#5f97d4', horizon: '#f7d7a4', bottom: '#ecc999', cloud: '#fff1e0', cloudShade: '#d9a98a', cover: 0.36, stars: 0 },
    sun: { color: '#ffd29a', intensity: 2.6, elev: 24, azim: -40, size: 0.9993, glow: 1.4, moon: 0 },
    hemi: { sky: '#ffe1b8', ground: '#6a4a2a', intensity: 1.05 },
    fog: { color: '#eccfa3', near: 60, far: 235 },
    exposure: 1.0,
    water: { deep: '#17444c', shallow: '#4c8c78', foam: '#fff6ea', refl: '#9a5a26', wave: 0.12, spec: 1.2, bed: '#6a5640', sunGain: 1.0 },
    ground: { wet: '#5a4632', shore: '#ad9068', grass1: '#a8903c', grass2: '#8a6a2a', rock: '#7f766a', snow: '#f4f7fb', lava: '#000000',
      strata: ['#7f766a', '#7f766a', '#7f766a', '#7f766a'] },
    terrain: { bank: 1.4, hill: 20, cliff: 0.1, cliffH: 4, wiggle: 1.4, rough: 1.1, snowLine: 999, mesa: 0, lava: 0, strata: 0 },
    mountains: { color: '#8a6a5a', far: '#c9a98f', base: 0.03, amp: 0.09, mesa: 0, snow: 0 },
    grass: { n: 70, s: [0.3, 14], tints: ['#b8a048', '#a08a3a', '#c8a850'] },
    decorCount: 46,
    decor: [
      { type: 'round', w: 6, s: [3, 65], sc: [0.8, 1.35], tints: ['#d9661c', '#e8a020', '#c0391b', '#e07a26', '#b5452a', '#d4a52a'] },
      { type: 'pine', w: 1.6, s: [4, 70], sc: [0.9, 1.4], tints: ['#2f5a33', '#3a6a3a'] },
      { type: 'bush', w: 3, s: [1.2, 30], sc: [0.7, 1.3], tints: ['#c8641f', '#a85a2a', '#d89a2a'] },
      { type: 'reeds', w: 2.2, s: [-0.4, 1.4], sc: [0.8, 1.2], tints: ['#b8a050', '#a89048'], minH: -0.5 },
      { type: 'boulder', w: 1.2, s: [-0.6, 25], sc: [0.4, 1.2], tints: ['#8a8078'], minH: -0.6, maxSlope: 2 },
      { type: 'kRow', w: 1.0, s: [1.7, 3.4], sc: [1, 1], tints: ['#ffffff'], minH: -1.2, maxH: 0.15, maxSlope: 3 },
      { type: 'kDock', w: 0.8, s: [1.6, 2.6], sc: [1, 1], tints: ['#ffffff'], minH: -0.9, maxH: 0.2, maxSlope: 3 },
    ],
    weather: { leaves: 1 }, wind: 1.3, lightning: false,
    birds: '#2a2220', fish: true,
    obstacles: { rock: 2.5, log: 2.4, whirl: 0, ice: 0, boat: 0.6, bridge: 0.7, barrels: 0.4, slalom: 0.6 }, trees: 'leafy', treeTint: '#d9661c', bridge: 'wood',
    rock: { side: '#857c72', top: '#b0702a', glow: 0 },
    log: '#ffffff', lantern: 0,
  },
  {
    id: 'canyon', name: 'KIZIL KANYON',
    sky: { top: '#3f66a8', horizon: '#ffbf86', bottom: '#f0ad84', cloud: '#ffe2c4', cloudShade: '#c98a6a', cover: 0.2, stars: 0 },
    sun: { color: '#ffb36e', intensity: 2.7, elev: 15, azim: 22, size: 0.9992, glow: 1.8, moon: 0 },
    hemi: { sky: '#ffd2a4', ground: '#8a4a2a', intensity: 1.0 },
    fog: { color: '#f0b088', near: 70, far: 250 },
    exposure: 1.0,
    water: { deep: '#21504f', shallow: '#5f9a7e', foam: '#fff2e2', refl: '#a3502c', wave: 0.1, spec: 1.4, bed: '#8a6046', sunGain: 0.9 },
    ground: { wet: '#7a5a45', shore: '#d2a679', grass1: '#c47a45', grass2: '#b0643a', rock: '#a54f2f', snow: '#f4f7fb', lava: '#000000',
      strata: ['#c4643a', '#9e4527', '#dd8f55', '#8a3b22'] },
    terrain: { bank: 0.5, hill: 7, cliff: 1, cliffH: 21, wiggle: 1.2, rough: 1.2, snowLine: 999, mesa: 1, lava: 0, strata: 1 },
    mountains: { color: '#a85a40', far: '#e09a78', base: 0.03, amp: 0.08, mesa: 1, snow: 0 },
    grass: { n: 35, s: [0.4, 12], tints: ['#c8a860', '#b09048'] },
    decorCount: 30,
    decor: [
      { type: 'cactus', w: 2.2, s: [3, 60], sc: [0.8, 1.35], tints: ['#5a8a3f', '#6a8a45'], maxSlope: 0.45 },
      { type: 'bush', w: 2.5, s: [1, 50], sc: [0.6, 1.1], tints: ['#a89050', '#8a7a40', '#b09a5a'], maxSlope: 0.6 },
      { type: 'boulder', w: 4, s: [-0.6, 60], sc: [0.5, 1.8], tints: ['#b8653a', '#a5552f', '#c4784a'], minH: -0.6, maxSlope: 2.5 },
      { type: 'deadTree', w: 0.8, s: [3, 50], sc: [0.8, 1.2], tints: ['#6a4a35'], maxSlope: 0.5 },
    ],
    weather: { dust: 0.8 }, wind: 1.4, lightning: false,
    birds: '#3a2a22', fish: false,
    obstacles: { rock: 4, log: 0.4, whirl: 0, ice: 0, fall: 1.7, bridge: 0.6, boat: 0.4, barrels: 0.4 }, trees: 'bare', bridge: 'stone',
    rock: { side: '#a8583a', top: '#c98a5a', glow: 0 },
    log: '#c8a888', lantern: 0,
  },
  {
    id: 'jungle', name: 'YAĞMUR ORMANI',
    sky: { top: '#46565f', horizon: '#8a9a98', bottom: '#7d8d8a', cloud: '#a3aeb0', cloudShade: '#56636a', cover: 0.95, stars: 0 },
    sun: { color: '#cfe0d6', intensity: 1.15, elev: 62, azim: -30, size: 0.9999, glow: 0.2, moon: 0 },
    hemi: { sky: '#b0c2c0', ground: '#2a3a2a', intensity: 1.45 },
    fog: { color: '#7e8f8c', near: 28, far: 175 },
    exposure: 1.0,
    water: { deep: '#1b382d', shallow: '#3c684a', foam: '#e2ebe4', refl: '#1f3a25', wave: 0.2, spec: 0.5, bed: '#3c3a2a', caustics: 0.3 },
    ground: { wet: '#4a3c2c', shore: '#5c4a36', grass1: '#2f6a2a', grass2: '#1f4f22', rock: '#4a5048', snow: '#f4f7fb', lava: '#000000',
      strata: ['#4a5048', '#4a5048', '#4a5048', '#4a5048'] },
    terrain: { bank: 1.0, hill: 15, cliff: 0.15, cliffH: 5, wiggle: 1.8, rough: 1.0, snowLine: 999, mesa: 0, lava: 0, strata: 0 },
    mountains: { color: '#3f554f', far: '#71837f', base: 0.04, amp: 0.12, mesa: 0, snow: 0 },
    grass: { n: 84, s: [0.3, 14], tints: ['#3a8a2a', '#2f7a28'] },
    decorCount: 62, extraDecor: 64, // rain forest: packed wall of trees (second pass in terrain.genDecor)
    decor: [
      { type: 'palm', w: 4, s: [1.2, 45], sc: [0.85, 1.35], tints: ['#3a8a2a', '#4a9a35', '#2f7a2a'] },
      { type: 'jungle', w: 8, s: [1.4, 70], sc: [0.85, 1.45], tints: ['#1f6a2a', '#2a7a30', '#195a25', '#2f8a36'] },
      { type: 'bush', w: 6, s: [0.6, 40], sc: [0.9, 1.7], tints: ['#2a7a2a', '#1f6a25', '#3a8a30'] },
      { type: 'reeds', w: 3, s: [-0.4, 1.4], sc: [0.9, 1.4], tints: ['#4a8a3a'], minH: -0.5 },
      { type: 'boulder', w: 1, s: [-0.6, 25], sc: [0.4, 1.1], tints: ['#5a6a55'], minH: -0.6, maxSlope: 2 },
      { type: 'kRow', w: 0.8, s: [1.7, 3.4], sc: [1, 1], tints: ['#ffffff'], minH: -1.2, maxH: 0.15, maxSlope: 3 },
    ],
    weather: { rain: 1 }, wind: 1.9, lightning: true,
    birds: null, fish: true,
    obstacles: { rock: 2, log: 2, whirl: 1.4, ice: 0, boat: 0.5, bridge: 0.6, barrels: 0.5 }, trees: 'leafy', treeTint: '#2a7a30', bridge: 'wood',
    rock: { side: '#575d54', top: '#3a7a2c', glow: 0 },
    log: '#9aa88a', lantern: 0,
  },
  {
    id: 'snow', name: 'KARLI ZİRVELER',
    sky: { top: '#7fa0c2', horizon: '#e2eaf2', bottom: '#d7e1ea', cloud: '#f4f7fa', cloudShade: '#a8b6c4', cover: 0.62, stars: 0 },
    sun: { color: '#ffffff', intensity: 1.9, elev: 30, azim: -55, size: 0.9995, glow: 0.6, moon: 0 },
    hemi: { sky: '#eaf2ff', ground: '#8a98a8', intensity: 1.35 },
    fog: { color: '#dbe4ec', near: 40, far: 205 },
    exposure: 0.95,
    water: { deep: '#18466a', shallow: '#5aa3c4', foam: '#ffffff', refl: '#c9d8e6', wave: 0.1, spec: 1.0, bed: '#6a7a88', caustics: 0.6 },
    ground: { wet: '#97a5b3', shore: '#e4ebf2', grass1: '#f3f7fb', grass2: '#e0e9f2', rock: '#6a707a', snow: '#f6f9fc', lava: '#000000',
      strata: ['#6a707a', '#6a707a', '#6a707a', '#6a707a'] },
    terrain: { bank: 1.6, hill: 34, cliff: 0.2, cliffH: 8, wiggle: 1.4, rough: 1.2, snowLine: -10, mesa: 0, lava: 0, strata: 0 },
    mountains: { color: '#8a9cb0', far: '#c4d2e0', base: 0.05, amp: 0.15, mesa: 0, snow: 0.35 },
    decorCount: 42,
    decor: [
      { type: 'snowPine', w: 7, s: [2, 80], sc: [0.8, 1.5], tints: ['#ffffff'] },
      { type: 'snowBoulder', w: 2.5, s: [-0.6, 50], sc: [0.5, 1.6], tints: ['#7a8088', '#6a7078'], minH: -0.6, maxSlope: 2.5 },
      { type: 'deadTree', w: 0.5, s: [3, 50], sc: [0.8, 1.2], tints: ['#4a4040'] },
    ],
    weather: { snow: 1 }, wind: 1.2, lightning: false,
    birds: null, fish: true,
    obstacles: { rock: 2, log: 0, whirl: 0, ice: 3, bridge: 0.6, buoys: 0.4, slalom: 0.4 }, trees: 'bare', bridge: 'snow',
    rock: { side: '#6d737c', top: '#f2f6fb', glow: 0 },
    log: '#ffffff', lantern: 0,
  },
  {
    id: 'night', name: 'AY IŞIĞI',
    sky: { top: '#0c1838', horizon: '#2e4478', bottom: '#1f2f58', cloud: '#3a4e84', cloudShade: '#161f42', cover: 0.3, stars: 1 },
    sun: { color: '#bcd0ff', intensity: 1.7, elev: 24, azim: 4, size: 0.99935, glow: 1.1, moon: 1 },
    hemi: { sky: '#6078c0', ground: '#1c2636', intensity: 1.35 },
    fog: { color: '#1e2f58', near: 48, far: 215 },
    exposure: 1.3, night: 1, lamp: 1, envI: 0.55,
    grade: { tint: '#d6e0ff', sat: 1.0, bloom: 0.8, contrast: 1.0, threshold: 0.85 },
    water: { deep: '#0c2850', shallow: '#235a86', foam: '#8ea4d2', refl: '#15294d', wave: 0.1, spec: 0.8, bed: '#2a3448', glow: '#2bc4ff', sunGain: 0.85, caustics: 0.15 },
    ground: { wet: '#2e3646', shore: '#4c566c', grass1: '#2c504c', grass2: '#22423f', rock: '#3c4454', snow: '#f4f7fb', lava: '#000000',
      strata: ['#3c4454', '#3c4454', '#3c4454', '#3c4454'] },
    terrain: { bank: 0.8, hill: 13, cliff: 0, cliffH: 0, wiggle: 1.8, rough: 1.0, snowLine: 999, mesa: 0, lava: 0, strata: 0 },
    mountains: { color: '#18264c', far: '#2c3f70', base: 0.035, amp: 0.1, mesa: 0, snow: 0 },
    grass: { n: 56, s: [0.3, 12], tints: ['#2c5a50', '#244c46'] },
    decorCount: 48,
    decor: [
      { type: 'pine', w: 4, s: [3, 70], sc: [0.9, 1.5], tints: ['#1a3a35', '#16302e'] },
      { type: 'round', w: 2, s: [3, 60], sc: [0.8, 1.3], tints: ['#1f4040', '#183535'] },
      { type: 'mushroom', w: 3.5, s: [0.4, 22], sc: [0.8, 1.7], tints: ['#3af0ff', '#b06aff', '#5aff9a', '#ff6ad5'] },
      { type: 'reeds', w: 3, s: [-0.4, 1.4], sc: [0.9, 1.3], tints: ['#2a4a3a'], minH: -0.5 },
      { type: 'deadTree', w: 1, s: [3, 50], sc: [0.8, 1.3], tints: ['#2a2a30'] },
      { type: 'boulder', w: 1, s: [-0.6, 25], sc: [0.4, 1.1], tints: ['#3a404a'], minH: -0.6, maxSlope: 2 },
      { type: 'lantern', w: 2.2, s: [0.8, 3.5], sc: [1, 1.1], tints: ['#ffffff'], maxSlope: 0.5 },
      { type: 'kHouse', w: 0.9, s: [2.4, 3.8], sc: [1, 1], tints: ['#ffffff'], minH: -1.5, maxH: 0.05, maxSlope: 3 },
      { type: 'kRow', w: 1.0, s: [1.7, 3.4], sc: [1, 1], tints: ['#ffffff'], minH: -1.2, maxH: 0.15, maxSlope: 3 },
      { type: 'kDock', w: 0.9, s: [1.6, 2.6], sc: [1, 1], tints: ['#ffffff'], minH: -0.9, maxH: 0.2, maxSlope: 3 },
    ],
    weather: { fireflies: 1 }, wind: 0.8, lightning: false,
    birds: null, fish: true,
    obstacles: { rock: 2.5, log: 1.5, whirl: 0, ice: 0, boat: 0.8, buoys: 1.3, bridge: 0.7, barrels: 0.4, slalom: 0.4 }, trees: 'leafy', treeTint: '#2a5550', bridge: 'wood',
    rock: { side: '#5a6274', top: '#3e6a68', glow: 0 },
    log: '#a0a8c0', lantern: 1,
  },
  {
    id: 'volcano', name: 'ATEŞ DAĞI',
    sky: { top: '#2e1010', horizon: '#c4542e', bottom: '#7c3224', cloud: '#6a3028', cloudShade: '#241010', cover: 0.72, stars: 0 },
    sun: { color: '#ff8c52', intensity: 2.0, elev: 14, azim: -15, size: 0.99955, glow: 1.6, moon: 0 },
    hemi: { sky: '#ffad8c', ground: '#3a1a12', intensity: 1.15 },
    fog: { color: '#7a3424', near: 38, far: 200 },
    exposure: 1.12, night: 0.35, lamp: 0.55, envI: 0.6,
    grade: { tint: '#ffe6d6', sat: 1.04, bloom: 1.0, contrast: 1.02, threshold: 0.85 },
    water: { deep: '#1c1517', shallow: '#3c2c2a', foam: '#e8b89a', refl: '#b8441e', wave: 0.12, spec: 0.75, bed: '#2e2420', glow: '#ff6a1a', sunGain: 1.0, caustics: 0.3 },
    ground: { wet: '#1e1a19', shore: '#2c2724', grass1: '#2f2a28', grass2: '#1f1b1a', rock: '#3a3230', snow: '#f4f7fb', lava: '#ff6a12',
      strata: ['#3a3230', '#2a2422', '#4a3a34', '#241e1c'] },
    terrain: { bank: 1.4, hill: 22, cliff: 0.5, cliffH: 10, wiggle: 1.4, rough: 1.7, snowLine: 999, mesa: 0, lava: 1, strata: 0.4 },
    mountains: { color: '#2a1414', far: '#5a2420', base: 0.04, amp: 0.14, mesa: 0, snow: 0 },
    decorCount: 34,
    decor: [
      { type: 'deadTree', w: 3, s: [2, 60], sc: [0.8, 1.3], tints: ['#2a2220', '#1f1a18'] },
      { type: 'boulder', w: 6, s: [-0.6, 70], sc: [0.5, 2.2], tints: ['#2f2a28', '#3a3230', '#252020'], minH: -0.6, maxSlope: 2.5 },
      { type: 'bush', w: 1, s: [1, 30], sc: [0.6, 1.0], tints: ['#3a3020'] },
    ],
    weather: { embers: 1, ash: 0.7 }, wind: 1.1, lightning: false,
    birds: null, fish: false,
    // ATEŞ DAĞI signature: lava geysers + drifting magma crust (no whirlpools / rockfall: those belong to the jungle / canyon)
    obstacles: { rock: 3.2, log: 0, whirl: 0, ice: 0, geyser: 2.4, crust: 1.7, bridge: 0.5, barrels: 0.2 }, bridge: 'stone',
    rock: { side: '#4a3e3a', top: '#6a3424', glow: 0.0 },
    log: '#ffffff', lantern: 1,
  },
];

const col = (h) => new THREE.Color(h);

const DEFAULTS = {
  night: 0, lamp: 0, envI: 0.7,
  water: { bed: '#6a6048', glow: '#30e0ff', sunGain: 1, caustics: 1 },
  grade: { tint: '#ffffff', sat: 1.05, bloom: 0.55, contrast: 1.04, threshold: 1.0 },
};
function withDefaults(b) {
  const o = { ...DEFAULTS, ...b };
  o.water = { ...DEFAULTS.water, ...b.water };
  o.grade = { ...DEFAULTS.grade, ...(b.grade || {}) };
  return o;
}

function convert(b0) {
  const b = withDefaults(b0);
  const o = JSON.parse(JSON.stringify(b));
  for (const k of ['top', 'horizon', 'bottom', 'cloud', 'cloudShade']) o.sky[k] = col(b.sky[k]);
  o.sun.color = col(b.sun.color);
  const el = (b.sun.elev * Math.PI) / 180, az = (b.sun.azim * Math.PI) / 180;
  o.sun.dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
  o.hemi.sky = col(b.hemi.sky); o.hemi.ground = col(b.hemi.ground);
  o.fog.color = col(b.fog.color);
  for (const k of ['deep', 'shallow', 'foam', 'refl', 'bed', 'glow']) o.water[k] = col(b.water[k]);
  o.grade.tint = col(b.grade.tint);
  for (const k of ['wet', 'shore', 'grass1', 'grass2', 'rock', 'snow', 'lava']) o.ground[k] = col(b.ground[k]);
  o.ground.strata = b.ground.strata.map(col);
  o.mountains.color = col(b.mountains.color); o.mountains.far = col(b.mountains.far);
  o.decor = b.decor.map((d) => ({ ...d, tints: d.tints.map(col) }));
  o.grass = b.grass ? { ...b.grass, tints: b.grass.tints.map(col) } : null;
  o.decorTotal = o.decor.reduce((a, d) => a + d.w, 0);
  o.rock.side = col(b.rock.side); o.rock.top = col(b.rock.top);
  o.log = col(b.log);
  o.birds = b.birds ? col(b.birds) : null;
  o.treeTint = b.treeTint ? col(b.treeTint) : null;
  return o;
}

export const BIOMES = RAW.map(convert);
export const NB = BIOMES.length;

/** biome blend at track distance d */
export function biomeAt(d, out = {}) {
  const dd = Math.max(0, d);
  const k = biomeIndex(dd);
  const local = dd - biomeStart(k);
  out.k = k;
  out.cur = k % NB;
  out.prev = (k - 1 + NB) % NB;
  out.t = k === 0 ? 1 : smooth01(local / BIOME_TRANS);
  return out;
}

// --- Terrain parameter blending (per row of a chunk) -----------------------
const TP_KEYS = ['bank', 'hill', 'cliff', 'cliffH', 'wiggle', 'rough', 'snowLine', 'mesa', 'lava', 'strata'];
export function makeTerrainParams() {
  const o = {};
  for (const k of TP_KEYS) o[k] = 0;
  o.g = { wet: new THREE.Color(), shore: new THREE.Color(), grass1: new THREE.Color(), grass2: new THREE.Color(),
    rock: new THREE.Color(), snow: new THREE.Color(), lava: new THREE.Color(), strata: [0, 1, 2, 3].map(() => new THREE.Color()) };
  return o;
}
const _bb = {};
export function terrainParamsAt(d, out) {
  biomeAt(d, _bb);
  const A = BIOMES[_bb.prev], B = BIOMES[_bb.cur], t = _bb.t;
  for (const k of TP_KEYS) {
    let a = A.terrain[k], b = B.terrain[k];
    if (k === 'snowLine') { a = Math.min(a, 200); b = Math.min(b, 200); }
    out[k] = lerp(a, b, t);
  }
  const g = out.g;
  for (const k of ['wet', 'shore', 'grass1', 'grass2', 'rock', 'snow', 'lava']) g[k].copy(A.ground[k]).lerp(B.ground[k], t);
  for (let i = 0; i < 4; i++) g.strata[i].copy(A.ground.strata[i]).lerp(B.ground.strata[i], t);
  return out;
}

export function pickWeighted(list, total, r) {
  let x = r * total;
  for (const it of list) { x -= it.w; if (x <= 0) return it; }
  return list[list.length - 1];
}

export { clamp };
