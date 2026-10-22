// Dev helper: evaluates WDD_JS (an expression or async function body) in the app frame.
// Usage: WDD_JS='return window.IWER_DEVICE.fovy' npx @iwsdk/cli browser run tools/wdd-eval.mjs
export default async function run({ frame, page }) {
  const body = process.env.WDD_JS ?? 'return 1';
  return await (frame ?? page).evaluate((b) => new Function(`return (async () => { ${b} })()`)(), body);
}
