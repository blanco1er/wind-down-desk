// 29 Oct: seeds this browser's evenings for the memory-world probe — an earlier evening (two good things kept, two
// things let go, so two stars), before a fresh stage reloads the page. Clears tonight so Keep starts empty.
export default async function run({ frame, page }) {
  const f = frame ?? page;
  return await f.evaluate(() => {
    const KEY = 'wind-down-desk.memory.v1';
    const date = '2026-10-27';
    const data = { version: 1, nights: [{ date, tomorrow: [], later: [], letGo: ['Old email', 'The parking fine'], plan: [], planKept: false, kept: ['Someone kind', 'A walk outside'], rituals: ['keep', 'unload'] }], stars: [{ text: 'Old email', date, seed: 1234567 }, { text: 'The parking fine', date, seed: 7654321 }], laterPool: [], morningSeen: null, done: [], celebrated: [] };
    localStorage.setItem(KEY, JSON.stringify(data));
    return JSON.parse(localStorage.getItem(KEY)).nights.length;
  });
}
