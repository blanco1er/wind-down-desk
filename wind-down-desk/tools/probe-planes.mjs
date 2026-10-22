// Dev probe: horizontal planes of the emulated room (label, centre, size).
export default async function run({ frame, page }) {
  return await (frame ?? page).evaluate(() => window.__wdd?.state().planes);
}
