// 45-minute session without leaks (26 Oct): one ≈ 95 s cycle of a lived evening per run (Places in the globe → a
// different place each time, the sky, Breathe, Talk it through with the on-device agent, back to the room), then the memory: JS heap, GPU textures / geometries /
// programs (three.js), draw calls. Run it in a loop (tools/stability/long-session.sh) on the same page.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page }) {
  const f = frame ?? page;
  const ev = (fn, a) => f.evaluate(fn, a);
  const placed = await ev(() => window.__wdd?.state?.().placement ?? null);
  if (placed !== 'table' && placed !== 'floating') {
    await ev(() => window.__wdd.film.day(30));
    await ev(() => {
      const d = window.IWER_DEVICE;
      d.position.set(-0.84, 1.26, 0.2);
      const yaw = Math.PI / 2, pitch = (-27 * Math.PI) / 180;
      const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
      d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
    });
    if (await f.isVisible('[data-style="talk"]')) await f.click('[data-style="talk"]');
    else await f.click('#begin');
    for (let i = 0; i < 40; i++) {
      if (['table', 'floating'].includes(await ev(() => window.__wdd?.state?.().placement ?? null))) break;
      await wait(300);
    }
    await wait(5000);
  }
  const say = (t) => ev((x) => window.__wdd.say(x), t);
  const k = await ev(() => (window.__longCycle = (window.__longCycle ?? 0) + 1));
  const steps = [];
  const mode = () => ev(() => window.__wdd.evening().mode);
  // Places in the globe: open, browse k places on, "this one" (every place comes in turn), Full, the sky.
  await say('Places.');
  await wait(2500);
  for (let i = 0; i < 1 + (k % 3); i++) {
    await ev(() => window.__wdd.press('globe-next'));
    await wait(900);
  }
  await say('This one.');
  await wait(5000);
  steps.push(`place:${await ev(() => window.__wdd.debug().visuals.backdrop.place)}`);
  await ev(() => window.__wdd.immersion('full'));
  await ev(() => window.__wdd.sky(false));
  await wait(6000);
  // Breathe (two breaths), then stop.
  await ev(() => window.__wdd.press('ritual:breathe'));
  await wait(2000);
  steps.push(`breathe:${await mode()}`);
  await wait(22000);
  await say("That's enough.");
  await wait(6000);
  // Talk it through (the on-device agent stands in for the LLM here: no server, no key), two turns, then the end.
  await ev(() => window.__wdd.press('ritual:talk'));
  await wait(4000);
  steps.push(`talk:${await mode()}`);
  await say(`Work has been a lot this week, cycle ${k}.`);
  await wait(6000);
  await say('Mostly the report. I keep putting it off.');
  await wait(6000);
  await say("That's all.");
  await wait(9000);
  await say('Back to my room.');
  await wait(4000);
  steps.push(`end:${await mode()}`);
  const sample = await ev(() => {
    const p = window.__wdd.perf();
    const mem = performance.memory;
    return {
      cycle: window.__longCycle,
      t: Math.round(performance.now() / 1000),
      heapMB: mem ? +(mem.usedJSHeapSize / 1048576).toFixed(1) : null,
      textures: p.textures,
      geometries: p.geometries,
      programs: p.programs,
      draws: p.drawCalls.p50 / 2,
      placeMiB: +(window.__wdd.placeMemory().bytes / 1048576).toFixed(1),
      quality: window.__wdd.quality().level,
      stones: window.__wdd.state().tokens.length,
      mode: window.__wdd.evening().mode,
      done: window.__wdd.evening().done,
      livingBuilt: window.__wdd.debug().visuals.living.built.size,
      previews: window.__wdd.globe().previews,
    };
  });
  return { ...sample, steps };
}
