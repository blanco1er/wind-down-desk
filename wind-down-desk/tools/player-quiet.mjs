// A whole QUIET EVENING played with the mouse only (player mode, emulated hands do the pinches), Chromium or WebKit:
// never a word typed or spoken, never a microphone request. Fails if getUserMedia (or speech recognition) is called,
// or if any step has no touch path. Screenshot per step.
//   node tools/player-quiet.mjs https://localhost:8093/ [chromium|webkit] [outDir]
// WDD_PLAYWRIGHT_WEBKIT=<path to a playwright-core index.mjs> if the project's WebKit build is not installed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, webkit as webkitDefault } from 'playwright';

const webkit = process.env.WDD_PLAYWRIGHT_WEBKIT ? (await import(process.env.WDD_PLAYWRIGHT_WEBKIT)).webkit : webkitDefault;
const url = process.argv[2] ?? 'https://localhost:8081/';
const name = process.argv[3] ?? 'chromium';
const out = `${process.argv[4] ?? 'artifacts/player-mode'}/${name}-soiree-silencieuse`;
mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await (name === 'webkit' ? webkit : chromium).launch({ headless: true, args: name === 'chromium' ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : [] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => {
  window.__mic = { getUserMedia: 0, speech: 0 };
  const md = navigator.mediaDevices;
  if (md?.getUserMedia) {
    const real = md.getUserMedia.bind(md);
    md.getUserMedia = (c) => {
      window.__mic.getUserMedia++;
      return real(c);
    };
  }
  for (const k of ['SpeechRecognition', 'webkitSpeechRecognition']) {
    const R = window[k];
    if (R?.prototype?.start) {
      const start = R.prototype.start;
      R.prototype.start = function () {
        window.__mic.speech++;
        return start.call(this);
      };
    }
  }
});

let n = 0;
const shot = async (label) => {
  const file = `${out}/${String(++n).padStart(2, '0')}-${label}.png`;
  await page.screenshot({ path: file });
  console.log(`  [${name}] ${file}`);
};
const st = () => page.evaluate(() => ({ mode: window.__wdd.evening().mode, phase: window.__wdd.state().phase, proposal: window.__wdd.evening().proposal?.ritual ?? null, tokens: window.__wdd.state().tokens.map((t) => `${t.text}:${t.bin ?? '-'}`), mic: window.__mic }));
const screenOfEntity = (key, idx) =>
  page.evaluate(([k, i]) => {
    const v = window.__wdd.debug().visuals;
    const holder = i == null ? v[k] : typeof i === 'number' ? v[k][i]?.entity : v[k].find((c) => c.id === i)?.entity;
    if (holder == null) return null;
    const o = holder.object3D;
    o.updateWorldMatrix(true, false);
    return window.__wddPlayer.screenOf(o.getWorldPosition(o.position.clone()));
  }, [key, idx]);
const click = async (p, label) => {
  if (p == null) throw new Error(`nothing to click for ${label}`);
  await page.mouse.move(p.x, p.y, { steps: 6 });
  await page.mouse.down();
  await wait(60);
  await page.mouse.up();
};
/** The touch reply under the caption: 0 = Yes / Longer, 1 = Not now / Enough. */
const reply = async (i, label) => {
  await page.waitForFunction(() => window.__wdd.debug().visuals.repliesShown, null, { timeout: 15000 });
  await wait(700);
  await click(await screenOfEntity(i === 0 ? 'keepEntity' : 'lighterEntity'), label);
};
const word = async (label) => {
  await page.waitForFunction(() => window.__wdd.debug().visuals.wordsShown, null, { timeout: 15000 });
  await wait(500);
  const i = await page.evaluate((l) => {
    const v = window.__wdd.debug().visuals;
    return v.wordChips.findIndex((c) => c.mesh.visible && c.label === l);
  }, label);
  await click(await screenOfEntity('wordChips', i >= 0 ? i : 0), `word ${label}`);
};

await page.goto(url);
await page.evaluate(() => {
  localStorage.removeItem('wdd.style');
  localStorage.removeItem('wind-down-desk.memory.v1');
});
await page.reload();
await page.waitForFunction(() => window.__wdd != null && window.IWER_DEVICE != null, null, { timeout: 40000 });
await wait(3500);
await shot('accueil-choix');
await page.click('[data-style="quiet"]');
await page.waitForFunction(() => ['table', 'floating'].includes(window.__wdd.state().placement) && window.__wddPlayer != null, null, { timeout: 30000 });
await wait(4500);
if (await page.isVisible('[data-act="help-ok"]')) await page.click('[data-act="help-ok"]');
await shot('arrivee-question');
console.log('  ', JSON.stringify(await st()));

// Unload: "Yes" if the lamp proposes it, else its row in the Rituals menu (open beside the lamp), then words.
if ((await st()).proposal === 'unload') await reply(0, 'Yes (unload)');
else {
  const open = await page.evaluate(() => window.__wdd.debug().visuals.ritualMenuOpen);
  if (!open) {
    await click(await screenOfEntity('ritualsEntity'), 'Rituals');
    await wait(1300);
  }
  await click(await screenOfEntity('ritualChips', 'unload'), 'Unload');
}
await wait(1500);
await shot('unload-mots');
for (const w of ['Work', 'Money', 'Family']) {
  await word(w);
  await wait(900);
}
await wait(2000);
await shot('unload-pierres');
console.log('  ', JSON.stringify(await st()));
const ids = await page.evaluate(() => window.__wdd.state().tokens.filter((t) => t.bin == null && !t.released).map((t) => t.id));
const bins = ['tomorrow', 'later', 'let-go'];
for (let i = 0; i < ids.length; i++) {
  await click(await page.evaluate((id) => window.__wddPlayer.target('stone', id), ids[i]), `stone ${ids[i]}`);
  await page.waitForFunction(() => window.__wddPlayer.holding != null, null, { timeout: 6000 });
  await wait(300);
  await click(await page.evaluate((b) => window.__wddPlayer.target('bin', b), bins[i % 3]), `bin ${bins[i % 3]}`);
  await page.waitForFunction(() => window.__wddPlayer.holding == null && !window.__wddPlayer.busy, null, { timeout: 8000 });
  await wait(1200);
}
await page.waitForFunction(() => window.__wdd.state().plan != null, null, { timeout: 25000 });
await wait(2500);
await shot('plan');
await click(await screenOfEntity('keepEntity'), 'Keep this plan');
await wait(4000);
await shot('plan-garde');
console.log('  ', JSON.stringify(await st()));

// Release: "Yes", then one of tonight's stones, then held over the water and let go (mouse → emulated hand).
const proposal1 = (await st()).proposal;
if (proposal1 === 'release') await reply(0, 'Yes (release)');
else {
  await click(await screenOfEntity('ritualsEntity'), 'Rituals');
  await wait(1300);
  await click(await screenOfEntity('ritualChips', 'release'), 'Release');
}
await wait(2000);
await shot('release-choix');
await page.waitForFunction(() => window.__wdd.debug().visuals.wordsShown, null, { timeout: 15000 });
await click(await screenOfEntity('wordChips', 0), 'first stone of tonight');
await page.waitForFunction(() => window.__wdd.weightWorld() != null, null, { timeout: 15000 });
await wait(4000);
await click(await page.evaluate(() => window.__wddPlayer.target('weight')), 'weight');
await page.waitForFunction(() => window.__wddPlayer.holding === 'weight', null, { timeout: 6000 });
await wait(400);
await click(await page.evaluate(() => window.__wddPlayer.target('water')), 'water');
await wait(6000);
await shot('release-coule');
console.log('  ', JSON.stringify(await st()));

// Breathe: "Yes", the light alone, then "Enough".
await page.waitForFunction(() => window.__wdd.evening().proposal != null, null, { timeout: 20000 });
const proposal2 = (await st()).proposal;
if (proposal2 === 'breathe') await reply(0, 'Yes (breathe)');
else {
  await click(await screenOfEntity('ritualsEntity'), 'Rituals');
  await wait(1300);
  await click(await screenOfEntity('ritualChips', 'breathe'), 'Breathe');
}
await page.waitForFunction(() => window.__wdd.evening().mode === 'breathe', null, { timeout: 10000 });
await wait(7000);
await shot('breathe');
await reply(1, 'Enough');
await wait(4000);

// A place, by touch, and back.
await click(await screenOfEntity('ornamentEntity'), 'Places');
await wait(1400);
await click(await screenOfEntity('placeChips', 'moon-lake'), 'lake');
await wait(5000);
await shot('lieu-lac');
await click(await screenOfEntity('ornamentEntity'), 'Places');
await wait(1400);
await click(await screenOfEntity('placeChips', 'room'), 'room');
await wait(4000);

// Good night: "Yes" if proposed, else the Rituals menu.
const proposal3 = (await st()).proposal;
if (proposal3 === 'sleep') await reply(0, 'Yes (sleep)');
else {
  const open = await page.evaluate(() => window.__wdd.debug().visuals.ritualMenuOpen);
  if (!open) {
    await click(await screenOfEntity('ritualsEntity'), 'Rituals');
    await wait(1300);
  }
  await click(await screenOfEntity('ritualChips', 'sleep'), 'Good night');
}
await wait(6000);
await shot('bonne-nuit');
const final = await st();
console.log('  ', JSON.stringify(final));
const ok = final.mode === 'night' && final.mic.getUserMedia === 0 && final.mic.speech === 0;
writeFileSync(`${out}/report.json`, JSON.stringify({ ok, final, errors }, null, 2));
console.log(`  [${name}] ${ok ? 'OK' : 'ÉCHEC'} — getUserMedia ${final.mic.getUserMedia}, reconnaissance vocale ${final.mic.speech}, erreurs : ${errors.length ? errors.join(' | ') : 'aucune'}`);
await browser.close();
process.exit(ok ? 0 : 1);
