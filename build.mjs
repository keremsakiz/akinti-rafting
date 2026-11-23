import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'fs';

const minify = !process.argv.includes('--dev');
// YÖNETİCİ MODU: only with --admin. Store builds (App Store / Play Store) = plain `node build.mjs`.
const admin = process.argv.includes('--admin');
const res = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  minify,
  target: ['es2019'],
  write: false,
  legalComments: 'none',
  loader: { '.glb': 'binary' },
  define: { __ADMIN__: String(admin) },
  logLevel: 'warning',
});
const js = res.outputFiles[0].text.replace(/<\/script>/g, '<\\/script>');
const tpl = readFileSync('src/template.html', 'utf8');
const marker = '/*__BUNDLE__*/';
const i = tpl.indexOf(marker);
const html = tpl.slice(0, i) + js + tpl.slice(i + marker.length);
writeFileSync('dist/index.html', html);
console.log('built dist/index.html', (html.length / 1024).toFixed(0) + ' KB');
if (admin) console.log('\n  !!! YÖNETİCİ MODU AÇIK: bu derleme MAĞAZAYA GÖNDERİLMEZ. Yayın için: node build.mjs\n');
else if (html.includes('admPanel')) { console.error('HATA: yönetici kodu derlemede kaldı!'); process.exit(1); }
else console.log('  yönetici modu yok (mağaza için uygun)');
