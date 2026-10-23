// Agent memory (24 Oct): a returning evening. The lamp opens with one true sentence and yesterday's open Tomorrow
// stones: "done" (voice) dissolves one into light, "Not yet" (touch) keeps the other; then "forget everything".
//   WDD_JS="$(cat tools/onboarding/recall-seed.js)" iwsdk browser run tools/wdd-eval.mjs; iwsdk browser reload
//   iwsdk browser run tools/onboarding/recall-check.mjs
import { writeFileSync } from 'node:fs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = 'artifacts/agent-memory';
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  await page.evaluate(() => document.querySelectorAll('.workspace-view-switcher').forEach((e) => (e.style.display = 'none'))).catch(() => {});
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 86 });
    writeFileSync(`${OUT}/${name}`, Buffer.from(r.data, 'base64'));
  };
  await f.evaluate(() => {
    const d = window.IWER_DEVICE;
    d.primaryInputMode = 'hand';
    d.position.set(-0.84, 1.2, 0.2);
    const yaw = Math.PI / 2, pitch = (-27 * Math.PI) / 180;
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
    window.__wdd?.film?.fov?.(58);
  });
  const caption = () => f.evaluate(() => ({ line: window.__wdd.debug().visuals.lastSpoken ?? null, tokens: window.__wdd.state().tokens.map((t) => t.text), mode: window.__wdd.evening().mode }));
  const landing = await f.evaluate(() => document.getElementById('memory')?.textContent ?? null);
  const card = (await f.isVisible('[data-style="talk"]')) ? '[data-style="talk"]' : '#begin';
  await f.click(card);
  const r = { landing };
  for (let i = 0; i < 40; i++) {
    await wait(300);
    const c = await caption();
    if (/Did you/u.test(c.line ?? '')) break;
  }
  await wait(1400);
  r.opening = await caption();
  await shot('01-opening.jpg');
  await f.evaluate(() => window.__wdd.say('Done.'));
  await wait(1100);
  await shot('02-done-dissolves.jpg');
  await wait(1200);
  r.second = await caption();
  await shot('03-second-question.jpg');
  await f.evaluate(() => window.__wdd.press('lighter'));
  await wait(2200);
  r.after = await caption();
  await shot('04-proposal.jpg');
  r.memory = await f.evaluate(() => JSON.parse(localStorage.getItem('wind-down-desk.memory.v1')).done);
  await f.evaluate(() => window.__wdd.say('Forget everything.'));
  await wait(800);
  r.confirm = await caption();
  await shot('05-forget-confirm.jpg');
  await f.evaluate(() => window.__wdd.press('keep'));
  await wait(800);
  r.forgotten = await f.evaluate(() => JSON.parse(localStorage.getItem('wind-down-desk.memory.v1') ?? 'null'));
  r.afterForget = await caption();
  return r;
}
