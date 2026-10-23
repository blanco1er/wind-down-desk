// Instanced stones — draw calls per eye with 12 stones (26 Oct). Draw calls are deterministic (unlike CPU time on a
// loaded machine). The app holds 8 stones at most; the emulator-only film.cap(12) lifts it for this proof: 12 stones
// said, 4 of them sorted into the Tomorrow / Later bowls → 12 stones in view (8 on the desk, 4 in bowls), and the
// Release weight. Then in each place (Full immersion), looking at the desk from the seat: draw calls per eye with the
// batch ON and OFF.
//   WDD_PLACES=a,b,… limits the places (default: all). WDD_SETUP=0 skips the 12-stone setup (already done).
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page }) {
  const f = frame ?? page;
  const ev = (fn, a) => f.evaluate(fn, a);
  if (process.env.WDD_SETUP !== '0') {
    await ev(() => window.__wdd.film.day(90));
    if (await f.isVisible('[data-style="talk"]')) await f.click('[data-style="talk"]');
    else await f.click('#begin');
    for (let i = 0; i < 40; i++) {
      if (['table', 'floating'].includes(await ev(() => window.__wdd?.state?.().placement ?? null))) break;
      await wait(300);
    }
    await wait(4000);
    await ev(() => window.__wdd.quality?.(0));
    await ev(() => window.__wdd.film.cap(12));
    await ev(() => window.__wdd.press('ritual:unload'));
    await wait(1200);
    const lines = ['I have to call the bank and book the dentist.', 'The slides for Monday are not done and the report is late.', 'I keep replaying the argument with my sister and the comment at lunch.', 'The rent is due, the bike is broken and the plants need water.', 'I forgot to answer the landlord and the trip is not planned.', 'My back hurts and I have not run in weeks.', 'The car insurance expires and the tap is leaking.', 'I need to buy the gift for mum and the emails are piling up.'];
    for (const l of lines) {
      if ((await ev(() => window.__wdd.state().tokens.length)) >= 12) break;
      await ev((t) => window.__wdd.say(t), l);
      await wait(2200);
    }
    await ev(() => window.__wdd.say("That's it"));
    await wait(2500);
    const bins = ['tomorrow', 'later', 'later', 'tomorrow'];
    const firsts = await ev(() => window.__wdd.state().tokens.filter((t) => t.bin == null).slice(0, 4).map((t) => t.text));
    for (let i = 0; i < firsts.length; i++) {
      await ev((t) => window.__wdd.say(t), `${firsts[i]}, ${bins[i]}`);
      await wait(1800);
    }
    await wait(2500);
    await ev(() => window.__wdd.film.cap(8));
  }
  const look = () =>
    ev(() => {
      const d = window.IWER_DEVICE;
      const eye = window.__wdd.deskPoint(0, 0.42, 0.44);
      const at = window.__wdd.deskPoint(0, 0, 0.06);
      d.position.set(eye.x, eye.y, eye.z);
      const dx = at.x - eye.x, dy = at.y - eye.y, dz = at.z - eye.z;
      const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
      const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
      d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
    });
  await look();
  const tokens = await ev(() => window.__wdd.state().tokens);
  const out = { stones: tokens.filter((t) => !t.released).length, sorted: tokens.filter((t) => t.bin != null).length, weight: await ev(() => window.__wdd.weightWorld() != null), places: {} };
  const places = process.env.WDD_PLACES ? process.env.WDD_PLACES.split(',') : await ev(() => window.__wdd.places);
  const measure = async (on) => {
    await ev((v) => window.__wdd.stoneBatch(v), on);
    await wait(400);
    await ev(() => window.__wdd.perfReset());
    await wait(1200);
    const p = await ev(() => window.__wdd.perf());
    return { perEye: p.drawCalls.p50 / 2, max: p.drawCalls.max / 2, drawn: on ? await ev(() => window.__wdd.stoneBatch().drawn) : 0 };
  };
  for (const id of places) {
    await ev((p) => window.__wdd.place(p), id);
    await wait(3200);
    await ev(() => window.__wdd.immersion('full'));
    await wait(1500);
    await look();
    const on = await measure(true);
    const off = await measure(false);
    out.places[id] = { on: on.perEye, onMax: on.max, off: off.perEye, offMax: off.max, batched: on.drawn };
  }
  await ev(() => window.__wdd.stoneBatch(true));
  return out;
}
