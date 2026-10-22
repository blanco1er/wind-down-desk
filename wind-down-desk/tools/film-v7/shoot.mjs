// v7 competition film: one script, several short takes (each < 100 s, the `browser run` lease is 110 s).
//   sh tools/stage.sh 54 30 && SHOT=unload npx @iwsdk/cli browser run tools/film-v7/shoot.mjs --timeout 108000
// Capture: CDP screencast of the 3840 × 2160 managed browser (start the runtime with
//   iwsdk dev up --headless --ai-mode agent --allow-browser-automation --screenshot-width 3840 --screenshot-height 2160),
// JPEG q85 (≈ 30 frames/s at 4K on an M2; q95 drops to ≈ 20).
// Real input paths only: sentences go through the app's speech handler (window.__wdd.say = the path of a transcribed
// microphone clip); stones are pinched, carried and released by the emulated right hand (IWER) through IWSDK grabbing.
// Film-only extras (never in the build): seeded history (`film.history`), arrival replayed from darkness, head moves.
// Output: artifacts/frames-v7-<shot>/ (frames + index.json + audio.json + stills.json + marks.json). An existing
// folder is archived (renamed), never deleted.
import { appendFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function run({ frame, page, cdp, workspaceRoot }) {
  const f = frame ?? page;
  const shot = process.env.SHOT ?? 'unload';
  const quality = Number(process.env.Q ?? 85);
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '.workspace-view-switcher{display:none!important}';
    document.head.appendChild(style);
  });
  const dir = join(workspaceRoot, 'artifacts', `frames-v7-${shot}`);
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
  const stills = [];
  const marks = [];
  const still = async (name) => {
    await wait(100);
    stills.push({ name, frame: frames.at(-1)?.name });
  };
  const log = (m) => appendFileSync(join(dir, 'log.txt'), `${((Date.now() - t0) / 1000).toFixed(2)} ${m} frames=${frames.length}\n`);
  const mark = (label) => {
    marks.push({ label, t: (Date.now() - t0) / 1000 });
    log(`mark ${label}`);
  };

  // A page exception can leave the page paused under the runner's debugger session (render and evaluate stop):
  // never pause, and log + resume if it happens anyway.
  cdp.on('Debugger.paused', async (e) => {
    log(`PAUSED ${e.reason} ${JSON.stringify(e.data ?? {}).slice(0, 300)} at ${e.callFrames?.[0]?.url ?? ''}:${e.callFrames?.[0]?.location?.lineNumber ?? ''}`);
    try { await cdp.send('Debugger.resume'); } catch {}
  });
  try {
    await cdp.send('Debugger.enable');
    await cdp.send('Debugger.setPauseOnExceptions', { state: 'none' });
    await cdp.send('Debugger.setSkipAllPauses', { skip: true });
  } catch (err) {
    log(`debugger setup failed ${err}`);
  }

  // ------------------------------------------------------------------ head (seated, slow breathing sway)
  const base = await f.evaluate(() => {
    const p = window.IWER_DEVICE.position;
    return { x: p.x, y: p.y, z: p.z };
  });
  // The head and hands are animated INSIDE the page (setInterval at 60 Hz): at 4K every CDP round trip takes
  // ≈ 100 ms, so driving them from Node made the hands three times too slow. Node only sends targets.
  const head = { pitch: -27, target: -27, yaw: 90, yawTarget: 90, ease: 0.045, pos: { ...base }, posTarget: { ...base }, sway: 1 };
  await f.evaluate((b) => {
    const old = window.__rig;
    if (old) clearInterval(old.timer);
    const rig = { pitch: -27, target: -27, yaw: 90, yawTarget: 90, ease: 0.045, sway: 1, pos: { ...b }, posTarget: { ...b }, glides: [], t0: performance.now() };
    rig.timer = setInterval(() => {
      const now = performance.now();
      const k = 60 / 30; // ease constants were tuned for 30 Hz
      const a = 1 - Math.pow(1 - rig.ease, 1 / k);
      rig.pitch += (rig.target - rig.pitch) * a;
      rig.yaw += (rig.yawTarget - rig.yaw) * (1 - Math.pow(1 - rig.ease * 0.8, 1 / k));
      const ap = 1 - Math.pow(1 - 0.04, 1 / k);
      for (const c of ['x', 'y', 'z']) rig.pos[c] += (rig.posTarget[c] - rig.pos[c]) * ap;
      const t = (now - rig.t0) / 1000;
      const rad = Math.PI / 180;
      const pitch = (rig.pitch + Math.sin(t * 0.7) * 0.35 * rig.sway) * rad;
      const yaw = (rig.yaw + Math.sin(t * 0.43) * 0.5 * rig.sway) * rad;
      const sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2), sx = Math.sin(pitch / 2), cx = Math.cos(pitch / 2);
      window.IWER_DEVICE.quaternion.set(cy * sx, sy * cx, -sy * sx, cy * cx);
      window.IWER_DEVICE.position.set(rig.pos.x, rig.pos.y, rig.pos.z);
      rig.glides = rig.glides.filter((g) => {
        const q = Math.min(1, (now - g.start) / g.ms);
        const e = q < 0.5 ? 4 * q * q * q : 1 - (-2 * q + 2) ** 3 / 2;
        window.IWER_DEVICE.hands[g.side].position.set(g.from.x + (g.to.x - g.from.x) * e, g.from.y + (g.to.y - g.from.y) * e + Math.sin(Math.PI * q) * g.lift, g.from.z + (g.to.z - g.from.z) * e);
        return q < 1;
      });
    }, 16);
    window.__rig = rig;
  }, base);
  let sent = '';
  const syncHead = (snap = false) => {
    const msg = JSON.stringify({ target: head.target, yawTarget: head.yawTarget, ease: head.ease, posTarget: head.posTarget, sway: head.sway });
    if (msg === sent && !snap) return;
    sent = msg;
    f.evaluate(([m, sn, cur]) => {
      Object.assign(window.__rig, JSON.parse(m));
      if (sn) Object.assign(window.__rig, { pitch: cur.pitch, yaw: cur.yaw, pos: { ...cur.pos } });
    }, [msg, snap, { pitch: head.pitch, yaw: head.yaw, pos: head.pos }]).catch(() => {});
  };
  const headTimer = setInterval(() => syncHead(), 50);
  /** Aim the head at a world point (yaw / pitch in the app's convention), from the target head position. */
  const aim = (p, snap = false) => {
    const from = head.posTarget;
    const dx = p.x - from.x, dy = p.y - from.y, dz = p.z - from.z;
    const yaw = (Math.atan2(-dx, -dz) * 180) / Math.PI;
    const pitch = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
    let y = yaw;
    while (y - head.yaw > 180) y -= 360;
    while (y - head.yaw < -180) y += 360;
    head.yawTarget = y;
    head.target = pitch;
    if (snap) {
      head.yaw = y;
      head.pitch = pitch;
      syncHead(true);
    }
  };
  const lean = (towards, metres, snap = false) => {
    const dx = towards.x - base.x, dy = towards.y - base.y, dz = towards.z - base.z;
    const d = Math.hypot(dx, dy, dz);
    head.posTarget = { x: base.x + (dx / d) * metres, y: base.y + (dy / d) * metres, z: base.z + (dz / d) * metres };
    if (snap) {
      head.pos = { ...head.posTarget };
      syncHead(true);
    }
  };

  // ------------------------------------------------------------------ app helpers
  const say = async (text) => {
    log(`say ${text.slice(0, 40)}`);
    await f.evaluate((t) => { void window.__wdd.say(t); }, text);
  };
  const js = (fn, arg) => f.evaluate(fn, arg);
  const deskPoint = (x, y, z) => f.evaluate(([a, b, c]) => window.__wdd.deskPoint(a, b, c), [x, y, z]);
  const fov = (deg) => f.evaluate((d) => window.__wdd.film.fov(d), deg);
  const setHand = (side, p, pinch) =>
    f.evaluate(([s, pos, v]) => {
      const hand = window.IWER_DEVICE.hands[s];
      hand.position.set(pos.x, pos.y, pos.z);
      if (v != null) hand.updatePinchValue(v);
    }, [side, p, pinch]);
  const restR = await deskPoint(0.52, 0.0, 0.56);
  const restL = await deskPoint(-0.52, 0.0, 0.56);
  const glide = async (side, from, to, ms, lift = 0) => {
    await f.evaluate((g) => {
      window.__rig.glides = window.__rig.glides.filter((o) => o.side !== g.side);
      window.__rig.glides.push({ ...g, start: performance.now() });
    }, { side, from, to, ms, lift });
    await wait(ms + 20);
  };
  const tokens = () => js(() => window.__wdd.state().tokens);
  const grabStone = async (id, bin) => {
    log(`grab ${id} -> ${bin}`);
    const stone = await js((i) => window.__wdd.stoneWorld(i), id);
    const end = await js((b) => window.__wdd.binWorld(b), bin);
    if (stone == null || end == null) return false;
    const above = { x: stone.x, y: stone.y + 0.06, z: stone.z };
    await glide('right', restR, above, 650, 0.05);
    await glide('right', above, { x: stone.x, y: stone.y + 0.01, z: stone.z }, 300);
    await setHand('right', { x: stone.x, y: stone.y + 0.01, z: stone.z }, 1);
    await wait(280);
    await glide('right', { x: stone.x, y: stone.y + 0.01, z: stone.z }, { x: end.x, y: end.y + 0.03, z: end.z }, 1050, 0.1);
    await wait(150);
    await setHand('right', { x: end.x, y: end.y + 0.03, z: end.z }, 0);
    await wait(300);
    await glide('right', { x: end.x, y: end.y + 0.03, z: end.z }, restR, 700, 0.09);
    return true;
  };
  /** Release: pinch the basalt stone, hold it over the water, open the fingers. */
  const sinkByHand = async (holdMs = 1600, onHold) => {
    const s = await js(() => window.__wdd.weightWorld());
    const w = await js(() => window.__wdd.waterWorld(0.085));
    if (s == null || w == null) return false;
    const above = { x: s.x, y: s.y + 0.06, z: s.z };
    await glide('right', restR, above, 700, 0.05);
    await glide('right', above, { x: s.x, y: s.y + 0.012, z: s.z }, 320);
    await setHand('right', { x: s.x, y: s.y + 0.012, z: s.z }, 1);
    await wait(340);
    const over = { x: w.x + 0.03, y: w.y, z: w.z + 0.035 };
    await glide('right', { x: s.x, y: s.y + 0.012, z: s.z }, over, 1400, 0.07);
    if (onHold) await onHold();
    await wait(holdMs);
    await setHand('right', over, 0);
    await wait(200);
    void glide('right', over, restR, 1200, 0.0);
    return true;
  };
  const waitFor = async (fn, arg, ms = 6000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await js(fn, arg)) return true;
      await wait(120);
    }
    return false;
  };

  let pageT0 = 0;
  let startAt = 0;
  const startRec = async () => {
    startAt = (Date.now() - t0) / 1000;
    pageT0 = await js(() => performance.now());
    recording = true;
    mark('start');
  };
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality, maxWidth: Number(process.env.MAXW ?? 3840), maxHeight: Number(process.env.MAXW ?? 3840) * 9 / 16, everyNthFrame: 1 });

  // Hands start out of reach (below the table, pinch open) so nothing can be grabbed during the arrival;
  // they glide in from below when a gesture is needed.
  const awayR = { x: restR.x, y: restR.y - 0.35, z: restR.z };
  const awayL = { x: restL.x, y: restL.y - 0.35, z: restL.z };
  await setHand('right', awayR, 0);
  await setHand('left', awayL, 0);
  await wait(400);
  const handsIn = async () => {
    void glide('left', awayL, restL, 900);
    await glide('right', awayR, restR, 900);
  };
  const center = await deskPoint(0, 0.02, 0.02);
  const water = await js(() => window.__wdd.waterWorld(0));

  // ================================================================== takes
  if (shot === 'unload') {
    // The lamp wakes in the dark, proposes Unload; a full head becomes stones; sorted by hand and by voice; Let go = a star.
    await fov(54);
    await js(() => window.__wdd.film.history(21));
    aim(await deskPoint(0, -0.02, -0.06), true);
    await startRec();
    await js(() => window.__wdd.arrive());
    await wait(4200);
    await still('lamp-wakes');
    mark('dump');
    await say("I still haven't replied to the landlord about the heating. I need to book the dentist. The slides for Monday aren't done. And I keep thinking about that awkward thing I said at lunch.");
    await wait(3600);
    await still('stones');
    // Stones at the ends of the row only: the emulated pinch point sits a few cm from the IWER wrist, so a stone
    // in the middle of the row can be taken for its neighbour. Middle stones are sorted by voice.
    const list = await tokens();
    const first = list[0]?.id;
    const last = list.at(-1)?.id;
    await say("That's it.");
    await handsIn();
    mark('pinch-tomorrow');
    if (first) await grabStone(first, 'tomorrow');
    await wait(900);
    mark('pinch-letgo');
    if (last) await grabStone(last, 'let-go');
    await wait(500);
    await still('let-go-dust');
    await wait(2600);
    mark('voice-sort');
    await say('Dentist, tomorrow.');
    await wait(1700);
    await say('Slides, later.');
    await wait(1800);
    const rest = (await tokens()).filter((t) => t.bin == null && !t.released);
    log(`left on desk: ${rest.map((t) => t.text).join(' | ')}`);
    head.target += 11;
    await wait(2600);
    await still('plan');
    mark('keep');
    await say('Keep it.');
    head.target -= 11;
    await wait(4200);
    await still('proposes-release');
  } else if (shot === 'release' || shot === 'open') {
    // Agentic start: the lamp hears something heavy, proposes Release and carries the sentence into the stone.
    const close = shot === 'open';
    await js(() => window.__wdd.film.history(21));
    if (close) {
      await fov(30);
      lean(water, 0.16, true);
      aim({ x: water.x, y: water.y - 0.01, z: water.z }, true);
      head.sway = 0.6;
    } else {
      await fov(54);
      aim(await deskPoint(0, -0.02, -0.06), true);
    }
    await js(() => window.__wdd.arrive());
    await wait(2600);
    if (!close) await startRec();
    mark('heard');
    await say('The meeting with Paul tomorrow. I keep replaying it.');
    await wait(close ? 3200 : 4200);
    await still('proposes-release');
    if (close) await startRec();
    mark('yes');
    await say('Yes.');
    await waitFor(() => window.__wdd.weightWorld() != null, null, 8000);
    await wait(close ? 2600 : 3000);
    await still('release-stone');
    await handsIn();
    mark('pinch');
    await sinkByHand(close ? 2200 : 1700, async () => {
      await still('release-hold');
    });
    mark('drop');
    await wait(700);
    await still('release-sinks');
    await wait(1300);
    await still('release-words-of-light');
    await wait(3200);
    await still('release-gone');
    await wait(close ? 1500 : 4200);
    if (!close) await still('proposes-breathe');
  } else if (shot === 'breathe') {
    // Agentic: "wired, can't relax" → the lamp proposes Breathe → the lamp becomes a moon that breathes with you.
    await fov(54);
    await js(() => window.__wdd.film.history(21));
    aim(await deskPoint(0, -0.02, -0.06), true);
    await js(() => window.__wdd.arrive());
    await wait(2600);
    await startRec();
    mark('heard');
    await say("I'm so wired tonight. I can't relax.");
    await wait(3800);
    await still('proposes-breathe');
    mark('yes');
    await say('Yes.');
    const sideL = await deskPoint(-0.22, 0.04, 0.06);
    const sideR = await deskPoint(0.22, 0.04, 0.06);
    await handsIn();
    void glide('left', restL, sideL, 1400, 0.03);
    await glide('right', restR, sideR, 1400, 0.03);
    await wait(3000);
    await still('moon-forms');
    await wait(3700);
    await still('breathe-in');
    await wait(4300);
    await still('breathe-out');
    await wait(6000);
    await wait(4000);
    await still('breathe-in-2');
    await wait(5600);
    mark('enough');
    await say("That's enough.");
    void glide('left', sideL, restL, 1500, 0.02);
    void glide('right', sideR, restR, 1500, 0.02);
    await wait(3400);
    await still('well-done');
    await wait(5200);
    await still('proposes-sleep');
    mark('goodnight');
    await say('Good night.');
    await wait(2600);
    await still('good-night');
    // Look up: the personal sky above the desk.
    head.ease = 0.02;
    head.target = 12;
    await wait(6500);
    await still('sky');
    await wait(1200);
  } else if (shot === 'places') {
    await fov(54);
    await js(() => window.__wdd.film.history(21));
    aim(await deskPoint(0, -0.02, -0.06), true);
    await js(() => window.__wdd.arrive());
    await wait(3000);
    await say('Not now.');
    await wait(1500);
    await startRec();
    mark('lake');
    await say('Take me to the lake.');
    head.target = -12;
    await wait(3600);
    await still('lake');
    head.ease = 0.025;
    head.yawTarget = 135;
    head.target = -4;
    await wait(5200);
    await still('lake-look');
    head.yawTarget = 92;
    head.target = -14;
    await wait(4200);
    mark('garden');
    await say('Go to the garden.');
    await wait(4200);
    await still('garden');
    head.yawTarget = 60;
    head.target = -6;
    await wait(4500);
    await still('garden-look');
    head.yawTarget = 90;
    head.target = -12;
    await wait(3000);
    mark('stars');
    await say('Show me the stars.');
    await wait(3000);
    head.target = 14;
    await wait(5200);
    await still('hilltop-sky');
    head.target = -16;
    await wait(4200);
    await still('hilltop-desk');
    mark('room');
    await say('Back to my room.');
    await wait(3600);
    await still('room');
  } else if (shot === 'voice') {
    // Accessibility: the whole Release by voice, hands resting; then "voice off" (captions stay).
    await fov(54);
    await js(() => window.__wdd.film.history(21));
    aim(await deskPoint(0, -0.02, -0.06), true);
    await js(() => window.__wdd.arrive());
    await wait(3000);
    await startRec();
    mark('release');
    await say('Release.');
    await wait(3600);
    await still('voice-ask');
    mark('weight');
    await say('That email I never answered.');
    await waitFor(() => window.__wdd.weightWorld() != null, null, 8000);
    await wait(3200);
    await still('voice-stone');
    mark('letitgo');
    await say('Let it go.');
    await wait(2400);
    await still('voice-sinks');
    await wait(4200);
    await still('voice-gone');
    await wait(3000);
    mark('voiceoff');
    await say('Voice off.');
    await wait(3000);
    await still('voice-off');
  } else if (shot === 'raw') {
    // Tech proof: the film set hidden. The emulator's synthetic room (IWER living_room) and its detected table.
    await fov(70);
    await js(() => window.__wdd.film.history(21));
    await js(() => window.__wdd.film.hide(true));
    lean(center, -0.35, true);
    head.posTarget.y += 0.25;
    head.pos.y += 0.25;
    aim(center, true);
    head.yaw += 14;
    syncHead(true);
    await wait(1500);
    await startRec();
    head.ease = 0.012;
    aim(center);
    await wait(2500);
    await js(() => window.__wdd.arrive());
    await wait(6500);
    await still('raw-room');
    await wait(1500);
  } else if (shot === 'sky') {
    // The sky that grows: evening 3 vs evening 60 (seeded history, film only), after "good night", looking up.
    await fov(54);
    for (const evenings of [3, 60]) {
      await js((n) => window.__wdd.film.history(n), evenings);
      head.ease = 0.045;
      aim(await deskPoint(0, -0.02, -0.06), true);
      await js(() => window.__wdd.arrive());
      await wait(2600);
      await say('Good night.');
      await wait(2200);
      if (!recording) await startRec();
      mark(`sky-${evenings}`);
      head.ease = 0.02;
      head.target = 14;
      await wait(6000);
      await still(`sky-${evenings}`);
      await wait(800);
    }
  }

  await wait(300);
  recording = false;
  await cdp.send('Page.stopScreencast');
  clearInterval(headTimer);
  await wait(300);
  writeFileSync(join(dir, 'index.json'), JSON.stringify(frames));
  const state = await js(() => window.__wdd.evening());
  const audio = await js(() => window.__wdd.voice());
  const toVideo = (t) => Math.round(((t - pageT0) / 1000 + startAt) * 1000) / 1000;
  const events = [...audio.log, ...audio.cues].filter((e) => e.t >= pageT0 - 50).map((e) => ({ at: toVideo(e.t), src: e.src, volume: e.volume }));
  writeFileSync(join(dir, 'audio.json'), JSON.stringify({ startAt, events }));
  writeFileSync(join(dir, 'stills.json'), JSON.stringify(stills));
  writeFileSync(join(dir, 'marks.json'), JSON.stringify(marks));
  const first = frames[0]?.t ?? 0;
  return { shot, frames: frames.length, seconds: (frames.at(-1)?.t ?? 0) - first, fps: frames.length / Math.max(0.1, (frames.at(-1)?.t ?? 0) - first), mode: state.mode, audioEvents: events.length, marks };
}
