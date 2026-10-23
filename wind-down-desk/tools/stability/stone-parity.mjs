// Instanced stones — parity and draw calls (26 Oct). A returning evening with WDD_STONES stones on the desk; the
// evening frozen (pause), then the same frame drawn with the batch ON and OFF: pixel difference, in four looks —
// engraved stones (and one in hover glow), a stone dissolving into embers, "done" stones, a basalt Release stone
// half under water with its words of light. Then the draw calls per eye in the busiest place, batch on / off.
// Writes artifacts/stones/<look>-{on,off}.png and a diff report.
import { mkdirSync, writeFileSync } from 'node:fs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const ev = (fn, a) => f.evaluate(fn, a);
  const dir = 'artifacts/stones';
  mkdirSync(dir, { recursive: true });
  const want = Number(process.env.WDD_STONES ?? 12);
  await ev(() => window.__wdd.film.day(90));
  await ev(() => {
    const d = window.IWER_DEVICE;
    d.position.set(-0.84, 1.26, 0.2);
    const yaw = Math.PI / 2, pitch = (-38 * Math.PI) / 180;
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
    window.__wdd?.film?.fov?.(40);
  });
  if (await f.isVisible('[data-style="talk"]')) await f.click('[data-style="talk"]');
  else await f.click('#begin');
  for (let i = 0; i < 40; i++) {
    if (['table', 'floating'].includes(await ev(() => window.__wdd?.state?.().placement ?? null))) break;
    await wait(300);
  }
  await wait(5000);
  await ev((n) => window.__wdd.film.cap(Math.max(8, n)), want);
  await ev(() => window.__wdd.press('ritual:unload'));
  await wait(1500);
  const lines = ['I have to call the bank and book the dentist.', 'The slides for Monday are not done and the report is late.', 'I keep replaying the argument with my sister and the comment at lunch.', 'The rent is due, the bike is broken and the plants need water.', 'I forgot to answer the landlord and the trip is not planned.', 'My back hurts and I have not run in weeks.', 'The car insurance expires and the tap is leaking.', 'I need to buy the gift for mum and the emails are piling up.'];
  for (const l of lines) {
    if ((await ev(() => window.__wdd.state().tokens.length)) >= want) break;
    await ev((t) => window.__wdd.say(t), l);
    await wait(2500);
  }
  await wait(3000);
  await ev(() => window.__wdd.film.cap(8));
  // Look at the stones' row from the seat (wherever the desk was placed tonight).
  await ev(() => {
    const d = window.IWER_DEVICE;
    const eye = window.__wdd.deskPoint(0, 0.42, 0.44);
    const at = window.__wdd.deskPoint(0, 0, 0.09);
    d.position.set(eye.x, eye.y, eye.z);
    const dx = at.x - eye.x, dy = at.y - eye.y, dz = at.z - eye.z;
    const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
    window.__wdd?.film?.fov?.(46);
  });
  await wait(800);
  const out = { stones: await ev(() => window.__wdd.state().tokens.length), batch: await ev(() => window.__wdd.stoneBatch()) };
  // Freeze the evening: nothing moves, the same frame can be drawn both ways.
  await ev(() => window.__wdd.pause('page', false));
  await wait(400);
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${dir}/${name}.png`, Buffer.from(r.data, 'base64'));
  };
  const looks = {
    engraved: () => {
      const s = [...window.__wdd.debug().stones.values()];
      s.forEach((x, i) => { x.uniforms.uGlow.value = i === 0 ? 1 : 0; });
    },
    dissolving: () => {
      const s = [...window.__wdd.debug().stones.values()];
      s[1].uniforms.uDissolve.value = 0.45;
      s[2].uniforms.uWarm.value = 0.8;
      s[2].uniforms.uDissolve.value = 0.2;
    },
    done: () => {
      const s = [...window.__wdd.debug().stones.values()];
      s.forEach((x) => { x.uniforms.uDone.value = 1; x.uniforms.uDissolve.value = 0; x.uniforms.uWarm.value = 0; });
    },
    basalt: () => {
      const s = [...window.__wdd.debug().stones.values()];
      const p = s[3].mesh.getWorldPosition(s[3].mesh.position.clone());
      s[3].uniforms.uBasalt.value = 1;
      s[3].uniforms.uWaterY.value = p.y + 0.004;
      s[3].uniforms.uEngraveGlow.value = 0.7;
      s[4].uniforms.uEngraveFade.value = 0.6;
    },
  };
  out.looks = {};
  for (const [name, fn] of Object.entries(looks)) {
    await f.evaluate(new Function(`(${fn.toString()})()`));
    await ev(() => window.__wdd.stoneBatch(true));
    await wait(350);
    await shot(`${name}-on`);
    out.looks[name] = { drawnOn: await ev(() => window.__wdd.stoneBatch().drawn) };
    await ev(() => window.__wdd.stoneBatch(false));
    await wait(350);
    await shot(`${name}-off`);
  }
  await ev(() => window.__wdd.stoneBatch(true));
  await ev(() => window.__wdd.pause('page', true));
  await ev(() => window.__wdd?.film?.fov?.(58));
  return out;
}
