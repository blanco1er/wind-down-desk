// Talk it through latency (25 Oct): from the end of your sentence to the first sound of the lamp's voice, with the
// local API server, a fake streaming model and a fake Gemini TTS timed like the owner's live measures (model 2.5 s
// whole / 1.0 s to first words; TTS first byte 1.32 s). Three turns with the former path, three streamed.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page }) {
  const f = frame ?? page;
  const state = () => f.evaluate(() => window.__wdd.talk());
  await f.evaluate(() => window.__wdd.micState('listening'));
  await f.evaluate(() => window.__wdd.press('ritual:talk'));
  for (let i = 0; i < 100; i++) {
    const s = await state();
    if (s.speaking) break;
    await wait(100);
  }
  for (let i = 0; i < 150 && (await state()).speaking; i++) await wait(100);
  const turn = async (text) => {
    const t0 = Date.now();
    await f.evaluate((t) => window.__wdd.say(t), text);
    for (let i = 0; i < 200; i++) {
      if ((await state()).speaking) break;
      await wait(25);
    }
    const ms = Date.now() - t0;
    for (let i = 0; i < 300 && ((await state()).speaking || (await state()).busy); i++) await wait(100);
    await wait(500);
    return ms;
  };
  const sentences = ['Today was long and loud at work.', 'My manager moved the deadline again.', 'I keep replaying the meeting in my head.'];
  const before = [];
  const after = [];
  await f.evaluate(() => window.__wdd.talkStream(false));
  for (const s of sentences) before.push(await turn(s));
  await f.evaluate(() => window.__wdd.talkStream(true));
  for (const s of sentences) after.push(await turn(`${s} Again.`));
  const avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
  return { beforeMs: before, afterMs: after, beforeAvg: avg(before), afterAvg: avg(after) };
}
