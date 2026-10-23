// Where is a long frame? Starts a ritual (WDD_RITUAL, default release) on a fresh evening and lines up the long frames
// (> 22 ms, perf-system) with the steps: the touch, the weight formed from a sentence. Run on the landing page.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page }) {
  const f = frame ?? page;
  const kind = process.env.WDD_RITUAL ?? 'release';
  await f.evaluate(() => window.__wdd.film.day(5));
  await f.evaluate(() => {
    const d = window.IWER_DEVICE;
    d.position.set(-0.84, 1.26, 0.2);
    const yaw = Math.PI / 2, pitch = (-27 * Math.PI) / 180;
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
  });
  if (await f.isVisible('[data-style="talk"]')) await f.click('[data-style="talk"]');
  else await f.click('#begin');
  for (let i = 0; i < 40; i++) {
    if (['table', 'floating'].includes(await f.evaluate(() => window.__wdd?.state?.().placement ?? null))) break;
    await wait(300);
  }
  await wait(9000);
  await f.evaluate(() => window.__wdd.perfReset());
  const marks = [];
  const mark = async (label) => marks.push([await f.evaluate(() => Math.round(performance.now())), label]);
  await mark('press');
  await f.evaluate((k) => window.__wdd.press(`ritual:${k}`), kind);
  await wait(3500);
  if (kind === 'release') {
    await mark('say');
    await f.evaluate(() => window.__wdd.say('The meeting with Paul tomorrow.'));
    await wait(3500);
  }
  await mark('end');
  return { marks, longFrames: await f.evaluate(() => window.__wdd.perf().longFrames), programs: await f.evaluate(() => window.__wdd.perf().programs) };
}
