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
import { mountAccessPanel } from './landing/access-panel.ts';
import { probeXr } from './landing/xr-detect.ts';
import { planLanding } from './logic/xr-support.ts';
import { mountOverlay } from './overlay.ts';
import { PerfBeginSystem, PerfEndSystem } from './systems/perf-system.ts';
import { RitualSystem } from './systems/ritual-system.ts';
import { trackPage } from './visits.ts';
import { installGuard, watchContext } from './runtime-guard.ts';

// Anonymous visit steps (production build only; never words or voice: src/visits.ts).
trackPage();
// 26 Oct (safety nets): safe mode, memory floor, anonymous error reports (type + cleaned message) — before anything.
installGuard();
// Accessibility settings: reachable from the first second, before the scene is drawn (and by voice in the headset).
mountAccessPanel();

// The engraved stones and bowls are drawn with the shipped typeface: load it first (≤ 2.5 s). Meanwhile, ask the
// browser which immersive sessions it can open (22 Oct: a phone or a laptop never gets a dead "Begin" button).
// "Preview on this screen" (?preview=1, computer without a headset) installs the IWER emulator BEFORE the world.
const params = new URLSearchParams(location.search);
const planned = Promise.all([loadFonts(), probeXr()]).then(async ([, probe]) => {
  const plan = planLanding(probe, {
    finePointer: matchMedia('(pointer: fine)').matches,
    width: innerWidth,
    previewParam: params.get('preview') === '1',
  });
  let emulated = false;
  if (plan.startPreview) emulated = await import('./preview/emulator.ts').then((m) => m.installEmulator());
  return { probe, plan, emulated };
});
void planned
  .then(async (landing) => ({ landing, world: await World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions) }))
  .then(({ landing, world }) => {
  // A lost GPU context: reported, counted toward safe mode, said plainly, then a clean reload.
  watchContext(world.renderer.domElement, () => {
    const note = document.createElement('div');
    note.textContent = 'The display was interrupted. Coming back in a moment…';
    note.setAttribute('role', 'status');
    note.style.cssText = 'position:fixed;left:50%;top:24px;transform:translateX(-50%);padding:12px 18px;border-radius:14px;background:rgba(20,18,16,.86);color:#fff;font:15px system-ui;z-index:99';
    document.body.appendChild(note);
  });
  world
    .registerSystem(PerfBeginSystem, { priority: -100 })
    .registerSystem(RitualSystem, { priority: 10 })
    .registerSystem(PerfEndSystem, { priority: 100 });
  mountOverlay(world, landing);
  if (landing.emulated) void import('./preview/preview.ts').then((m) => m.startPreview(world));
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
