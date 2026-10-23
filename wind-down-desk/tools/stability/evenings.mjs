// Stability pass (26 Oct): several evenings chained in one emulator session, each a fresh page (reload before).
//   WDD_PHASE=e1  day 0, memory erased: the first evening (Unload straight away, stones into the bowls by hand and
//                 by voice, the plan kept), Places in the globe (open, next, "this one", back to the room), Good night.
//   WDD_PHASE=e2  day 1: the sky in the lamp, follow-ups, Talk it through (2 turns, "that's all"), Breathe, Good night.
//   WDD_PHASE=e2b day 1 again (page reopened the same evening): a full Breathe, Good night.
//   WDD_PHASE=e3  day 2: Release (a weight into the water), Good night.
//   WDD_PHASE=e4  day 3: arrival = 3 evenings → the milestone (pebble), Places in the globe, back to the room.
//   WDD_PHASE=e4b day 3 again (same evening, page reloaded): no second celebration, the pebble already there.
// Returns a log of steps with the app's state, worst frames and draw calls. Errors: `iwsdk browser logs` after.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page }) {
  const f = frame ?? page;
  const phase = process.env.WDD_PHASE ?? 'e1';
  const day = { e1: 0, e2: 1, e2b: 1, e3: 2, e4: 3, e4b: 3 }[phase];
  const log = [];
  const ev = (fn, a) => f.evaluate(fn, a);
  const say = (t) => ev((x) => window.__wdd.say(x), t);
  const press = (a) => ev((x) => window.__wdd.press(x), a);
  // Each step: the worst frame since the last step (transitions included), then the STEADY draw calls over 1.2 s.
  const snap = async (step) => {
    const worst = await ev(() => ({ max: window.__wdd.perf().frameMs.max, p99: window.__wdd.perf().frameMs.p99, long: window.__wdd.perf().longFrames.filter((l) => l[1] > 40), now: Math.round(performance.now()) }));
    await ev(() => window.__wdd.perfReset());
    await wait(1200);
    const s = await ev(() => {
      const d = window.__wdd;
      const e = d.evening();
      const st = d.state();
      const p = d.perf();
      const m = d.debug().visuals;
      return {
        mode: e.mode,
        phase: st.phase,
        done: e.done,
        tokens: st.tokens.length,
        inBins: st.tokens.filter((t) => t.bin != null).length,
        globe: d.globe(),
        sky: m.skyShown,
        keepsakes: m.keepsakes.shown,
        place: m.backdrop.place,
        steadyDrawsPerEye: p.drawCalls.p50 / 2,
      };
    });
    log.push({ step, ...s, worstFrame: worst.max, frameP99: worst.p99, long: worst.long.map(([t, ms]) => `${ms}ms@-${worst.now - t}`).join(' ') });
    await ev(() => window.__wdd.perfReset());
  };
  // A first evening: the memory emptied the app's way (the in-page copy too), no last place.
  if (phase === 'e1') await ev(() => { window.__wdd.film.history(0); try { localStorage.removeItem('wdd.lastPlace'); } catch {} });
  await ev((n) => window.__wdd.film.day(n), day);
  await page.evaluate(() => document.querySelectorAll('.workspace-view-switcher').forEach((e) => (e.style.display = 'none'))).catch(() => {});
  await ev(() => {
    const d = window.IWER_DEVICE;
    d.primaryInputMode = 'hand';
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
  await ev(() => window.__wdd.micState?.('listening'));
  await wait(4000);
  await snap('arrived');
  const goodNight = async () => {
    await say('Good night.');
    await wait(4000);
    await snap('good night');
    log.push({ step: 'memory', ...(await ev(() => ({ sky: window.__wdd.sky.length, mem: JSON.parse(localStorage.getItem('wind-down-desk.memory.v1') ?? '{}') })).then((r) => ({ nights: r.mem.nights?.length, stars: r.mem.stars?.length, celebrated: r.mem.celebrated, rituals: r.mem.nights?.map((n) => (n.rituals ?? []).join('+')) }))) });
  };
  const globeVisit = async () => {
    await say('Places.');
    await wait(2200);
    await snap('places in the globe');
    if (process.env.WDD_DRAWLIST === '1') {
      log.push({ step: 'visible', ...(await ev(() => {
        const v = window.__wdd.debug().visuals;
        let scene = v.root;
        while (scene.parent) scene = scene.parent;
        const names = new Map();
        for (const [k, val] of Object.entries(v)) if (val != null && val.isMesh) names.set(val, k);
        for (const c of v.globeButtons ?? []) names.set(c.mesh, c.action);
        for (const c of v.placeChips ?? []) names.set(c.mesh, `place:${c.id}`);
        for (const c of v.ritualChips ?? []) names.set(c.mesh, `ritual:${c.id}`);
        for (const c of v.wordChips ?? []) names.set(c.mesh, 'word');
        const out = [];
        scene.traverseVisible((o) => {
          if (!o.isMesh && !o.isPoints) return;
          const op = o.material?.uniforms?.uOpacity?.value;
          out.push(`${names.get(o) ?? o.geometry?.type}${op != null ? `@${(+op).toFixed(2)}` : ''}`);
        });
        return { n: out.length, items: out.join(' | ') };
      })) });
    }
    await press('globe-next');
    await wait(1500);
    await say('Next.');
    await wait(1500);
    await say('This one.');
    await wait(3500);
    await snap('arrived in the place');
    await say('Back to my room.');
    await wait(3000);
    await snap('back in the room');
  };
  if (phase === 'e1') {
    await say("I haven't replied to the landlord about the heating. I need to book the dentist. The slides for Monday aren't done. And I keep replaying that awkward comment at lunch.");
    await wait(5000);
    await snap('unload: stones');
    await say("That's it.");
    await wait(1500);
    const tokens = await ev(() => window.__wdd.state().tokens.filter((t) => t.bin == null).map((t) => t.text));
    // By voice: one to each bowl ("X, tomorrow" / later / let go).
    const bins = ['tomorrow', 'later', 'let go', 'let go'];
    for (let i = 0; i < tokens.length && i < 4; i++) {
      await say(`${tokens[i]}, ${bins[i]}.`);
      await wait(1400);
    }
    await wait(2500);
    await snap('unload: sorted');
    await say('Keep it.');
    await wait(3000);
    await snap('plan kept');
    await globeVisit();
    await goodNight();
  } else if (phase === 'e2') {
    await wait(3000);
    await snap('sky, follow-ups');
    await say('Done.');
    await wait(2500);
    await say('Not yet.');
    await wait(2500);
    await snap('after follow-ups');
    await press('ritual:talk');
    await wait(6000);
    await snap('talk: opening');
    await say('Work has been a lot this week and I feel behind on everything.');
    await wait(7000);
    await say('Mostly the slides. I keep putting them off.');
    await wait(7000);
    await snap('talk: two turns');
    await say("That's all.");
    await wait(4000);
    await snap('talk: closing');
    // Chosen while the lamp still says its closing line: the talk must still count (fixed 26 Oct).
    await wait(1000);
    await snap('talk: ended');
    await press('ritual:breathe');
    await wait(22000);
    await snap('breathe');
    await say("That's enough.");
    await wait(5000);
    await snap('breathe: ended');
    await goodNight();
  } else if (phase === 'e2b') {
    // Same evening, page reopened: a full Breathe (two breaths), then "that's enough".
    await wait(2000);
    await press('ritual:breathe');
    await wait(34000);
    await snap('breathe: two breaths');
    await say("That's enough.");
    await wait(9000);
    await snap('breathe: ended');
    await goodNight();
  } else if (phase === 'e3') {
    await wait(3000);
    await snap('sky');
    await press('ritual:release');
    await wait(3500);
    await say('The meeting with Paul tomorrow. I keep replaying it.');
    await wait(3000);
    await snap('release: the weight');
    const s = await ev(() => window.__wdd.weightWorld());
    const w = await ev(() => window.__wdd.waterWorld?.(0.085) ?? null);
    if (s != null && w != null) {
      const hand = (p, v) => ev(([pos, val]) => { const h = window.IWER_DEVICE.hands.right; h.position.set(pos.x, pos.y, pos.z); if (val != null) h.updatePinchValue(val); }, [p, v]);
      await hand({ x: s.x, y: s.y + 0.06, z: s.z }, 0);
      await wait(400);
      await hand({ x: s.x, y: s.y + 0.012, z: s.z }, null);
      await wait(300);
      await hand({ x: s.x, y: s.y + 0.012, z: s.z }, 1);
      await wait(400);
      for (let k = 1; k <= 20; k++) {
        await hand({ x: s.x + (w.x + 0.03 - s.x) * (k / 20), y: s.y + 0.012 + (w.y - s.y) * (k / 20) + Math.sin(Math.PI * k / 20) * 0.06, z: s.z + (w.z + 0.035 - s.z) * (k / 20) }, null);
        await wait(50);
      }
      await wait(1400);
      await hand({ x: w.x + 0.03, y: w.y, z: w.z + 0.035 }, 0);
      await wait(6000);
      log.push({ step: 'release: weight', weight: true });
    } else log.push({ step: 'release: weight', weight: false });
    await snap('release: after');
    await say("That's enough.");
    await wait(3000);
    await goodNight();
  } else if (phase === 'e4' || phase === 'e4b') {
    await wait(6500);
    await snap('sky + milestone');
    await wait(4000);
    await snap('after the sky');
    if (phase === 'e4') await globeVisit();
    log.push({ step: 'final', ...(await ev(() => ({ celebrated: JSON.parse(localStorage.getItem('wind-down-desk.memory.v1') ?? '{}').celebrated, keepsakes: window.__wdd.debug().visuals.keepsakes.shown }))) });
  }
  return log;
}
