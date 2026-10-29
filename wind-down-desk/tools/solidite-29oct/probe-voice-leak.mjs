// 29 Oct: the lamp speaks again and again (the arrival line, 18 times): how many positional audio players stay in
// the scene? Before the fix every line left one (never removed); after, the count stays flat.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const js = (fn, a) => f.evaluate(fn, a);
  cdp.on('Page.screencastFrame', (e) => cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}));
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 20, maxWidth: 320, maxHeight: 180, everyNthFrame: 3 });
  const count = () => js(() => { let sc = window.__wdd.debug().visuals.root; while (sc.parent) sc = sc.parent; let n = 0; sc.traverse((o) => { if (o.type === 'Audio') n++; }); return { audio: n, sceneChildren: sc.children.length }; });
  await js(() => window.__wdd.voice(true));
  const before = await count();
  for (let k = 0; k < 18; k++) {
    await js(() => window.__wdd.arrive());
    await wait(4200);
  }
  const after = await count();
  const lines = await js(() => window.__wdd.voice().log.filter((l) => l.src.startsWith('voice/')).length);
  const sound = await js(() => window.__wdd.sound());
  await cdp.send('Page.stopScreencast');
  return { before, after, voiceLinesPlayed: lines, rms: sound.rms, context: sound.context };
}
