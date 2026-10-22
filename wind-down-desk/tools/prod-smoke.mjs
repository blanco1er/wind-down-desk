// Smoke test of the PRODUCTION server (npm start): the landing renders, no page error, the agent is the server's,
// the anonymous "page" beacon arrives. No XR here (IWER is dev-only): headset paths are proven in the emulator.
//   node tools/prod-smoke.mjs http://127.0.0.1:8799/?ref=devpost [screenshot.png]
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const shot = process.argv[3];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, userAgent: 'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/40.4.0 Chrome/138.0 VR Safari/537.36' });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const beacons = [];
page.on('request', (r) => r.url().endsWith('/api/visit') && beacons.push(r.postData()));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 30000 });
await page.waitForTimeout(3000);
const state = await page.evaluate(() => ({
  title: document.title,
  status: document.getElementById('status')?.textContent,
  begin: document.getElementById('begin')?.textContent,
  privacy: document.querySelector('.privacy')?.textContent,
  canvas: document.querySelectorAll('canvas').length,
  wdd: typeof window.__wdd,
}));
if (shot) await page.screenshot({ path: shot });
console.log(JSON.stringify({ state, errors, beacons }, null, 2));
await browser.close();
