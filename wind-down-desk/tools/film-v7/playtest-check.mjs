// Checks the play-test console end to end: a typed dump, "That's it.", the hand buttons (Tomorrow, Let go),
// then Release by voice + the "sink" hand button. Returns the stones' bins and the evening mode.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page }) {
  const f = frame ?? page;
  const click = (pred) => f.evaluate((p) => {
    const b = [...document.querySelectorAll('#wdd-playtest button')].find((x) => (x.dataset.say ?? x.dataset.hand ?? x.dataset.act ?? '').startsWith(p));
    if (!b) return false;
    b.click();
    return true;
  }, pred);
  const out = {};
  out.dump = await click('I still');
  await wait(3500);
  out.thatsit = await click("That's it");
  await wait(800);
  out.tomorrow = await click('tomorrow');
  await wait(3800);
  out.letgo = await click('let-go');
  await wait(4500);
  out.tokens = await f.evaluate(() => window.__wdd.state().tokens.map((t) => `${t.text}:${t.bin}${t.released ? ' (released)' : ''}`));
  return out;
}
