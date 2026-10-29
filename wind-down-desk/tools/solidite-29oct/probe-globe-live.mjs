// 29 Oct — the live globe: Places opened by touch, › twice quickly (only the last place may load), the world follows
// the globe after GLOBE_SETTLE_MS with the globe still open ("On the way…", then "You are here"), then a touch on the
// globe closes it and stays there.
//   sh tools/solidite-29oct/run.sh tools/solidite-29oct/probe-globe-live.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeHands } from './hands.mjs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp, workspaceRoot }) {
  const f = frame ?? page;
  const js = (fn, a) => f.evaluate(fn, a);
  const out = join(workspaceRoot, 'artifacts', 'solidite-29oct', 'globe-live');
  mkdirSync(out, { recursive: true });
  const shot = async (n) => {
    const s = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
    writeFileSync(join(out, `${n}.jpg`), Buffer.from(s.data, 'base64'));
  };
  const state = () => js(() => { const v = window.__wdd.debug().visuals; return { place: v.backdrop.place, globe: v.globePlace, open: v.placesOpen }; });
  const H = makeHands(f);
  const r = { checks: {} };
  await js(() => { window.IWER_DEVICE.primaryInputMode = 'hand'; });
  await H.rest();
  if ((await js(() => window.__wdd.tension().side)) != null) await js(() => window.__wdd.tension('skip'));
  if (await js(() => window.__wdd.debug().visuals.ritualMenuOpen)) { await H.poke('rituals'); await wait(900); }
  r.placesPoke = await H.poke('places');
  await wait(1500);
  r.start = await state();
  // The head rises a little (−12°, same heading) so the globe's name row is in the stills.
  await js(() => {
    const d = window.IWER_DEVICE;
    const q = d.quaternion;
    const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const yaw = Math.atan2(-fx, -fz), pitch = (-12 * Math.PI) / 180;
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cx = Math.cos(pitch / 2), sx = Math.sin(pitch / 2);
    d.quaternion.set(cy * sx, sy * cx, -sy * sx, cy * cx);
  });
  await wait(600);
  // › twice within ~0.3 s (the touch twin of two quick pokes): the settle timer must load only the last one.
  // (Two › from the last place lands on "Your room": the direction is picked so the pair ends on a real place.)
  const ahead = await js(() => { const v = window.__wdd.debug().visuals; const a = v.stepGlobe(2); v.stepGlobe(-2); return a; });
  const dir = ahead === 'room' || ahead === r.start.place ? 'globe-prev' : 'globe-next';
  r.direction = dir;
  await js((d) => window.__wdd.press(d), dir);
  await wait(300);
  await js((d) => window.__wdd.press(d), dir);
  r.target = (await state()).globe;
  const seen = new Set();
  const t0 = Date.now();
  let onTheWay = false;
  while (Date.now() - t0 < 3000) {
    const s = await state();
    seen.add(s.place);
    if (!onTheWay && Date.now() - t0 > 250) {
      onTheWay = true;
      r.onTheWay = s;
      await shot('1-en-chemin');
    }
    await wait(100);
  }
  r.after3s = await state();
  r.placesSeen = [...seen];
  r.checks.followsGlobe = r.target !== 'room' && r.after3s.place === r.target && r.after3s.globe === r.target && r.after3s.open === true;
  r.checks.onlyLastLoaded = r.placesSeen.filter((p) => p !== r.start.place).every((p) => p === r.after3s.globe);
  await shot('2-arrive');
  // A touch on the globe: it closes, and you stay.
  r.orbPoke = await H.poke('orb');
  await wait(1500);
  r.afterTouch = await state();
  r.checks.touchClosesAndStays = r.afterTouch.open === false && r.afterTouch.place === r.after3s.place;
  await shot('3-globe-ferme');
  r.misses = H.stats.pokeMisses;
  return r;
}
