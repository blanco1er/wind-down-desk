// Head gaze the jury can SEE (23 Oct): aim the emulated head at the lamp, then at a stone, and read what reacts.
// Run right after tools/onboarding/cold-run.sh (a stone on the desk). Writes artifacts/onboarding/gaze-*.jpg.
import { writeFileSync } from 'node:fs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  await page.evaluate(() => document.querySelectorAll('.workspace-view-switcher').forEach((e) => (e.style.display = 'none'))).catch(() => {});
  cdp.on('Page.screencastFrame', (e) => void cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}));
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 640, maxHeight: 360 });
  const look = (p) =>
    f.evaluate((t) => {
      const d = window.IWER_DEVICE;
      const h = d.position;
      const dx = t.x - h.x, dy = t.y - h.y, dz = t.z - h.z;
      const yaw = Math.atan2(-dx, -dz);
      const pitch = Math.atan2(dy, Math.hypot(dx, dz));
      const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
      d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
    }, p);
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
    writeFileSync(`artifacts/onboarding/${name}.jpg`, Buffer.from(r.data, 'base64'));
  };
  const lamp = await f.evaluate(() => { const v = window.__wdd.debug().visuals.orb; const p = v.getWorldPosition(v.position.clone()); return { x: p.x, y: p.y, z: p.z }; });
  const stoneId = await f.evaluate(() => window.__wdd.state().tokens[0]?.id ?? null);
  const stone = stoneId == null ? null : await f.evaluate((id) => window.__wdd.stoneWorld(id), stoneId);
  const out = {};
  await look({ x: lamp.x - 0.25, y: lamp.y, z: lamp.z + 0.1 });
  await wait(900);
  out.lampAway = await f.evaluate(() => window.__wdd.onboarding().lampGaze);
  await shot('gaze-lamp-away');
  await look(lamp);
  await wait(1200);
  out.lampLooked = await f.evaluate(() => window.__wdd.onboarding().lampGaze);
  await shot('gaze-lamp-looked');
  if (stone != null) {
    await look(stone);
    await wait(150);
    out.stoneAt150ms = await f.evaluate(() => window.__wdd.onboarding().gazed);
    await wait(350);
    out.stoneAt500ms = await f.evaluate(() => window.__wdd.onboarding().gazed);
    await shot('gaze-stone-focused');
    await look({ x: stone.x + 0.03, y: stone.y, z: stone.z });
    await wait(400);
    out.stoneDrift3cm = await f.evaluate(() => window.__wdd.onboarding().gazed);
  }
  await cdp.send('Page.stopScreencast');
  return { stoneId, ...out };
}
