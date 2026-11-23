// Merge selected Kenney Watercraft Kit (CC0) models into one compressed GLB.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mergeDocuments, prune, dedup, meshopt, reorder, unpartition } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
const DIR = '/home/claude/assets_raw/water/Models/GLB format';
const OUT = process.argv[2] || '/home/claude/work/out';
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const names = ['boat-row-small', 'boat-row-large', 'buoy', 'buoy-flag', 'ramp', 'boat-fishing-small', 'boat-house-a', 'boat-sail-a', 'gate-finish', 'boat-speed-g', 'boat-tug-a', 'ship-small', 'ship-ocean-liner-small'];
const doc = await io.read(`${DIR}/${names[0]}.glb`);
for (const n of names.slice(1)) mergeDocuments(doc, await io.read(`${DIR}/${n}.glb`));
const root = doc.getRoot();
// one scene, one top-level node per model (named after the file)
const scenes = root.listScenes();
const main = scenes[0];
scenes.forEach((s, i) => {
  const kids = s.listChildren();
  const holder = doc.createNode(names[i]);
  for (const k of kids) { s.removeChild(k); holder.addChild(k); }
  main.addChild(holder);
  if (i > 0) s.dispose();
});
root.setDefaultScene(main);
await doc.transform(unpartition(), dedup(), prune(), reorder({ encoder: MeshoptEncoder }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
for (const t of root.listTextures()) t.setURI('colormap.png');
await io.write(`${OUT}/kenney.glb`, doc);
console.log('textures', root.listTextures().length, 'materials', root.listMaterials().length, 'meshes', root.listMeshes().length, 'nodes', main.listChildren().map((n) => n.getName()).join(','));
