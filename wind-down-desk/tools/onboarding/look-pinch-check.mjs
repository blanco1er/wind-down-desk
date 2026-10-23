// Look and pinch (23 Oct): look at the stone, pinch far from it, look at the "Later" bowl, pinch → placed there.
// Run right after tools/onboarding/cold-run.sh silent-talk (the example stone is on the desk).
import { writeFileSync } from 'node:fs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
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
  const pinch = async () => {
    // The right hand rests low and to the side, far from any stone; a pinch there is "look and pinch".
    await f.evaluate(() => {
      const d = window.IWER_DEVICE;
      const h = d.hands.right;
      h.position.set(d.position.x + 0.05, d.position.y - 0.45, d.position.z + 0.18);
      h.updatePinchValue(1);
    });
    await wait(250);
    await f.evaluate(() => window.IWER_DEVICE.hands.right.updatePinchValue(0));
    await wait(250);
  };
  const id = await f.evaluate(() => window.__wdd.state().tokens.find((t) => t.bin == null)?.id ?? null);
  if (id == null) return { error: 'no unsorted stone' };
  const stone = await f.evaluate((i) => window.__wdd.stoneWorld(i), id);
  const bin = await f.evaluate(() => window.__wdd.binWorld('later'));
  await look(stone);
  await wait(600);
  const before = await f.evaluate(() => window.__wdd.onboarding());
  await pinch();
  const chosen = await f.evaluate(() => window.__wdd.onboarding().chosen);
  await look(bin);
  await wait(700);
  const binFocus = await f.evaluate(() => window.__wdd.onboarding().gazedBin);
  const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
  writeFileSync('artifacts/onboarding/look-pinch-bowl.jpg', Buffer.from(r.data, 'base64'));
  await pinch();
  await wait(1500);
  const after = await f.evaluate((i) => window.__wdd.state().tokens.find((t) => t.id === i)?.bin ?? null, id);
  await cdp.send('Page.stopScreencast');
  return { gazedBefore: before.gazed, gazeSource: before.gazeSource, chosen, binFocus, placedIn: after };
}
