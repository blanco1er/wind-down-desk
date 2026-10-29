// 28 Oct (product pass): stills of each new moment, played by the real paths in the emulator.
//   sh tools/stage.sh 54 30 && SCENE=<scene> npx @iwsdk/cli browser run tools/produit-28oct/shots.mjs --timeout 108000
// Scenes: arrival (the bead on arrival, slid by the emulated index fingertip), squeeze (fists: IWER "point" pose,
// open: "default"), keep (touch words, cupped hands), journal (the page, a star looked at by turning the head),
// night (Good night: the bead again, the summary, the stars on the ceiling, "stay", the fade).
// Output: ../video/produit-28oct/<nn>-<name>.jpg (+ <scene>.json with the app state at each still).
// The headless render loop only advances while a screencast runs: one runs for the whole scene.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function run({ frame, page, cdp, workspaceRoot }) {
  const f = frame ?? page;
  const scene = process.env.SCENE ?? 'arrival';
  const out = join(workspaceRoot, '..', 'video', 'produit-28oct');
  mkdirSync(out, { recursive: true });
  // A stale Vite error overlay (an intermediate edit) lives in the host page: never in a still.
  for (const target of [page, frame].filter(Boolean)) await target.evaluate(() => document.querySelectorAll('vite-error-overlay').forEach((e) => e.remove())).catch(() => {});
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '.workspace-view-switcher{display:none!important}';
    document.head.appendChild(style);
  });
  let last = null;
  cdp.on('Page.screencastFrame', async (event) => {
    last = event.data;
    try {
      await cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId });
    } catch {}
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
  const log = [];
  const js = (fn, a) => f.evaluate(fn, a);
  const still = async (name, extra = {}) => {
    await wait(250);
    if (last != null) writeFileSync(join(out, `${name}.jpg`), Buffer.from(last, 'base64'));
    const state = await js(() => ({ mode: window.__wdd.evening().mode, caption: window.__wdd.debug().visuals.captionCanvas?.lastText ?? null, flash: window.__wdd.caption().flash, tension: window.__wdd.tension(), perf: window.__wdd.perf?.() ?? null }));
    log.push({ name, t: Date.now(), ...state, ...extra });
  };
  // Head: seated (stage.sh: yaw 90°, pitch −30°); eased.
  const head = { pitch: -30, yaw: 90 };
  const look = async (pitch, yaw = 90, ms = 900) => {
    const steps = Math.max(1, Math.round(ms / 40));
    const p0 = head.pitch;
    const y0 = head.yaw;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      head.pitch = p0 + (pitch - p0) * e;
      head.yaw = y0 + (yaw - y0) * e;
      await js(([p, y]) => {
        const rad = Math.PI / 180;
        const sy = Math.sin((y * rad) / 2), cy = Math.cos((y * rad) / 2), sx = Math.sin((p * rad) / 2), cx = Math.cos((p * rad) / 2);
        window.IWER_DEVICE.quaternion.set(cy * sx, sy * cx, -sy * sx, cy * cx);
      }, [head.pitch, head.yaw]);
      await wait(40);
    }
  };
  const until = async (fn, ms = 20000, arg) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await js(fn, arg)) return true;
      await wait(150);
    }
    return false;
  };
  const deskPoint = (x, y, z) => js(([a, b, c]) => window.__wdd.deskPoint(a, b, c), [x, y, z]);
  const hand = (side, p, pose) =>
    js(([s, q, ps]) => {
      const h = window.IWER_DEVICE.hands[s];
      if (q != null) h.position.set(q.x, q.y, q.z);
      if (ps != null) h.poseId = ps;
    }, [side, p, pose]);
  await js(() => {
    window.IWER_DEVICE.primaryInputMode = 'hand';
  });
  const rest = { right: await deskPoint(0.52, 0.0, 0.56), left: await deskPoint(-0.52, 0.0, 0.56) };
  await hand('right', rest.right, 'default');
  await hand('left', rest.left, 'default');

  /** Closed loop: moves the right hand so its measured index fingertip lands on the rail at u (0..1). */
  const tipTo = async (u, lift = 0.004, back = false) => {
    const target = await js(([x, b]) => window.__wdd.railWorld(x, b), [u, back]);
    target.y += lift;
    for (let k = 0; k < 6; k++) {
      const tip = (await js(() => window.__wdd.tips().right)) ?? null;
      const pos = await js(() => {
        const p = window.IWER_DEVICE.hands.right.position;
        return { x: p.x, y: p.y, z: p.z };
      });
      if (tip == null) {
        // No tip measured yet (the bead reads tips only while it waits): an approximate offset first.
        await hand('right', { x: target.x + 0.02, y: target.y + 0.03, z: target.z + 0.12 });
      } else {
        await hand('right', { x: pos.x + target.x - tip.x, y: pos.y + target.y - tip.y, z: pos.z + target.z - tip.z });
      }
      await wait(90);
    }
  };

  if (scene === 'arrival') {
    await until(() => window.__wdd.tension().side === 'in', 30000);
    await look(-22, 90, 800);
    await wait(1200);
    await still('01-perle-arrivee');
    await look(-30, 90, 600);
    await hand('right', null, 'point');
    await tipTo(0.5, 0.03);
    await tipTo(0.5);
    for (let i = 0; i <= 20; i++) {
      await tipTo(0.5 + (0.3 * i) / 20);
      if (i === 14) await still('02-perle-glisse-au-doigt');
    }
    await hand('right', rest.right, 'default');
    await until(() => window.__wdd.tension().side == null, 5000);
    await wait(300);
    await still('03-perle-gardee');
    await until(() => window.__wdd.evening().proposal != null, 9000);
    await wait(1600);
    await still('04-proposition-selon-la-perle', { proposal: await js(() => window.__wdd.evening().proposal) });
  } else if (scene === 'squeeze') {
    await js(() => window.__wdd.ritual('squeeze'));
    const l = await deskPoint(-0.12, 0.13, 0.2);
    const r = await deskPoint(0.12, 0.13, 0.2);
    await hand('left', l, 'default');
    await hand('right', r, 'default');
    await wait(5600);
    await still('05-squeeze-mains-ouvertes');
    await hand('left', null, 'point');
    await hand('right', null, 'point');
    await wait(2600);
    await still('06-squeeze-la-lumiere-entre-dans-les-poings');
    await hand('left', null, 'default');
    await hand('right', null, 'default');
    await wait(450);
    await still('07-squeeze-la-lumiere-s-echappe');
    await wait(1200);
    await still('08-squeeze-poussiere-chaude');
    log.push({ name: 'followed', followed: await js(() => window.__wdd.evening().mode) });
    await js(() => window.__wdd.press('rituals'));
    await wait(4000);
  } else if (scene === 'keep') {
    await js(() => window.__wdd.ritual('keep'));
    await wait(2500);
    await still('09-keep-les-mots');
    // Cupped hands: both open, palms close together over the tray.
    await hand('left', await deskPoint(-0.05, 0.12, 0.2), 'default');
    await hand('right', await deskPoint(0.05, 0.12, 0.2), 'default');
    await wait(400);
    const words = await js(() => window.__wdd.debug().visuals.wordChips.filter((c) => c.mesh.visible).map((c) => c.label));
    const first = words.findIndex((w) => w === 'A good meal');
    await js((i) => window.__wdd.press(`word:${i}`), first >= 0 ? first : 1);
    await wait(900);
    await still('10-keep-lumiere-dans-les-mains');
    await wait(2200);
    await still('11-keep-la-lumiere-part-a-sa-place');
    await hand('right', rest.right);
    await hand('left', rest.left);
    await js(() => window.__wdd.say('The long call with my sister'));
    await wait(1500);
    await js(() => window.__wdd.say('A laugh with Tom at lunch'));
    await wait(3000);
    await still('12-keep-trois-lumieres-dans-la-piece');
    await look(-12, 90, 1400);
    await wait(600);
    await still('13-keep-lumieres-vues-de-plus-haut');
    await look(-30, 90, 900);
    await wait(2500);
  } else if (scene === 'journal') {
    await js(() => window.__wdd.journal('open'));
    await wait(2600);
    await still('14-carnet-page-et-semaine', { journal: await js(() => window.__wdd.journal()) });
    await js(() => window.__wdd.press('keep'));
    await wait(1300);
    await still('15-carnet-soiree-precedente', { journal: await js(() => window.__wdd.journal()) });
    // Look at a star: the head turns to it (the gaze path, no shortcut).
    const n = await js(() => window.__wdd.journal().stars);
    const target = await js((i) => window.__wdd.starWorld(i), Math.max(0, n - 1));
    const headPos = await js(() => {
      const p = window.IWER_DEVICE.position;
      return { x: p.x, y: p.y, z: p.z };
    });
    if (target != null) {
      const dx = target.x - headPos.x;
      const dy = target.y - headPos.y;
      const dz = target.z - headPos.z;
      // IWER yaw 90° faces −X here: yaw = atan2(-dx, -dz) in degrees.
      const yaw = (Math.atan2(-dx, -dz) * 180) / Math.PI;
      const pitch = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
      await look(pitch, yaw, 1400);
      await wait(1500);
      await still('16-carnet-regarder-une-etoile', { journal: await js(() => window.__wdd.journal()), target });
      await look(-30, 90, 1000);
    }
    await js(() => window.__wdd.journal('close'));
    await wait(1500);
  } else if (scene === 'mix') {
    // The Sound button held (as a long poke would), then a fingertip on each rail.
    await js(() => window.__wdd.mix('open'));
    await wait(1800);
    await still('25-mixage-voix-et-son');
    await hand('right', null, 'point');
    const v0 = (await js(() => window.__wdd.mix())).voice;
    await tipTo(v0, 0.03);
    for (let i = 0; i <= 12; i++) await tipTo(v0 - (0.3 * i) / 12);
    await still('26-mixage-voix-plus-douce', { mix: await js(() => window.__wdd.mix()) });
    await tipTo(0.5, 0.04);
    await tipTo(0.9, 0.03, true);
    for (let i = 0; i <= 12; i++) await tipTo(0.9 - (0.3 * i) / 12, 0.004, true);
    await still('27-mixage-ambiance', { mix: await js(() => window.__wdd.mix()) });
    await hand('right', rest.right, 'default');
    log.push({ name: 'mix-final', mix: await js(() => window.__wdd.mix()) });
    await js(() => window.__wdd.mix({ voice: 0.7, sound: 1 }));
    await js(() => window.__wdd.mix('close'));
    await wait(1500);
  } else if (scene === 'night') {
    await js(() => window.__wdd.say('good night'));
    await until(() => window.__wdd.tension().side === 'out', 8000);
    await wait(1500);
    await still('17-perle-avant-la-nuit');
    await hand('right', null, 'point');
    await tipTo(0.7, 0.03);
    for (let i = 0; i <= 16; i++) await tipTo(0.7 - (0.4 * i) / 16);
    await hand('right', rest.right, 'default');
    await until(() => window.__wdd.tension().side == null, 5000);
    await wait(400);
    await still('18-perle-plus-legere');
    await until(() => window.__wdd.evening().mode === 'night', 8000);
    await wait(1200);
    await still('19-bilan-de-la-soiree');
    await wait(2600);
    await look(8, 90, 1500);
    await wait(2500);
    await still('20-les-etoiles-montent', { night: await js(() => window.__wdd.night()) });
    await look(45, 90, 2200);
    await wait(3500);
    await still('21-ton-ciel-au-plafond', { night: await js(() => window.__wdd.night()) });
    await look(-30, 90, 1500);
    await until(() => window.__wdd.night().step === 2, 12000);
    await wait(1200);
    await still('22-la-lampe-propose-de-rester');
    await js(() => window.__wdd.say('stay with me'));
    await wait(2500);
    await still('23-je-reste', { night: await js(() => window.__wdd.night()) });
    await js(() => window.__wdd.sleepSkip(780));
    await look(40, 90, 1500);
    await wait(1500);
    await still('24-fondu-aux-deux-tiers', { night: await js(() => window.__wdd.night()) });
    await look(-30, 90, 800);
  }
  await cdp.send('Page.stopScreencast');
  writeFileSync(join(out, `${scene}.json`), JSON.stringify(log, null, 1));
  return log.map((l) => ({ name: l.name, mode: l.mode, flash: l.flash, tension: l.tension?.side, extra: l.proposal?.line ?? l.night?.ceiling ?? l.journal?.week ?? l.mix ?? undefined }));
}
