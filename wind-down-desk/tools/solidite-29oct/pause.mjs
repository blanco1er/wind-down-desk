// 29 Oct (solidity) — pause / resume, as the headset does it, in the emulator. PHASE (run by pause.sh):
//   a   Breathe running → the Meta button (session "visible-blurred") 3 s → back; the page hidden 3 s → back;
//       both hands lost 3 s (tracking off) → back, then a real fingertip touch still works.
//   b1  Unload: a word touched, its stone left unsorted, one placed (the state before leaving XR).
//   b2  after `xr exit` + `xr enter`: what remains, and one evening step by hand (a touch = one press, no doubles).
import { makeHands } from './hands.mjs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const phase = process.env.PHASE ?? 'a';
  const js = (fn, a) => f.evaluate(fn, a);
  cdp.on('Page.screencastFrame', (e) => cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}));
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 20, maxWidth: 320, maxHeight: 180, everyNthFrame: 3 });
  const errors = [];
  const onConsole = (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); };
  const onErr = (e) => errors.push(`pageerror: ${String(e?.message ?? e).slice(0, 200)}`);
  page.on('console', onConsole);
  page.on('pageerror', onErr);
  const H = makeHands(f);
  const until = async (fn, ms, arg) => { const end = Date.now() + ms; while (Date.now() < end) { if (await js(fn, arg)) return true; await wait(150); } return false; };
  const clock = () => js(() => ({ ...window.__wdd.clock(), mode: window.__wdd.evening().mode, audio: window.__wdd.sound().context }));
  const out = { phase };
  await js(() => { window.IWER_DEVICE.primaryInputMode = 'hand'; });
  await H.rest();
  const menuPick = async (id) => {
    if (!(await js(() => window.__wdd.debug().visuals.ritualMenuOpen))) { await H.poke('rituals'); await until(() => window.__wdd.debug().visuals.ritualMenuOpen, 2500); }
    await wait(900);
    return H.poke(`ritual:${id}`);
  };
  if (phase === 'a') {
    if (await js(() => window.__wdd.tension().side != null)) { await wait(900); await H.poke('keep'); await wait(900); }
    await menuPick('breathe');
    await until(() => window.__wdd.evening().mode === 'breathe', 4000);
    await wait(3000);
    const steps = [];
    const sample = async (label, ms) => { const a = await clock(); await wait(ms); const b = await clock(); steps.push({ label, from: a, to: b, advanced: +(b.elapsed - a.elapsed).toFixed(2) }); };
    await sample('running', 2000);
    // The Meta button: the session goes "visible-blurred".
    await js(() => window.IWER_DEVICE.updateVisibilityState('visible-blurred'));
    await wait(300);
    await sample('Meta button (visible-blurred)', 3000);
    await js(() => window.IWER_DEVICE.updateVisibilityState('visible'));
    await wait(300);
    await sample('back (visible)', 2000);
    // The page itself hidden (the browser tab in the background), then shown again.
    await js(() => {
      const d = document;
      Object.defineProperty(d, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(d, 'visibilityState', { configurable: true, get: () => 'hidden' });
      d.dispatchEvent(new Event('visibilitychange'));
    });
    await wait(300);
    await sample('page hidden', 3000);
    await js(() => {
      const d = document;
      delete d.hidden;
      delete d.visibilityState;
      d.dispatchEvent(new Event('visibilitychange'));
    });
    await wait(300);
    await sample('page shown again', 2000);
    // Hand tracking lost (both hands), then back.
    await js(() => { window.IWER_DEVICE.hands.left.connected = false; window.IWER_DEVICE.hands.right.connected = false; });
    await wait(300);
    await sample('hands lost', 3000);
    out.handsLost = await js(() => ({ caption: window.__wdd.caption().flash, tracked: window.__wdd.evening().hands }));
    await js(() => { window.IWER_DEVICE.hands.left.connected = true; window.IWER_DEVICE.hands.right.connected = true; });
    await wait(1200);
    await sample('hands back', 2000);
    out.touchAfter = await H.poke('lighter');
    await until(() => window.__wdd.evening().mode !== 'breathe', 9000);
    out.modeAfterEnough = await js(() => window.__wdd.evening().mode);
    out.steps = steps;
  } else if (phase === 'b1') {
    if (await js(() => window.__wdd.tension().side != null)) { await wait(900); await H.poke('keep'); await wait(900); }
    await menuPick('unload');
    await until(() => window.__wdd.debug().visuals.wordChips.some((c) => c.mesh.visible && !/Write/u.test(c.label ?? '')), 9000);
    await wait(900);
    const used = [];
    for (const bin of ['tomorrow', null]) {
      const i = await js((u) => window.__wdd.debug().visuals.wordChips.findIndex((c) => c.mesh.visible && c.label && !/Write|That/u.test(c.label) && !u.includes(c.label)), used);
      used.push(await js((x) => window.__wdd.debug().visuals.wordChips[x]?.label, i));
      await H.poke(`word:${i}`);
      await until(() => window.__wdd.state().tokens.some((t) => t.bin == null && !t.released), 6000);
      await wait(900);
      if (bin != null) {
        const id = await js(() => window.__wdd.state().tokens.find((t) => t.bin == null && !t.released)?.id);
        await H.grab(id, bin);
        await wait(1500);
      }
    }
    out.before = await js(() => ({ mode: window.__wdd.evening().mode, phase: window.__wdd.state().phase, tokens: window.__wdd.state().tokens.map((t) => `${t.text}:${t.bin ?? '-'}`), clock: window.__wdd.clock() }));
  } else {
    await until(() => ['table', 'floating'].includes(window.__wdd.state().placement), 9000);
    await wait(2500);
    out.after = await js(() => ({ placement: window.__wdd.state().placement, mode: window.__wdd.evening().mode, phase: window.__wdd.state().phase, tokens: window.__wdd.state().tokens.map((t) => `${t.text}:${t.bin ?? '-'}`), words: window.__wdd.debug().visuals.wordChips.filter((c) => c.mesh.visible).map((c) => c.label), replies: window.__wdd.debug().visuals.replyLabels, bead: window.__wdd.tension().side, clock: window.__wdd.clock(), caption: window.__wdd.caption().flash }));
    // One touch on "Rituals" = one press, the menu flips once (no listener doubled by the second entry).
    if (out.after.bead != null) { await wait(900); await H.poke('keep'); await wait(1200); }
    const m0 = await js(() => window.__wdd.debug().visuals.ritualMenuOpen);
    const p0 = await js(() => window.__wdd.presses().count);
    await H.poke('rituals');
    await wait(900);
    out.oneTouch = { presses: (await js(() => window.__wdd.presses().count)) - p0, menuFlipped: (await js(() => window.__wdd.debug().visuals.ritualMenuOpen)) !== m0 };
    // The stone left on the desk can still be pinched into a bowl.
    const id = await js(() => window.__wdd.state().tokens.find((t) => t.bin == null && !t.released)?.id ?? null);
    out.leftStone = id;
    if (id != null) out.pinchedAfter = await H.grab(id, 'later');
  }
  out.hands = H.stats;
  out.errors = errors;
  page.off('console', onConsole);
  page.off('pageerror', onErr);
  await cdp.send('Page.stopScreencast').catch(() => {});
  return out;
}
