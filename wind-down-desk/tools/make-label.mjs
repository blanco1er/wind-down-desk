// Renders the honest lower-third for the demo video (PNG, transparent) with the app's own typeface.
// npx @iwsdk/cli browser run tools/make-label.mjs  → artifacts/label-v4.png
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
export default async function run({ frame, page, workspaceRoot }) {
  const f = frame ?? page;
  const text = process.env.WDD_LABEL ?? 'Meta Quest 3 emulator (IWER). A photo of a room stands in for passthrough. 21 evenings of history simulated.';
  const data = await f.evaluate(async (t) => {
    await document.fonts.load('500 30px Manrope');
    const c = document.createElement('canvas');
    c.width = 1920;
    c.height = 120;
    const ctx = c.getContext('2d');
    ctx.font = '500 30px Manrope, sans-serif';
    const w = ctx.measureText(t).width + 56;
    ctx.fillStyle = 'rgba(20, 16, 12, 0.55)';
    ctx.beginPath();
    ctx.roundRect(48, 30, w, 56, 28);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 252, 246, 0.92)';
    ctx.textBaseline = 'middle';
    ctx.fillText(t, 76, 59);
    return c.toDataURL('image/png');
  }, text);
  const out = join(workspaceRoot, 'artifacts', process.env.WDD_LABEL_OUT ?? 'label-v4.png');
  writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
  return out;
}
