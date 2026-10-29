// 29 Oct (finishing pass): the same stills before / after each change, played by the real paths in the emulator.
//   sh tools/stage.sh 54 30 && PHASE=avant SCENE=<scene> npx @iwsdk/cli browser run tools/finition-29oct/shots.mjs --timeout 108000
// Scenes: keep (cupped hands, the light rising, landed, three lights, from higher up), night (Good night: the room
// darkens, the stars rise, the ceiling), journal (the page, the rituals menu), lamp (close-up of the motes: idle,
// listening, speaking), squeeze (open hands, fists, the light escaping).
// Output: ../video/finition-29oct/<PHASE>/<name>.jpg (+ <scene>.json: the app state and draw calls at each still).
// The headless render loop only advances while a screencast runs: one runs for the whole scene.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function run({ frame, page, cdp, workspaceRoot }) {
  const f = frame ?? page;
  const scene = process.env.SCENE ?? 'keep';
  const out = join(workspaceRoot, '..', 'video', 'finition-29oct', process.env.PHASE ?? 'apres');
  mkdirSync(out, { recursive: true });
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
    const state = await js(() => {
      const d = window.__wdd;
      const p = d.perf?.();
      return { mode: d.evening().mode, flash: d.caption?.().flash, drawsPerEye: p == null ? null : p.drawCalls.max / 2, triangles: p?.triangles.max ?? null };
    });
    await js(() => window.__wdd.perfReset?.());
    log.push({ name, t: Date.now(), ...state, ...extra });
  };
  const head = { pitch: -30, yaw: 90 };
  const look = async (pitch, yaw = 90, ms = 900) => {
    const steps = Math.max(1, Math.round(ms / 110));
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
  /** Turns the head toward a world point (IWER yaw 90° faces −X here). */
  const lookAt = async (target, ms = 1200, dPitch = 0, dYaw = 0) => {
    const h = await js(() => {
      const p = window.IWER_DEVICE.position;
      return { x: p.x, y: p.y, z: p.z };
    });
    const dx = target.x - h.x;
    const dy = target.y - h.y;
    const dz = target.z - h.z;
    await look((Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI + dPitch, (Math.atan2(-dx, -dz) * 180) / Math.PI + dYaw, ms);
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
  const fov = (deg) => js((d) => window.__wdd.film?.fov(d), deg);
  await js(() => {
    window.IWER_DEVICE.primaryInputMode = 'hand';
  });
  const rest = { right: await deskPoint(0.52, 0.0, 0.56), left: await deskPoint(-0.52, 0.0, 0.56) };
  await hand('right', rest.right, 'default');
  await hand('left', rest.left, 'default');
  // No bead question in the way of these moments.
  await js(() => window.__wdd.tension('skip'));

  if (scene === 'keep') {
    await js(() => window.__wdd.ritual('keep'));
    await wait(2200);
    // Cupped hands: both open, palms close together over the tray.
    await hand('left', await deskPoint(-0.05, 0.12, 0.2), 'default');
    await hand('right', await deskPoint(0.05, 0.12, 0.2), 'default');
    await wait(500);
    const words = await js(() => window.__wdd.debug().visuals.wordChips.filter((c) => c.mesh.visible).map((c) => c.label));
    const first = words.findIndex((w) => w === 'A good meal');
    await js((i) => window.__wdd.press(`word:${i}`), first >= 0 ? first : 1);
    const onWall = await js(() => window.__wdd.walls().picked != null);
    await wait(700);
    await still('keep-1-nait-dans-les-mains', { onWall });
    // The eyes follow the light as it rises toward the wall in front of you.
    if (onWall) await look(-18, 90, 900);
    await wait(onWall ? 600 : 1500);
    await still('keep-2-monte');
    if (onWall) await look(-12, 90, 900);
    await wait(onWall ? 600 : 1300);
    await still('keep-3-vole-vers-sa-place');
    await wait(onWall ? 2400 : 2200);
    await still('keep-4-posee-avec-son-mot');
    await hand('right', rest.right);
    await hand('left', rest.left);
    await js(() => window.__wdd.say('The long call with my sister'));
    await wait(1500);
    await js(() => window.__wdd.say('A laugh with Tom at lunch'));
    await wait(6000);
    await still('keep-5-trois-lumieres');
    await look(-12, 90, 1400);
    await wait(600);
    await still('keep-6-vues-de-plus-haut');
    await look(-30, 90, 900);
    await wait(800);
  } else if (scene === 'night') {
    await js(() => window.__wdd.say('good night'));
    // The bead is asked only if something was done tonight: never wait for it when it is not.
    await until(() => window.__wdd.tension().side === 'out' || window.__wdd.evening().mode === 'night', 4000);
    await js(() => window.__wdd.tension().side === 'out' && window.__wdd.tension('skip'));
    await until(() => window.__wdd.evening().mode === 'night', 8000);
    await still('nuit-1-bilan', { night: await js(() => window.__wdd.night()) });
    await look(-14, 90, 700);
    // Timed on the app's own clock (seconds since Good night), not the wall clock.
    const at = (sec) => until((x) => (window.__wdd.night().since ?? 0) >= x, 30000, sec);
    await at(2.4 + 2.2);
    await still('nuit-2-les-etoiles-montent', { night: await js(() => window.__wdd.night()) });
    await look(20, 90, 1000);
    await at(2.4 + 4.6);
    await still('nuit-3-elles-arrivent', { night: await js(() => window.__wdd.night()) });
    await look(55, 90, 1400);
    await at(9.3);
    await still('nuit-4-ton-ciel-au-plafond', { night: await js(() => window.__wdd.night()) });
    await look(42, 62, 1400);
    await wait(500);
    await still('nuit-5-plafond-de-cote', { night: await js(() => window.__wdd.night()) });
    await look(-30, 90, 1500);
    await wait(500);
  } else if (scene === 'journal') {
    await js(() => window.__wdd.journal('open'));
    await wait(2600);
    await still('carnet-1-page-et-semaine', { journal: await js(() => window.__wdd.journal()) });
    await js(() => window.__wdd.press('keep'));
    await wait(1300);
    await still('carnet-2-soiree-precedente');
    await js(() => window.__wdd.journal('close'));
    await wait(1500);
    await js(() => window.__wdd.debug().visuals.ritualMenuOpen || window.__wdd.press('rituals'));
    await wait(1800);
    await still('carnet-3-menu-des-rituels');
  } else if (scene === 'lamp') {
    // Nothing in front of the lamp: the ritual menu (opened by the lamp's proposal) closes first.
    await js(() => window.__wdd.debug().visuals.ritualMenuOpen && window.__wdd.press('rituals'));
    await wait(900);
    const orb = await js(() => {
      const v = window.__wdd.debug().visuals.orb;
      const p = v.getWorldPosition(v.position.clone());
      return { x: p.x, y: p.y, z: p.z };
    });
    await lookAt(orb, 1200);
    await fov(15);
    // Closed loop: project the globe into the rendered eye and turn the head until it sits in the middle.
    for (let k = 0; k < 4; k++) {
      await wait(300);
      const ndc = await js(() => {
        const v = window.__wdd.debug().visuals;
        const cam = v.camera?.cameras?.[0] ?? v.camera;
        const p = v.orb.getWorldPosition(v.orb.position.clone());
        p.project(cam);
        return { x: p.x, y: p.y };
      });
      if (ndc == null || !Number.isFinite(ndc.x)) break;
      await look(head.pitch + ndc.y * 7.5 * 0.9, head.yaw - ndc.x * 13 * 0.9, 300);
    }
    await wait(1800);
    await still('lampe-1-repos');
    await js(() => window.__wdd.lamp('listen'));
    await wait(1600);
    await still('lampe-2-ecoute');
    await js(() => window.__wdd.lamp('speak'));
    await wait(1400);
    await still('lampe-3-parole');
    await js(() => window.__wdd.lamp('think'));
    await wait(1400);
    await still('lampe-4-reflexion');
    await js(() => window.__wdd.lamp(null));
    await fov(54);
    await look(-30, 90, 800);
  } else if (scene === 'squeeze') {
    await js(() => window.__wdd.ritual('squeeze'));
    const l = await deskPoint(-0.12, 0.13, 0.2);
    const r = await deskPoint(0.12, 0.13, 0.2);
    await hand('left', l, 'default');
    await hand('right', r, 'default');
    await wait(5600);
    await still('squeeze-1-mains-ouvertes');
    await hand('left', null, 'point');
    await hand('right', null, 'point');
    await wait(2600);
    await still('squeeze-2-la-lumiere-entre-dans-les-poings');
    await hand('left', null, 'default');
    await hand('right', null, 'default');
    await wait(450);
    await still('squeeze-3-la-lumiere-s-echappe');
    await wait(1200);
    await still('squeeze-4-poussiere-chaude');
    await js(() => window.__wdd.press('rituals'));
    await wait(3000);
  }
  await cdp.send('Page.stopScreencast');
  writeFileSync(join(out, `${scene}.json`), JSON.stringify(log, null, 1));
  return log.map((l) => ({ name: l.name, mode: l.mode, draws: l.drawsPerEye, tris: l.triangles }));
}
