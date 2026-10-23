// The first minute, cold (22 Oct, jury criterion "immediate usability, clear onboarding"): a judge who has read
// nothing. Records a CDP screencast + a per-second log (caption, mode, stones, hint) while a scenario plays.
//   sh tools/onboarding/cold-run.sh <scenario> <outDir> [hour]
//   scenarios: silent-talk (choose "Talk", then never speak), silent-quiet (choose "Quiet evening", touch nothing),
//              judge (choose "Talk", stay silent, then pinch the stone the desk shows and drop it where it points)
// Env: WDD_SCENARIO, WDD_OUT (frames dir), WDD_HOUR (fake local hour: the lamp's proposal depends on it), WDD_SECONDS.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const scenario = process.env.WDD_SCENARIO ?? 'silent-talk';
  const dir = process.env.WDD_OUT ?? 'artifacts/onboarding/frames';
  const seconds = Number(process.env.WDD_SECONDS ?? 60);
  const hour = process.env.WDD_HOUR != null ? Number(process.env.WDD_HOUR) : null;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  // The outer dev page's Runtime/Editor switcher is not part of the app: hidden in the recording.
  await page.evaluate(() => document.querySelectorAll('.workspace-view-switcher').forEach((e) => (e.style.display = 'none'))).catch(() => {});
  // Seat the emulated headset (seated at the synthetic room's table, looking down at it), hands mode, fake hour.
  await f.evaluate((h) => {
    const d = window.IWER_DEVICE;
    d.primaryInputMode = 'hand';
    d.position.set(-0.84, 1.2, 0.2);
    const yaw = Math.PI / 2;
    const pitch = (-27 * Math.PI) / 180;
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
    if (h != null) Date.prototype.getHours = () => h;
    window.__wdd?.film?.fov?.(58);
  }, hour);

  const frames = [];
  const t0 = Date.now();
  cdp.on('Page.screencastFrame', async (event) => {
    const name = `f${String(frames.length).padStart(5, '0')}.jpg`;
    writeFileSync(join(dir, name), Buffer.from(event.data, 'base64'));
    frames.push({ name, t: (Date.now() - t0) / 1000 });
    try {
      await cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId });
    } catch {}
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });

  const log = [];
  const sample = async () => {
    const s = await f.evaluate(() => {
      const d = window.__wdd;
      if (d == null) return null;
      const st = d.state();
      const ev = d.evening();
      const v = d.debug().visuals;
      return {
        placement: st.placement,
        mode: ev.mode,
        phase: st.phase,
        caption: v.lastSpoken ?? null,
        stones: st.tokens.length,
        sorted: st.tokens.filter((t) => t.bin != null || t.released).length,
        hint: d.onboarding?.() ?? null,
      };
    });
    log.push({ t: +((Date.now() - t0) / 1000).toFixed(1), ...s });
  };

  // The judge sees the landing and touches a card (talk or quiet).
  const card = scenario === 'silent-quiet' ? '[data-style="quiet"]' : '[data-style="talk"]';
  await wait(1500);
  if (await f.isVisible(card)) await f.click(card);
  else await f.click('#begin');
  let firstSortAt = null;
  let grabbed = false;
  while ((Date.now() - t0) / 1000 < seconds) {
    await sample();
    const last = log[log.length - 1];
    if (firstSortAt == null && last?.sorted > 0) firstSortAt = last.t;
    // The judge: once the desk shows a stone and where it goes, they pinch it and drop it there.
    if (scenario === 'judge' && !grabbed && last?.hint?.stone != null && last.hint.bin != null && (Date.now() - t0) / 1000 > 3) {
      grabbed = true;
      const { stone, bin } = last.hint;
      const start = await f.evaluate((id) => window.__wdd.stoneWorld(id), stone);
      const end = await f.evaluate((b) => window.__wdd.binWorld(b), bin);
      const setHand = (p, pinch) =>
        f.evaluate(([pos, v]) => {
          const hand = window.IWER_DEVICE.hands.right;
          hand.position.set(pos.x, pos.y, pos.z);
          if (v != null) hand.updatePinchValue(v);
        }, [p, pinch]);
      await setHand({ x: start.x + 0.04, y: start.y + 0.12, z: start.z + 0.12 }, 0);
      await wait(500);
      await setHand({ x: start.x, y: start.y + 0.01, z: start.z }, 0);
      await wait(300);
      await setHand({ x: start.x, y: start.y + 0.01, z: start.z }, 1);
      await wait(300);
      for (let i = 1; i <= 30; i++) {
        const k = i / 30;
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        await setHand({ x: start.x + (end.x - start.x) * e, y: start.y + 0.01 + (end.y - start.y) * e + Math.sin(Math.PI * k) * 0.08, z: start.z + (end.z - start.z) * e }, null);
        await wait(35);
      }
      await wait(200);
      await setHand({ x: end.x, y: end.y + 0.01, z: end.z }, 0);
      await wait(400);
      await setHand({ x: end.x + 0.05, y: end.y + 0.15, z: end.z + 0.2 }, 0);
    }
    await wait(1000);
  }
  await cdp.send('Page.stopScreencast');
  writeFileSync(join(dir, 'index.json'), JSON.stringify(frames));
  writeFileSync(join(dir, 'log.json'), JSON.stringify({ scenario, hour, firstSortAt, log }, null, 2));
  return { scenario, hour, frames: frames.length, firstSortAt, log: log.filter((_, i) => i % 5 === 0 || i === log.length - 1) };
}
