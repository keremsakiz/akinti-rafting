import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file:///home/claude/akinti/dist/index.html');
await page.waitForTimeout(2000);
// tap the menu to start (touch)
await page.touchscreen.tap(195, 600);
await page.waitForTimeout(1500);
console.log('mode after tap:', await page.evaluate(() => __akinti.S.mode));
// swipe right using CDP touch events
const cdp = await ctx.newCDPSession(page);
const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
await touch('touchStart', 150, 600);
for (let i = 1; i <= 8; i++) { await touch('touchMove', 150 + i * 15, 600); await page.waitForTimeout(60); }
await touch('touchEnd', 270, 600);
await page.waitForTimeout(800);
console.log('targetX after swipe right:', await page.evaluate(() => __akinti.S.targetX.toFixed(2)), 'x:', await page.evaluate(() => __akinti.S.x.toFixed(2)));
// pause button
await page.touchscreen.tap(36, 32);
await page.waitForTimeout(500);
console.log('mode after pause tap:', await page.evaluate(() => __akinti.S.mode));
await page.touchscreen.tap(195, 440);
await page.waitForTimeout(500);
console.log('mode after resume tap:', await page.evaluate(() => __akinti.S.mode));
console.log(errs.length ? errs.join('\n') : 'no page errors');
await browser.close();
