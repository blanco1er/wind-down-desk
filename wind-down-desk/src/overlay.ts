/**
 * 2D landing (browser tab before the headset session): the tray is the hero; one small glass bar with the name,
 * the memory line and one button. The button asks for the microphone first (a permission prompt is reliable here,
 * not inside the immersive session), then enters XR. The agent/voice status stays for screen readers only.
 * First visit: two glass cards instead of the button, "Talk with the lamp" / "Quiet evening" (touch only, the
 * microphone is never requested). The choice is remembered; a small link in the bar changes it.
 */
import { DefaultLoadingManager, VisibilityState, type World } from '@iwsdk/core';
import { mountNoXrCard } from './landing/no-xr.ts';
import { isComputer, type LandingPlan, type XrProbe } from './logic/xr-support.ts';
import { services } from './services.ts';
import { track } from './visits.ts';

export interface LandingState {
  probe: XrProbe;
  plan: LandingPlan;
  /** The IWER emulator was installed for "Preview on this screen". */
  emulated: boolean;
}

const DEMO_URL = String(import.meta.env.VITE_WDD_DEMO_URL ?? '');
const SHORT_URL = String(import.meta.env.VITE_WDD_SHORT_URL ?? '');

export function mountOverlay(world: World, landing: LandingState): void {
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

  // 22 Oct: no immersive session possible here (a phone, a laptop without a headset) → the "Made for Meta Quest"
  // card replaces the bar: never a button that fails. The emulated preview counts as a headset.
  const sessionMode = landing.emulated ? 'immersive-ar' : landing.plan.mode;
  if (!world.xrEnabled || sessionMode === 'none') {
    root.querySelector('.bar')?.setAttribute('hidden', '');
    mountNoXrCard(root, { plan: landing.plan, reason: landing.probe.api ? 'no-session' : 'no-webxr', demoUrl: DEMO_URL, shortUrl: SHORT_URL });
    world.visibilityState.subscribe((state) => root.classList.toggle('hidden', state !== VisibilityState.NonImmersive));
    return;
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
  const alert = mountAlert(root);
  const begin = async () => {
    alert.hide();
    button.disabled = true;
    button.textContent = 'Opening…';
    // A quiet evening never asks for the microphone (no permission prompt at all).
    if (!services.style.quiet) await services.voice.start();
    // Passthrough when the browser offers it (Quest), else full VR (a PC headset, Quest 2 without AR).
    world.launchXR(sessionMode === 'immersive-vr' ? ({ sessionMode: 'immersive-vr' } as Parameters<World['launchXR']>[0]) : undefined);
    watchLaunch(world, () => {
      button.disabled = false;
      button.textContent = 'Begin';
      track('landing', { kind: 'xr-failed' });
      alert.show(begin, isComputer(matchMedia('(pointer: fine)').matches, innerWidth) ? preview : null);
    });
    window.setTimeout(() => {
      button.disabled = false;
      button.textContent = 'Begin';
    }, 2500);
  };
  const preview = () => {
    const url = new URL(location.href);
    url.searchParams.set('preview', '1');
    location.assign(url.toString());
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

/**
 * IWSDK's launchXR only logs a refused session. Watch the request: once it is no longer pending and no session
 * exists, it failed (refused, NotSupportedError, a PC runtime without a headset) → onFail. Gives up after 60 s.
 */
function watchLaunch(world: World, onFail: () => void): void {
  const w = world as unknown as { session?: unknown; sessionRequestPending?: boolean };
  const t0 = performance.now();
  const tick = () => {
    if (w.session != null) return;
    if (w.sessionRequestPending !== true) {
      onFail();
      return;
    }
    if (performance.now() - t0 < 60_000) window.setTimeout(tick, 250);
  };
  window.setTimeout(tick, 250);
}

/** A clear message with an action when the immersive session could not open (never a silent return). */
function mountAlert(root: HTMLElement): { show(retry: () => void, preview: (() => void) | null): void; hide(): void } {
  const box = document.createElement('div');
  box.className = 'xr-alert';
  box.setAttribute('role', 'alert');
  box.setAttribute('translate', 'no');
  box.hidden = true;
  const title = document.createElement('p');
  title.className = 'xr-alert-title';
  title.textContent = 'The headset view did not open.';
  const body = document.createElement('p');
  body.className = 'xr-alert-body';
  body.textContent = 'Allow it when your browser asks, and check that your headset is on. On a phone or a computer without a headset, this experience needs a Meta Quest.';
  const actions = document.createElement('div');
  actions.className = 'xr-alert-actions';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'xr-alert-primary';
  retry.textContent = 'Try again';
  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'xr-alert-secondary';
  prev.textContent = 'Preview on this screen';
  actions.append(retry, prev);
  box.append(title, body, actions);
  root.prepend(box);
  let onRetry: (() => void) | null = null;
  let onPreview: (() => void) | null = null;
  retry.addEventListener('click', () => onRetry?.());
  prev.addEventListener('click', () => onPreview?.());
  return {
    show(r, p) {
      onRetry = r;
      onPreview = p;
      prev.hidden = p == null;
      box.hidden = false;
      retry.focus();
    },
    hide() {
      box.hidden = true;
    },
  };
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
