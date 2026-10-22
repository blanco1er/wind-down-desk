/**
 * 2D landing (browser tab before the headset session): the tray is the hero; one small glass bar with the name,
 * the memory line and one button. The button asks for the microphone first (a permission prompt is reliable here,
 * not inside the immersive session), then enters XR. The agent/voice status stays for screen readers only.
 * First visit: two glass cards instead of the button, "Talk with the lamp" / "Quiet evening" (touch only, the
 * microphone is never requested). The choice is remembered; a small link in the bar changes it.
 */
import { DefaultLoadingManager, VisibilityState, type World } from '@iwsdk/core';
import { services } from './services.ts';

export function mountOverlay(world: World): void {
  const root = document.getElementById('landing');
  const button = document.getElementById('begin') as HTMLButtonElement | null;
  const status = document.getElementById('status');
  const memory = document.getElementById('memory');
  if (root == null || button == null || status == null || memory == null) {
    markReady();
    return;
  }
  revealWhenDrawn();
  memory.textContent = services.memory.welcomeLine();

  void services.agent.init().then((s) => {
    status.textContent =
      s.mode === 'server'
        ? `Agent: ${s.agent}. Voice: ${s.stt}.`
        : 'The agent runs on this device. Voice needs the local server.';
  });

  if (!world.xrEnabled) {
    button.textContent = 'Open on Meta Quest';
    button.title = 'Open this page in the Meta Quest browser';
    button.disabled = true;
  }

  const choose = document.getElementById('choose');
  const styleLink = document.getElementById('style') as HTMLButtonElement | null;
  const sync = () => {
    const style = services.style.get();
    const first = style == null && world.xrEnabled;
    root.classList.toggle('first', first);
    if (choose != null) choose.hidden = !first;
    button.hidden = first;
    if (styleLink != null) {
      styleLink.hidden = first || !world.xrEnabled;
      styleLink.textContent = style === 'quiet' ? 'Quiet evening' : 'Talk with the lamp';
      styleLink.title = style === 'quiet' ? 'Touch only, no microphone. Click to talk with the lamp instead.' : 'Click for a quiet evening: touch only, no microphone.';
    }
  };
  sync();
  const begin = async () => {
    button.disabled = true;
    button.textContent = 'Opening…';
    // A quiet evening never asks for the microphone (no permission prompt at all).
    if (!services.style.quiet) await services.voice.start();
    world.launchXR();
    window.setTimeout(() => {
      button.disabled = false;
      button.textContent = 'Begin';
    }, 2500);
  };
  button.addEventListener('click', () => void begin());
  choose?.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest('button');
    const style = card?.dataset.style;
    if (style !== 'talk' && style !== 'quiet') return;
    services.style.set(style);
    sync();
    void begin();
  });
  styleLink?.addEventListener('click', () => {
    services.style.set(services.style.quiet ? 'talk' : 'quiet');
    sync();
  });
  services.style.onChange(sync);

  world.visibilityState.subscribe((state) => {
    root.classList.toggle('hidden', state !== VisibilityState.NonImmersive);
  });
}

function markReady(): void {
  if (document.body.classList.contains('ready')) return;
  document.body.classList.add('ready');
  window.dispatchEvent(new Event('wdd:landing-ready'));
}

/**
 * Fades the scene in once the tray is drawn with its textures (no loading flash, no half-rendered tray):
 * at least a few frames, and the default loader idle. Never waits more than 4 s.
 */
function revealWhenDrawn(): void {
  let loaded = 0;
  let total = 0;
  const previous = DefaultLoadingManager.onProgress;
  DefaultLoadingManager.onProgress = (url, l, t) => {
    loaded = l;
    total = t;
    previous?.(url, l, t);
  };
  const t0 = performance.now();
  let frames = 0;
  const check = () => {
    frames++;
    const idle = loaded >= total;
    const elapsed = performance.now() - t0;
    if ((idle && frames >= 8 && elapsed > 350) || elapsed > 4000) {
      markReady();
      return;
    }
    requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}
