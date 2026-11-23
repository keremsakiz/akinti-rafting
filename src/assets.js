import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
// Characters: Quaternius "Universal Base Characters" (CC0), optimised.
// Props: Kenney "Watercraft Kit" (CC0).
import maleGlb from '../assets/male.glb';
import femaleGlb from '../assets/female.glb';
import kenneyGlb from '../assets/kenney.glb';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const parse = (u8) => new Promise((res, rej) => {
  const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  loader.parse(buf, '', res, rej);
});

export async function loadAssets() {
  await MeshoptDecoder.ready;
  const [male, female, kenney] = await Promise.all([parse(maleGlb), parse(femaleGlb), parse(kenneyGlb)]);
  const props = {};
  for (const c of kenney.scene.children) props[c.name.replace(/_\d+$/, '')] = c;
  return { male, female, props };
}
