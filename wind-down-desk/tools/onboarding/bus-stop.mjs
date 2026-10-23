// "One bus stop" test (23 Oct): a short complete evening, the evident path, timed. First evening, talk.
// Say one worry → pinch the stone into its bowl (emulated hand) → "Keep it" → the lamp offers Yes / Good night →
// Good night → the session ends by itself.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  cdp.on('Page.screencastFrame', (e) => void cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}));
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 40, maxWidth: 320, maxHeight: 180 });
  const t0 = Date.now();
  const at = () => +((Date.now() - t0) / 1000).toFixed(1);
  const steps = [];
  const card = '[data-style="talk"]';
  if (await f.isVisible(card)) await f.click(card);
  else await f.click('#begin');
  await f.waitForFunction(() => window.__wdd.evening().mode === 'unload', null, { timeout: 30000 });
  steps.push(['Unload (first evening)', at()]);
  await f.evaluate(() => window.__wdd.say('I need to call the dentist.'));
  await f.waitForFunction(() => window.__wdd.state().tokens.length > 0, null, { timeout: 20000 });
  steps.push(['a stone', at()]);
  await wait(1200);
  const id = await f.evaluate(() => window.__wdd.state().tokens[0].id);
  const start = await f.evaluate((i) => window.__wdd.stoneWorld(i), id);
  const end = await f.evaluate(() => window.__wdd.binWorld('tomorrow'));
  const hand = (p, v) => f.evaluate(([q, pinch]) => { const h = window.IWER_DEVICE.hands.right; h.position.set(q.x, q.y, q.z); if (pinch != null) h.updatePinchValue(pinch); }, [p, v]);
  await hand({ x: start.x, y: start.y + 0.01, z: start.z }, 0);
  await wait(250);
  await hand({ x: start.x, y: start.y + 0.01, z: start.z }, 1);
  await wait(250);
  for (let i = 1; i <= 20; i++) {
    const k = i / 20;
    await hand({ x: start.x + (end.x - start.x) * k, y: start.y + 0.01 + (end.y - start.y) * k + Math.sin(Math.PI * k) * 0.08, z: start.z + (end.z - start.z) * k }, null);
    await wait(30);
  }
  await hand({ x: end.x, y: end.y + 0.01, z: end.z }, 0);
  await wait(300);
  await hand({ x: end.x, y: end.y + 0.2, z: end.z + 0.25 }, 0);
  await f.waitForFunction(() => window.__wdd.state().phase === 'plan', null, { timeout: 20000 });
  steps.push(['sorted → plan', at()]);
  await wait(2500);
  await f.evaluate(() => window.__wdd.press('keep'));
  await f.waitForFunction(() => window.__wdd.evening().mode === 'choose', null, { timeout: 20000 });
  steps.push(['plan kept → the lamp offers', at()]);
  await wait(2500);
  const replies = await f.evaluate(() => window.__wdd.debug().visuals.replyLabels);
  await f.evaluate(() => window.__wdd.press('lighter'));
  steps.push(['Good night touched', at()]);
  await f.waitForFunction(() => window.__wdd.state().placement === 'preview', null, { timeout: 30000 }).catch(() => {});
  steps.push(['session over', at()]);
  await cdp.send('Page.stopScreencast');
  return { replies, steps, totalSeconds: at() };
}
