import { build } from 'esbuild';
import { writeFileSync } from 'fs';
const res = await build({ entryPoints: ['test/raftview/main.js'], bundle: true, format: 'iife', write: false, loader: { '.glb': 'binary' }, logLevel: 'warning' });
writeFileSync('test/raftview/index.html', `<!DOCTYPE html><html><body style="margin:0"><script>${res.outputFiles[0].text}</script></body></html>`);
console.log('ok');
