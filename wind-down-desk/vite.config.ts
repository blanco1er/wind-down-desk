/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { fileURLToPath } from 'node:url';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig } from 'vite';

const lucideLite = fileURLToPath(new URL('./src/vendor/lucide-lite.ts', import.meta.url));
const apiTarget = process.env.WDD_API_TARGET ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [iwsdkDev()],
  server: {
    host: '0.0.0.0',
    // WDD_PORT: another IWSDK project on this Mac also defaults to 8081.
    port: Number(process.env.WDD_PORT ?? 8081),
    strictPort: true,
    open: false,
    // Agent + voice server (npm run server). Missing server → on-device agent.
    proxy: { '/api': { target: apiTarget, changeOrigin: true } },
  },
  build: {
    outDir: 'dist',
    sourcemap: process.env.WDD_SOURCEMAP === '1',
    target: 'esnext',
    reportCompressedSize: true,
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
  // (three@0.185 vs app super-three@0.181). Duplicate Component classes break
  // instanceof checks → "Only pmndrs/uikit components can be added as children".
  resolve: {
    alias: [{ find: /^@pmndrs\/uikit-lucide$/u, replacement: lucideLite }],
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@drawcall/uikitml',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
});
