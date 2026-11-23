// Optimize Quaternius Universal Base Characters for the rafting game.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { weld, simplify, prune, dedup, quantize, meshopt, reorder } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'fs';

const W = '/home/claude/work/chars';
const OUT = process.argv[2] || '/home/claude/work/out';
await MeshoptSimplifier.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

async function webp(file, size, q) {
  return new Uint8Array(await sharp(`${W}/${file}`).resize(size, size, { fit: 'fill' }).webp({ quality: q, effort: 6 }).toBuffer());
}

for (const [name, src, baseTex, normTex] of [
  ['male', 'Superhero_Male_FullBody.gltf', 'T_Superhero_Male_Ligh.png', 'T_Superhero_Male_Normal.png'],
  ['female', 'Superhero_Female_FullBody.gltf', 'T_Superhero_Female_Light_BaseColor.png', 'T_Superhero_Female_Normal.png'],
]) {
  // patch image uris so the file can be read
  const j = JSON.parse(readFileSync(`${W}/${src}`, 'utf8'));
  for (const im of j.images) {
    if (/Eye_Normal/.test(im.uri)) im.uri = 'T_Eye_Normal.png';
    else if (/Eye_Brown/.test(im.uri)) im.uri = 'T_Eye_Brown.png';
    else if (/Hair_1_Normal/.test(im.uri)) im.uri = 'T_Hair_1_Normal.png';
    else if (/Hair_2_Normal/.test(im.uri)) im.uri = 'T_Hair_2_Normal.png';
    else if (/Hair_1_Base/.test(im.uri)) im.uri = 'T_Hair_1_BaseColor.png';
    else if (/Hair_2_Base/.test(im.uri)) im.uri = 'T_Hair_2_BaseColor.png';
    else if (/Normal/.test(im.uri)) im.uri = normTex;
    else if (/Rough/.test(im.uri)) im.uri = im.uri;
    else im.uri = baseTex;
  }
  writeFileSync(`${W}/_${name}.gltf`, JSON.stringify(j));
  const doc = await io.read(`${W}/_${name}.gltf`);
  const root = doc.getRoot();
  doc.createExtension(EXTTextureWebP).setRequired(true);

  // strip unused vertex streams
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
    for (const sem of p.listSemantics()) {
      if (!['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0'].includes(sem)) p.setAttribute(sem, null);
    }
  }
  // materials
  const mats = root.listMaterials();
  for (const m of mats) {
    const n = m.getName();
    if (/Hair/.test(n)) { // eyebrows: flat dark colour
      m.setBaseColorTexture(null); m.setNormalTexture(null);
      m.setBaseColorFactor([0.09, 0.06, 0.045, 1]); m.setRoughnessFactor(0.9); m.setName('brows');
    } else if (/Eyes/.test(n)) {
      m.setNormalTexture(null); m.setRoughnessFactor(0.25); m.setName('eyes');
      const t = m.getBaseColorTexture(); t.setImage(await webp('T_Eye_Brown.png', 128, 82)).setMimeType('image/webp').setURI('eyes.webp');
    } else {
      m.setMetallicRoughnessTexture(null); m.setRoughnessFactor(0.6); m.setMetallicFactor(0); m.setName('body');
      m.getBaseColorTexture().setImage(await webp(baseTex, 512, 84)).setMimeType('image/webp').setURI(`${name}_base.webp`);
      m.getNormalTexture().setImage(await webp(normTex, 512, 88)).setMimeType('image/webp').setURI(`${name}_n.webp`);
    }
    m.setDoubleSided(false);
  }
  // node names
  for (const n of root.listNodes()) if (n.getMesh()) {
    const mn = n.getMesh().listPrimitives()[0].getMaterial().getName();
    n.setName(mn); n.getMesh().setName(mn);
  }
  await doc.transform(prune(), dedup(), weld());
  // simplify body more aggressively than the small parts
  let before = 0, after = 0;
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) before += p.getIndices().getCount() / 3;
  await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: 0.42, error: 0.0015, lockBorder: false }));
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) after += p.getIndices().getCount() / 3;
  await doc.transform(prune(), reorder({ encoder: MeshoptEncoder }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(`${OUT}/${name}.glb`, doc);
  console.log(name, 'tris', before, '->', after, 'per mesh:', root.listMeshes().map((m) => m.getName() + ':' + m.listPrimitives()[0].getIndices().getCount() / 3).join(' '));
}
