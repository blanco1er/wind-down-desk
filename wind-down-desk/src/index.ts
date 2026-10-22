/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Wind-Down Desk additions are MIT-licensed as well (see LICENSE).
 */

import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { loadFonts } from './desk/fonts.ts';
import { mountOverlay } from './overlay.ts';
import { PerfBeginSystem, PerfEndSystem } from './systems/perf-system.ts';
import { RitualSystem } from './systems/ritual-system.ts';
import { trackPage, track } from './visits.ts';

// Anonymous visit steps (production build only; never words or voice: src/visits.ts).
trackPage();
addEventListener('error', () => track('client-error', { where: 'window' }, 'client-error'));
addEventListener('unhandledrejection', () => track('client-error', { where: 'promise' }, 'client-rejection'));

// The engraved stones and bowls are drawn with the shipped typeface: load it first (≤ 2.5 s).
void loadFonts()
  .then(() => World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions))
  .then((world) => {
  world
    .registerSystem(PerfBeginSystem, { priority: -100 })
    .registerSystem(RitualSystem, { priority: 10 })
    .registerSystem(PerfEndSystem, { priority: 100 });
  mountOverlay(world);
  // Emulator-only film set (photographic room + table) for recording the demo; not in production builds.
  if (import.meta.env.DEV) {
    void import('./desk/film-set.ts').then((m) => m.mountFilmSet(world));
    // Play-test (npm run playtest, or ?player=1): player mode (mouse, seated camera, no IWER dev chrome) and the
    // French play-test console. `?dev=1` keeps the raw IWER developer UI. Emulator only.
    const params = new URLSearchParams(location.search);
    if (import.meta.env.VITE_WDD_PLAYTEST === '1' || params.get('player') === '1') {
      void Promise.all([import('./dev/playtest.ts'), import('./dev/player.ts')]).then(([pt, pl]) => {
        const tryMount = () => {
          const g = window as unknown as { __wdd?: unknown; IWER_DEVICE?: unknown };
          if (g.__wdd == null || g.IWER_DEVICE == null) return void window.setTimeout(tryMount, 300);
          const player = pl.playerModeWanted() ? pl.mountPlayer(world) : null;
          pt.mountPlaytest(player);
        };
        tryMount();
      });
    }
  }
});
