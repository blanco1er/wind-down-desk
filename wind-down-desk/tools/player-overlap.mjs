// Overlap check (22 Oct: + the open Places menu with "Move desk here") (owner, 19 Oct: "Table stays | Full" glued to Yes / Not now, then to Longer / Enough).
// In a place (Full and Table stays), for a lamp proposal and for Breathe, projects the screen rectangle of every
// visible glass element under the caption and fails if two of them overlap or stand closer than 8 px (1440 px wide).
//   node tools/player-overlap.mjs https://localhost:8081/ [chromium|webkit] [outDir] [place ids, comma separated]
// Living places (19 Oct): a 3D effect that stands in the view (the campfire) is checked too, as one more rectangle,
// against every element (caption, rituals panel, chips, the tray) — it must never sit behind the interface.
// WDD_PLAYWRIGHT_WEBKIT=<path to a playwright-core index.mjs> if the project's WebKit build is not installed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, webkit as webkitDefault } from 'playwright';

const webkit = process.env.WDD_PLAYWRIGHT_WEBKIT ? (await import(process.env.WDD_PLAYWRIGHT_WEBKIT)).webkit : webkitDefault;
const url = process.argv[2] ?? 'https://localhost:8081/';
const name = process.argv[3] ?? 'chromium';
const out = `${process.argv[4] ?? 'artifacts/player-mode'}/${name}-chevauchements`;
const placeIds = (process.argv[5] ?? 'moon-lake').split(',');
mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const GAP = 8;

const browser = await (name === 'webkit' ? webkit : chromium).launch({ headless: true, args: name === 'chromium' ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : [] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const say = async (text) => {
  await page.click('#wdd-say');
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
};

/** Screen rectangles (CSS px) of the visible glass elements: caption pill excluded (its canvas is wider than the pill). */
const rects = () =>
  page.evaluate(() => {
    const v = window.__wdd.debug().visuals;
    const items = [
      ['Yes/Longer', v.keepChip],
      ['Not now/Enough', v.lighterChip],
      ['Table stays | Full', v.immersionToggle],
      // 22 Oct: "Move desk here" under the open Places grid, and the grid's bottom row above it.
      ['Move desk here', v.moveChip],
      ...v.placeChips.slice(5).map((c) => [`Place ${c.id}`, c.mesh]),
    ];
    const res = [];
    for (const [label, mesh] of items) {
      if (mesh == null || !mesh.visible) continue;
      const op = mesh.material?.uniforms?.uOpacity?.value ?? 1;
      if (op < 0.05) continue;
      mesh.updateWorldMatrix(true, false);
      if (mesh.geometry.boundingBox == null) mesh.geometry.computeBoundingBox();
      const b = mesh.geometry.boundingBox;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) {
        const p = mesh.localToWorld(b.min.clone().set(x, y, 0));
        const s = window.__wddPlayer.screenOf(p);
        x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y);
      }
      res.push({ label, x0, y0, x1, y1, op: Math.round(op * 100) / 100 });
    }
    // Larger interface pieces, checked only against the 3D effects (their canvases are wider than what is drawn).
    const others = [['Caption', v.caption], ['Tray', v.tray], ...v.ritualChips.map((c) => [`Ritual ${c.id}`, c.mesh])];
    const big = [];
    for (const [label, mesh] of others) {
      if (mesh == null || !mesh.visible) continue;
      const op = mesh.material?.uniforms?.uOpacity?.value ?? 1;
      if (op < 0.05) continue;
      mesh.updateWorldMatrix(true, false);
      if (mesh.geometry.boundingBox == null) mesh.geometry.computeBoundingBox();
      const b = mesh.geometry.boundingBox;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
        const s = window.__wddPlayer.screenOf(mesh.localToWorld(b.min.clone().set(x, y, z)));
        if (s == null) continue;
        x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y);
      }
      if (x1 > x0 && label === 'Caption' && v.captionCanvas?.box != null) {
        // Only the pill drawn on the caption's canvas.
        const bx = v.captionCanvas.box, w = x1 - x0, h = y1 - y0;
        [x0, x1, y0, y1] = [x0 + bx.x0 * w, x0 + bx.x1 * w, y0 + bx.y0 * h, y0 + bx.y1 * h];
      }
      if (x1 > x0) big.push({ label, x0, y0, x1, y1, big: true });
    }
    // The campfire: its ring of stones and the flames (≈ 0.8 m high), as seen right now.
    const fire = v.living.current?.fire;
    const effects = [];
    if (fire != null && v.living.current.root.visible) {
      const ring = (v.living.current.life.fire.ringRadius ?? 0.5) + 0.08;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < 16; i++) for (const h of [0, 0.8]) {
        const a = (i / 16) * Math.PI * 2;
        const p = fire.group.localToWorld(fire.group.position.clone().set(Math.cos(a) * ring, h, Math.sin(a) * ring));
        const s = window.__wddPlayer.screenOf(p);
        if (s == null) continue;
        x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y);
      }
      if (x1 > x0) effects.push({ label: 'Campfire', x0, y0, x1, y1, effect: true });
    }
    return [...res, ...big, ...effects];
  });

const report = [];
const check = async (state) => {
  await wait(1800);
  const r = await rects();
  const clashes = [];
  for (let i = 0; i < r.length; i++)
    for (let j = i + 1; j < r.length; j++) {
      const a = r[i], b = r[j];
      const dx = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
      const dy = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1);
      // Large pieces are only checked against 3D effects (the fire must never stand behind the interface).
      if ((a.big || b.big) && !(a.effect || b.effect)) continue;
      // Grid cells are laid out together (0.8 cm apart by design): only checked against the other controls.
      if (a.label.startsWith('Place ') && b.label.startsWith('Place ')) continue;
      // Same row (Yes | Not now) is fine when they stand apart; anything else must keep the gap.
      if (dx < GAP && dy < GAP) clashes.push(`${a.label} × ${b.label} (écart x ${Math.round(dx)} px, y ${Math.round(dy)} px)`);
    }
  report.push({ state, visible: r.map((x) => x.label), clashes });
  await page.screenshot({ path: `${out}/${String(report.length).padStart(2, '0')}-${state}.png` });
  console.log(`  [${name}] ${state}: ${r.map((x) => x.label).join(', ') || '—'}${clashes.length ? `  ✗ ${clashes.join(' ; ')}` : '  ✓'}`);
};

await page.goto(url);
await page.waitForFunction(() => window.__wdd != null && window.IWER_DEVICE != null, null, { timeout: 40000 });
await wait(2500);
await page.click((await page.isVisible('[data-style="talk"]')) ? '[data-style="talk"]' : '#begin');
await page.waitForFunction(() => ['table', 'floating'].includes(window.__wdd.state().placement) && window.__wddPlayer != null, null, { timeout: 30000 });
await wait(4000);
if (await page.isVisible('[data-act="help-ok"]')) await page.click('[data-act="help-ok"]');

for (const placeId of placeIds)
for (const immersion of ['Full immersion.', 'Keep my table.']) {
  await page.evaluate((p) => window.__wdd.place(p), placeId);
  await wait(4500);
  await say(immersion);
  await wait(2500);
  await check(`${placeId}-${immersion.startsWith('Full') ? 'full' : 'table'}-repos`);
  await page.evaluate(() => window.__wdd.press('places'));
  await check(`${placeId}-${immersion.startsWith('Full') ? 'full' : 'table'}-places-ouvert`);
  await page.evaluate(() => window.__wdd.debug().visuals.openPlaces(false));
  await wait(800);
  await page.evaluate(() => window.__wdd.arrive());
  await page.waitForFunction(() => window.__wdd.evening().proposal != null, null, { timeout: 20000 }).catch(() => {});
  await check(`${placeId}-${immersion.startsWith('Full') ? 'full' : 'table'}-proposition`);
  await say('Breathe.');
  await page.waitForFunction(() => window.__wdd.evening().mode === 'breathe', null, { timeout: 10000 }).catch(() => {});
  await wait(4000);
  await check(`${placeId}-${immersion.startsWith('Full') ? 'full' : 'table'}-breathe`);
  await say("That's enough.");
  await wait(3000);
}
const bad = report.filter((r) => r.clashes.length);
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(`  [${name}] ${bad.length === 0 ? 'OK — aucun chevauchement' : `ÉCHEC — ${bad.length} état(s) avec chevauchement`}`);
await browser.close();
process.exit(bad.length === 0 ? 0 : 1);
