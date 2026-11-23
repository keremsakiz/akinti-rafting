import * as THREE from 'three';
import { loadAssets } from '../../src/assets.js';
import { Raft } from '../../src/raft.js';

const W = 1200, H = 800;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.NeutralToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#9cc3d6');
scene.add(new THREE.HemisphereLight('#d2e8ff', '#557a42', 1.2));
const sun = new THREE.DirectionalLight('#fff0d4', 2.8);
sun.position.set(-6, 9, 5); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 });
scene.add(sun);
const water = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#1f6f78', roughness: 0.2 }));
water.receiveShadow = true;
scene.add(water);
const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 200);
camera.layers.enable(1);
let raft;
window.setup = async () => {
  const assets = await loadAssets();
  raft = new Raft(scene, assets);
  return raft.crew.length;
};
window.view = (name, ph, vx = 0) => {
  for (const c of raft.crew) c.phase = (ph + (c.role === 'guide' ? 0 : 0)) % 1;
  raft.update(0, 1.0, 0, 0, vx, 0, 0.0, 15);
  const V = {
    game: [[0, 7.4, 8.6], [0, 0, -12], 60],
    front: [[3.6, 2.0, -4.2], [0, 0.6, 0], 40],
    side: [[5.5, 1.3, -0.2], [0, 0.6, -0.2], 40],
    logo: [[3.2, 0.5, -0.1], [0, 0.35, -0.1], 30],
    logoL: [[-3.2, 0.5, -0.1], [0, 0.35, -0.1], 30],
    close: [[2.2, 1.5, -1.6], [0.2, 0.75, -0.6], 40],
    closeback: [[-1.6, 1.9, 2.6], [0, 0.8, 0.3], 45],
    rear: [[2.0, 2.6, 5.2], [0, 0.6, 0], 40],
    top: [[0.01, 7, 0.4], [0, 0, 0], 40],
    left: [[-5.5, 1.3, -0.2], [0, 0.6, -0.2], 40],
  }[name];
  camera.position.set(...V[0]); camera.fov = V[2]; camera.updateProjectionMatrix(); camera.lookAt(...V[1]);
  renderer.render(scene, camera);
  return raft.crew.map((c) => [c.blade.x.toFixed(2), c.blade.y.toFixed(2), c.blade.z.toFixed(2), c.bladeIn.toFixed(2)].join(','));
};
window.feet = () => raft.crew.map((c) => ['thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r'].map((n) => {
  const v = c.bone[n].getWorldPosition(new THREE.Vector3()); raft.body.worldToLocal(v); return n + ':' + v.toArray().map((x) => x.toFixed(2)).join(',');
}).join('  ') + '  side=' + c.side);
// vessel checks: switch vessel, measure hull vs. crew feet (body space)
window.vessel = (id) => { raft.setVessel(id); raft.update(0.016, 1.0, 0, 0, 0, 0, 0, 15); return raft.vid; };
window.measure = () => {
  raft.update(0.016, 1.0, 0, 0, 0, 0, 0, 15);
  raft.group.updateMatrixWorld(true);
  const hull = raft.hulls[raft.vid];
  const box = new THREE.Box3();
  if (hull) { const inv = raft.body.matrixWorld.clone().invert(); hull.traverse((o) => { if (o.isMesh && o.visible && o.geometry) { o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld).applyMatrix4(inv); box.union(b); } }); }
  const crew = raft.crew.filter((c) => c.root.visible).map((c) => {
    const f = ['foot_l', 'foot_r', 'ball_l', 'ball_r', 'calf_l', 'calf_r', 'thigh_l', 'pelvis'].map((n) => { const b = c.bone[n]; if (!b) return n + ':-'; const v = b.getWorldPosition(new THREE.Vector3()); raft.body.worldToLocal(v); return n + ':' + v.toArray().map((x) => x.toFixed(2)).join(','); });
    return c.pose + ' ' + f.join(' ');
  });
  return { hullMin: box.min.toArray().map((x) => +x.toFixed(2)), hullMax: box.max.toArray().map((x) => +x.toFixed(2)), crew };
};
window.shot = (pos, look, fov = 40) => { camera.position.set(...pos); camera.fov = fov; camera.updateProjectionMatrix(); camera.lookAt(...look); renderer.render(scene, camera); };
// floor under each crew member's feet: down-rays against the hull only (body space)
window.floors = () => {
  raft.group.updateMatrixWorld(true);
  const hull = raft.hulls[raft.vid] || raft.body;
  const crewSet = new Set(); raft.crew.forEach((c) => c.root.traverse((o) => crewSet.add(o)));
  const metas = []; hull.traverse((o) => { if (o.isMesh && o.visible && !crewSet.has(o)) metas.push(o); });
  const rc = new THREE.Raycaster(); rc.layers.enableAll();
  return raft.crew.filter((c) => c.root.visible).map((c) => ['foot_l', 'ball_l', 'foot_r', 'ball_r'].map((n) => {
    const v = c.bone[n].getWorldPosition(new THREE.Vector3());
    rc.set(new THREE.Vector3(v.x, v.y + 2.5, v.z), new THREE.Vector3(0, -1, 0));
    const hits = rc.intersectObjects(metas, false).map((h) => { const q = raft.body.worldToLocal(h.point.clone()); return q.y.toFixed(2); });
    const f = raft.body.worldToLocal(v.clone());
    return n + ' y=' + f.y.toFixed(2) + ' hits[' + hits.slice(0, 4).join(',') + ']';
  }).join(' | '));
};
window.joints = () => { const c = raft.crew[0], J = c.base.J; return ['thigh_l', 'calf_l', 'foot_l', 'ball_l', 'pelvis'].map((n) => n + ':' + J[n].toArray().map((x) => x.toFixed(3)).join(',')).join(' ') + ' scale=' + raft.crew.map((k) => k.root.scale.x.toFixed(2)).join(','); };
window.dbg = () => raft.crew.map((c) => c.pose + ' seatY=' + (c.o.seat ? c.o.seat.y.toFixed(2) : '-') + ' floor=' + JSON.stringify(c.floor) + ' probe=' + !!c.floorProbe);
