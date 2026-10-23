// Instanced stones: is the batch's shader program ready before the first stone (precompile), so the first stone
// never compiles a program mid-evening? Fresh page, landing → desk placed, no stone yet.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page }) {
  const f = frame ?? page;
  if (await f.isVisible('[data-style="quiet"]')) await f.click('[data-style="quiet"]');
  else await f.click('#begin');
  for (let i = 0; i < 40; i++) {
    if (['table', 'floating'].includes(await f.evaluate(() => window.__wdd?.state?.().placement ?? null))) break;
    await wait(300);
  }
  await wait(4000);
  const before = await f.evaluate(() => ({ stones: window.__wdd.state().tokens.length, programs: window.__wdd.perf().programs ?? null, names: window.__wdd.perf().programNames ?? null }));
  await f.evaluate(() => window.__wdd.press('ritual:unload'));
  await wait(1200);
  await f.evaluate(() => window.__wdd.say('I have to call the bank and book the dentist.'));
  await wait(3500);
  const after = await f.evaluate(() => ({ stones: window.__wdd.state().tokens.length, programs: window.__wdd.perf().programs ?? null, names: window.__wdd.perf().programNames ?? null, batch: window.__wdd.stoneBatch() }));
  const added = Array.isArray(before.names) && Array.isArray(after.names) ? after.names.filter((n) => !before.names.includes(n)) : null;
  return { before: { stones: before.stones, programs: before.programs }, after: { stones: after.stones, programs: after.programs, batch: after.batch }, compiledAtFirstStone: added };
}
