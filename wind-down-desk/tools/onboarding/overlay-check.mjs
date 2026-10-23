export default async function run({ frame, page }) {
  const info = async (ctx) => ctx.evaluate(() => { const o = document.querySelector('vite-error-overlay'); return o ? (o.shadowRoot?.querySelector('.message-body, .message')?.textContent ?? 'overlay').slice(0, 500) : 'none'; });
  return { frame: frame ? await info(frame) : 'no frame', page: await info(page) };
}
