// Debug: does a long 4K screencast keep flowing? Counts frames per 2 s for N seconds (with optional disk writes).
import { writeFileSync, mkdirSync } from 'node:fs';
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const dir = '/private/tmp/claude-501/-Volumes-Dev-Projects-CauldronClash-CauldronClash/3aee8286-0ea0-44b5-823f-24a95001bc34/scratchpad/video-meta/sc';
  mkdirSync(dir, { recursive: true });
  let n = 0;
  cdp.on('Page.screencastFrame', async (e) => { n++; if (process.env.W === '1') writeFileSync(`${dir}/x${n % 50}.jpg`, Buffer.from(e.data, 'base64')); try { await cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }); } catch {} });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 3840, maxHeight: 2160 });
  const counts = [];
  let evals = 0;
  const secs = Number(process.env.S ?? 30);
  for (let i = 0; i < secs / 2; i++) {
    const before = n;
    const end = Date.now() + 2000;
    while (Date.now() < end) { await f.evaluate(() => 1); evals++; await new Promise((r) => setTimeout(r, 50)); }
    counts.push(n - before);
  }
  await cdp.send('Page.stopScreencast');
  return { counts, evals };
}
