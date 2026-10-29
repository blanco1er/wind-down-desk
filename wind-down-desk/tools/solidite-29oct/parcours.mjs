// 29 Oct (solidity) — the whole evening with hands only, in the emulator: real fingertip pokes, real pinches,
// never a sentence (no say(), no voice). One PART per `iwsdk browser run` (110 s cap), all on the same page:
//   1 arrival (the bead slid by a fingertip) → Unload (words touched, stones pinched into the three bowls,
//     "That's all") → the plan kept by touch
//   2 Release (a stone of tonight touched, the weight pinched and dropped in the water) → Breathe ("Enough")
//   3 Squeeze (fists closed then opened, "Enough") → Keep (three good things touched)
//   4 Talk it through (a bubble touched, "That's all") → the journal (Earlier, Close) → Places (the lamp's
//     globe: next, choose, Full, back to the room) → the volumes (Sound held, a fingertip on the rail, Done)
//   5 Good night (the bead) → the night → the closing line and the fade → "Lights out" → the session ends
// Run by tools/solidite-29oct/parcours.sh (fresh memory, stage, the five parts, the report).
import { makeHands } from './hands.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
class Blocked extends Error {}

export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const part = Number(process.env.PART ?? 1);
  const js = (fn, a) => f.evaluate(fn, a);
  const t0 = Date.now();
  const log = [];
  const errors = [];
  const draws = {};
  const onConsole = (m) => {
    const type = m.type();
    if (type === 'error' || type === 'warning') errors.push({ s: +((Date.now() - t0) / 1000).toFixed(1), type, text: m.text().slice(0, 240) });
  };
  const onError = (e) => errors.push({ s: +((Date.now() - t0) / 1000).toFixed(1), type: 'pageerror', text: String(e?.message ?? e).slice(0, 240) });
  page.on('console', onConsole);
  page.on('pageerror', onError);
  // Failed network requests (what the CLI reports as "requestfailed"), with the step they happened in.
  const reqs = new Map();
  await cdp.send('Network.enable').catch(() => {});
  const onReq = (e) => { if (e.request.url.includes('/api/')) reqs.set(e.requestId, { url: e.request.url.split('/api/')[1], body: (e.request.postData ?? '').slice(0, 60) }); };
  const onFail = (e) => { const r = reqs.get(e.requestId); if (r) errors.push({ s: +((Date.now() - t0) / 1000).toFixed(1), type: 'requestfailed', text: `${r.url} ${e.errorText}${e.canceled ? ' (canceled)' : ''} ${r.body}`, after: log.length ? log[log.length - 1].step : 'start' }); };
  cdp.on('Network.requestWillBeSent', onReq);
  cdp.on('Network.loadingFailed', onFail);
  // The headless render loop only advances while a screencast runs.
  const onFrame = (e) => cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {});
  cdp.on('Page.screencastFrame', onFrame);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 20, maxWidth: 320, maxHeight: 180, everyNthFrame: 3 });
  const H = makeHands(f);
  // 29 Oct: every wait is counted on the APP's clock (window.__wdd.clock().elapsed, which advances ≤ 50 ms per
  // frame), never on the wall clock. On a slow machine (production in software rendering, ~2 frames/s) the app lives
  // ~10× slower than real time: a wall-clock wait gave up before the night's replies existed, then touched a hidden
  // button. A wall cap (20× + 5 s) still reports a frozen clock as a block.
  const appNow = () => js(() => window.__wdd.clock().elapsed);
  const realWait = (ms) => new Promise((r) => setTimeout(r, ms));
  const wait = async (ms) => {
    const t = await appNow();
    const cap = Date.now() + ms * 20 + 5000;
    while (Date.now() < cap) {
      if ((await appNow()) - t >= ms / 1000) return;
      await realWait(Math.min(100, ms));
    }
  };
  const until = async (fn, ms, arg) => {
    const t = await appNow();
    const cap = Date.now() + ms * 20 + 5000;
    while (Date.now() < cap) {
      if (await js(fn, arg)) return true;
      if ((await appNow()) - t >= ms / 1000) return Boolean(await js(fn, arg));
      await realWait(150);
    }
    return false;
  };
  const snap = () =>
    js(() => {
      const d = window.__wdd;
      const v = d.debug().visuals;
      return {
        mode: d.evening().mode,
        phase: d.state().phase,
        words: v.wordChips.filter((c) => c.mesh.visible).map((c) => c.label),
        replies: v.replyLabels ?? null,
        bead: d.tension().side,
        proposal: d.evening().proposal?.ritual ?? null,
        menu: v.ritualMenuOpen,
      };
    });
  const mark = async (step, extra = {}) => {
    const s = await snap();
    const presses = await js(() => window.__wdd.presses().last.slice(-3).join(','));
    log.push({ s: +((Date.now() - t0) / 1000).toFixed(1), step, mode: s.mode, phase: s.phase, ...extra, presses });
  };
  // 29 Oct: a block ends the part (no step is logged as done after a BLOCKED).
  let blocked = null;
  const fail = async (step) => {
    const s = await snap();
    log.push({ s: +((Date.now() - t0) / 1000).toFixed(1), step: `BLOCKED: ${step}`, ...s, presses: await js(() => window.__wdd.presses().last.slice(-4).join(',')) });
    blocked = step;
    throw new Blocked(step);
  };
  /** Draw calls per eye now (renderer.info / 2 in the emulator's stereo), max over ~1.2 s. */
  const measure = async (name) => {
    await js(() => window.__wdd.perfReset());
    await wait(1200);
    const p = await js(() => window.__wdd.perf());
    // The emulator-only decor (room photo, its table) is not in the Quest build: the headset count leaves it out.
    const decor = await js(() => {
      let sc = window.__wdd.debug().visuals.root;
      while (sc.parent) sc = sc.parent;
      const on = (n) => { const o = sc.getObjectByName(n); if (o == null) return 0; for (let q = o; q; q = q.parent) if (!q.visible) return 0; return 1; };
      return on('film-set-room') + on('film-set-table');
    });
    draws[name] = { perEyeP50: p.drawCalls.p50 / 2, perEyeMax: p.drawCalls.max / 2, device: p.drawCalls.max / 2 - decor, triangles: p.triangles.max, xr: p.xr };
    // Over budget: which objects draw (onBeforeRender per draw and per eye, over ~0.6 s), to know what to merge.
    if (draws[name].device > 25 || process.env.DRAW_WHO === '1') draws[name].who = await drawWho();
  };
  const drawWho = () =>
    js(async () => {
      let scene = window.__wdd.debug().visuals.root;
      while (scene.parent) scene = scene.parent;
      const hits = new Map();
      const undo = [];
      let on = false;
      scene.traverse((o) => {
        if (!o.isMesh && !o.isPoints && !o.isLine && !o.isSprite) return;
        const prev = o.onBeforeRender;
        const path = [];
        for (let q = o; q != null && path.length < 3; q = q.parent) path.push(q.name || q.type);
        const key = `${path.join(' < ')} ro=${o.renderOrder} #${o.id} ${o.isInstancedMesh ? `inst${o.count}` : ''}`;
        o.onBeforeRender = function (...a) {
          if (on) hits.set(key, (hits.get(key) ?? 0) + 1);
          return prev.apply(this, a);
        };
        undo.push(() => { o.onBeforeRender = prev; });
      });
      await new Promise((r) => setTimeout(r, 200));
      on = true;
      await new Promise((r) => setTimeout(r, 600));
      on = false;
      undo.forEach((u) => u());
      const max = Math.max(...hits.values());
      return [...hits.entries()].map(([k, n]) => `${(n / max).toFixed(2)} ${k}`).sort();
    });
  const wordIndex = (re, exclude = []) => js(([src, ex]) => window.__wdd.debug().visuals.wordChips.findIndex((c) => c.mesh.visible && c.label != null && new RegExp(src, 'u').test(c.label) && !ex.includes(c.label)), [re.source, exclude]);
  const openMenuAndPick = async (id) => {
    if (!(await js(() => window.__wdd.debug().visuals.ritualMenuOpen))) {
      await H.poke('rituals');
      await until(() => window.__wdd.debug().visuals.ritualMenuOpen, 2500);
      await wait(500);
    }
    return H.poke(`ritual:${id}`);
  };
  /** The ritual menu shares its place with Places and Sound: a touch on "Rituals" folds it first. */
  const closeMenu = async () => {
    if (await js(() => window.__wdd.debug().visuals.ritualMenuOpen)) {
      await H.poke('rituals');
      await until(() => !window.__wdd.debug().visuals.ritualMenuOpen, 2500);
      await wait(500);
    }
  };
  /** Back to "choose": whatever the lamp proposes after a ritual, nothing is accepted. */
  const settleChoose = (ms = 12000) => until(() => window.__wdd.evening().mode === 'choose' || window.__wdd.evening().mode === 'night', ms);

  await js(() => { window.IWER_DEVICE.primaryInputMode = 'hand'; });
  if (process.env.NET_DEBUG === '1') {
    await js(() => {
      if (window.__netDebug) return;
      window.__netDebug = [];
      const origAbort = AbortController.prototype.abort;
      AbortController.prototype.abort = function (...a) { window.__netDebug.push(`abort: ${new Error().stack?.split('\n').slice(2, 7).join(' | ')}`); return origAbort.apply(this, a); };
      const RS = ReadableStreamDefaultReader.prototype;
      const origCancel = RS.cancel;
      RS.cancel = function (...a) { window.__netDebug.push(`reader.cancel: ${new Error().stack?.split('\n').slice(2, 7).join(' | ')}`); return origCancel.apply(this, a); };
      const origRelease = RS.releaseLock;
      RS.releaseLock = function (...a) { window.__netDebug.push(`reader.releaseLock: ${new Error().stack?.split('\n').slice(2, 7).join(' | ')}`); return origRelease.apply(this, a); };
    });
  }
  if (process.env.MIC) await js((m) => window.__wdd.micState(m), process.env.MIC);
  await H.rest();
  const before = await js(() => ({ heap: performance.memory?.usedJSHeapSize ?? null }));

  try {
  if (part === 1) {
    await until(() => ['table', 'floating'].includes(window.__wdd.state().placement), 10000);
    await mark('desk placed', { placement: await js(() => window.__wdd.state().placement), activeStones: await js(() => window.__wdd.state().tokens.filter((t) => !t.released).length) });
    // The bead on arrival: a fingertip slides it (the real gesture), or "Skip" by touch.
    if (await until(() => window.__wdd.tension().side === 'in', 9000)) {
      await wait(900);
      await measure('arrival bead');
      await H.slide(0.5, 0.75);
      const kept = await until(() => window.__wdd.tension().side == null, 6000);
      if (!kept) await H.poke('keep');
      await mark(kept ? 'bead slid by a fingertip and kept' : 'bead skipped by touch', { in: await js(() => window.__wdd.tension().in) });
    }
    await until(() => window.__wdd.evening().proposal != null || window.__wdd.evening().mode === 'unload', 9000);
    await wait(600);
    const s1 = await snap();
    if (s1.mode !== 'unload') {
      if (s1.proposal === 'unload') await H.poke('keep');
      else await openMenuAndPick('unload');
    }
    if (!(await until(() => window.__wdd.evening().mode === 'unload', 4000))) await fail('Unload did not start');
    await mark('Unload started', { proposal: s1.proposal });
    const bins = ['tomorrow', 'later', 'let-go'];
    const used = [];
    for (let k = 0; k < 3; k++) {
      // A stone waiting (the first evening's example stone) is sorted first; otherwise a word (or bubble) touched.
      let id = await js(() => window.__wdd.state().tokens.find((t) => t.bin == null && !t.released)?.id ?? null);
      if (id == null) {
        const ok = await until(() => window.__wdd.debug().visuals.wordChips.some((c) => c.mesh.visible && c.label != null && !/Write|That/u.test(c.label)), 12000);
        if (!ok) {
          await fail(`no word to touch before stone ${k + 1}`);
          break;
        }
        await wait(400);
        const i = await wordIndex(/^(?!Write|That).+/u, used);
        used.push(await js((x) => window.__wdd.debug().visuals.wordChips[x].label, i));
        await H.poke(`word:${i}`);
        await until(() => window.__wdd.state().tokens.some((t) => t.bin == null && !t.released), 8000);
        await wait(900);
        id = await js(() => window.__wdd.state().tokens.find((t) => t.bin == null && !t.released)?.id ?? null);
        // A touched word must become a stone (29 Oct: a desk left full by earlier evenings refused it).
        if (id == null) await fail(`a touched word made no stone (${await js(() => window.__wdd.caption().flash)})`);
      }
      if (k === 0) await measure('unload stone waiting');
      const ok = id != null && (await H.grab(id, bins[k]));
      await mark(`stone ${k + 1} pinched into ${bins[k]}`, { ok, word: used[used.length - 1] ?? 'example stone' });
      await wait(700);
    }
    // "That's all": the word, or the bubble — both come back after each stone now (29 Oct fix).
    const done = await until(() => window.__wdd.debug().visuals.wordChips.some((c) => c.mesh.visible && /^That/u.test(c.label ?? '')), 12000);
    await measure('unload words back');
    if (!done) await fail('"That\'s all" never offered');
    else {
      const i = await wordIndex(/^That/u);
      await H.poke(`word:${i}`);
      await mark('"That\'s all" touched');
    }
    // The plan (only with something in Tomorrow): "Keep it" by touch.
    if (await until(() => window.__wdd.state().phase === 'plan' && window.__wdd.debug().visuals.card.visible, 9000)) {
      await wait(800);
      await measure('plan card');
      await H.poke('keep');
      await mark('plan kept by touch');
    }
    if (!(await settleChoose())) await fail('Unload never ended');
    await mark('Unload done', { done: await js(() => window.__wdd.evening().done) });
  } else if (part === 2) {
    await openMenuAndPick('release');
    if (!(await until(() => window.__wdd.evening().release?.phase === 'ask', 6000))) await fail('Release did not ask');
    await until(() => window.__wdd.debug().visuals.wordChips.some((c) => c.mesh.visible), 5000);
    await wait(700);
    const i = await wordIndex(/^(?!Write).+/u);
    await H.poke(`word:${i >= 0 ? i : 0}`);
    await mark('Release: a stone of tonight touched');
    if (!(await until(() => window.__wdd.weightWorld() != null && ['hold', 'over'].includes(window.__wdd.evening().release?.phase), 9000))) await fail('the weight never came');
    await wait(1200);
    await measure('release weight');
    const w = await js(() => window.__wdd.weightWorld());
    if (w != null) {
      await H.pinchAt(w);
      const over = await js(() => window.__wdd.waterWorld(0.12));
      await H.moveTo(over, 16);
      await wait(900);
      await H.release();
      await mark('Release: the weight pinched and dropped over the water', { phase: await js(() => window.__wdd.evening().release?.phase) });
      await H.rest();
    }
    if (!(await settleChoose(20000))) await fail('Release never ended');
    await mark('Release done', { done: await js(() => window.__wdd.evening().done) });
    await wait(800);
    await openMenuAndPick('breathe');
    if (!(await until(() => window.__wdd.evening().mode === 'breathe', 4000))) await fail('Breathe did not start');
    await wait(9000);
    await measure('breathe');
    await H.poke('lighter');
    await mark('Breathe: "Enough" touched');
    if (!(await settleChoose(10000))) await fail('Breathe never ended');
  } else if (part === 3) {
    await openMenuAndPick('squeeze');
    if (!(await until(() => window.__wdd.evening().mode === 'squeeze', 4000))) await fail('Squeeze did not start');
    await H.fists('near');
    await wait(4500);
    await H.fists(true);
    await wait(3000);
    await measure('squeeze fists');
    await H.fists(false);
    await wait(2500);
    await mark('Squeeze: fists closed, then opened');
    await H.rest();
    await wait(600);
    const replies = (await snap()).replies;
    await H.poke(replies?.length === 2 ? 'lighter' : 'keep');
    await mark('Squeeze: "Enough" touched', { replies });
    if (!(await settleChoose(10000))) await fail('Squeeze never ended');
    await wait(800);
    await openMenuAndPick('keep');
    if (!(await until(() => window.__wdd.evening().mode === 'keep', 4000))) await fail('Keep did not start');
    await until(() => window.__wdd.debug().visuals.wordChips.some((c) => c.mesh.visible), 5000);
    await wait(900);
    await measure('keep words');
    const used = [];
    for (let k = 0; k < 3; k++) {
      const i = await wordIndex(/^(?!Write).+/u, used);
      if (i < 0) break;
      used.push(await js((x) => window.__wdd.debug().visuals.wordChips[x].label, i));
      await H.poke(`word:${i}`);
      await wait(1100);
    }
    await mark('Keep: three good things touched', { words: used, kept: (await js(() => window.__wdd.keep())).tonight });
    if (!(await settleChoose(15000))) {
      await H.poke('keep');
      if (!(await settleChoose(8000))) await fail('Keep never ended');
    }
    await mark('Keep done', { lights: (await js(() => window.__wdd.keep())).lights });
  } else if (part === 4) {
    await openMenuAndPick('talk');
    if (!(await until(() => window.__wdd.evening().mode === 'talk', 4000))) await fail('Talk did not start');
    const bubbles = await until(() => window.__wdd.debug().visuals.wordChips.some((c) => c.mesh.visible && !/Write/u.test(c.label ?? '')), 16000);
    if (!bubbles) await fail('no bubble to touch in Talk');
    else {
      await wait(1000); // the bubbles glide to the hand (≈ 0.5 s): touch them where they stop
      // ("Let's breathe together." would leave Talk for Breathe, by design: another bubble.)
      const i = await wordIndex(/^(?!Write|Let.s breathe).+/u);
      await H.poke(`word:${i}`);
      await mark('Talk: a bubble touched', { mode: await js(() => window.__wdd.evening().mode) });
      await until(() => !window.__wdd.talk().busy, 9000);
      await wait(1500);
    }
    await H.poke('keep');
    await mark('Talk: "That\'s all" touched', { streamFallbacks: await js(() => window.__wdd.talk().streamFallbacks) });
    await until(() => window.__wdd.evening().mode !== 'talk', 16000);
    // What weighed became stones: the lamp asks to let them go (Unload). Each pinched into Let go, then "That's all".
    if ((await js(() => window.__wdd.evening().mode)) === 'unload') {
      await wait(1200);
      for (let k = 0; k < 6; k++) {
        const id = await js(() => window.__wdd.state().tokens.find((t) => t.bin == null && !t.released)?.id ?? null);
        if (id == null) break;
        await H.grab(id, 'let-go');
        await wait(900);
      }
      await mark('Talk: its stones pinched into Let go', { tokens: await js(() => window.__wdd.state().tokens.length) });
      if (await until(() => window.__wdd.debug().visuals.wordChips.some((c) => c.mesh.visible && /^That/u.test(c.label ?? '')), 12000)) {
        await H.poke(`word:${await wordIndex(/^That/u)}`);
        await mark('"That\'s all" touched');
      } else await fail('"That\'s all" never offered after Talk');
      if (await until(() => window.__wdd.state().phase === 'plan' && window.__wdd.debug().visuals.card.visible, 6000)) {
        await wait(800);
        await H.poke('keep');
      }
    }
    if (!(await settleChoose(16000))) await fail('Talk never ended');
    await wait(600);
    // The journal: Your sky → Earlier → Close.
    await openMenuAndPick('sky');
    if (!(await until(() => window.__wdd.journal().open, 4000))) await fail('the journal did not open');
    await wait(1400);
    await measure('journal');
    await H.poke('keep');
    await wait(900);
    const j = await js(() => window.__wdd.journal());
    await H.poke('lighter');
    await wait(900);
    await mark('journal: opened, Earlier, Close', { earlier: j.index, closed: !(await js(() => window.__wdd.journal().open)) });
    // Places in the lamp: next, choose, Full, then back to the room.
    await closeMenu();
    await H.poke('places');
    if (!(await until(() => window.__wdd.globe().open, 3000))) await fail('Places did not open');
    await wait(700);
    await H.poke('globe-next');
    await wait(900);
    const chosen = (await js(() => window.__wdd.globe())).place;
    await H.poke('orb');
    await until((c) => window.__wdd.debug().visuals.backdrop.place === c, 9000, chosen);
    await wait(2500);
    await measure(`place ${chosen}`);
    // "Table stays | Full": the switch shows with the globe open (29 Oct fix), then the globe closes.
    await H.poke('places');
    await until(() => window.__wdd.globe().open, 3000);
    await wait(900);
    await H.poke('immersion');
    await wait(900);
    await H.poke('globe-close');
    await wait(1600);
    await measure(`place ${chosen} (Full)`);
    await mark('Places: a place chosen, Full', { place: await js(() => window.__wdd.debug().visuals.backdrop.place), immersion: await js(() => window.__wdd.debug().visuals.backdrop.immersionLevel) });
    await closeMenu();
    await H.poke('places');
    await until(() => window.__wdd.globe().open, 3000);
    await wait(500);
    for (let k = 0; k < 12 && (await js(() => window.__wdd.globe().place)) !== 'room'; k++) {
      await H.poke('globe-next');
      await wait(450);
    }
    await H.poke('orb');
    await until(() => window.__wdd.debug().visuals.backdrop.place === 'room', 8000);
    await mark('Places: back to my room by touch', { place: await js(() => window.__wdd.debug().visuals.backdrop.place) });
    await wait(1000);
    // The volumes (29 Oct: Settings, then Volume), a fingertip on the voice rail, Done.
    await closeMenu();
    const muted0 = await js(() => window.__wdd.voice().muted);
    await H.poke('settings');
    await wait(900);
    await H.poke('setting:volume');
    if (!(await until(() => window.__wdd.mix().open, 2500))) await fail('the volumes did not open');
    await wait(900);
    await measure('volumes');
    const v0 = (await js(() => window.__wdd.mix())).voice;
    await H.slide(v0, Math.max(0.1, v0 - 0.25));
    const v1 = (await js(() => window.__wdd.mix())).voice;
    await H.poke('keep');
    await mark('volumes: Settings › Volume, voice slid, Done', { voice: [v0, v1], closed: !(await js(() => window.__wdd.mix().open)), muteUnchanged: muted0 === (await js(() => window.__wdd.voice().muted)) });
    await js((v) => window.__wdd.mix({ voice: v }), v0);
  } else if (part === 5) {
    await openMenuAndPick('sleep');
    if (await until(() => window.__wdd.tension().side === 'out', 5000)) {
      await wait(900);
      await H.slide(0.6, 0.3);
      const kept = await until(() => window.__wdd.tension().side == null, 6000);
      if (!kept) await H.poke('keep');
      await mark(kept ? 'Good night: bead slid by a fingertip' : 'Good night: bead skipped by touch', { out: await js(() => window.__wdd.tension().out) });
    }
    if (!(await until(() => window.__wdd.evening().mode === 'night', 6000))) await fail('the night did not come');
    if (!(await until(() => window.__wdd.night().sleep != null, 22000))) await fail('the closing line never came');
    await wait(900);
    await measure('night sky on the ceiling');
    await mark('night: the closing line, one button', { replies: (await snap()).replies, ceiling: (await js(() => window.__wdd.night())).ceiling });
    await js(() => window.__wdd.sleepSkip(10));
    await wait(1500);
    await measure('night: halfway through the fade');
    await mark('night: halfway through the fade', { sleep: (await js(() => window.__wdd.night())).sleep });
    await H.poke('keep');
    const ended = await until(() => !window.__wdd.perf().xr, 20000);
    if (!ended) await fail('"Lights out" did not end the session');
    else await mark('"Lights out": the session ended by itself');
  }

  } catch (e) {
    if (!(e instanceof Blocked)) throw e;
  }

  const after = await js(() => ({ heap: performance.memory?.usedJSHeapSize ?? null }));
  await cdp.send('Page.stopScreencast').catch(() => {});
  cdp.off?.('Page.screencastFrame', onFrame);
  page.off('console', onConsole);
  page.off('pageerror', onError);
  if (process.env.NET_DEBUG === '1') errors.push(...(await js(() => window.__netDebug ?? [])).map((text) => ({ s: 0, type: 'netdebug', text })));
  return { part, blocked, seconds: +((Date.now() - t0) / 1000).toFixed(1), log, errors, draws, hands: H.stats, heapMB: [before.heap, after.heap].map((h) => (h == null ? null : +(h / 1048576).toFixed(1))) };
}
