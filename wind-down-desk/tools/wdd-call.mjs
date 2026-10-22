// Dev helper: calls window.__wdd.<fn>(...args) in the app; args via WDD_CALL env (JSON array: [fn, ...args]).
export default async function run({ frame, page }) {
  const [fn, ...args] = JSON.parse(process.env.WDD_CALL ?? '["state"]');
  return await (frame ?? page).evaluate(([f, a]) => window.__wdd[f](...a), [fn, args]);
}
