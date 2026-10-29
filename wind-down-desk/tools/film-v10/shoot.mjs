// v10 competition film (29 Oct 2026, from v9: Your sky as a memory world, the night without a sleep timer): one script, short takes (each < 100 s: the `browser run` lease is 110 s), played
// by the real paths in the emulator with the v9 hand choreography (tools/film-v9/rig.mjs): fingertip pokes, one-hand
// pinches, the bead slid by a fingertip, Squeeze fists. Sentences go through the app's speech handler
// (window.__wdd.say = the path of a transcribed microphone clip), only in the takes that show the voice.
//   sh tools/stage.sh 54 30 && SHOT=<shot> npx @iwsdk/cli browser run tools/film-v10/shoot.mjs --timeout 108000
// Runtime: iwsdk dev up --headless --ai-mode agent --allow-browser-automation --screenshot-width 1920 --screenshot-height 1080
// Takes: seed, arrive, unload, open, release, breathe, squeeze, keep, sky, places, night, busstop, raw.
// Output: artifacts/frames-v10-<shot>/ (frames + index.json + audio.json + stills.json + marks.json + overlap.json).
// Film-only extras (never in the build): seeded history (film.history), arrival replayed from darkness, head moves.
import { appendFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRig } from './rig.mjs';
import { installOverlap } from './overlap.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function run({ frame, page, cdp, workspaceRoot }) {
  const f = frame ?? page;
  const shot = process.env.SHOT ?? 'arrive';
  const quality = Number(process.env.Q ?? 88);
  for (const t of [page, frame].filter(Boolean)) await t.evaluate(() => document.querySelectorAll('vite-error-overlay').forEach((e) => e.remove())).catch(() => {});
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '.workspace-view-switcher{display:none!important}';
    document.head.appendChild(style);
  });
  const js = (fn, a) => f.evaluate(fn, a);
  const dir = join(workspaceRoot, 'artifacts', `frames-v10-${shot}`);
  if (existsSync(dir)) renameSync(dir, `${dir}-old-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const frames = [];
  const t0 = Date.now();
  let recording = false;
  cdp.on('Page.screencastFrame', async (event) => {
    if (recording) {
      const name = `f${String(frames.length).padStart(5, '0')}.jpg`;
      writeFileSync(join(dir, name), Buffer.from(event.data, 'base64'));
      frames.push({ name, t: (Date.now() - t0) / 1000 });
    }
    try {
      await cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId });
    } catch {}
  });
  cdp.on('Debugger.paused', async () => { try { await cdp.send('Debugger.resume'); } catch {} });
  try {
    await cdp.send('Debugger.enable');
    await cdp.send('Debugger.setPauseOnExceptions', { state: 'none' });
    await cdp.send('Debugger.setSkipAllPauses', { skip: true });
  } catch {}
  const stills = [];
  const marks = [];
  const overlap = [];
  const log = (m) => appendFileSync(join(dir, 'log.txt'), `${((Date.now() - t0) / 1000).toFixed(2)} ${m} frames=${frames.length}\n`);
  const mark = (label) => { marks.push({ label, t: (Date.now() - t0) / 1000 }); log(`mark ${label}`); };
  const still = async (name) => { await wait(80); stills.push({ name, frame: frames.at(-1)?.name, t: (Date.now() - t0) / 1000 }); };
  const until = async (fn, ms, arg) => { const end = Date.now() + ms; while (Date.now() < end) { if (await js(fn, arg)) return true; await wait(120); } return false; };
  const say = async (text) => { log(`say ${text.slice(0, 50)}`); await js((t) => { void window.__wdd.say(t); }, text); };
  const fov = (deg) => js((d) => window.__wdd.film.fov(d), deg);
  const tokens = () => js(() => window.__wdd.state().tokens);
  const loose = () => js(() => window.__wdd.state().tokens.filter((t) => t.bin == null && !t.released).map((t) => t.id));
  const menuOpen = () => js(() => window.__wdd.debug().visuals.ritualMenuOpen);
  const wordIndex = (re, exclude = []) => js(([src, ex]) => window.__wdd.debug().visuals.wordChips.findIndex((c) => c.mesh.visible && c.label != null && new RegExp(src, 'u').test(c.label) && !ex.includes(c.label)), [re.source, exclude]);
  const wordLabel = (i) => js((x) => window.__wdd.debug().visuals.wordChips[x]?.label ?? null, i);
  const orbPos = () => js(() => { const o = window.__wdd.debug().visuals.orb; o.updateWorldMatrix(true, false); const p = o.getWorldPosition(o.position.clone()); return { x: p.x, y: p.y, z: p.z }; });

  await installOverlap(f);
  const R = await makeRig(f);
  let pageT0 = 0;
  let startAt = 0;
  const startRec = async () => {
    startAt = (Date.now() - t0) / 1000;
    pageT0 = await js(() => performance.now());
    recording = true;
    mark('start');
  };
  // Overlap of the lamp's globe and the caption's pill, ≈ 4×/s while recording.
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      await wait(250);
      if (!recording) continue;
      try {
        const o = await js(() => window.__v9overlap());
        overlap.push({ t: (Date.now() - t0) / 1000, ...o });
      } catch {}
    }
  })();
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality, maxWidth: Number(process.env.MAXW ?? 1920), maxHeight: (Number(process.env.MAXW ?? 1920) * 9) / 16, everyNthFrame: 1 });

  const deskCentre = await R.deskPoint(0, -0.02, -0.06);
  /** Before a take that does not show the arrival: the bead question and the ritual menu out of the way (unfilmed). */
  const settle = async () => {
    await until(() => !window.__wdd.debug().visuals.skyShown, 12000);
    if (await js(() => window.__wdd.tension().side != null)) { await js(() => window.__wdd.press('keep')); await wait(900); }
    if (await menuOpen()) { await js(() => window.__wdd.press('rituals')); await wait(700); }
  };
  const pickRitual = async (id) => {
    if (!(await menuOpen())) {
      await R.poke('rituals', { back: false });
      await until(() => window.__wdd.debug().visuals.ritualMenuOpen, 2500);
      await wait(650);
    }
    return R.poke(`ritual:${id}`);
  };

  // ================================================================== takes
  if (shot === 'seed') {
    // Unfilmed: 21 evenings of history (film only), then one arrival so the 21st evening's keepsake is already
    // celebrated: the takes after it show an ordinary evening you came back for.
    await js(() => window.__wdd.film.history(21));
    await js(() => window.__wdd.arrive());
    // The bead first (skipped), then the sky and the 21st evening's plant are shown and celebrated, off camera.
    if (await until(() => window.__wdd.tension().side === 'in', 9000)) { await wait(600); await js(() => window.__wdd.press('keep')); }
    await wait(15000);
    await settle();
  } else if (shot === 'arrive') {
    // The lamp wakes in the dark; your sky in the globe; "How heavy is tonight?": a fingertip slides the bead; the
    // lamp proposes the evening; "Yes" by touch.
    await fov(54);
    await R.away();
    await R.aim(deskCentre, true);
    await startRec();
    await js(() => window.__wdd.arrive());
    await wait(1500);
    await R.handsIn();
    await until(() => window.__wdd.tension().side === 'in', 12000);
    await wait(1800);
    await still('bead-asked');
    mark('slide');
    await R.slide(0.5, 0.78, { ms: 1700 });
    await still('bead-slid');
    await until(() => window.__wdd.evening().proposal != null || window.__wdd.evening().mode === 'unload', 9000);
    await wait(2600);
    await still('proposes');
    const prop = await js(() => window.__wdd.evening().proposal?.ritual ?? null);
    log(`proposal ${prop}`);
    mark('yes');
    if (prop === 'unload') await R.poke('keep');
    else await pickRitual('unload');
    await until(() => window.__wdd.evening().mode === 'unload', 5000);
    await wait(2500);
    await still('unload-open');
  } else if (shot === 'unload') {
    // Continues 'arrive' (same page): a full head becomes stones; one hand sorts them; "That's all"; the plan kept.
    await fov(54);
    await R.aim(deskCentre, true);
    if ((await js(() => window.__wdd.evening().mode)) !== 'unload') { await settle(); await js(() => window.__wdd.ritual('unload')); await wait(2000); }
    await startRec();
    mark('dump');
    await say("I still haven't replied to the landlord about the heating. I need to book the dentist. The slides for Monday aren't done. And I keep thinking about that awkward thing I said at lunch.");
    await until((n) => window.__wdd.state().tokens.filter((t) => t.bin == null && !t.released).length >= 3, 9000);
    await wait(2600);
    await still('stones');
    const ids = await loose();
    const plan = [[ids[0], 'tomorrow'], [ids[1], 'later'], [ids.at(-1), 'let-go']];
    for (const [id, bin] of plan) {
      if (id == null) continue;
      const s = await js((i) => window.__wdd.stoneWorld(i), id);
      const e = await js((b) => window.__wdd.binWorld(b), bin);
      mark(`pinch-${bin}`);
      await R.grab(s, { ...e, y: e.y + 0.035 }, { back: false });
      await wait(bin === 'let-go' ? 300 : 120);
      if (bin === 'let-go') await still('let-go-dust');
    }
    await R.restBoth(700);
    await wait(1600);
    const left = await loose();
    log(`left ${left.length}`);
    // Two more by voice (the voice twin), then "That's all" by touch.
    if (left.length > 0) { await say('Slides, later.'); await wait(1600); }
    if ((await loose()).length > 0) { await say('The rest, let go.'); await wait(2200); }
    if (await until(() => window.__wdd.debug().visuals.wordChips.some((c) => c.mesh.visible && /^That/u.test(c.label ?? '')), 5000)) {
      mark('thats-all');
      await R.poke(`word:${await wordIndex(/^That/u)}`);
    }
    if (await until(() => window.__wdd.state().phase === 'plan' && window.__wdd.debug().visuals.card.visible, 8000)) {
      await wait(2600);
      await still('plan');
      mark('keep-plan');
      await R.poke('keep');
      await wait(2500);
    }
    await still('after-plan');
  } else if (shot === 'open' || shot === 'release') {
    // Release: something heavy heard → the lamp proposes Release → "Yes" by touch → the basalt stone, engraved with
    // your words; one hand pinches it, holds it over the black water, opens: it sinks, the words light up and dissolve.
    const close = shot === 'open';
    await settle();
    const water = await js(() => window.__wdd.waterWorld(0));
    if (close) {
      // Close, but the hand that holds the stone stays in frame (v9: the first close-up showed only two fingertips).
      // Lower and closer: the whole hand above the water in frame, the caption high above it, out of frame.
      await fov(40);
      await R.lean(water, 0.1, true);
      await R.setHead({ posTarget: { ...(await js(() => window.__rig9.head.posTarget)), y: (await js(() => window.__rig9.head.posTarget.y)) - 0.12 }, pos: { ...(await js(() => window.__rig9.head.pos)), y: (await js(() => window.__rig9.head.pos.y)) - 0.12 } });
      await R.aim({ x: water.x + 0.02, y: water.y + 0.06, z: water.z + 0.02 }, true, null);
      await R.setHead({ sway: 0.6 });
    } else {
      await fov(54);
      await R.aim(deskCentre, true);
    }
    if (!close) await startRec();
    mark('heard');
    await say('The meeting with Paul tomorrow. I keep replaying it.');
    await until(() => window.__wdd.evening().proposal?.ritual === 'release', 6000);
    await wait(close ? 1800 : 2600);
    await still('proposes-release');
    mark('yes');
    if (close) await js(() => window.__wdd.press('keep'));
    else await R.poke('keep');
    await until(() => window.__wdd.weightWorld() != null, 9000);
    if (close) { await wait(1200); await startRec(); }
    await wait(close ? 1800 : 2600);
    await still('release-stone');
    const s = await js(() => window.__wdd.weightWorld());
    const w = await js(() => window.__wdd.waterWorld(0.085));
    mark('pinch');
    await R.grab(s, { x: w.x + 0.025, y: w.y, z: w.z + 0.03 }, { hold: close ? 1700 : 1300, carryMs: 1350, back: false, onHold: () => still('release-hold') });
    mark('drop');
    await wait(500);
    await still('release-sinks');
    await R.restBoth(900);
    await wait(900);
    await still('release-words-of-light');
    await wait(close ? 2600 : 3800);
    await still('release-gone');
    if (close) { await R.lean(water, 0, false); }
  } else if (shot === 'breathe') {
    // "Wired, can't relax" → the lamp proposes Breathe → "Yes" by touch → the lamp becomes a moon that grows as you
    // breathe in. Hands rest (the left on the table, the right relaxed), never mirrored.
    await settle();
    await fov(54);
    await R.aim(deskCentre, true);
    await startRec();
    mark('heard');
    await say("I'm so wired tonight. I can't relax.");
    await until(() => window.__wdd.evening().proposal?.ritual === 'breathe', 6000);
    await wait(2600);
    await still('proposes-breathe');
    mark('yes');
    await R.poke('keep');
    await wait(3500);
    await still('moon-forms');
    await wait(4200);
    await still('breathe-in');
    await wait(4400);
    await still('breathe-out');
    await wait(5000);
    await still('breathe-in-2');
    mark('enough');
    if (await js(() => window.__wdd.debug().visuals.replyLabels?.length === 2)) await R.poke('lighter');
    else await say("That's enough.");
    await wait(3500);
    await still('well-done');
  } else if (shot === 'squeeze') {
    // v9b (coordinator, 29 Oct): hands raised, thumbs up, a short close shot centred on the light in the fists.
    await settle();
    await fov(54);
    await R.aim(deskCentre, true);
    await pickRitual('squeeze');
    await until(() => window.__wdd.evening().mode === 'squeeze', 4000);
    await wait(1200);
    await R.fistsNear();
    const mid = await R.deskPoint(0.01, 0.13, 0.27);
    await fov(Number(process.env.SQ_FOV ?? 40));
    await R.aim(mid, true);
    await startRec();
    await wait(1200);
    await wait(2600);
    await still('squeeze-open-hands');
    mark('fists');
    await R.fists(true);
    await wait(3000);
    await still('squeeze-fists');
    mark('open');
    await R.fists(false);
    await wait(500);
    await still('squeeze-escapes');
    await wait(1600);
    await still('squeeze-dust');
    await R.restBoth(800);
    await R.leftSettle(900);
    await wait(1200);
  } else if (shot === 'keep') {
    // Keep: three good things, touched one by one with one fingertip; each becomes a warm light (born in the lamp, a
    // short pause there: no cupped hands in the emulator) that flies to the real wall in front; then look up at them.
    await settle();
    await fov(54);
    await R.aim(deskCentre, true);
    await startRec();
    mark('menu');
    await pickRitual('keep');
    await until(() => window.__wdd.evening().mode === 'keep', 4000);
    await until(() => window.__wdd.debug().visuals.wordChips.some((c) => c.mesh.visible), 5000);
    // The words rise above the tray: the eyes go up to them (seated, the whole grid in frame).
    await R.look(-15, 90, 0.04);
    await wait(1600);
    await still('keep-words');
    const onWall = await js(() => window.__wdd.walls().picked != null);
    log(`wall ${onWall}`);
    const used = [];
    for (let k = 0; k < 3; k++) {
      const pref = [/^A good meal/u, /^Someone kind/u, /^Time outside/u, /^A laugh/u][k];
      let i = await wordIndex(pref, used);
      if (i < 0) i = await wordIndex(/^(?!Write|That).+/u, used);
      if (i < 0) break;
      used.push(await wordLabel(i));
      mark(`keep-${k + 1}`);
      await R.poke(`word:${i}`, { back: k === 2 });
      if (k === 0) {
        await wait(400);
        await still('keep-light-born');
        await R.look(-16, null, 0.03);
        await wait(1900);
        await still('keep-light-flies');
        await R.look(-15, 90, 0.035);
        await wait(1200);
      } else await wait(1300);
    }
    await wait(1800);
    mark('look-up');
    await R.look(-6, 90, 0.022);
    await wait(4200);
    await still('keep-three-lights');
    await R.look(-27, 90, 0.03);
    await wait(2200);
  } else if (shot === 'sky') {
    // Your sky, the memory world (v10): touch it in the menu; the room dims, the lamp says one true sentence; every
    // good thing kept floats around you, alive; look up at the crown; look at one light: its words appear; another;
    // Close by touch: the lights go back to the wall.
    await settle();
    await fov(54);
    await R.aim(deskCentre, true);
    await startRec();
    mark('menu');
    await pickRitual('sky');
    await until(() => window.__wdd.memoryWorld().open, 4000);
    // v10 (owner's extract, first cut): the head rises WITH the lights as they leave the wall, so the crown is seen
    // forming around you while the lamp speaks — not 6 s on the desk.
    const mw = await js(() => window.__wdd.memoryWorld());
    log(`summary ${mw.summary} kept=${mw.kept.length}`);
    await wait(700);
    await R.setHead({ ease: 0.016 });
    mark('crown');
    const mid = mw.kept.length > 0 ? mw.kept.reduce((a, k) => ({ x: a.x + k.x / mw.kept.length, y: a.y + k.y / mw.kept.length, z: a.z + k.z / mw.kept.length }), { x: 0, y: 0, z: 0 }) : null;
    // A little above the crown's centre: the lamp's caption (anchored to the desk) leaves the frame's bottom, where
    // the film's subtitles sit.
    if (mid != null) await R.aim({ x: mid.x, y: mid.y + 0.12, z: mid.z });
    await wait(5200);
    await still('sky-crown');
    const pick = (i) => { const k = mw.kept[Math.max(0, Math.min(mw.kept.length - 1, i))]; return { ...k, y: k.y + 0.07 }; };
    if (mw.kept.length > 0) {
      mark('look-light');
      await R.setHead({ ease: 0.03 });
      await R.aim(pick(mw.kept.length - 1));
      await wait(4200);
      await still('sky-word');
      mark('look-light-2');
      await R.aim(pick(Math.floor(mw.kept.length / 2)));
      await wait(3800);
      await still('sky-word-2');
    }
    await R.setHead({ ease: 0.03 });
    await R.aim(deskCentre);
    await wait(1800);
    mark('close');
    await R.poke('lighter');
    await until(() => !window.__wdd.memoryWorld().open, 3000);
    await wait(2600);
    await still('sky-closed');
  } else if (shot === 'places') {
    // Places in the lamp: touch Places, the globe floats up with a place inside; touch › for the next; touch the
    // globe: the place opens around you (the tray and the lamp stay); look around.
    await settle();
    await fov(54);
    await R.aim(deskCentre, true);
    await startRec();
    mark('places');
    await R.poke('places');
    await until(() => window.__wdd.globe().open, 3000);
    await wait(900);
    const g = await orbPos();
    await R.setHead({ ease: 0.03 });
    await R.aim({ x: g.x, y: g.y - 0.03, z: g.z });
    await wait(2200);
    await still('globe-place');
    // The globe opens on the campfire (index 1 after a reload); one touch on › shows the moonlit lake.
    mark('next');
    await R.poke('globe-next');
    await wait(1500);
    log(`globe place ${await js(() => window.__wdd.globe().place)}`);
    await still('globe-next');
    mark('choose');
    await R.poke('orb');
    await wait(1200);
    await R.setHead({ ease: 0.022 });
    await R.look(-8, 96);
    await wait(3800);
    await still('place-arrived');
    await R.look(-3, 126);
    await wait(3600);
    await still('place-look');
    await R.look(-16, 90);
    await wait(2600);
    await still('place-desk');
  } else if (shot === 'night') {
    // Good night by touch; the bead once more, slid lighter by a fingertip; the evening's summary; the room darkens and
    // your stars rise to the real ceiling; look up; then "Sleep well." and everything fades out (v10).
    await settle();
    await fov(54);
    await R.aim(deskCentre, true);
    await startRec();
    mark('good-night');
    await pickRitual('sleep');
    if (await until(() => window.__wdd.tension().side === 'out' || window.__wdd.evening().mode === 'night', 3000) && (await js(() => window.__wdd.tension().side === 'out'))) {
      await wait(1500);
      await still('bead-night');
      const u = await js(() => window.__wdd.tension().out ?? window.__wdd.tension().in ?? 0.6);
      await R.slide(Math.max(0.35, Number(u) || 0.6), 0.22, { ms: 1500 });
    }
    await until(() => window.__wdd.evening().mode === 'night', 8000);
    await still('night-summary');
    const at = (sec) => until((x) => (window.__wdd.night().since ?? 0) >= x, 14000, sec);
    // v10: up as the stars leave the lamp (step 1 at 2.4 s), so they are seen rising and landing.
    await at(2.0);
    mark('stars-rise');
    await R.setHead({ ease: 0.018 });
    await R.look(24, 90);
    await at(4.5);
    await still('stars-rising');
    await R.look(52, 90);
    await at(8.0);
    await still('ceiling');
    // v10: no sleep timer. "Sleep well. You can take the headset off now." with one button, Lights out; then the
    // room, the desk, the stars, the sound and the lamp go down together (≈ 20 s) and the session ends by itself.
    await R.setHead({ ease: 0.03 });
    await R.look(-27, 90);
    await until(() => (window.__wdd.debug().visuals.replyLabels ?? []).includes('Lights out'), 15000);
    await wait(1800);
    await still('sleep-well');
    mark('fade');
    await wait(7000);
    await still('fading');
    await wait(6000);
    await still('dark');
  } else if (shot === 'busstop') {
    // The bus stop test (Meta Start judging), hands only: the microphone refused; arrival → the bead skipped by touch
    // → Unload → a word touched, its stone pinched into Tomorrow → another into Let go → Good night → the bead skipped
    // → the night → "Good night" touched: the session ends by itself. Timed from the first frame of the arrival.
    await js(() => window.__wdd.micState('denied'));
    await fov(54);
    await R.away();
    // A little higher than the seated framing: the touch words (above the bowls) stay whole in frame.
    await R.aim({ ...deskCentre, y: deskCentre.y + 0.07 }, true);
    await startRec();
    const tA = Date.now();
    await js(() => window.__wdd.arrive());
    await wait(900);
    await R.handsIn();
    await R.measurePinch();
    // The bead without a microphone: "Light / Some / Heavy" to touch (the Skip button is not offered then).
    if (await until(() => window.__wdd.tension().side === 'in', 9000)) {
      await wait(500);
      const i = await wordIndex(/^Some$/u);
      const shown = await js(() => window.__wdd.buttonWorld('keep')?.shown === true);
      if (i >= 0) await R.poke(`word:${i}`);
      else if (shown) await R.poke('keep');
      else log('busstop: no bead answer to touch');
    }
    await until(() => window.__wdd.evening().proposal != null || window.__wdd.evening().mode === 'unload', 8000);
    await wait(500);
    const prop = await js(() => window.__wdd.evening().proposal?.ritual ?? null);
    if (prop === 'unload') await R.poke('keep');
    else await pickRitual('unload');
    const bins = ['tomorrow', 'let-go'];
    const used = [];
    for (let k = 0; k < 2; k++) {
      // A stone already waiting (the words fold away while one waits) is pinched first; otherwise a word is touched.
      let id = (await loose())[0] ?? null;
      if (id == null) {
        await until((u) => window.__wdd.debug().visuals.wordChips.some((c) => c.mesh.visible && c.label != null && !/Write|That/u.test(c.label) && !u.includes(c.label)), 4000, used);
        await wait(200);
        const i = await wordIndex(/^(?!Write|That).+/u, used);
        if (i < 0) { log('busstop: no word to touch'); break; }
        used.push(await wordLabel(i));
        await R.poke(`word:${i}`, { back: false });
        await until(() => window.__wdd.state().tokens.some((t) => t.bin == null && !t.released), 4000);
        id = (await loose())[0];
        // The new stone glides from the word down to the tray (≈ 0.8 s).
        await wait(1100);
      }
      const s = await js((x) => window.__wdd.stoneWorld(x), id);
      const e = await js((b) => window.__wdd.binWorld(b), bins[k]);
      await R.grab(s, { ...e, y: e.y + 0.035 }, { back: k === 1, carryMs: 850 });
      log(`busstop stone ${id} -> ${JSON.stringify(await js((x) => window.__wdd.state().tokens.find((t) => t.id === x), id))} at ${JSON.stringify(s)}`);
    }
    await wait(300);
    const replies = await js(() => window.__wdd.debug().visuals.replyLabels ?? null);
    if (replies?.includes('Good night')) await R.poke('lighter');
    else await pickRitual('sleep');
    if (await until(() => window.__wdd.tension().side === 'out', 4000)) { await wait(400); await R.poke('keep'); }
    await until(() => window.__wdd.evening().mode === 'night', 6000);
    await until(() => window.__wdd.night().step === 2, 20000);
    await wait(500);
    await R.poke('lighter');
    const ended = await until(() => !window.__wdd.perf().xr, 20000);
    const seconds = (Date.now() - tA) / 1000;
    log(`busstop ${seconds.toFixed(1)} s ended=${ended}`);
    marks.push({ label: `busstop-${seconds.toFixed(1)}s-ended-${ended}`, t: (Date.now() - t0) / 1000 });
    await wait(1200);
  } else if (shot === 'raw') {
    // Tech proof: the film set hidden: the emulator's synthetic room (IWER living_room) and the table it detects.
    await settle();
    await fov(70);
    await js(() => window.__wdd.film.hide(true));
    await R.away();
    const c = await R.deskPoint(0, 0.02, 0.02);
    await R.lean(c, -0.35, true);
    await R.setHead({ posTarget: { ...(await js(() => window.__rig9.head.posTarget)), y: (await js(() => window.__rig9.head.posTarget.y)) + 0.25 }, pos: { ...(await js(() => window.__rig9.head.pos)), y: (await js(() => window.__rig9.head.pos.y)) + 0.25 } });
    await wait(300);
    await R.aim(c, true);
    await R.setHead({ yaw: (await js(() => window.__rig9.head.yaw)) + 14, ease: 0.012 });
    await wait(1500);
    await startRec();
    await R.aim(c);
    await wait(2500);
    await js(() => window.__wdd.arrive());
    await wait(6500);
    await still('raw-room');
    await wait(1500);
    await js(() => window.__wdd.film.hide(false));
  }

  await wait(300);
  recording = false;
  sampling = false;
  await sampler;
  await cdp.send('Page.stopScreencast');
  await wait(200);
  writeFileSync(join(dir, 'index.json'), JSON.stringify(frames));
  const audio = await js(() => window.__wdd.voice()).catch(() => ({ log: [], cues: [] }));
  const toVideo = (t) => Math.round(((t - pageT0) / 1000 + startAt) * 1000) / 1000;
  const events = [...(audio.log ?? []), ...(audio.cues ?? [])].filter((e) => e.t >= pageT0 - 50).map((e) => ({ at: toVideo(e.t), src: e.src, volume: e.volume }));
  writeFileSync(join(dir, 'audio.json'), JSON.stringify({ startAt, events }));
  writeFileSync(join(dir, 'stills.json'), JSON.stringify(stills));
  writeFileSync(join(dir, 'marks.json'), JSON.stringify(marks));
  writeFileSync(join(dir, 'overlap.json'), JSON.stringify(overlap));
  writeFileSync(join(dir, 'hands.json'), JSON.stringify({ misses: R.misses, log: R.log }));
  const first = frames[0]?.t ?? 0;
  const secs = (frames.at(-1)?.t ?? 0) - first;
  return { shot, frames: frames.length, seconds: +secs.toFixed(1), fps: +(frames.length / Math.max(0.1, secs)).toFixed(1), mode: await js(() => window.__wdd.evening().mode).catch(() => null), covered: overlap.filter((o) => o.covered).length, cut: overlap.filter((o) => o.cut).length, samples: overlap.length, pokeMisses: R.misses, marks: marks.map((m) => `${m.label}@${m.t.toFixed(1)}`) };
}
