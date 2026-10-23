// Removes a STALE Vite error overlay from the outer dev page (left over after a fixed compile error); prints it first.
export default async function run({ page }) {
  return page.evaluate(() => {
    const o = document.querySelector('vite-error-overlay');
    const text = o?.shadowRoot?.querySelector('.message-body, .message')?.textContent ?? null;
    o?.remove();
    return { removed: o != null, text: text?.slice(0, 200) ?? null };
  });
}
