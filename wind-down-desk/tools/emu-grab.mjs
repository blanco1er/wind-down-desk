// Dev helper: emulated right hand pinches a stone and drops it at a desk target.
// WDD_GRAB='{"id":"t1","bin":"tomorrow"}' or '{"id":"t3","to":[x,y,z]}' (desk-local).
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page }) {
  const f = frame ?? page;
  const { id, bin, to, steps = 24, grabOffset = [0, 0] } = JSON.parse(process.env.WDD_GRAB ?? '{}');
  const stone = await f.evaluate((i) => window.__wdd.stoneWorld(i), id);
  const start = stone == null ? null : { x: stone.x + grabOffset[0], y: stone.y, z: stone.z + grabOffset[1] };
  const end = await f.evaluate(([b, t]) => (b ? window.__wdd.binWorld(b) : window.__wdd.deskPoint(...t)), [bin, to]);
  if (start == null || end == null) return { error: 'unknown stone or target', start, end };
  const setHand = (p, pinch) =>
    f.evaluate(([pos, v]) => {
      const hand = window.IWER_DEVICE.hands.right;
      hand.position.set(pos.x, pos.y, pos.z);
      if (v != null) hand.updatePinchValue(v);
    }, [p, pinch]);
  await setHand({ x: start.x, y: start.y + 0.05, z: start.z }, 0);
  await wait(120);
  await setHand({ x: start.x, y: start.y + 0.01, z: start.z }, 0);
  await wait(120);
  await setHand({ x: start.x, y: start.y + 0.01, z: start.z }, 1);
  await wait(200);
  const grabbed = await f.evaluate(() => window.__wdd.state().tokens);
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    const lift = Math.sin(Math.PI * k) * 0.08;
    await setHand({ x: start.x + (end.x - start.x) * e, y: start.y + 0.01 + (end.y - start.y) * e + lift, z: start.z + (end.z - start.z) * e }, null);
    await wait(30);
  }
  await wait(150);
  await setHand({ x: end.x, y: end.y + 0.01, z: end.z }, 0);
  await wait(400);
  await setHand({ x: end.x + 0.05, y: end.y + 0.12, z: end.z + 0.15 }, 0);
  await wait(200);
  return f.evaluate(() => window.__wdd.state().tokens);
}
