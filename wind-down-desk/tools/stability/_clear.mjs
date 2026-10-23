export default async function run({ frame, page }) {
  const f = frame ?? page;
  return f.evaluate(() => { localStorage.removeItem('wdd.safe'); localStorage.removeItem('wdd.boot'); return 'cleared'; });
}
