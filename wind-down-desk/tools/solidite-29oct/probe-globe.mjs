// 29 Oct: the lamp's globe in a place — the "Table stays | Full" switch (still), and real pokes on the orb / switch.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeHands } from './hands.mjs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp, workspaceRoot }) {
  const f = frame ?? page;
  const js = (fn, a) => f.evaluate(fn, a);
  const out = join(workspaceRoot, 'artifacts', 'solidite-29oct');
  mkdirSync(out, { recursive: true });
  let last = null;
  cdp.on('Page.screencastFrame', (e) => { last = e.data; cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}); });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
  const still = async (n) => { await wait(300); if (last) writeFileSync(join(out, `${n}.jpg`), Buffer.from(last, 'base64')); };
  const H = makeHands(f);
  await js(() => { window.IWER_DEVICE.primaryInputMode = 'hand'; });
  await H.rest();
  if (await js(() => window.__wdd.tension().side != null)) { await H.poke('keep'); await wait(800); }
  if (await js(() => window.__wdd.debug().visuals.ritualMenuOpen)) { await H.poke('rituals'); await wait(900); }
  const r = {};
  r.places = await H.poke('places');
  await wait(1200);
  r.next = await H.poke('globe-next');
  await wait(900);
  r.orb = await H.poke('orb');
  await wait(4500);
  r.place = await js(() => window.__wdd.debug().visuals.backdrop.place);
  r.placesAgain = await H.poke('places');
  await wait(1500);
  r.toggle = await js(() => window.__wdd.buttonWorld('immersion'));
  await still('globe-ouvert-interrupteur');
  r.immersion = await H.poke('immersion');
  await wait(900);
  r.level = await js(() => window.__wdd.debug().visuals.backdrop.immersionLevel);
  await still('globe-ouvert-full');
  r.close = await H.poke('globe-close');
  await wait(1500);
  await still('lieu-full-globe-ferme');
  r.misses = H.stats.pokeMisses;
  await cdp.send('Page.stopScreencast');
  return r;
}
