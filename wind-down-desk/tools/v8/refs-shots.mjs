// v8: the 18 scenes of the owner's reference images, played through the app's real paths (sentences into the
// speech handler, the emulated right hand pinching through IWSDK grabbing), one still per scene.
//   sh tools/stage.sh 54 27 && GROUP=A OUT=dir npx @iwsdk/cli browser run tools/v8/refs-shots.mjs --timeout 108000
// Groups (each < 100 s): A arrival → unload → plan · B release → breathe → good night · C places.
import { mkdirSync } from 'node:fs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page }) {
  const f = frame ?? page;
  const out = process.env.OUT;
  const group = process.env.GROUP ?? 'A';
  mkdirSync(out, { recursive: true });
  await page.evaluate(() => {
    const s = document.createElement('style');
    s.textContent = '.workspace-view-switcher{display:none!important}';
    document.head.appendChild(s);
  });
  const shots = [];
  const shot = async (name) => {
    await wait(150);
    await page.screenshot({ path: `${out}/${name}.png` });
    shots.push(name);
  };
  const ev = (body, arg) => f.evaluate(new Function('arg', `return (async () => { const d = window.__wdd; ${body} })()`), arg);
  const say = async (text, ms) => {
    await ev('await d.say(arg);', text);
    await wait(ms);
  };
  // In-page hand helper (the play-test console's path): glide, pinch, carry, open the fingers.
  await ev(`
    const hand = window.IWER_DEVICE.hands.right;
    const glide = async (to, ms, lift = 0) => {
      const from = { x: hand.position.x, y: hand.position.y, z: hand.position.z };
      const t0 = performance.now();
      for (;;) {
        const k = Math.min(1, (performance.now() - t0) / ms);
        const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
        hand.position.set(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e + Math.sin(Math.PI * k) * lift, from.z + (to.z - from.z) * e);
        if (k >= 1) return;
        await new Promise((r) => requestAnimationFrame(r));
      }
    };
    window.__v8 = {
      rest: () => d.deskPoint(0.42, 0.02, 0.55),
      async pick(from) { await glide({ x: from.x, y: from.y + 0.06, z: from.z }, 600, 0.03); await glide({ x: from.x, y: from.y + 0.01, z: from.z }, 260); hand.updatePinchValue(1); await new Promise((r) => setTimeout(r, 300)); },
      async to(p, ms = 1000) { await glide(p, ms, 0.08); },
      async open() { hand.updatePinchValue(0); await new Promise((r) => setTimeout(r, 120)); },
      async away() { await glide(window.__v8.rest(), 600, 0.05); },
    };
  `);
  const nextStone = (match) => ev(`const t = d.state().tokens.find((t) => t.bin == null && !t.released && (arg == null || t.text.toLowerCase().includes(arg))); return t == null ? null : d.stoneWorld(t.id);`, match ?? null);

  if (group === 'A') {
    await ev('d.film.history(21); d.arrive();');
    await wait(2600);
    await shot('v8-04-arrival');
    await say("I'm so wired tonight, I can't relax.", 2600);
    await shot('v8-02-proposal-rituals');
    await say('Unload.', 2400);
    await say("I still haven't replied to the landlord about the heating. And I need to book the dentist, it's been a year.", 1800);
    await say("The slides for Monday aren't done. I keep replaying that.", 2600);
    await shot('v8-05-unload-dump');
    await say('Awkward comment in the meeting. And my passport expires in March.', 2400);
    await say("That's it.", 2200);
    const dentist = await nextStone('dentist');
    const bowl = await ev(`return d.binWorld('tomorrow');`);
    if (dentist && bowl) {
      await ev('await window.__v8.pick(arg);', dentist);
      await ev('await window.__v8.to(arg);', { x: bowl.x, y: bowl.y + 0.07, z: bowl.z + 0.01 });
      await wait(500);
      await shot('v8-06-unload-sort');
      await ev('await window.__v8.to(arg, 300);', { x: bowl.x, y: bowl.y + 0.03, z: bowl.z });
      await ev('await window.__v8.open(); await window.__v8.away();');
    }
    const awkward = await nextStone('awkward');
    const letgo = await ev(`return d.binWorld('let-go');`);
    if (awkward && letgo) {
      await ev('await window.__v8.pick(arg);', awkward);
      await ev('await window.__v8.to(arg);', { x: letgo.x, y: letgo.y + 0.03, z: letgo.z });
      await ev('await window.__v8.open();');
      await ev('window.__v8.away();');
      await wait(1500);
      await shot('v8-07-let-go');
    }
    await say('Sort them for me.', 5200);
    await shot('v8-08-plan');
  }
  if (group === 'B') {
    await ev('d.film.history(21); d.arrive();');
    await wait(2400);
    await say('Release.', 2800);
    await shot('v8-10-release-ask');
    await say('The meeting with Paul tomorrow. I keep replaying it.', 4200);
    const s = await ev('return d.weightWorld();');
    const w = await ev('return d.waterWorld(0.085);');
    if (s && w) {
      await ev('await window.__v8.pick(arg);', { ...s, y: s.y + 0.002 });
      await ev('await window.__v8.to(arg, 1200);', { x: w.x + 0.03, y: w.y, z: w.z + 0.035 });
      await wait(700);
      await shot('v8-03-release-hold');
      await ev('await window.__v8.open(); window.__v8.away();');
      await ev(`for (let i = 0; i < 200; i++) { if (d.evening().release?.phase === 'gone') break; await new Promise((r) => setTimeout(r, 50)); } await new Promise((r) => setTimeout(r, 700));`);
      await shot('v8-11-release-gone');
    }
    await wait(2500);
    await say('Breathe.', 300);
    // Wait for the 2nd inhale near its top, then the following exhale.
    await ev(`for (let i = 0; i < 400; i++) { const b = d.evening().breath; if (b && b.cycle >= 1 && b.phase === 'in' && b.level > 0.8) return; await new Promise((r) => setTimeout(r, 50)); }`);
    await shot('v8-01-breathe-in');
    await ev(`for (let i = 0; i < 400; i++) { const b = d.evening().breath; if (b && b.phase === 'out' && b.level < 0.45) return; await new Promise((r) => setTimeout(r, 50)); }`);
    await shot('v8-09-breathe-out');
    await say("That's enough.", 6000);
    await say('Good night.', 1900);
    await shot('v8-12-good-night');
  }
  if (group === 'C') {
    await ev('d.film.history(21); d.arrive();');
    await wait(2400);
    await say('Unload.', 2000);
    await say("I still haven't replied to the landlord about the heating. And I need to book the dentist, it's been a year.", 1800);
    await say("The slides for Monday aren't done. I keep replaying that awkward comment I made in the meeting. Oh, and my passport expires in March.", 2600);
    await say("That's it.", 1800);
    await ev(`d.press('places');`);
    await wait(1800);
    await shot('v8-13-places-menu');
    await ev(`await d.place('cabin-lake');`);
    await wait(3600);
    await shot('v8-14-lake-table-stays');
    await ev(`d.immersion('full');`);
    await wait(1200);
    await ev(`await d.place('tea-garden');`);
    await wait(2600);
    await shot('v8-15-garden-full');
  }
  return shots;
}
