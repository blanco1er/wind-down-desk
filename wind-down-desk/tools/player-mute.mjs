// "Muted" means total silence: checked with the real mouse in player mode (Chromium and WebKit).
// Mutes with the glass Sound button, then: the master volume is 0 and nothing leaves the audio listener (RMS), in the
// garden with its rain, during a ritual, and after a reload (remembered). Unmutes: the ambience comes back.
// Saves zoomed shots of the button in both states.
//   node tools/player-mute.mjs https://localhost:8093/ [chromium|webkit] [outDir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, webkit as webkitDefault } from 'playwright';

const webkit = process.env.WDD_PLAYWRIGHT_WEBKIT ? (await import(process.env.WDD_PLAYWRIGHT_WEBKIT)).webkit : webkitDefault;
const url = process.argv[2] ?? 'https://localhost:8081/';
const name = process.argv[3] ?? 'chromium';
const out = `${process.argv[4] ?? 'artifacts/player-mode'}/${name}-muet`;
mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await (name === 'webkit' ? webkit : chromium).launch({
  headless: true,
  args: name === 'chromium' ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] : [],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const glass = (key, id) =>
  page.evaluate(([k, i]) => {
    const v = window.__wdd.debug().visuals;
    const ent = i == null ? v[k] : v[k].find((c) => c.id === i)?.entity;
    if (ent == null) return null;
    const o = ent.object3D;
    o.updateWorldMatrix(true, false);
    return window.__wddPlayer.screenOf(o.getWorldPosition(o.position.clone()));
  }, [key, id]);
const click = async (p) => {
  await page.mouse.move(p.x, p.y, { steps: 5 });
  await page.mouse.down();
  await wait(60);
  await page.mouse.up();
};
/** Loudest RMS seen over ~1.2 s (the ambience and rain are continuous; cues are short). */
const listen = async () => {
  let peak = 0;
  let last = null;
  for (let i = 0; i < 8; i++) {
    last = await page.evaluate(() => window.__wdd.sound());
    peak = Math.max(peak, last.rms);
    await wait(150);
  }
  return { ...last, rms: +peak.toFixed(5) };
};
const zoom = async (label) => {
  const p = await glass('voiceEntity');
  await page.screenshot({ path: `${out}/${label}.png`, clip: { x: p.x - 110, y: p.y - 40, width: 220, height: 80 } });
};
const start = async () => {
  await page.waitForFunction(() => window.__wdd != null && window.IWER_DEVICE != null, null, { timeout: 40000 });
  await wait(2500);
  await page.click((await page.isVisible('[data-style="talk"]')) ? '[data-style="talk"]' : '#begin');
  await page.waitForFunction(() => ['table', 'floating'].includes(window.__wdd.state().placement) && window.__wddPlayer != null, null, { timeout: 30000 });
  await wait(4000);
  if (await page.isVisible('[data-act="help-ok"]')) await page.click('[data-act="help-ok"]');
};

const steps = [];
const check = async (label, expectSilent) => {
  const s = await listen();
  const ok = expectSilent ? s.master === 0 && s.rms < 1e-4 && !s.speaking : s.master === 1 && s.rms > 1e-4;
  steps.push({ label, ...s, ok });
  console.log(`  [${name}] ${label}: master=${s.master} rms=${s.rms} muted=${s.muted} context=${s.context} → ${ok ? 'ok' : 'ÉCHEC'}`);
};

await page.goto(url);
await page.evaluate(() => localStorage.removeItem('wdd.voice'));
await page.reload();
await start();
await check('1-son-au-depart', false);
await zoom('bouton-sound');
await click(await glass('voiceEntity'));
await wait(900);
await check('2-muet', true);
await zoom('bouton-muted');
// The garden, with its rain.
await click(await glass('ornamentEntity'));
await wait(1300);
await click(await glass('placeChips', 'rain-veranda'));
await page.waitForFunction(() => window.__wdd.debug().visuals.backdrop.place === 'rain-veranda', null, { timeout: 10000 });
await wait(4000);
await check('3-muet-jardin-pluie', true);
// A ritual (its cues and the lamp's lines).
await page.click('#wdd-say');
await page.keyboard.type('Breathe.');
await page.keyboard.press('Enter');
await wait(5000);
await check('4-muet-rituel', true);
// Living places (19 Oct): the campfire's embers loop and crackles, the beach's surf, the snow's wind — all muted.
await page.click('#wdd-say');
await page.keyboard.type("That's enough.");
await page.keyboard.press('Enter');
await wait(2500);
for (const place of ['ember-fire', 'moon-beach', 'northern-lights']) {
  await page.evaluate((p) => window.__wdd.place(p), place);
  await page.waitForFunction((p) => window.__wdd.debug().visuals.backdrop.place === p, place, { timeout: 15000 });
  await wait(4500);
  if (place === 'ember-fire') await page.evaluate(() => window.__wdd.debug().visuals.living.crackleNow());
  await wait(600);
  await check(`4b-muet-${place}`, true);
}
// Reload: still muted.
await page.reload();
await start();
await check('5-muet-apres-rechargement', true);
await zoom('bouton-muted-apres-rechargement');
// Sound back, ambience included.
await click(await glass('voiceEntity'));
await wait(3500);
await check('6-son-revenu', false);
await zoom('bouton-sound-revenu');

writeFileSync(`${out}/report.json`, JSON.stringify({ steps, errors }, null, 2));
console.log(`  [${name}] ${steps.filter((s) => s.ok).length}/${steps.length} ok, errors: ${errors.length ? errors.join(' | ') : 'none'}`);
await browser.close();
