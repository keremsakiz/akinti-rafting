import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const logs = [];
page.on('console', (m) => { if (m.type() !== 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('file:///home/claude/akinti/test/raftview/index.html');
console.log('crew', await page.evaluate('setup()'));
const shots = JSON.parse(process.argv[2] || '[["front",0]]');
for (const [v, ph, vx] of shots) {
  const r = await page.evaluate(`view(${JSON.stringify(v)}, ${ph}, ${vx || 0})`);
  console.log(v, ph, JSON.stringify(r));
  await page.screenshot({ path: `/home/claude/akinti/test/out/raft_${v}_${String(ph).replace('.', '')}.png` });
}
console.log(logs.join('\n'));
await browser.close();
