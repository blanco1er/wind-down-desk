// v8 perf probe: the heaviest new moments. Five stones on the desk, then (A) the tea garden in "Full" with the
// rain, (B) your room with the Places grid open. CPU throttled ×1 / ×4 / ×6 (DevTools), app timings from
// window.__wdd.perf() (update + render submit, draw calls, triangles per stereo frame).
//   sh tools/stage.sh 54 27 && npx @iwsdk/cli browser run tools/v8/perf-v8.mjs --timeout 108000
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const windowMs = Number(process.env.WDD_WINDOW_MS ?? 5000);
  const rates = JSON.parse(process.env.WDD_RATES ?? '[1,4,6]');
  const ev = (body) => f.evaluate(new Function(`return (async () => { const d = window.__wdd; ${body} })()`));
  await ev(`d.film.history(21); d.arrive(); await new Promise((r) => setTimeout(r, 2200));
    await d.say('Unload.'); await new Promise((r) => setTimeout(r, 1500));
    await d.say("I still haven't replied to the landlord about the heating. And I need to book the dentist, it's been a year.");
    await new Promise((r) => setTimeout(r, 1200));
    await d.say("The slides for Monday aren't done. I keep replaying that awkward comment I made in the meeting. Oh, and my passport expires in March.");
    await new Promise((r) => setTimeout(r, 2500));`);
  const measure = async (label) => {
    const out = [];
    for (const rate of rates) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      await wait(600);
      await ev('d.perfReset();');
      await wait(windowMs);
      out.push({ scenario: label, cpuThrottle: rate, ...(await ev('return d.perf();')) });
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    return out;
  };
  const results = [];
  await ev(`await d.place('tea-garden'); await new Promise((r) => setTimeout(r, 2000)); d.immersion('full'); await new Promise((r) => setTimeout(r, 2500));`);
  results.push(...(await measure('garden-full-rain')));
  results.push({ rain: await ev('return d.rain();'), placeMemory: await ev('return d.placeMemory();') });
  await ev(`await d.place('room'); await new Promise((r) => setTimeout(r, 2000)); d.press('places'); await new Promise((r) => setTimeout(r, 1500));`);
  results.push(...(await measure('room-places-grid-open')));
  return results;
}
