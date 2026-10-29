// 29 Oct: title strips for the before / after boards (the app's typeface, rendered by the managed browser).
// WDD_LABELS='{"name":"text",...}' OUT=<dir>  → <dir>/<name>.png (1920 × 64, dark)
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
export default async function run({ frame, page }) {
  const f = frame ?? page;
  const labels = JSON.parse(process.env.WDD_LABELS ?? '{}');
  for (const [name, text] of Object.entries(labels)) {
    const data = await f.evaluate(async (t) => {
      await document.fonts.load('600 30px Manrope');
      const c = document.createElement('canvas');
      c.width = 1920;
      c.height = 64;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#16120f';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.font = '600 30px Manrope, sans-serif';
      ctx.fillStyle = '#f3e6d4';
      ctx.textBaseline = 'middle';
      ctx.fillText(t, 28, 33);
      return c.toDataURL('image/png').split(',')[1];
    }, text);
    writeFileSync(join(process.env.OUT, `${name}.png`), Buffer.from(data, 'base64'));
  }
  return Object.keys(labels);
}
