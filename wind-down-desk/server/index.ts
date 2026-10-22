/**
 * Starts the server: `npm run server` (API only, for `npm run dev`) or `npm start` (production: API + dist/).
 *   PORT (default 8787), HOST (default 127.0.0.1; 0.0.0.0 on Render, where RENDER=true is set by the platform).
 *   WDD_SERVE_DIST=1 (set by `npm start`) serves the Vite build from ./dist (or WDD_DIST_DIR).
 * Keys are read from the environment only (Render: Environment tab), never from a file.
 */
import { existsSync } from 'node:fs';
import { createApp } from './app.ts';
import { DEFAULT_DIST } from './static.ts';

const env = process.env;
const port = Number(env.PORT ?? 8787);
const host = env.HOST ?? (env.RENDER === 'true' ? '0.0.0.0' : '127.0.0.1');
const dist = env.WDD_DIST_DIR ?? DEFAULT_DIST;
const serveDist = env.WDD_SERVE_DIST === '1';
if (serveDist && !existsSync(dist)) {
  console.error(`[wdd-server] ${dist} is missing: run \`npm run build\` first.`);
  process.exit(1);
}
const { server, providers, visits } = createApp({ env, staticDir: serveDist ? dist : undefined });

server.listen(port, host, () => {
  console.log(`[wdd-server] http://${host}:${port}  agent: ${providers.agent.name}  stt: ${providers.stt.name}${serveDist ? '  + app (dist/)' : ''}`);
  if (providers.simulated.agent) {
    console.log('[wdd-server] No LLM_* / DEEPSEEK_* key in env: on-device simulated agent (no paid calls).');
  }
  if (providers.simulated.stt) {
    console.log('[wdd-server] No STT_* key in env: simulated speech-to-text (no paid calls).');
  }
  console.log(`[wdd-server] visit log: ${visits.enabled ? 'on' : 'off'}, owner export: ${visits.exportEnabled ? 'on' : 'off (WDD_VISITS_TOKEN not set)'}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
