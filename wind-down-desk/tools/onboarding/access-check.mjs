// Accessibility (23 Oct): gaze-only selection by dwell, high contrast, larger text — all turned on BY VOICE here
// (the landing's button is checked separately). The emulated head looks at a stone for 1.6 s, then at a bowl:
// the stone must be sorted with no hand and no further word.
import { writeFileSync } from 'node:fs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.WDD_OUT ?? 'artifacts/onboarding';

export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  await page.evaluate(() => document.querySelectorAll('.workspace-view-switcher').forEach((e) => (e.style.display = 'none'))).catch(() => {});
  cdp.on('Page.screencastFrame', (e) => void cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}));
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
    writeFileSync(`${OUT}/${name}`, Buffer.from(r.data, 'base64'));
  };
  await f.evaluate(() => {
    const d = window.IWER_DEVICE;
    d.primaryInputMode = 'hand';
    d.position.set(-0.84, 1.2, 0.2);
    window.__wdd?.film?.fov?.(58);
  });
  const look = (p) =>
    f.evaluate((t) => {
      const d = window.IWER_DEVICE;
      const dx = t.x - d.position.x, dy = t.y - d.position.y, dz = t.z - d.position.z;
      const yaw = Math.atan2(-dx, -dz);
      const pitch = Math.atan2(dy, Math.hypot(dx, dz));
      const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
      d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
    }, p);
  const card = '[data-style="talk"]';
  if (await f.isVisible(card)) await f.click(card);
  else if (await f.isVisible('#begin')) await f.click('#begin');
  // Placed, then into Unload.
  for (let i = 0; i < 40; i++) {
    const s = await f.evaluate(() => window.__wdd?.state?.().placement ?? null);
    if (s === 'table' || s === 'floating') break;
    await wait(300);
  }
  await wait(2500);
  const result = {};
  // 1. By voice.
  await f.evaluate(() => window.__wdd.say('look to select'));
  await wait(400);
  result.afterVoice = await f.evaluate(() => ({ access: window.__wdd.access(), caption: window.__wdd.debug().visuals.lastSpoken ?? null }));
  // 2. A stone (spoken, as a person would).
  await f.evaluate(() => window.__wdd.say('I need to call the dentist.'));
  let stone = null;
  for (let i = 0; i < 30 && stone == null; i++) {
    await wait(300);
    stone = await f.evaluate(() => window.__wdd.state().tokens.find((t) => t.bin == null && !t.released)?.id ?? null);
  }
  result.stone = stone;
  await wait(1500);
  const sp = await f.evaluate((id) => window.__wdd.stoneWorld(id), stone);
  await look(sp);
  await wait(800);
  result.midDwell = await f.evaluate(() => window.__wdd.dwell());
  await shot('access-dwell-stone.jpg');
  await wait(1000);
  result.afterStone = await f.evaluate(() => window.__wdd.dwell());
  // 3. The bowl it should go to.
  const bp = await f.evaluate(() => window.__wdd.binWorld('later'));
  await look(bp);
  await wait(700);
  await shot('access-dwell-bowl.jpg');
  await wait(1300);
  result.afterBowl = await f.evaluate((id) => ({ dwell: window.__wdd.dwell(), token: window.__wdd.state().tokens.find((t) => t.id === id) }), stone);
  // 4. Contrast and text size, by voice (gaze selection off first: looking around must not press anything).
  await f.evaluate(() => window.__wdd.say('hands again'));
  await wait(600);
  await look({ x: bp.x, y: bp.y + 0.1, z: bp.z });
  await wait(400);
  await shot('access-normal-before.jpg');
  await f.evaluate(() => window.__wdd.say('high contrast'));
  await wait(300);
  await f.evaluate(() => window.__wdd.say('bigger text'));
  await wait(1200);
  await shot('access-contrast-large.jpg');
  result.final = await f.evaluate(() => window.__wdd.access());
  await f.evaluate(() => window.__wdd.say('contrast off'));
  await f.evaluate(() => window.__wdd.say('normal text'));
  await wait(1200);
  await shot('access-normal.jpg');
  result.reset = await f.evaluate(() => window.__wdd.access());
  return result;
}
