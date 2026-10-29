// 29 Oct: which buttons can be touched now, in a few states (choose; ritual menu open; Places open; a place chosen).
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const js = (fn, a) => f.evaluate(fn, a);
  cdp.on('Page.screencastFrame', (e) => cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}));
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 20, maxWidth: 320, maxHeight: 180, everyNthFrame: 3 });
  const acts = ['rituals', 'places', 'settings', 'orb', 'keep', 'lighter', 'immersion', 'move-desk', 'globe-prev', 'globe-next', 'globe-close', 'ritual:sky', 'place:room'];
  const shown = () => js((a) => Object.fromEntries(a.map((x) => { const b = window.__wdd.buttonWorld(x); return [x, b == null ? 'absent' : b.shown ? (b.poke ? 'ok' : 'nopoke') : 'hidden']; })), acts);
  const out = {};
  const st = () => js(() => ({ mode: window.__wdd.evening().mode, menu: window.__wdd.debug().visuals.ritualMenuOpen, places: window.__wdd.globe().open, place: window.__wdd.debug().visuals.backdrop.place, journal: window.__wdd.journal().open }));
  if (await js(() => window.__wdd.tension().side != null)) { await js(() => window.__wdd.press('keep')); await wait(800); }
  await wait(1500);
  out.start = { ...(await st()), b: await shown() };
  await js(() => window.__wdd.press('rituals')); await wait(1200);
  out.menuOpen = { ...(await st()), b: await shown() };
  await js(() => window.__wdd.press('rituals')); await wait(1200);
  out.menuClosed = { ...(await st()), b: await shown() };
  await js(() => window.__wdd.press('places')); await wait(1500);
  out.placesOpen = { ...(await st()), b: await shown() };
  await js(() => window.__wdd.press('globe-next')); await wait(900);
  await js(() => window.__wdd.press('orb')); await wait(4000);
  out.placeChosen = { ...(await st()), b: await shown() };
  await js(() => window.__wdd.press('places')); await wait(1500);
  out.placesAgain = { ...(await st()), b: await shown() };
  await cdp.send('Page.stopScreencast');
  return out;
}
