// Screenshots of the touch menus where they now open (near you): Places grid, ritual menu.
import { writeFileSync } from 'node:fs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  await page.evaluate(() => document.querySelectorAll('.workspace-view-switcher').forEach((e) => (e.style.display = 'none'))).catch(() => {});
  cdp.on('Page.screencastFrame', (e) => void cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}));
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 40, maxWidth: 320, maxHeight: 180 });
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
    writeFileSync(`artifacts/onboarding/${name}.jpg`, Buffer.from(r.data, 'base64'));
  };
  await f.evaluate(() => window.__wdd.press('places'));
  await wait(1600);
  await shot('menu-places-near');
  await f.evaluate(() => window.__wdd.debug().visuals.openPlaces(false));
  await wait(900);
  await f.evaluate(() => window.__wdd.press('rituals'));
  await wait(1600);
  await shot('menu-rituals-near');
  await f.evaluate(() => window.__wdd.press('rituals'));
  await cdp.send('Page.stopScreencast');
  return 'ok';
}
