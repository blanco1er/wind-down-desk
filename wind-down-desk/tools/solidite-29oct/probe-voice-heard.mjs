// 29 Oct: the lamp's line is really heard after the reuse fix: loudness leaving the listener while it speaks.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  cdp.on('Page.screencastFrame', (e) => cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}));
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 20, maxWidth: 320, maxHeight: 180, everyNthFrame: 3 });
  const out = [];
  for (let k = 0; k < 2; k++) {
    await f.evaluate(() => { window.__wdd.voice(true); window.__wdd.sound(); window.__wdd.arrive(); });
    let peak = 0;
    for (let i = 0; i < 40; i++) { const s = await f.evaluate(() => window.__wdd.sound().rms); peak = Math.max(peak, s); await wait(100); }
    out.push(+peak.toFixed(4));
    await wait(1500);
  }
  await cdp.send('Page.stopScreencast');
  return { peakRmsFirstLine: out[0], peakRmsSameLineAgain: out[1] };
}
