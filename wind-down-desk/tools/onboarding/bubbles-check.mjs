// Suggestion bubbles (axe 4): a voice evening (microphone pretended to work), the person says nothing for 5 s →
// at most three bubbles above the bowls; touching one is exactly saying it (a stone appears); after sorting it,
// "That's all for tonight." is offered too. Captures in artifacts/lamp/.
import { writeFileSync } from 'node:fs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 86 });
    writeFileSync(`artifacts/lamp/${name}.jpg`, Buffer.from(r.data, 'base64'));
  };
  await f.evaluate(() => window.__wdd.micState('listening'));
  const words = () => f.evaluate(() => window.__wdd.debug().visuals.wordChips.filter((c) => c.mesh.visible && c.label != null).map((c) => c.label));
  const r = { at0: await words() };
  await wait(6000);
  r.after6s = await words();
  await shot('bubbles-hesitate');
  // Touch the first bubble (as a finger poke would).
  await f.evaluate(() => window.__wdd.press('word:0'));
  await wait(2500);
  r.stones = await f.evaluate(() => window.__wdd.state().tokens.map((t) => t.text));
  r.whileStoneWaits = await words();
  // Sort it, stay silent: the bubbles come back with a way to end.
  const id = await f.evaluate(() => window.__wdd.state().tokens[0]?.id);
  const start = await f.evaluate((i) => window.__wdd.stoneWorld(i), id);
  const end = await f.evaluate(() => window.__wdd.binWorld('later'));
  const hand = (p, pinch) => f.evaluate(([q, v]) => {
    const h = window.IWER_DEVICE.hands.right;
    h.position.set(q.x, q.y, q.z);
    if (v != null) h.updatePinchValue(v);
  }, [p, pinch]);
  await hand({ x: start.x, y: start.y + 0.1, z: start.z + 0.1 }, 0);
  await wait(400);
  await hand({ x: start.x, y: start.y + 0.01, z: start.z }, 0);
  await wait(300);
  await hand({ x: start.x, y: start.y + 0.01, z: start.z }, 1);
  await wait(300);
  for (let i = 1; i <= 24; i++) {
    const k = i / 24;
    await hand({ x: start.x + (end.x - start.x) * k, y: start.y + 0.01 + (end.y - start.y) * k + Math.sin(Math.PI * k) * 0.08, z: start.z + (end.z - start.z) * k }, null);
    await wait(35);
  }
  await hand({ x: end.x, y: end.y + 0.01, z: end.z }, 0);
  await wait(300);
  await hand({ x: end.x + 0.1, y: end.y + 0.25, z: end.z + 0.3 }, 0);
  r.sorted = await f.evaluate(() => window.__wdd.state().tokens.map((t) => t.bin));
  await wait(6500);
  r.afterSort = await words();
  await shot('bubbles-after-sort');
  return r;
}
