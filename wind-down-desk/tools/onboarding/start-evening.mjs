// Seats the emulated head (as the cold-minute recordings), touches "Talk with the lamp" and waits for the desk.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page }) {
  const f = frame ?? page;
  await page.evaluate(() => document.querySelectorAll('.workspace-view-switcher').forEach((e) => (e.style.display = 'none'))).catch(() => {});
  await f.evaluate(() => {
    const d = window.IWER_DEVICE;
    d.primaryInputMode = 'hand';
    // 24 Oct: eyes 0.45 m above the synthetic table (a typical seat; was 0.39, a low one).
    d.position.set(-0.84, 1.26, 0.2);
    const yaw = Math.PI / 2, pitch = (-27 * Math.PI) / 180;
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
    window.__wdd?.film?.fov?.(58);
  });
  const style = process.env.WDD_STYLE ?? 'talk';
  const card = `[data-style="${style}"]`;
  if (await f.isVisible(card)) await f.click(card);
  else await f.click('#begin');
  for (let i = 0; i < 40; i++) {
    const s = await f.evaluate(() => window.__wdd?.state?.().placement ?? null);
    if (s === 'table' || s === 'floating') return { placement: s };
    await wait(300);
  }
  return { placement: null };
}
