// 29 Oct (solidity) — one unknown room (SCENE, prepared by rooms.sh): where the desk went and why, the stills, and a
// short evening by hand to prove it stays usable (a word touched, its stone pinched into a bowl, Keep's lights on a
// wall or at the desk, Good night's sky on the ceiling or in a dome, the reach of every target from the eyes).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeHands } from './hands.mjs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp, workspaceRoot }) {
  const f = frame ?? page;
  const scene = process.env.SCENE ?? 'blind';
  const js = (fn, a) => f.evaluate(fn, a);
  const out = join(workspaceRoot, '..', 'video', 'solidite-29oct');
  mkdirSync(out, { recursive: true });
  for (const t of [page, frame].filter(Boolean)) await t.evaluate(() => document.querySelectorAll('vite-error-overlay').forEach((e) => e.remove())).catch(() => {});
  await page.evaluate(() => { const s = document.querySelector('.workspace-view-switcher'); if (s) s.style.display = 'none'; }).catch(() => {});
  let last = null;
  cdp.on('Page.screencastFrame', (e) => { last = e.data; cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}); });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
  const stills = [];
  const still = async (name) => { await wait(350); if (last) { const file = `${scene}-${name}.jpg`; writeFileSync(join(out, file), Buffer.from(last, 'base64')); stills.push(file); } };
  const until = async (fn, ms, arg) => { const end = Date.now() + ms; while (Date.now() < end) { if (await js(fn, arg)) return true; await wait(150); } return false; };
  const look = (p, y) => js(([pp, yy]) => { const rad = Math.PI / 180; const sy = Math.sin((yy * rad) / 2), cy = Math.cos((yy * rad) / 2), sx = Math.sin((pp * rad) / 2), cx = Math.cos((pp * rad) / 2); window.IWER_DEVICE.quaternion.set(cy * sx, sy * cx, -sy * sx, cy * cx); }, [p, y]);
  const H = makeHands(f);
  const r = { scene };
  const menuPick = async (id) => {
    if (!(await js(() => window.__wdd.debug().visuals.ritualMenuOpen))) {
      await H.poke('rituals');
      await until(() => window.__wdd.debug().visuals.ritualMenuOpen, 2500);
    }
    await wait(900); // the rows slide in
    return H.poke(`ritual:${id}`);
  };
  await js((s) => { window.IWER_DEVICE.primaryInputMode = 'hand'; window.__wdd.film.history(14); if (s === 'blind' || s === 'denied') window.__wdd.blindRoom(true); if (s === 'denied') window.__wdd.micState('denied'); }, scene);
  r.session = await js(() => ({ enabledFeatures: window.__xrFeatures ?? null, denied: window.__deniedPatch === true }));
  await js((v) => window.__wdd.film?.fov(v), scene === 'high' || scene === 'tooHigh' ? 72 : 54);
  await js(() => window.__wdd.recenter(true));
  await until(() => ['table', 'floating'].includes(window.__wdd.state().placement), 9000);
  await wait(2500);
  await H.rest();
  const st = await js(() => ({ placement: window.__wdd.state().placement, source: window.__wdd.state().source, surfaces: window.__wdd.surfaces(), anchor: window.__wdd.anchor().status, anchorLog: window.__wdd.anchor().log.slice(-3).map((l) => l.what), mic: window.__wdd.state().mic, origin: window.__wdd.deskPoint(0, 0, 0) }));
  Object.assign(r, st);
  // Reach: distance of the targets from the eyes and from a shoulder (20 cm under the eyes, 15 cm to the right).
  r.reach = await js(() => {
    const d = window.__wdd;
    const h = window.IWER_DEVICE.position;
    const sh = { x: h.x, y: h.y - 0.2, z: h.z - 0.15 };
    const dist = (p, o) => (p == null ? null : +Math.hypot(p.x - o.x, p.y - o.y, p.z - o.z).toFixed(2));
    const t = { bowls: d.bins.map((b) => d.binWorld(b)), rituals: d.buttonWorld('rituals'), word0: d.buttonWorld('word:0'), keep: d.buttonWorld('keep') };
    return { bowlsFromEyes: t.bowls.map((p) => dist(p, h)), bowlsFromShoulder: t.bowls.map((p) => dist(p, sh)), ritualsFromShoulder: dist(t.rituals, sh), replyFromShoulder: dist(t.keep, sh), deskBelowEyes: +(h.y - d.deskPoint(0, 0, 0).y).toFixed(2) };
  });
  if (await js(() => window.__wdd.tension().side != null)) { await H.poke('keep'); await wait(900); }
  if (await js(() => window.__wdd.debug().visuals.ritualMenuOpen)) { await H.poke('rituals'); await wait(900); }
  await still('1-bureau');
  // A short evening by hand: Unload, a word, its stone into Tomorrow.
  await menuPick('unload');
  // A stone already waiting (last night's follow-up, last week's Later) is placed first: the words come back after.
  for (let k = 0; k < 4; k++) {
    await wait(1500);
    const waiting = await js(() => window.__wdd.state().tokens.find((t) => t.bin == null && !t.released)?.id ?? null);
    if (waiting == null) break;
    await H.grab(waiting, 'later');
  }
  await until(() => window.__wdd.debug().visuals.wordChips.some((c) => c.mesh.visible && !/Write/u.test(c.label ?? '')), 9000);
  await wait(1000);
  // A desk at chin height (tooHigh): the words stand at eye level; you look ahead, not down, to read them.
  if (scene === 'tooHigh') { await look(-14, 90); await wait(900); }
  await still('2-mots');
  if (scene === 'tooHigh') { await look(-30, 90); await wait(600); }
  const i = await js(() => window.__wdd.debug().visuals.wordChips.findIndex((c) => c.mesh.visible && c.label && !/Write|That/u.test(c.label)));
  await H.poke(`word:${i}`);
  await until(() => window.__wdd.state().tokens.some((t) => t.bin == null && !t.released), 6000);
  await wait(900);
  const id = await js(() => window.__wdd.state().tokens.find((t) => t.bin == null && !t.released)?.id ?? null);
  r.pinched = id != null && (await H.grab(id, 'tomorrow'));
  await wait(1200);
  await still('3-pierre-posee');
  // Keep: three good things → the lights find a wall (or stay by the desk).
  await menuPick('keep');
  await until(() => window.__wdd.evening().mode === 'keep', 4000);
  await wait(1200);
  for (let k = 0; k < 3; k++) {
    const w = await js(() => window.__wdd.debug().visuals.wordChips.findIndex((c) => c.mesh.visible && c.label && !/Write/u.test(c.label)));
    if (w < 0) break;
    await H.poke(`word:${w}`);
    await wait(1200);
  }
  r.keepWall = await js(() => window.__wdd.walls().picked ?? null);
  r.walls = await js(() => window.__wdd.walls().walls.length);
  await wait(3000);
  await still('4-lumieres-keep');
  await until(() => window.__wdd.evening().mode === 'choose', 12000);
  // Good night → the sky: on the detected ceiling, or a dome.
  await menuPick('sleep');
  if (await until(() => window.__wdd.tension().side === 'out', 4000)) { await wait(700); await H.poke('keep'); }
  await until(() => window.__wdd.night().step === 2, 22000);
  r.ceiling = await js(() => window.__wdd.night().ceiling);
  await look(45, 90);
  await wait(1600);
  await still('5-ciel-nuit');
  await look(-30, 90);
  await wait(800);
  r.hands = H.stats;
  r.stills = stills;
  await H.poke('lighter');
  await until(() => !window.__wdd.perf().xr, 15000);
  await js(() => window.__wdd.blindRoom(false));
  await cdp.send('Page.stopScreencast');
  return r;
}
