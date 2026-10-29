// 29 Oct (robustness without a headset) — the hands-only evening (parts 1 and 5 of solidite-29oct/parcours.mjs) in the
// emulated preview of a build, under the conditions a real Quest 3 / 3S adds. Own headless Chromium (GPU), own server.
//   node tools/robustesse-29oct/run.mjs <label> [url]          url default https://127.0.0.1:5299
// Conditions (env, combinable):
//   JITTER_MM=4 JITTER_HZ=30   hand tracking noise: both hands shake ± JITTER_MM (3D) at JITTER_HZ
//   DROP_EVERY_S=6 DROP_MS=100-300   tracking lost now and then (hands disconnected for a random 100–300 ms)
//   PINCH_DIP=0.04             per noise tick, the chance a held pinch drops for one tick (a flickering pinch)
//   CARRY_DROP=1               every carried stone: the hand is lost for 300 ms, 250 ms into the carry
//   CPU=4                      CDP CPU throttling ×4 (×6…) for the whole run
//   INPUT=controller           controllers instead of hands (then only the arrival is driven: see the report)
//   AUTOPLAY=blocked           sound may not start without a gesture (Quest Browser's rule for a fresh page)
//   PARTS=1,5                  which parts of parcours.mjs
// Output: artifacts/robustesse-29oct/<label>/result.json (+ captures at each step change), summary on stdout.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [label = 'base', base = 'https://127.0.0.1:5299'] = process.argv.slice(2);
const outDir = join(projectDir, 'artifacts/robustesse-29oct', label);
mkdirSync(outDir, { recursive: true });
const require = createRequire(join(projectDir, 'package.json'));
const { chromium } = require('playwright');
const { default: parcours } = await import(pathToFileURL(join(projectDir, 'tools/solidite-29oct/parcours.mjs')).href);
const env = process.env;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const sec = () => ((Date.now() - t0) / 1000).toFixed(1);
const say = (...a) => console.log(`[${sec()}s]`, ...a);
const cond = {
  jitterMm: Number(env.JITTER_MM ?? 0), jitterHz: Number(env.JITTER_HZ ?? 30),
  dropEveryS: Number(env.DROP_EVERY_S ?? 0), dropMs: (env.DROP_MS ?? '100-300').split('-').map(Number),
  pinchDip: Number(env.PINCH_DIP ?? 0), carryDrop: env.CARRY_DROP === '1', carryDropMs: Number(env.CARRY_DROP_MS ?? 300), cpu: Number(env.CPU ?? 1), input: env.INPUT ?? 'hand', autoplay: env.AUTOPLAY ?? 'allowed',
  parts: (env.PARTS ?? '1,5').split(',').map(Number),
};
const args = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
args.push(cond.autoplay === 'blocked' ? '--autoplay-policy=document-user-activation-required' : '--autoplay-policy=no-user-gesture-required');
const browser = await chromium.launch({ headless: true, channel: 'chromium', args });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message ?? e).slice(0, 240)));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console: ${m.text().slice(0, 240)}`); });
let n = 0;
const shot = async (name) => {
  n += 1;
  await page.screenshot({ path: join(outDir, `${String(n).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-').slice(0, 50)}.png`), timeout: 60000 }).catch(() => {});
};

await page.goto(`${base}/?internal=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => { try { localStorage.clear(); } catch {} });
await page.goto(`${base}/?preview=1&internal=1`, { waitUntil: 'load', timeout: 120000 });
const cdp = await context.newCDPSession(page);
cdp.on('Page.screencastFrame', (e) => cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}));
const screencast = () => cdp.send('Page.startScreencast', { format: 'jpeg', quality: 20, maxWidth: 320, maxHeight: 180, everyNthFrame: 3 }).catch(() => {});
await screencast();
if (cond.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cond.cpu });
await page.waitForFunction(() => window.IWER_DEVICE != null, null, { timeout: 180000 });
// STRIP=plane-detection,mesh-detection,…: the session is asked without them, as a runtime that does not grant them.
if (env.STRIP) {
  await page.waitForFunction(() => navigator.xr != null, null, { timeout: 60000 });
  await page.evaluate((strip) => {
    const xr = navigator.xr;
    const orig = xr.requestSession.bind(xr);
    xr.requestSession = (mode, init = {}) => {
      const drop = (l) => (l ?? []).filter((f) => !strip.includes(f));
      window.__stripInit = { required: drop(init.requiredFeatures), optional: drop(init.optionalFeatures) };
      return orig(mode, { ...init, requiredFeatures: drop(init.requiredFeatures), optionalFeatures: drop(init.optionalFeatures) });
    };
  }, env.STRIP.split(','));
}
await page.waitForFunction(() => { const c = document.querySelector('#choose'); const b = document.querySelector('#begin'); return (c && !c.hidden) || (b && !b.hidden); }, null, { timeout: 180000 });
await wait(2000);
const card = page.locator(`#choose button[data-style="${env.CARD ?? 'talk'}"]`);
if (await card.isVisible()) await card.click();
else await page.locator('#begin').click();
await page.waitForFunction(() => window.__wdd?.perf?.().xr === true, null, { timeout: 180000 });
say('session XR active');
// Controllers from the very start (the app checks the inputs 6 s into the session, as a person holding them would).
if (cond.input !== 'hand') await page.evaluate((mode) => { window.IWER_DEVICE.primaryInputMode = mode; }, cond.input);
await page.waitForFunction(() => ['table', 'floating'].includes(window.__wdd?.state?.().placement), null, { timeout: 60000 }).catch(() => {});
await page.evaluate((mode) => { window.IWER_DEVICE.primaryInputMode = mode; }, cond.input);
await wait(2000);
await page.evaluate(() => {
  const d = window.IWER_DEVICE;
  const c = window.__wdd.deskPoint(0, 0.05, 0.05);
  const dx = c.x - d.position.x, dy = c.y - d.position.y, dz = c.z - d.position.z;
  const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
});
await wait(1500);
await shot('entree');
const atStart = await page.evaluate(() => {
  const d = window.__wdd;
  const st = d.state();
  const sources = [...(window.IWER_DEVICE.activeSession?.inputSources ?? [])].map((x) => (x.hand ? 'hand' : 'pad'));
  return { placement: st.placement, placedOn: st.placedOn ?? null, source: st.source ?? null, enabled: [...(window.IWER_DEVICE.activeSession?.enabledFeatures ?? [])], asked: window.__stripInit ?? null, sources };
}).catch((e) => String(e));
say('au départ', JSON.stringify(atStart));

// The real-world conditions, installed in the page: noise on the hands' base pose, tracking drops, pinch flicker.
const noise = await page.evaluate((c) => {
  const stats = { ticks: 0, drops: 0, dips: 0 };
  window.__robustStats = stats;
  if (c.jitterMm <= 0 && c.dropEveryS <= 0 && c.pinchDip <= 0 && !c.carryDrop) return 'none';
  for (const side of ['left', 'right']) {
    const h = window.IWER_DEVICE.hands[side];
    const pos = h.position;
    const set = pos.set.bind(pos);
    const baseP = { x: pos.x, y: pos.y, z: pos.z };
    pos.set = (x, y, z) => { baseP.x = x; baseP.y = y; baseP.z = z; return set(x, y, z); };
    const pinch = h.updatePinchValue.bind(h);
    let wanted = 0;
    let pinchedAt = -1;
    h.updatePinchValue = (v) => {
      if (v > 0.5 && wanted <= 0.5) pinchedAt = performance.now();
      if (v <= 0.5) pinchedAt = -1;
      wanted = v;
      pinch(v);
    };
    const amp = c.jitterMm / 1000;
    // Smooth-ish tremor: two sines + a little white noise per axis (real hand tracking shakes, it does not teleport).
    const ph = [Math.random() * 6, Math.random() * 6, Math.random() * 6];
    let nextDrop = performance.now() + c.dropEveryS * 1000 * (0.5 + Math.random());
    setInterval(() => {
      stats.ticks++;
      const t = performance.now() / 1000;
      if (amp > 0) {
        const n = (i) => amp * (0.6 * Math.sin(2 * Math.PI * c.jitterHz * 0.37 * t + ph[i]) + 0.25 * Math.sin(2 * Math.PI * c.jitterHz * t + ph[i] * 2) + 0.15 * (Math.random() * 2 - 1));
        set(baseP.x + n(0), baseP.y + n(1), baseP.z + n(2));
      }
      if (c.pinchDip > 0 && wanted > 0.5 && Math.random() < c.pinchDip) {
        stats.dips++;
        pinch(0);
        setTimeout(() => pinch(wanted), 1000 / c.jitterHz);
      }
      if (c.carryDrop && pinchedAt > 0 && performance.now() - pinchedAt > 250) {
        pinchedAt = -1;
        stats.drops++;
        const hands = () => [...(window.IWER_DEVICE.activeSession?.inputSources ?? [])].filter((x) => x.hand != null).length;
        stats.trace = stats.trace ?? [];
        const tr = { side, before: hands() };
        stats.trace.push(tr);
        h.connected = false;
        setTimeout(() => { tr.during = hands(); }, 120);
        setTimeout(() => { h.connected = true; setTimeout(() => { tr.after = hands(); }, 120); }, Number(c.carryDropMs ?? 300));
      }
      if (c.dropEveryS > 0 && performance.now() > nextDrop) {
        nextDrop = performance.now() + c.dropEveryS * 1000 * (0.5 + Math.random());
        const ms = c.dropMs[0] + Math.random() * ((c.dropMs[1] ?? c.dropMs[0]) - c.dropMs[0]);
        stats.drops++;
        h.connected = false;
        setTimeout(() => { h.connected = true; }, ms);
      }
    }, 1000 / c.jitterHz);
  }
  return 'installed';
}, cond);
say('conditions', JSON.stringify(cond), noise);
if (env.TRACE_STONES === '1') {
  await page.evaluate(() => {
    const tr = (window.__stoneTrace = []);
    let last = '';
    setInterval(() => {
      const d = window.__wdd;
      const toks = d.state().tokens.map((t) => { const w = d.stoneWorld(t.id); return `${t.id}:${t.bin ?? '-'}${t.released ? 'R' : ''}@${w ? w.y.toFixed(2) : '?'}`; }).join(' ');
      const h = window.IWER_DEVICE.hands.right;
      const k = `${toks} | pinch ${h.connected ? 'on' : 'LOST'}`;
      if (k !== last) { tr.push(`${d.clock().elapsed.toFixed(1)} ${k}`); last = k; }
    }, 50);
  });
}

// Every press with its time (double triggers), sampled from the app's own press log.
const pressTimes = [];
let lastCount = 0;
let sampling = true;
const sampler = (async () => {
  while (sampling) {
    const p = await page.evaluate(() => ({ ...window.__wdd.presses(), t: window.__wdd.clock().elapsed })).catch(() => null);
    if (p != null && p.count > lastCount) {
      const fresh = p.last.slice(-(p.count - lastCount));
      for (const a of fresh) pressTimes.push({ a, t: +p.t.toFixed(2) });
      lastCount = p.count;
    }
    await wait(120);
  }
})();

const results = [];
if (env.SCENARIO === 'toggles') {
  // A switch touched N times with shaking hands: every touch must flip it exactly once.
  const { makeHands } = await import(pathToFileURL(join(projectDir, 'tools/solidite-29oct/hands.mjs')).href);
  const H = makeHands(page);
  await H.rest();
  if (await page.evaluate(() => window.__wdd.tension().side != null)) await page.evaluate(() => window.__wdd.press('keep'));
  await wait(1500);
  await H.poke('settings', { fallback: true });
  await wait(1200);
  const flips = [];
  const N = Number(env.TOGGLES ?? 8);
  for (let i = 0; i < N; i++) {
    const before = await page.evaluate(() => window.__wdd.access().largeText);
    await H.poke('setting:text', { fallback: false });
    await wait(900);
    const after = await page.evaluate(() => window.__wdd.access().largeText);
    flips.push(before !== after ? 1 : 0);
  }
  const p = await page.evaluate(() => window.__wdd.presses());
  results.push({ toggles: N, flipped: flips.reduce((a, b) => a + b, 0), flips, pokeMisses: H.stats.pokeMisses, presses: p.count, gated: p.gated ?? null });
  say('bascules :', JSON.stringify(results[0]));
} else if (env.SCENARIO === 'observe') {
  // What a person sees 8 s into a session (inputs, gaze-only selection, the lamp's line), then a look-and-wait press.
  await wait(8000);
  const seen = await page.evaluate(() => ({ sources: [...(window.IWER_DEVICE.activeSession?.inputSources ?? [])].map((x) => `${x.targetRayMode}:${x.hand ? 'hand' : x.gamepad ? 'pad' : '-'}`), access: window.__wdd.access(), mode: window.__wdd.evening().mode }));
  results.push({ seen });
  say('observé', JSON.stringify(seen));
  await shot('observe');
  // Gaze only: look at the stone (the ring fills), then at a bowl.
  // The preview's seated camera owns the head: turn it with player.look(), closed loop on the real head direction.
  const look = async (p) => {
    for (let k = 0; k < 4; k++) {
      await page.evaluate((q) => {
        const d = window.IWER_DEVICE;
        const pl = window.__wddPlayer;
        const { x, y, z, w } = d.quaternion;
        const fx = -2 * (x * z + w * y), fy = -2 * (y * z - w * x), fz = -(1 - 2 * (x * x + y * y));
        const dx = q.x - d.position.x, dy = q.y - d.position.y, dz = q.z - d.position.z;
        const want = { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
        const now = { yaw: Math.atan2(-fx, -fz), pitch: Math.asin(Math.max(-1, Math.min(1, fy))) };
        const v = pl.view();
        pl.look(v.yaw + (want.yaw - now.yaw), v.pitch + (want.pitch - now.pitch));
      }, p);
      await wait(450);
    }
  };
  const tok = await page.evaluate(() => window.__wdd.state().tokens.find((t) => t.bin == null && !t.released)?.id ?? null);
  if (tok != null) {
    await look(await page.evaluate((i) => window.__wdd.stoneWorld(i), tok));
    await wait(2200);
    await look(await page.evaluate(() => window.__wdd.binWorld('tomorrow')));
    await wait(2600);
    const got = await page.evaluate((i) => window.__wdd.state().tokens.find((t) => t.id === i)?.bin ?? null, tok);
    results.push({ gazeSort: { tok, got } });
    say('tri au regard', JSON.stringify({ tok, got }));
  }
} else if (env.SCENARIO === 'controller-evening') {
  // A whole quiet evening with controllers only: every glass button by ray + trigger, every stone by two pulls.
  await page.evaluate(() => { if (window.__wddPlayer) window.__wddPlayer.keepRays = true; window.__wdd.rays(true); });
  await wait(6500);
  const ctl = (fn, arg) => page.evaluate(fn, arg);
  const aimFrom = () => ctl(() => {
    const c = window.IWER_DEVICE.controllers.right;
    const from = window.__wdd.deskPoint(0.18, 0.12, 0.42);
    c.position.set(from.x, from.y, from.z);
    return from;
  });
  const aimAt = (p) => ctl((q) => {
    const c = window.IWER_DEVICE.controllers.right;
    const from = { x: c.position.x, y: c.position.y, z: c.position.z };
    const dx = q.x - from.x, dy = q.y - from.y, dz = q.z - from.z;
    const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    c.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
  }, p);
  const pull = async () => { await ctl(() => window.IWER_DEVICE.controllers.right.updateButtonValue('trigger', 1)); await wait(Number(env.PULL_MS ?? 150)); await ctl(() => window.IWER_DEVICE.controllers.right.updateButtonValue('trigger', 0)); await wait(500); };
  const steps = [];
  const press = async (action) => {
    await aimFrom();
    const b = await ctl((a) => window.__wdd.buttonWorld(a), action);
    if (b == null || !b.shown) { steps.push({ action, ok: false, why: b == null ? 'absent' : 'hidden', mode: await ctl(() => window.__wdd.evening().mode) }); return false; }
    await aimAt(b);
    await wait(300);
    const hov = await ctl((a) => { const h = window.__wdd.debug().visuals.hover ?? {}; return { mine: h[a]?.target ?? null, any: Object.keys(h).filter((k) => (h[k].target ?? 0) > 0.5) }; }, action);
    const before = await ctl(() => window.__wdd.presses().count);
    await pull();
    let p = await ctl(() => window.__wdd.presses());
    let ok = p.count > before && p.last.slice(-(p.count - before)).includes(action);
    let retried = false;
    if (!ok) {
      // A person pulls again when nothing happened.
      retried = true;
      await wait(400);
      await pull();
      p = await ctl(() => window.__wdd.presses());
      ok = p.count > before && p.last.slice(-(p.count - before)).includes(action);
    }
    if (retried) steps.push({ retry: action, ok, sel: await ctl(() => window.__selTrace ?? null) });
    const words = ok ? null : await ctl(() => window.__wdd.debug().visuals.wordChips.map((c, i) => `${i}:${c.mesh.visible ? 'V' : 'h'}:${c.mesh.pointerEvents ?? '?'}:${(c.uniforms.uOpacity.value).toFixed(2)}`).join(' '));
    steps.push({ action, ok, ...(ok ? {} : { hov, got: p.last.slice(-(p.count - before)), gated: p.gated, words }) });
    return ok;
  };
  const sortOne = async (bin) => {
    await aimFrom();
    const tok = await ctl(() => window.__wdd.state().tokens.find((t) => t.bin == null && !t.released)?.id ?? null);
    if (tok == null) { steps.push({ sort: bin, ok: false, why: 'no stone' }); return; }
    await aimAt(await ctl((i) => window.__wdd.stoneWorld(i), tok));
    await wait(300);
    await pull();
    await aimAt(await ctl((x) => window.__wdd.binWorld(x), bin));
    await wait(300);
    await pull();
    await wait(1200);
    const got = await ctl((i) => window.__wdd.state().tokens.find((t) => t.id === i), tok);
    steps.push({ sort: bin, ok: got?.bin === bin || got?.released === true, got: got?.bin ?? (got?.released ? 'released' : null) });
  };
  const until = async (fn, ms) => { const e = Date.now() + ms; while (Date.now() < e) { if (await ctl(fn).catch(() => false)) return true; await wait(250); } return false; };
  if (await ctl(() => window.__wdd.tension().side != null)) await press('keep');
  await wait(2500);
  if (await ctl(() => window.__wdd.evening().mode !== 'unload')) {
    await press('rituals');
    await wait(1200);
    await press('ritual:unload');
  }
  await until(() => window.__wdd.state().tokens.some((t) => t.bin == null && !t.released), 15000);
  await wait(800);
  await sortOne('later');
  await until(() => window.__wdd.buttonWorld('word:0')?.shown === true, 10000);
  await press('word:0');
  await wait(2500);
  await sortOne('tomorrow');
  await until(() => window.__wdd.buttonWorld('word:1')?.shown === true, 10000);
  await press('word:1');
  await wait(2500);
  await sortOne('let-go');
  await wait(1500);
  for (let i = 0; i < 8; i++) {
    const label = await ctl((k) => window.__wdd.debug().visuals.wordChips?.[k]?.label ?? null, i).catch(() => null);
    if (label != null && /all/i.test(label)) { await press(`word:${i}`); break; }
  }
  await wait(3000);
  if (await ctl(() => window.__wdd.buttonWorld('keep')?.shown === true)) await press('keep');
  await wait(3000);
  steps.push({ mode: await ctl(() => window.__wdd.evening().mode) });
  await shot('manettes-apres-unload');
  // Good night by ray, the bead skipped by its button, then Lights out.
  if (!(await ctl(() => window.__wdd.debug().visuals.ritualsOpen))) await press('rituals');
  await wait(1200);
  await press('ritual:sleep');
  await wait(3000);
  if (await ctl(() => window.__wdd.tension().side != null)) await press('keep');
  await until(() => window.__wdd.night?.().step >= 2 || (window.__wdd.debug().visuals.replyLabels ?? []).some((l) => /lights/i.test(l)), 30000);
  await shot('manettes-nuit');
  await press('keep');
  await wait(9000);
  steps.push({ end: await ctl(() => ({ xr: window.__wdd.perf().xr, mode: window.__wdd.evening().mode })) });
  results.push({ steps });
  say('soirée aux manettes', JSON.stringify(steps));
} else if (cond.input === 'hand') {
  process.env.MIC = 'denied';
  for (const part of cond.parts) {
    process.env.PART = String(part);
    say(`partie ${part}…`);
    await cdp.send('Page.stopScreencast').catch(() => {});
    const r = await parcours({ page, frame: null, cdp }).catch((e) => ({ part, error: String(e?.message ?? e) }));
    results.push(r);
    say(`partie ${part} :`, JSON.stringify(r.error ?? (r.log ?? []).map((x) => x.step)));
    say('  ratés :', JSON.stringify({ pokes: r.hands?.pokes, pokeMisses: r.hands?.pokeMisses, grabs: r.hands?.grabs, grabMisses: r.hands?.grabMisses, blocked: r.blocked }));
    await screencast();
    await wait(1200);
    await shot(`fin-partie-${part}`);
    if (part === 1) {
      // Stones: none outside the tray, none floating above it, none counted twice.
      const stones = await page.evaluate(() => {
        const d = window.__wdd;
        const o = d.deskPoint(0, 0, 0), ex = d.deskPoint(1, 0, 0), ez = d.deskPoint(0, 0, 1);
        const ax = { x: ex.x - o.x, z: ex.z - o.z }, az = { x: ez.x - o.x, z: ez.z - o.z };
        return d.state().tokens.filter((t) => !t.released).map((t) => {
          const w = d.stoneWorld(t.id);
          if (w == null) return { id: t.id, bin: t.bin, w: null };
          const rx = w.x - o.x, rz = w.z - o.z;
          return { id: t.id, bin: t.bin, x: +(rx * ax.x + rz * ax.z).toFixed(3), y: +(w.y - o.y).toFixed(3), z: +(rx * az.x + rz * az.z).toFixed(3) };
        });
      }).catch((e) => String(e));
      results.push({ stones });
    }
  }
} else {
  // Controllers: what the person is told, whether a far ray + trigger presses glass buttons, and whether a stone
  // can be taken with the grip (squeeze) and put in a bowl.
  await wait(6500);
  await shot('manettes-accueil');
  // The computer preview lets the mouse replace the rays; a headset does not: give the controllers their rays back.
  await page.evaluate(() => { if (window.__wddPlayer) window.__wddPlayer.keepRays = true; window.__wdd.rays(true); });
  await wait(600);
  const aimAndPull = async (action) => {
    const ok = await page.evaluate(async (a) => {
      const d = window.IWER_DEVICE;
      const c = d.controllers.right;
      const b = window.__wdd.buttonWorld(a);
      if (b == null || !b.shown) return { a, why: b == null ? 'absent' : 'hidden' };
      const from = window.__wdd.deskPoint(0.18, 0.12, 0.42);
      c.position.set(from.x, from.y, from.z);
      const dx = b.x - from.x, dy = b.y - from.y, dz = b.z - from.z;
      const yaw0 = Math.atan2(-dx, -dz), pitch0 = Math.atan2(dy, Math.hypot(dx, dz));
      const aim = (yaw, pitch) => {
        const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
        c.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
      };
      // The controller's target ray is tilted from its grip (as on a real Quest controller): find the aim that
      // hovers the button, as a person corrects their wrist while looking at the ray.
      const hv = () => window.__wdd.debug().visuals.hover?.[a];
      let found = null;
      outer: for (const dp of [0, -0.2, 0.2, -0.4, 0.4, -0.6, 0.6, -0.8, 0.8]) {
        for (const dyw of [0, -0.1, 0.1, -0.2, 0.2]) {
          aim(yaw0 + dyw, pitch0 + dp);
          await new Promise((r) => setTimeout(r, 140));
          const h = hv();
          if ((h?.target ?? 0) > 0.5) { found = { dp, dyw }; break outer; }
        }
      }
      const before = window.__wdd.presses().count;
      await new Promise((r) => setTimeout(r, 200));
      const hov = { aim: found, ...(hv() ?? {}) };
      const sources = [...(d.activeSession?.inputSources ?? [])].map((x) => `${x.handedness}:${x.targetRayMode}:${x.hand ? 'hand' : x.gamepad ? 'pad' : '-'}`);
      c.updateButtonValue('trigger', 1);
      await new Promise((r) => setTimeout(r, 200));
      c.updateButtonValue('trigger', 0);
      await new Promise((r) => setTimeout(r, 400));
      const p = window.__wdd.presses();
      return { a, pressed: p.count > before && p.last.slice(-(p.count - before)).includes(a), hover: hov, sources, mode: d.primaryInputMode };
    }, action);
    results.push({ ray: ok });
    say('rayon + gâchette', JSON.stringify(ok));
    return ok;
  };
  if (await page.evaluate(() => window.__wdd.tension().side != null)) await aimAndPull('keep');
  await wait(1500);
  await aimAndPull('rituals');
  await wait(1200);
  await aimAndPull('ritual:unload');
  await wait(4000);
  await aimAndPull('word:0');
  await wait(3000);
  // Breathe with controllers: "Enough" must stay reachable by the ray (rays used to rest during Breathe).
  await aimAndPull('rituals');
  await wait(1200);
  await aimAndPull('ritual:breathe');
  await wait(4000);
  const replies = await page.evaluate(() => ({ mode: window.__wdd.evening().mode, replies: window.__wdd.debug().visuals.replyLabels ?? null }));
  results.push({ breathe: replies });
  say('Breathe aux manettes', JSON.stringify(replies));
  await aimAndPull('lighter');
  await wait(1500);
  results.push({ afterEnough: await page.evaluate(() => window.__wdd.evening().mode) });
  say('après Enough', JSON.stringify(results[results.length - 1]));
  await shot('manettes-pierre');
  // A stone with the grip: the controller on the stone, squeeze, carry to Later, release.
  const grab = await page.evaluate(async () => {
    const d = window.IWER_DEVICE;
    const c = d.controllers.right;
    const tok = window.__wdd.state().tokens.find((t) => t.bin == null && !t.released);
    if (tok == null) return { why: 'no stone' };
    const s = window.__wdd.stoneWorld(tok.id);
    const end = window.__wdd.binWorld('later');
    const step = (p) => new Promise((r) => { c.position.set(p.x, p.y, p.z); setTimeout(r, 45); });
    c.quaternion.set(-0.38, 0, 0, 0.92);
    // The grip lands on the stone from above (a few heights: the controller's grab sphere sits ahead of its origin).
    let held = false;
    for (const dy of [0.01, 0.03, -0.01, 0.05]) {
      await step({ x: s.x, y: s.y + 0.08, z: s.z + 0.02 });
      await step({ x: s.x, y: s.y + dy, z: s.z + 0.02 });
      await new Promise((r) => setTimeout(r, 200));
      c.updateButtonValue('squeeze', 1);
      await new Promise((r) => setTimeout(r, 300));
      const w = window.__wdd.stoneWorld(tok.id);
      await step({ x: s.x, y: s.y + dy + 0.05, z: s.z + 0.02 });
      await new Promise((r) => setTimeout(r, 200));
      const w2 = window.__wdd.stoneWorld(tok.id);
      if (w2.y - w.y > 0.02) { held = true; break; }
      c.updateButtonValue('squeeze', 0);
      await new Promise((r) => setTimeout(r, 300));
    }
    if (!held) return { id: tok.id, bin: null, held };
    for (let i = 1; i <= 16; i++) { const k = i / 16; await step({ x: s.x + (end.x - s.x) * k, y: s.y + 0.01 + (end.y + 0.03 - s.y) * k + Math.sin(Math.PI * k) * 0.08, z: s.z + (end.z - s.z) * k }); }
    c.updateButtonValue('squeeze', 0);
    await new Promise((r) => setTimeout(r, 800));
    const t = window.__wdd.state().tokens.find((x) => x.id === tok.id);
    return { id: tok.id, bin: t?.bin ?? null, held };
  });
  results.push({ grip: grab });
  say('pierre à la manette', JSON.stringify(grab));
  // Two pulls: point at the stone, pull the trigger; point at a bowl, pull again (the controllers' way to sort).
  for (const bin of ['later', 'tomorrow']) {
    const two = await page.evaluate(async (target) => {
      const d = window.IWER_DEVICE;
      const c = d.controllers.right;
      const tok = window.__wdd.state().tokens.find((t) => t.bin == null && !t.released);
      if (tok == null) return { why: 'no stone' };
      const from = window.__wdd.deskPoint(0.18, 0.12, 0.42);
      c.position.set(from.x, from.y, from.z);
      const aimAt = (p) => {
        const dx = p.x - from.x, dy = p.y - from.y, dz = p.z - from.z;
        const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
        const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
        c.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
      };
      const pull = async () => { c.updateButtonValue('trigger', 1); await new Promise((r) => setTimeout(r, 150)); c.updateButtonValue('trigger', 0); await new Promise((r) => setTimeout(r, 400)); };
      aimAt(window.__wdd.stoneWorld(tok.id));
      await new Promise((r) => setTimeout(r, 300));
      await pull();
      const b = window.__wdd.binWorld(target);
      aimAt({ x: b.x, y: b.y, z: b.z });
      await new Promise((r) => setTimeout(r, 300));
      await pull();
      await new Promise((r) => setTimeout(r, 1200));
      const t = window.__wdd.state().tokens.find((x) => x.id === tok.id);
      return { id: tok.id, wanted: target, bin: t?.bin ?? null };
    }, bin);
    results.push({ twoPulls: two });
    say('deux pressions de gâchette', JSON.stringify(two));
    await wait(2500);
  }
  await shot('manettes-deux-pressions');
  // Pointing at the stone from afar: trigger (select) or grip (squeeze) held while the ray moves to a bowl.
  for (const button of []) {
    const far = await page.evaluate(async (btn) => {
      const d = window.IWER_DEVICE;
      const c = d.controllers.right;
      const tok = window.__wdd.state().tokens.find((t) => t.bin == null && !t.released);
      if (tok == null) return { why: 'no stone' };
      const s = window.__wdd.stoneWorld(tok.id);
      const end = window.__wdd.binWorld('later');
      const from = window.__wdd.deskPoint(0.18, 0.12, 0.42);
      c.position.set(from.x, from.y, from.z);
      const aimAt = (p) => {
        const dx = p.x - from.x, dy = p.y - from.y, dz = p.z - from.z;
        const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
        const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
        c.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
      };
      aimAt(s);
      await new Promise((r) => setTimeout(r, 300));
      const y0 = window.__wdd.stoneWorld(tok.id);
      c.updateButtonValue(btn, 1);
      await new Promise((r) => setTimeout(r, 300));
      for (let i = 1; i <= 12; i++) {
        const k = i / 12;
        aimAt({ x: s.x + (end.x - s.x) * k, y: s.y + (end.y + 0.03 - s.y) * k, z: s.z + (end.z - s.z) * k });
        await new Promise((r) => setTimeout(r, 60));
      }
      const moved = window.__wdd.stoneWorld(tok.id);
      c.updateButtonValue(btn, 0);
      await new Promise((r) => setTimeout(r, 900));
      const t = window.__wdd.state().tokens.find((x) => x.id === tok.id);
      return { btn, id: tok.id, movedCm: +(Math.hypot(moved.x - y0.x, moved.z - y0.z) * 100).toFixed(1), bin: t?.bin ?? null };
    }, button);
    results.push({ far });
    say('pierre visée de loin', JSON.stringify(far));
  }
  await shot('manettes-apres-pierre');
}
sampling = false;
await sampler;
// Double triggers: the same action twice within 0.5 s of the app's clock.
const doubles = pressTimes.filter((p, i) => pressTimes.slice(0, i).some((q) => q.a === p.a && p.t - q.t < 0.5));
const perf = await page.evaluate(() => { const p = window.__wdd.perf(); return { frameMs: p.frameMs, cpuMs: p.cpuMs, drawCalls: p.drawCalls, longFrames: p.longFrames.length }; }).catch(() => null);
const robust = await page.evaluate(() => window.__robustStats ?? null).catch(() => null);
const placement = await page.evaluate(() => ({ placement: window.__wdd.state().placement, placedOn: window.__wdd.state().placedOn ?? null, mic: window.__wdd.state().mic ?? null })).catch(() => null);
const captions = await page.evaluate(() => { const v = window.__wdd.debug().visuals; return { captionShown: v.caption?.visible ?? null }; }).catch(() => null);
const stoneTrace = env.TRACE_STONES === '1' ? await page.evaluate(() => window.__stoneTrace).catch(() => null) : null;
const summary = { atStart, stoneTrace, label, base, at: new Date().toISOString(), cond, robust, placement, captions, results, presses: pressTimes.length, doubles, perf, pageErrors };
writeFileSync(join(outDir, 'result.json'), JSON.stringify(summary, null, 2));
say('placement :', JSON.stringify(placement), '; doubles :', JSON.stringify(doubles), '; perf frame ms :', JSON.stringify(perf?.frameMs), '; erreurs page :', pageErrors.length, JSON.stringify(robust));
await browser.close();
