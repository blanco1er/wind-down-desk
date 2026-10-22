// 22 Oct: where the desk is tonight and why (placement, source, frame, persistent anchor, what the room offers).
//   npx @iwsdk/cli browser run tools/anchor-state.mjs
export default async function run({ frame, page }) {
  return await (frame ?? page).evaluate(() => {
    const d = window.__wdd;
    const s = d.state();
    const r = (v) => (typeof v === 'number' ? +v.toFixed(3) : v);
    return {
      placement: s.placement,
      source: s.source,
      placedOn: s.placedOn,
      frame: s.frame == null ? null : Object.fromEntries(Object.entries(s.frame).map(([k, v]) => [k, r(v)])),
      anchor: d.anchor(),
      surfaces: d.surfaces(),
      features: window.__wddFeatures ?? null,
    };
  });
}
