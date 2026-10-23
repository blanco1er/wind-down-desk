// "Glasses view" captures (25 Oct): run with the emulator on the metaVRGlasses profile (iwsdk.config.json
// dev.emulator.device), its field-of-view mask on. Eyes 0.48 m above the table; the head turned to the framing
// fit-check recommends for each state; screenshots in artifacts/glasses/. Also reports the gaze source (eyes / head).
import { mkdirSync, writeFileSync } from 'node:fs';
import { fit } from './fit-check.mjs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  mkdirSync('artifacts/glasses', { recursive: true });
  await page.evaluate(() => document.querySelectorAll('.workspace-view-switcher').forEach((e) => (e.style.display = 'none'))).catch(() => {});
  const frameTo = async (name) => {
    const row = (await fit(f)).find((r) => r.eye === 0.48);
    await f.evaluate((g) => {
      const d = window.IWER_DEVICE;
      d.position.y = window.__wdd.state().frame.y + 0.48;
      const c = window.__wdd.deskPoint(0, 0, 0);
      const base = Math.atan2(-(c.x - d.position.x), -(c.z - d.position.z));
      const yaw = base - (g.yaw * Math.PI) / 180;
      const pitch = (g.pitch * Math.PI) / 180;
      const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
      d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
    }, row.gaze);
    await wait(900);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 86 });
    writeFileSync(`artifacts/glasses/${name}.jpg`, Buffer.from(shot.data, 'base64'));
    return { ...row.gaze, size: `${row.width}x${row.height}`, fits: row.fits };
  };
  const press = (a) => f.evaluate((x) => window.__wdd.press(x), a);
  const r = {};
  r.device = await f.evaluate(() => ({ name: window.IWER_DEVICE.name, mask: window.IWER_DEVICE.visibilityMaskEnabled ?? null }));
  await f.evaluate(() => window.__wdd.micState('listening'));
  await wait(1500);
  r.gaze = await f.evaluate(() => window.__wdd.onboarding().gazeSource);
  r.menu = await frameTo('01-glasses-ritual-menu');
  await press('ritual:unload');
  await wait(7500);
  r.unload = await frameTo('02-glasses-unload-bubbles');
  await press('rituals');
  await wait(800);
  await press('ritual:talk');
  await wait(13000);
  r.talk = await frameTo('03-glasses-talk');
  return r;
}
