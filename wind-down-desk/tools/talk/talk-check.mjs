// "Talk it through" end to end in the emulator (24 Oct), with the local API server and a FAKE Gemini TTS (no paid
// call): the lamp opens, speaks with a streamed spatial voice, listens, thinks, answers; what weighs becomes stones;
// a crisis sentence shows help resources; the clock announces the end at 40 min and closes at 45 gently, then the
// stones are let go in Unload. Captures in artifacts/talk/.
import { mkdirSync, writeFileSync } from 'node:fs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  mkdirSync('artifacts/talk', { recursive: true });
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 86 });
    writeFileSync(`artifacts/talk/${name}.jpg`, Buffer.from(r.data, 'base64'));
  };
  const state = () => f.evaluate(() => window.__wdd.talk());
  const until = async (pred, ms = 15000) => {
    const t0 = Date.now();
    for (;;) {
      const s = await state();
      if (pred(s) || Date.now() - t0 > ms) return { s, ms: Date.now() - t0 };
      await wait(100);
    }
  };
  await f.evaluate(() => window.__wdd.micState('listening'));
  const r = {};
  if (process.env.WDD_PART === 'b') return partB(f, r, shot, state, until);
  // Open it from the ritual menu (as a touch would).
  const t0 = Date.now();
  await f.evaluate(() => window.__wdd.press('ritual:talk'));
  r.opening = (await until((s) => s.speaking, 8000));
  r.firstSoundMs = Date.now() - t0;
  await wait(1500);
  await shot('01-opening');
  await until((s) => !s.speaking, 15000);
  // A first sentence.
  const t1 = Date.now();
  await f.evaluate(() => window.__wdd.say('I keep thinking about the deadline at work, and my sister has not called me back.'));
  await wait(400);
  r.thinking = await state();
  await shot('02-thinking');
  r.reply = (await until((s) => s.speaking, 15000)).s;
  r.replyToSoundMs = Date.now() - t1;
  await wait(1200);
  await shot('03-answer-stones');
  await until((s) => !s.speaking, 20000);
  // Silence: bubbles after 8 s.
  await wait(9000);
  r.bubbles = await f.evaluate(() => window.__wdd.debug().visuals.wordChips.filter((c) => c.mesh.visible && c.label != null).map((c) => c.label));
  await shot('04-bubbles');
  return r;
}

async function partB(f, r, shot, state, until) {
  // A crisis sentence: fixed answer, resources, no model call.
  await f.evaluate(() => window.__wdd.say('Sometimes I want to end my life.'));
  await wait(1500);
  r.crisis = await state();
  await shot('05-help');
  await until((s) => !s.speaking, 20000);
  // The clock: 41 min → announced; 45 → gentle close, then Unload with the stones.
  await f.evaluate(() => window.__wdd.talk(41));
  await wait(1200);
  r.announce = (await state()).caption;
  await f.evaluate(() => window.__wdd.talk(45.1));
  await wait(1500);
  r.closing = await state();
  await until((s) => s.mode === 'unload', 20000);
  await wait(1500);
  r.after = await state();
  r.tokens = await f.evaluate(() => window.__wdd.state().tokens.map((t) => `${t.text}:${t.suggestion}`));
  await shot('06-let-them-go');
  return r;
}
