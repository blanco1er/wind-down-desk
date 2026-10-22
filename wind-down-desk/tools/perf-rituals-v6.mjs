// v6 performance probe: CPU time per frame, draw calls and triangles during Breathe (moon, pearls, palm glow, motes,
// room dimmer) and during the heaviest Release moment (stone sinking: ripples, bubbles, light), at CPU ×1 / ×4 / ×6.
//   sh tools/stage.sh 54 30 && npx @iwsdk/cli browser run tools/perf-rituals-v6.mjs --timeout 108000
// Film set hidden (what the headset renders). Hands resting either side of the moon.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const rates = JSON.parse(process.env.WDD_RATES ?? '[1,4,6]');
  const windowMs = Number(process.env.WDD_WINDOW_MS ?? 5500);
  const gpu = await f.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  await f.evaluate(() => {
    window.__wdd.film.hide(true);
    window.__wdd.film.history(21);
    const H = window.IWER_DEVICE.hands;
    const put = (s, x, y, z) => { const p = window.__wdd.deskPoint(x, y, z); H[s].position.set(p.x, p.y, p.z); };
    put('left', -0.22, 0.04, 0.06);
    put('right', 0.22, 0.04, 0.06);
    window.__wdd.ritual('breathe');
  });
  await wait(6600);
  const breathe = [];
  for (const rate of rates) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await wait(500);
    await f.evaluate(() => window.__wdd.perfReset());
    await wait(windowMs);
    breathe.push({ cpuThrottle: rate, ...(await f.evaluate(() => window.__wdd.perf())), placeBytes: 0 });
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await f.evaluate(() => window.__wdd.say("That's enough."));
  await wait(7000);
  const release = [];
  for (const rate of rates) {
    await f.evaluate(() => window.__wdd.ritual('release'));
    await wait(1800);
    await f.evaluate(() => window.__wdd.say("I can't stop thinking about the meeting with Paul tomorrow."));
    await wait(2300);
    await f.evaluate(() => window.__wdd.say('Let it go.'));
    await wait(2200); // the stone floats over the water and falls
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await f.evaluate(() => window.__wdd.perfReset());
    await wait(4000); // splash, ripples, bubbles, words of light
    release.push({ cpuThrottle: rate, ...(await f.evaluate(() => window.__wdd.perf())) });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await f.evaluate(() => window.__wdd.say('Not now.'));
    await wait(5200);
  }
  await f.evaluate(() => window.__wdd.film.hide(false));
  return { gpu, breathe, release, state: await f.evaluate(() => window.__wdd.evening().mode) };
}
