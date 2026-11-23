// Headless screenshot + error harness
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';

const args = process.argv.slice(2);
const W = parseInt(process.env.W || '390', 10), H = parseInt(process.env.H || '844', 10);
const DPR = parseFloat(process.env.DPR || '1');
const out = process.env.OUT || '/home/claude/akinti/test/out';
import { readFileSync } from 'fs';
const plan = JSON.parse(args[0] && args[0].endsWith('.json') ? readFileSync(args[0], 'utf8') : (args[0] || '[]'));

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, isMobile: W < H, hasTouch: true });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('file:///home/claude/akinti/dist/index.html');
await page.waitForTimeout(2500);
for (const step of plan) {
  if (step.eval) await page.evaluate(step.eval);
  if (step.wait) await page.waitForTimeout(step.wait);
  if (step.shot) await page.screenshot({ path: `${out}/${step.shot}.png` });
  if (step.log) console.log(step.log, JSON.stringify(await page.evaluate(step.logEval)));
}
console.log(logs.slice(0, 40).join('\n') || 'no errors');
await browser.close();
