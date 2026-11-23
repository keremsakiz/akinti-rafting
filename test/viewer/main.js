import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import maleGlb from '../../assets/male.glb';
import femaleGlb from '../../assets/female.glb';
import kenneyGlb from '../../assets/kenney.glb';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(900, 700);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#8ab');
scene.add(new THREE.HemisphereLight('#fff', '#445', 1.5));
const sun = new THREE.DirectionalLight('#fff', 2.5); sun.position.set(3, 5, 4); scene.add(sun);
const camera = new THREE.PerspectiveCamera(35, 900 / 700, 0.1, 100);
camera.position.set(0, 1.2, 6); camera.lookAt(0, 0.9, 0);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const parse = (buf) => new Promise((res, rej) => loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
window.go = async () => {
  const out = {};
  const [m, f, k] = await Promise.all([parse(maleGlb), parse(femaleGlb), parse(kenneyGlb)]);
  m.scene.position.x = -0.8; f.scene.position.x = 0.8;
  scene.add(m.scene, f.scene);
  scene.updateMatrixWorld(true);
  const info = (g) => {
    const r = {};
    g.scene.traverse((o) => {
      if (o.isBone) { const p = o.getWorldPosition(new THREE.Vector3()); r[o.name] = [p.x - g.scene.position.x, p.y, p.z].map((v) => +v.toFixed(3)); }
    });
    const meshes = [];
    g.scene.traverse((o) => { if (o.isMesh) { meshes.push({ name: o.name, skinned: !!o.isSkinnedMesh, verts: o.geometry.attributes.position.count, attrs: Object.keys(o.geometry.attributes).map((a) => a + ':' + o.geometry.attributes[a].array.constructor.name + (o.geometry.attributes[a].normalized ? 'N' : '')).join(' '), bb: (() => { const b = new THREE.Box3().setFromObject(o); return [b.min.toArray().map((v) => +v.toFixed(2)), b.max.toArray().map((v) => +v.toFixed(2))]; })(), mat: o.material.name + ' map:' + !!o.material.map + ' nmap:' + !!o.material.normalMap }); } });
    return { bones: r, meshes };
  };
  out.male = info(m); out.female = info(f);
  out.kenney = k.scene.children.map((c) => c.name);
  renderer.render(scene, camera);
  return out;
};
