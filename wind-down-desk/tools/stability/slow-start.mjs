// Cold judge on a slow connection (26 Oct): the page reloaded under a throttled network (CDP), how long until the
// landing is usable ("Begin"), until the desk is on the table, until a place opens. WDD_NET = 8mbit (default) | 3g.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const NETS = { '8mbit': { latency: 40, down: 8e6 / 8, up: 2e6 / 8 }, '3g': { latency: 300, down: 1.6e6 / 8, up: 0.75e6 / 8 } };
export default async function run({ page, cdp }) {
  const net = NETS[process.env.WDD_NET ?? '8mbit'];
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: net.latency, downloadThroughput: net.down, uploadThroughput: net.up });
  const t0 = Date.now();
  await page.evaluate(() => location.reload());
  const appFrame = async () => {
    for (let i = 0; i < 600; i++) {
      for (const fr of page.frames()) {
        try {
          if (await fr.evaluate(() => window.IWER_DEVICE != null && typeof window.__wdd?.film === 'object')) return fr;
        } catch {}
      }
      await wait(200);
    }
    return null;
  };
  const f = await appFrame();
  const out = { net: process.env.WDD_NET ?? '8mbit' };
  if (f == null) return { ...out, error: 'no app frame' };
  for (let i = 0; i < 900; i++) {
    const ready = await f.evaluate(() => {
      const b = document.querySelector('[data-style="talk"]') ?? document.querySelector('#begin');
      return b != null && !(b instanceof HTMLButtonElement && b.disabled) && getComputedStyle(b).visibility !== 'hidden' && document.body.classList.contains('ready');
    }).catch(() => false);
    if (ready) break;
    await wait(200);
  }
  out.landingUsableS = (Date.now() - t0) / 1000;
  await f.evaluate(() => window.__wdd?.film?.day?.(15));
  await f.evaluate(() => {
    const d = window.IWER_DEVICE;
    d.position.set(-0.84, 1.26, 0.2);
    const yaw = Math.PI / 2, pitch = (-27 * Math.PI) / 180;
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
  });
  const t1 = Date.now();
  if (await f.isVisible('[data-style="talk"]')) await f.click('[data-style="talk"]');
  else await f.click('#begin');
  for (let i = 0; i < 300; i++) {
    if (['table', 'floating'].includes(await f.evaluate(() => window.__wdd?.state?.().placement ?? null))) break;
    await wait(200);
  }
  out.deskPlacedS = (Date.now() - t1) / 1000;
  await wait(3000);
  const t2 = Date.now();
  await f.evaluate(() => void window.__wdd.place('moon-beach'));
  for (let i = 0; i < 400; i++) {
    const p = await f.evaluate(() => window.__wdd.debug().visuals.backdrop.progress);
    if (p > 0) break;
    await wait(100);
  }
  out.placeOpensS = (Date.now() - t2) / 1000;
  out.errors = await f.evaluate(() => window.__wdd.perf().longFrames.filter((l) => l[1] > 100).length);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  return out;
}
