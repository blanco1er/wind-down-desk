// 45-minute session without leaks (26 Oct): one ≈ 95 s cycle of a lived evening per run (Places in the globe, a
// place and back, the sky, Breathe, a few spoken lines), then the memory: JS heap, GPU textures / geometries /
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
  const places = ['moon-lake', 'moon-beach', 'ember-fire', 'northern-lights', 'fireside-cabin', 'rain-veranda', 'firefly-meadow', 'desert-stars', 'rooftop-city'];
  const k = await ev(() => (window.__longCycle = (window.__longCycle ?? 0) + 1));
  await say('Places.');
  await wait(2500);
  await ev(() => window.__wdd.press('globe-next'));
  await wait(2000);
  await ev(() => window.__wdd.globe('close'));
  await ev((p) => void window.__wdd.place(p), places[k % places.length]);
  await wait(9000);
  await ev(() => window.__wdd.immersion('full'));
  await wait(6000);
  await ev(() => window.__wdd.sky(false));
  await wait(8000);
  await ev(() => window.__wdd.press('ritual:breathe'));
  await wait(20000);
  await say("That's enough.");
  await wait(8000);
  await say('Back to my room.');
  await wait(6000);
  await say(`I need to call the dentist and finish the report number ${k}.`);
  await wait(6000);
  await ev(() => window.__wdd.press('rituals'));
  await wait(3000);
  await ev(() => window.__wdd.press('rituals'));
  await wait(3000);
  return ev(() => {
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
    };
  });
}
