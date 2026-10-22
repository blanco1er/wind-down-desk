// Plays the whole evening in PLAYER MODE with the real mouse and keyboard (Playwright: chromium and/or webkit),
// and saves a screenshot per step. Nothing is called directly in the app: every action is a DOM click, a drag,
// a key or typed text, the paths the owner uses in Safari/Chrome. (Only *reading* positions uses the page.)
//   node tools/player-evening.mjs https://localhost:8093/ [chromium|webkit|both] [outDir]
// Needs a dev server started with VITE_WDD_PLAYTEST=1 (npm run playtest), or add ?player=1 to the URL.
import { mkdirSync } from 'node:fs';
import { chromium, webkit as webkitDefault } from 'playwright';

// WebKit build mismatch on this Mac: point WDD_PLAYWRIGHT_WEBKIT at a playwright-core whose WebKit is installed.
const webkit = process.env.WDD_PLAYWRIGHT_WEBKIT ? (await import(process.env.WDD_PLAYWRIGHT_WEBKIT)).webkit : webkitDefault;
const video = process.env.WDD_VIDEO === '1';

const url = process.argv[2] ?? 'https://localhost:8081/';
const which = process.argv[3] ?? 'both';
const outRoot = process.argv[4] ?? 'artifacts/player-mode';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function play(name, engine) {
  const out = `${outRoot}/${name}`;
  mkdirSync(out, { recursive: true });
  const browser = await engine.launch({ headless: true, args: name === 'chromium' ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : [] });
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    ...(video ? { recordVideo: { dir: out, size: { width: 1440, height: 900 } } } : {}),
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
  let n = 0;
  const pacing = [];
  /** Frame pacing since the previous step (requestAnimationFrame intervals in the page). */
  const frames = () =>
    page.evaluate(() => {
      const f = (window.__ft ?? []).splice(0);
      if (f.length < 2) return null;
      const s = [...f].sort((a, b) => a - b);
      const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
      return { n: f.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +s[s.length - 1].toFixed(1), over50: f.filter((x) => x > 50).length };
    });
  const shot = async (label) => {
    const file = `${out}/${String(++n).padStart(2, '0')}-${label}.png`;
    const fp = await frames();
    pacing.push({ step: label, ...fp });
    await page.screenshot({ path: file });
    console.log(`  [${name}] ${file} ${fp ? `frames p50 ${fp.p50} ms, p95 ${fp.p95} ms, max ${fp.max} ms, >50 ms: ${fp.over50}/${fp.n}` : ''}`);
  };
  const st = () => page.evaluate(() => {
    const s = window.__wdd.state();
    const e = window.__wdd.evening();
    return { phase: s.phase, mode: e.mode, proposal: e.proposal?.ritual ?? null, tokens: s.tokens.map((t) => `${t.text}:${t.bin ?? '-'}${t.released ? '(released)' : ''}`), plan: s.plan != null, holding: window.__wddPlayer?.holding ?? null };
  });
  const click = async (p, label) => {
    if (p == null) throw new Error(`no screen position for ${label}`);
    await page.mouse.move(p.x, p.y, { steps: 6 });
    await page.mouse.down();
    await wait(60);
    await page.mouse.up();
  };
  const target = (kind, id) => page.evaluate(([k, i]) => window.__wddPlayer.target(k, i), [kind, id]);
  /** Screen position of a glass button (entity of the desk visuals). */
  const glass = (key, id) =>
    page.evaluate(([k, i]) => {
      const v = window.__wdd.debug().visuals;
      const ent = i == null ? v[k] : v[k].find((c) => c.id === i)?.entity;
      if (ent == null) return null;
      const o = ent.object3D;
      o.updateWorldMatrix(true, false);
      const p = o.getWorldPosition(o.position.clone());
      return window.__wddPlayer.screenOf(p);
    }, [key, id]);
  /** Opens the glass Rituals menu with the mouse (it may already be open: the lamp opens it when it proposes). */
  const openRituals = async () => {
    const open = await page.evaluate(() => window.__wdd.debug().visuals.ritualMenuOpen);
    if (!open) {
      await click(await glass('ritualsEntity'), 'Rituals');
      await wait(1300);
    }
  };
  const typeLine = async (text) => {
    await page.click('#wdd-say');
    await page.keyboard.type(text, { delay: 8 });
    await page.keyboard.press('Enter');
  };

  await page.addInitScript(() => {
    window.__ft = [];
    let last = 0;
    const tick = (t) => {
      if (last > 0) window.__ft.push(t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto(url);
  await page.waitForFunction(() => window.__wdd != null && window.IWER_DEVICE != null, null, { timeout: 40000 });
  await wait(2500);
  await shot('landing');
  await page.click((await page.isVisible('[data-style="talk"]')) ? '[data-style="talk"]' : '#begin');
  await page.waitForFunction(() => ['table', 'floating'].includes(window.__wdd.state().placement) && window.__wddPlayer != null, null, { timeout: 30000 });
  await wait(4500);
  await shot('arrivee-comment-jouer');
  await page.click('[data-act="help-ok"]');

  // 1. Unload with the glass menu, then the head dump typed in the panel.
  await click(await glass('ritualChips', 'unload'), 'Unload chip');
  await wait(1500);
  await typeLine("I still haven't replied to the landlord. I need to book the dentist. The slides for Monday aren't done.");
  await page.waitForFunction(() => window.__wdd.state().tokens.length >= 3, null, { timeout: 20000 });
  await wait(3500);
  await typeLine("That's it.");
  await wait(2500);
  await shot('pierres');
  console.log('  ', JSON.stringify(await st()));

  // 2. Click a stone, then a bowl (x2), then drag-and-drop one.
  const ids = await page.evaluate(() => window.__wdd.state().tokens.filter((t) => t.bin == null && !t.released).map((t) => t.id));
  const bins = ['tomorrow', 'later', 'let-go'];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const stone = await target('stone', id);
    if (i === ids.length - 1) {
      // drag-and-drop
      const bowl = await target('bin', bins[i % 3]);
      await page.mouse.move(stone.x, stone.y, { steps: 5 });
      await page.mouse.down();
      await wait(900);
      for (let k = 1; k <= 20; k++) {
        await page.mouse.move(stone.x + ((bowl.x - stone.x) * k) / 20, stone.y + ((bowl.y - stone.y) * k) / 20);
        await wait(30);
      }
      await wait(250);
      await shot('glisser-deposer');
      await page.mouse.up();
    } else {
      await click(stone, `stone ${id}`);
      await page.waitForFunction(() => window.__wddPlayer.holding != null, null, { timeout: 5000 });
      await wait(400);
      if (i === 0) await shot('pierre-en-main');
      await click(await target('bin', bins[i % 3]), `bin ${bins[i % 3]}`);
    }
    await page.waitForFunction(() => window.__wddPlayer.holding == null && !window.__wddPlayer.busy, null, { timeout: 8000 });
    await wait(1400);
  }
  await wait(2500);
  await shot('tri-termine');
  console.log('  ', JSON.stringify(await st()));

  // 3. The plan: "Keep" glass button.
  await page.waitForFunction(() => window.__wdd.state().plan != null, null, { timeout: 25000 }).catch(() => {});
  await wait(2500);
  await shot('plan');
  const keep = await glass('keepEntity');
  if (keep != null) await click(keep, 'Keep');
  await wait(4000);
  await shot('plan-garde');
  console.log('  ', JSON.stringify(await st()));

  // 4. Release: the Rituals menu → Release, the sentence typed, the stone carried over the water with the mouse.
  await openRituals();
  await click(await glass('ritualChips', 'release'), 'Release chip');
  await wait(2500);
  await typeLine('The meeting with Paul tomorrow. I keep replaying it.');
  await page.waitForFunction(() => window.__wdd.weightWorld() != null, null, { timeout: 20000 });
  await wait(4500);
  await shot('release-pierre');
  await click(await target('weight'), 'weight stone');
  await page.waitForFunction(() => window.__wddPlayer.holding === 'weight', null, { timeout: 6000 });
  await wait(500);
  await click(await target('water'), 'water');
  await wait(1200);
  await shot('release-au-dessus-eau');
  await wait(5000);
  await shot('release-coule');
  console.log('  ', JSON.stringify(await st()));

  // 5. Breathe: the lamp proposes it after Release → the "Yes." reply in the panel's next step (else the menu).
  await page.waitForFunction(() => window.__wdd.evening().proposal != null || window.__wdd.evening().mode === 'choose', null, { timeout: 15000 }).catch(() => {});
  await wait(1500);
  await shot('proposition');
  const proposal = await page.evaluate(() => window.__wdd.evening().proposal?.ritual ?? null);
  if (proposal === 'breathe') {
    await page.click('#wdd-next .replies button:first-child');
  } else {
    await openRituals();
    await click(await glass('ritualChips', 'breathe'), 'Breathe chip');
  }
  await page.waitForFunction(() => window.__wdd.evening().mode === 'breathe', null, { timeout: 10000 });
  await wait(8000);
  await shot('breathe');
  await page.click('#wdd-next .replies button:first-child');
  await wait(4000);
  console.log('  ', JSON.stringify(await st()));

  // 6. Places: the Places button → the lake → back to the room; look around with the mouse; R recenters.
  await click(await glass('ornamentEntity'), 'Places');
  await wait(1500);
  await shot('lieux-menu');
  await click(await glass('placeChips', 'moon-lake'), 'lake');
  await wait(6000);
  await shot('lieu-lac');
  const c = { x: 900, y: 450 };
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  for (let k = 1; k <= 15; k++) {
    await page.mouse.move(c.x + k * 14, c.y + k * 3);
    await wait(25);
  }
  await page.mouse.up();
  await wait(1200);
  await shot('regarder-autour');
  await page.keyboard.press('r');
  await wait(1500);
  await click(await glass('ornamentEntity'), 'Places');
  await wait(1500);
  await click(await glass('placeChips', 'room'), 'room');
  await wait(5000);
  await shot('retour-chambre');

  // 7. Good night (the Rituals menu → Good night).
  await openRituals();
  await click(await glass('ritualChips', 'sleep'), 'Good night chip');
  await wait(6000);
  await shot('bonne-nuit');
  const final = await st();
  console.log('  ', JSON.stringify(final));
  console.log(`  [${name}] errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`${out}/pacing.json`, JSON.stringify({ final, errors, pacing }, null, 2));
  await ctx.close();
  await browser.close();
  return { final, errors };
}

const runs = which === 'both' ? [['chromium', chromium], ['webkit', webkit]] : [[which, which === 'webkit' ? webkit : chromium]];
for (const [name, engine] of runs) {
  console.log(`== ${name}`);
  await play(name, engine);
}
