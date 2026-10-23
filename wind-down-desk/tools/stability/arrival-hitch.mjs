// When is the long frame at arrival? Click → XR session → table found → desk revealed, against perf-system's long
// frames (> 22 ms) and the number of shader programs. Run on the landing page (reloaded).
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page }) {
  const f = frame ?? page;
  const now = () => f.evaluate(() => Math.round(performance.now()));
  const marks = [];
  const before = await f.evaluate(() => window.__wdd.perf().programNames);
  marks.push(['programs before', await f.evaluate(() => window.__wdd.perf?.().programs ?? null)]);
  await f.evaluate(() => {
    const d = window.IWER_DEVICE;
    d.position.set(-0.84, 1.26, 0.2);
    const yaw = Math.PI / 2, pitch = (-27 * Math.PI) / 180;
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
  });
  marks.push(['click', await now()]);
  if (await f.isVisible('[data-style="talk"]')) await f.click('[data-style="talk"]');
  else await f.click('#begin');
  let placedAt = null;
  for (let i = 0; i < 80; i++) {
    const p = await f.evaluate(() => window.__wdd?.state?.().placement ?? null);
    if (placedAt == null && (p === 'table' || p === 'floating')) { placedAt = await now(); marks.push(['placed', placedAt]); }
    if (placedAt != null && (await now()) - placedAt > 5000) break;
    await wait(100);
  }
  const perf = await f.evaluate(() => window.__wdd.perf());
  const after = perf.programNames.filter((n) => !before.includes(n));
  return { newPrograms: after, marks, programsAfter: perf.programs, renderMax: perf.renderMs.max, updateMax: perf.updateMs.max, longFrames: perf.longFrames.filter((l) => l[1] > 40) };
}
