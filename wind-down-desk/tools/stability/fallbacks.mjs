// Safety nets, played in the emulator (26 Oct). One phase per run (WDD_FB), on a fresh evening (the page reloaded):
//   quality    CPU ×12 for 14 s → the frame governor steps the quality down by itself (knobs applied), then calm
//   forced     levels 0 → 3 → 0 by the play-test API: aura motes, light dust, 8k / 6k, living layers
//   controllers  the hands go, controllers come: the lamp says controllers work (6 s rule run now)
//   mic        microphone refused: touching the lamp opens the ritual menu and says the hands do everything
//   safe       safe mode remembered (as after two bad starts): no aura, no dust, 6k, no living layers
//   lost       the GPU context is lost (WEBGL_lose_context): a bad start counted, a message, a clean reload
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const phase = process.env.WDD_FB ?? 'quality';
  const ev = (fn, a) => f.evaluate(fn, a);
  if (phase === 'safe') await ev(() => localStorage.setItem('wdd.safe', '1'));
  const out = { phase };
  const start = async () => {
    await ev(() => window.__wdd.film.day(9));
    await ev(() => {
      const d = window.IWER_DEVICE;
      d.position.set(-0.84, 1.26, 0.2);
      const yaw = Math.PI / 2, pitch = (-27 * Math.PI) / 180;
      const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
      d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
    });
    if (await f.isVisible('[data-style="talk"]')) await f.click('[data-style="talk"]');
    else await f.click('#begin');
    for (let i = 0; i < 40; i++) {
      if (['table', 'floating'].includes(await ev(() => window.__wdd?.state?.().placement ?? null))) break;
      await wait(300);
    }
    await wait(5000);
  };
  const knobs = () => ev(() => {
    const v = window.__wdd.debug().visuals;
    const q = window.__wdd.quality();
    return { level: q.level, safe: q.safe.safe, governor: q.governor, knobs: q.knobs, motes: v.spirit.mesh.geometry.drawRange.count / 6 - 1, auraShown: v.spirit.mesh.visible, dust: v.lights.density, hd: v.backdrop.hdStatus().ok };
  });
  if (phase === 'safe') {
    await start();
    out.state = await knobs();
    await ev(() => window.__wdd.place('fireside-cabin'));
    await wait(4000);
    out.living = await ev(() => ({ rootShown: window.__wdd.debug().visuals.living.root.visible, place: window.__wdd.debug().visuals.backdrop.place }));
    await ev(() => localStorage.removeItem('wdd.safe'));
    return out;
  }
  await start();
  if (phase === 'quality') {
    out.before = await knobs();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 12 });
    await wait(14000);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    out.slow = await knobs();
    await wait(3000);
    out.after = await knobs();
    // A calm margin brings it back up, one level per ≥ 20 s.
    await wait(45000);
    out.recovered = await knobs();
  } else if (phase === 'forced') {
    await ev(() => window.__wdd.place('fireside-cabin'));
    await wait(4500);
    const living = () => ev(() => { const l = window.__wdd.debug().visuals.living; const lights = []; for (const b of l.built.values()) for (const o of b.light) lights.push(o.visible); return { root: l.root.visible, light: lights }; });
    out.l0 = { ...(await knobs()), living: await living() };
    await ev(() => window.__wdd.quality(3));
    await wait(1500);
    out.l3 = { ...(await knobs()), living: await living(), place: await ev(() => window.__wdd.hd()) };
    await ev(() => window.__wdd.quality(0));
    await wait(1500);
    out.back = { ...(await knobs()), living: await living() };
    await ev(() => window.__wdd.quality(null));
  } else if (phase === 'controllers') {
    await ev(() => { window.IWER_DEVICE.primaryInputMode = 'controller'; });
    await wait(1500);
    await ev(() => window.__wdd.checkInputs());
    await wait(600);
    out.caption = await ev(() => window.__wdd.caption().flash);
    out.sources = await ev(() => window.__wdd.debug().visuals.prepRenderer?.xr.getSession()?.inputSources.length ?? null);
    await ev(() => { window.IWER_DEVICE.primaryInputMode = 'hand'; });
  } else if (phase === 'mic') {
    await ev(() => window.__wdd.micState('denied'));
    await ev(() => window.__wdd.press('rituals'));
    await wait(800);
    await ev(() => window.__wdd.press('rituals'));
    await wait(800);
    await ev(() => window.__wdd.press('orb'));
    await wait(1500);
    out.menu = await ev(() => window.__wdd.debug().visuals.ritualMenuOpen);
    out.caption = await ev(() => window.__wdd.caption().flash);
  } else if (phase === 'lost') {
    out.before = await ev(() => localStorage.getItem('wdd.boot'));
    await ev(() => {
      const gl = window.__wdd.debug().visuals.prepRenderer.getContext();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    });
    await wait(900);
    out.note = await ev(() => [...document.querySelectorAll('[role=status]')].map((e) => e.textContent).join(' | '));
    out.after = await ev(() => localStorage.getItem('wdd.boot'));
  }
  return out;
}
