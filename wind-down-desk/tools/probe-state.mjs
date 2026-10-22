// Dev probe: prints the ritual state and perf summary from the running app.
export default async function run({ page, frame }) {
  const frames = page.frames().map((f) => f.url().slice(0, 80));
  const target = frame ?? page;
  const result = await target.evaluate(() => {
    const api = window.__wdd;
    return api == null ? { error: 'no __wdd' } : { state: api.state(), perf: api.perf?.() };
  });
  return { frames, result };
}
