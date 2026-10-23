import { writeFileSync } from 'node:fs';
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  await new Promise((r) => setTimeout(r, 1500));
  const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 86 });
  writeFileSync('artifacts/talk/00-ritual-menu.jpg', Buffer.from(r.data, 'base64'));
  return await f.evaluate(() => window.__wdd.evening().mode);
}
