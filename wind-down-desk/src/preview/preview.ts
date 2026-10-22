/**
 * The emulated preview, once the world exists (after installEmulator): the player mode built for the Mac play-tests
 * (src/dev/player.ts: seated camera, click a stone then a bowl, click the glass buttons, the lamp starts
 * dictation), an honest badge, and — since there is no passthrough room in an emulator — a night place in Full
 * immersion as soon as the desk is placed.
 */
import type { World } from '@iwsdk/core';
import { track } from '../visits.ts';

interface Wdd {
  state(): { placement: string | null };
  place(id: string): Promise<unknown>;
  immersion(level: 'table' | 'full'): void;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function badge(): void {
  const b = document.createElement('div');
  b.className = 'preview-badge';
  b.setAttribute('translate', 'no');
  b.setAttribute('role', 'note');
  const t = document.createElement('span');
  t.textContent = 'Emulated preview · best on Meta Quest 3';
  const exit = document.createElement('a');
  exit.textContent = 'Exit';
  const url = new URL(location.href);
  url.searchParams.delete('preview');
  exit.href = url.toString();
  b.append(t, exit);
  document.body.append(b);
}

export async function startPreview(world: World): Promise<void> {
  badge();
  track('landing', { kind: 'preview' }, 'landing:preview');
  const g = window as unknown as { __wdd?: Wdd };
  for (let i = 0; i < 100 && g.__wdd == null; i++) await wait(100);
  const { mountPlayer } = await import('../dev/player.ts');
  mountPlayer(world);
  // Once the desk lands (the emulator has no room, so it floats), go somewhere: a night place, fully immersive.
  for (;;) {
    await wait(400);
    const d = g.__wdd;
    const placed = d?.state().placement;
    if (d != null && (placed === 'table' || placed === 'floating')) {
      await d.place('moon-lake');
      await wait(1200);
      d.immersion('full');
      return;
    }
  }
}
