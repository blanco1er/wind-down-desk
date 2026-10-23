export default async function run({ frame, page }) {
  const f = frame ?? page;
  return f.evaluate(() => ({ boot: localStorage.getItem('wdd.boot'), landing: !!document.querySelector('#begin, [data-style="talk"]'), wdd: typeof window.__wdd?.quality === 'function' ? window.__wdd.quality().safe : null }));
}
