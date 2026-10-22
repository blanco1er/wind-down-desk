import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error plain .mjs tool without types
import { parseStatus } from '../tools/playtest.mjs';

test('play-test launcher reads the dev status of this folder', () => {
  const ready = JSON.stringify({
    ok: true,
    data: {
      runtimeUrls: { local: 'https://localhost:8082/' },
      state: { running: true, browserCommandReady: true, session: { browser: { lifecycle: { state: 'running' } } } },
    },
  });
  assert.deepEqual(parseStatus(ready), { running: true, url: 'https://localhost:8082/', ready: true, browser: 'running' });
  // closed window: server alive, browser failed → the watchdog offers `npm run playtest:open`
  const closed = JSON.stringify({ data: { state: { running: true, browserCommandReady: false, session: { localUrl: 'https://localhost:8081/', browser: { lifecycle: { state: 'failed' } } } } } });
  assert.equal(parseStatus(closed).ready, false);
  assert.equal(parseStatus(closed).url, 'https://localhost:8081/');
  assert.deepEqual(parseStatus('not json'), { running: false, url: null, ready: false, browser: null });
});
