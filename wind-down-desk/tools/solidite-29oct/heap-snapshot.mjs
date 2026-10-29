// 29 Oct (solidity): a heap snapshot of the app page (after the GC), written to OUT, for heap-retainers.mjs.
import { createWriteStream } from 'node:fs';
export default async function run({ page, frame, cdp }) {
  const out = process.env.OUT;
  const ws = createWriteStream(out);
  let bytes = 0;
  cdp.on('HeapProfiler.addHeapSnapshotChunk', (e) => { bytes += e.chunk.length; ws.write(e.chunk); });
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const info = await (frame ?? page).evaluate(() => ({ heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1), url: location.href }));
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false });
  await new Promise((r) => ws.end(r));
  return { out, mb: +(bytes / 1048576).toFixed(1), frame: info, pageUrl: page.url() };
}
