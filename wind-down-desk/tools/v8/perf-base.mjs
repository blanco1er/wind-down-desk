// v8: baseline in your room (five stones, no menu, no place) at CPU ×1/×6, same windows as perf-v8.mjs.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const ev = (body) => f.evaluate(new Function(`return (async () => { const d = window.__wdd; ${body} })()`));
  await ev(`d.film.history(21); d.arrive(); await new Promise((r) => setTimeout(r, 2200)); await d.say('Unload.'); await new Promise((r) => setTimeout(r, 1500));
    await d.say("I still haven't replied to the landlord about the heating. And I need to book the dentist, it's been a year.");
    await new Promise((r) => setTimeout(r, 1200));
    await d.say("The slides for Monday aren't done. I keep replaying that awkward comment I made in the meeting. Oh, and my passport expires in March.");
    await new Promise((r) => setTimeout(r, 2500));`);
  const out = [];
  for (const rate of [1, 6]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await wait(600);
    await ev('d.perfReset();');
    await wait(5000);
    out.push({ scenario: 'room-baseline', cpuThrottle: rate, ...(await ev('return d.perf();')) });
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  return out;
}
