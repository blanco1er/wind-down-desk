// FoV-aware relay: turn the head 70° away, make the lamp speak, check the relay shows in front and fades when looking back.
import { writeFileSync } from 'node:fs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  await page.evaluate(() => document.querySelectorAll('.workspace-view-switcher').forEach((e) => (e.style.display = 'none'))).catch(() => {});
  cdp.on('Page.screencastFrame', (e) => void cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}));
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 40, maxWidth: 320, maxHeight: 180 });
  const turn = (yawDeg) => f.evaluate((y) => {
    const yaw = (y * Math.PI) / 180, pitch = (-15 * Math.PI) / 180;
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    window.IWER_DEVICE.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
  }, yawDeg);
  await turn(160);
  await wait(800);
  await f.evaluate(() => window.__wdd.say('Breathe.'));
  await wait(1800);
  const away = await f.evaluate(() => ({ visible: window.__wdd.debug().visuals.relay.visible }));
  const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
  writeFileSync('artifacts/onboarding/fov-relay.jpg', Buffer.from(r.data, 'base64'));
  await turn(90);
  await wait(1500);
  const back = await f.evaluate(() => ({ visible: window.__wdd.debug().visuals.relay.visible }));
  await cdp.send('Page.stopScreencast');
  return { awayRelay: away.visible, backRelay: back.visible };
}
