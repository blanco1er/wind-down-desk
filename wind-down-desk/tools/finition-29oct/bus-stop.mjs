// 29 Oct — the "one bus stop" test (Meta Start judging): a complete moment, hands only (no voice, no controller):
// arrival → the bead skipped with one touch → Unload → (first evening: the example stone pinched into a bowl) →
// two words touched → two stones pinched into bowls →
// Good night → the bead skipped → the night → "Good night" touched → the session ends by itself.
// Run right after a fresh stage (sh tools/stage.sh 54 30); the shell adds the stage time (reload + enter XR).
//   npx @iwsdk/cli browser run tools/finition-29oct/bus-stop.mjs --timeout 108000
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const t0 = Date.now();
  const log = [];
  const mark = (step, extra) => log.push({ s: +((Date.now() - t0) / 1000).toFixed(1), step, ...(extra ?? {}) });
  cdp.on('Page.screencastFrame', (e) => cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}));
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 30, maxWidth: 320, maxHeight: 180, everyNthFrame: 4 });
  const js = (fn, a) => f.evaluate(fn, a);
  const until = async (fn, ms, arg) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await js(fn, arg)) return true;
      await wait(150);
    }
    return false;
  };
  const state = () => js(() => { const d = window.__wdd; return { mode: d.evening().mode, tension: d.tension().side, replies: d.debug().visuals.replyLabels ?? null, words: d.debug().visuals.wordChips.filter((c) => c.mesh.visible).map((c) => c.label), tokens: d.state().tokens.length, xr: window.IWER_DEVICE != null && d.perf?.().xr }; });
  // Hands only: the person has refused the microphone (the touch path everyone gets without a voice).
  await js(() => { window.IWER_DEVICE.primaryInputMode = 'hand'; window.__wdd.micState('denied'); });
  const rest = await js(() => window.__wdd.deskPoint(0.3, 0.02, 0.5));
  await js((r) => { const h = window.IWER_DEVICE.hands.right; h.position.set(r.x, r.y, r.z); h.updatePinchValue(0); }, rest);
  mark('start', await state());
  // 1. The bead (arrival): one touch on "Skip".
  if (await until(() => window.__wdd.tension().side === 'in', 8000)) {
    await wait(800);
    mark('bead asked');
    await js(() => window.__wdd.press('keep'));
    mark('bead skipped by touch');
  }
  // 2. The lamp proposes; "Yes" (or Unload in the menu).
  await until(() => window.__wdd.evening().proposal != null || window.__wdd.evening().mode === 'unload', 8000);
  await wait(900);
  const prop = await js(() => window.__wdd.evening().proposal?.ritual ?? null);
  if (prop === 'unload') await js(() => window.__wdd.press('keep'));
  else await js(() => window.__wdd.press('ritual:unload'));
  mark('unload', { proposed: prop });
  // 3–4. A word touched → a stone; pinched into a bowl (the real IWSDK grab path, emulated hand); twice.
  //      (The words fold away while a stone waits to be sorted, by design: one word, one stone, one gesture.)
  const grab = async (id, bin) => {
    const stone = await js((i) => window.__wdd.stoneWorld(i), id);
    const end = await js((b) => window.__wdd.binWorld(b), bin);
    if (stone == null || end == null) return false;
    const set = (p, v) => js(([q, pv]) => { const h = window.IWER_DEVICE.hands.right; h.position.set(q.x, q.y, q.z); if (pv != null) h.updatePinchValue(pv); }, [p, v]);
    await set({ x: stone.x, y: stone.y + 0.05, z: stone.z }, 0);
    await wait(250);
    await set({ x: stone.x, y: stone.y + 0.01, z: stone.z }, 0);
    await wait(200);
    await set({ x: stone.x, y: stone.y + 0.01, z: stone.z }, 1);
    await wait(300);
    for (let i = 1; i <= 16; i++) {
      const k = i / 16;
      await set({ x: stone.x + (end.x - stone.x) * k, y: stone.y + 0.01 + (end.y + 0.03 - stone.y) * k + Math.sin(Math.PI * k) * 0.08, z: stone.z + (end.z - stone.z) * k }, null);
      await wait(45);
    }
    await set({ x: end.x, y: end.y + 0.03, z: end.z }, 0);
    await wait(500);
    await set(rest, 0);
    await wait(300);
    return true;
  };
  const bins = ['tomorrow', 'let-go'];
  const usedWords = [];
  // 29 Oct: on a first evening the example stone waits on the tray (the ghost hand shows the pinch), and the words
  // fold away while a stone waits: it goes into a bowl first, then the two words.
  const example = await js(() => window.__wdd.state().tokens.find((t) => t.bin == null && !t.released)?.id ?? null);
  if (example != null) {
    await grab(example, 'later');
    mark('example stone in a bowl', { bins: await js(() => window.__wdd.state().tokens.map((x) => x.bin ?? (x.released ? 'released' : null))) });
  }
  for (let k = 0; k < 2; k++) {
    await until(() => window.__wdd.debug().visuals.wordChips.some((c) => c.mesh.visible && c.label != null && !/Write/u.test(c.label)), 8000);
    await wait(400);
    // A topic not touched yet (a used one stays, dimmed).
    const i = await js((used) => window.__wdd.debug().visuals.wordChips.findIndex((c) => c.mesh.visible && c.label != null && !/Write|That/u.test(c.label) && !used.includes(c.label)), usedWords);
    // 29 Oct: no word on show (a slow machine, the words not up yet) is a block, reported as such.
    if (i < 0) {
      mark(`BLOCKED: no word to touch before stone ${k + 1}`, await state());
      break;
    }
    usedWords.push(await js((x) => window.__wdd.debug().visuals.wordChips[x].label, i));
    await js((x) => window.__wdd.press(`word:${x}`), i);
    mark(`word ${k + 1} touched`, { words: (await state()).words, index: i });
    await until(() => window.__wdd.state().tokens.some((t) => t.bin == null && !t.released), 5000);
    await wait(700);
    const t = await js(() => window.__wdd.state().tokens.find((x) => x.bin == null && !x.released));
    if (t) await grab(t.id, bins[k]);
    mark(`stone ${k + 1} in a bowl`, { bins: await js(() => window.__wdd.state().tokens.map((x) => x.bin ?? (x.released ? 'released' : null))) });
  }
  // 5. Good night: the Rituals button by the lamp, then its last row (two touches); or the reply when it is offered.
  await wait(600);
  const s5 = await state();
  if (s5.replies?.includes('Good night')) {
    await js(() => window.__wdd.press('lighter'));
  } else {
    if (!(await js(() => window.__wdd.debug().visuals.ritualMenuOpen))) await js(() => window.__wdd.press('rituals'));
    await wait(700);
    await js(() => window.__wdd.press('ritual:sleep'));
  }
  mark('good night touched', { replies: s5.replies, mode: s5.mode });
  // 6. The bead before the night: one touch.
  if (await until(() => window.__wdd.tension().side === 'out', 5000)) {
    await wait(700);
    await js(() => window.__wdd.press('keep'));
    mark('bead skipped by touch (night)');
  }
  await until(() => window.__wdd.evening().mode === 'night', 6000);
  mark('night: your sky rises');
  // 7. "Shall I stay?" → "Good night" (touch): the session closes by itself.
  await until(() => window.__wdd.night().step === 2, 20000);
  mark('lamp asks to stay');
  await wait(700);
  await js(() => window.__wdd.press('lighter'));
  const ended = await until(() => !window.__wdd.perf().xr, 20000);
  mark(ended ? 'session ended' : 'session still open');
  await cdp.send('Page.stopScreencast');
  return { seconds: +((Date.now() - t0) / 1000).toFixed(1), log };
}
