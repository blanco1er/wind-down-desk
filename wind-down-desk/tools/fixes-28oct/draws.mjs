// 28 Oct: draw calls per eye (p50 / max over 2 s, renderer.info / 2 as tools/stability/stone-draws.mjs) in the two
// states touched by the fixes. STATE=breathe: Breathe at the full moon, replies shown. STATE=quiet: a quiet Unload
// after a word was touched and its stone placed by the hand (the words are back if the fix is in).
// Run after `sh tools/stage.sh 54 30`.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page }) {
  const f = frame ?? page;
  const js = (fn, a) => f.evaluate(fn, a);
  const state = process.env.STATE ?? 'breathe';
  if (state === 'breathe') {
    await js(() => window.__wdd.ritual('breathe'));
    await wait(9000);
  } else {
    await js(() => { window.__wdd.film.history(21); window.__wdd.style('quiet'); window.__wdd.arrive(); });
    for (let k = 0; k < 60 && !(await js(() => window.__wdd.debug().visuals.repliesShown === true)); k++) await wait(150);
    await wait(800);
    await js(() => window.__wdd.press('keep'));
    for (let k = 0; k < 60 && !(await js(() => window.__wdd.debug().visuals.wordsShown === true)); k++) await wait(150);
    await wait(1200);
    const i = await js(() => window.__wdd.debug().visuals.wordChips.findIndex((c) => c.mesh.visible && c.label === 'Work'));
    await js((n) => window.__wdd.press(`word:${n}`), i);
    await wait(2500);
    // The right hand pinches the stone and drops it in Later (as tools/fixes-28oct/quiet-check.mjs).
    const id = await js(() => window.__wdd.state().tokens.find((t) => t.bin == null)?.id);
    const st = await js((x) => window.__wdd.stoneWorld(x), id);
    const end = await js(() => window.__wdd.binWorld('later'));
    const hand = (p, v) => js(([q, w]) => { const h = window.IWER_DEVICE.hands.right; h.position.set(q.x, q.y, q.z); if (w != null) h.updatePinchValue(w); }, [p, v]);
    await js(() => { window.IWER_DEVICE.primaryInputMode = 'hand'; });
    await hand({ x: st.x, y: st.y + 0.05, z: st.z });
    await wait(200);
    await hand({ x: st.x, y: st.y + 0.01, z: st.z });
    await wait(200);
    await hand({ x: st.x, y: st.y + 0.01, z: st.z }, 1);
    await wait(400);
    for (let k = 1; k <= 12; k++) {
      await hand({ x: st.x + ((end.x - st.x) * k) / 12, y: st.y + 0.01 + ((end.y + 0.02 - st.y) * k) / 12, z: st.z + ((end.z - st.z) * k) / 12 });
      await wait(80);
    }
    await hand({ x: end.x, y: end.y + 0.03, z: end.z }, 0);
    await wait(300);
    const rest = await js(() => window.__wdd.deskPoint(0.52, 0, 0.56));
    await hand(rest);
    await wait(3000);
  }
  await js(() => window.__wdd.perfReset());
  await wait(2000);
  const p = await js(() => window.__wdd.perf());
  const info = await js(() => ({ mode: window.__wdd.evening().mode, phase: window.__wdd.state().phase, words: window.__wdd.debug().visuals.wordsShown, replies: window.__wdd.debug().visuals.repliesShown, tokens: window.__wdd.state().tokens.map((t) => `${t.text}:${t.bin ?? '-'}`) }));
  if (state === 'quiet') await js(() => window.__wdd.style('talk'));
  return { state, perEyeP50: p.drawCalls.p50 / 2, perEyeMax: p.drawCalls.max / 2, xr: p.xr, ...info };
}
