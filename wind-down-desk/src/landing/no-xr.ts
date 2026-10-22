/**
 * The landing card for a device that cannot open an immersive session (a phone, a laptop without a headset):
 * never a dead "Begin" button. It says where the experience lives (Meta Quest 3 / 3S), gives the address to type in
 * the Quest browser (short, readable, tap to copy), a QR code drawn here (src/logic/qr.ts, no service), the demo video
 * when one is configured (VITE_WDD_DEMO_URL; empty → hidden) and, on a computer, "Preview on this screen".
 */
import { encodeQr, qrPath } from '../logic/qr.ts';
import { shortAddress, type LandingPlan } from '../logic/xr-support.ts';
import { track } from '../visits.ts';

const SVG = 'http://www.w3.org/2000/svg';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

/** The QR code as an inline SVG (crisp at any size, dark modules on warm paper). */
export function qrSvg(text: string, label: string): SVGSVGElement {
  const { d, size } = qrPath(encodeQr(text));
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('shape-rendering', 'crispEdges');
  const bg = document.createElementNS(SVG, 'rect');
  bg.setAttribute('width', String(size));
  bg.setAttribute('height', String(size));
  bg.setAttribute('fill', '#f6efe5');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#17110d');
  svg.append(bg, path);
  return svg;
}

export interface NoXrOptions {
  plan: LandingPlan;
  /** Why the card is shown (for the visit log): no WebXR at all, or no immersive session. */
  reason: 'no-webxr' | 'no-session';
  demoUrl?: string;
  shortUrl?: string;
}

export function mountNoXrCard(landing: HTMLElement, options: NoXrOptions): HTMLElement {
  const address = shortAddress(location.href.split(/[?#]/u)[0], options.shortUrl);
  const qrTarget = `https://${address.replace(/\/+$/u, '')}/?ref=qr`;
  landing.classList.add('noxr');
  document.body.classList.add('noxr');
  track('landing', { kind: options.reason }, `landing:${options.reason}`);

  const card = el('section', 'quest-card');
  card.setAttribute('aria-labelledby', 'qc-title');
  card.setAttribute('translate', 'no');
  const text = el('div', 'qc-text');
  text.append(el('p', 'qc-eyebrow', 'Made for Meta Quest 3 and 3S'));
  const title = el('h2', 'qc-title', 'Wind-Down Desk');
  title.id = 'qc-title';
  text.append(title);
  text.append(el('p', 'qc-lede', 'A seated evening ritual on your real table. Say what is on your mind, sort it by hand, let it go.'));
  text.append(el('p', 'qc-step', 'In your headset, open the Browser and go to'));

  const addr = el('button', 'qc-address');
  addr.type = 'button';
  addr.setAttribute('aria-label', `Copy the address ${address}`);
  const addrText = el('span', 'qc-address-text', address);
  const addrHint = el('span', 'qc-address-hint', 'Copy');
  addr.append(addrText, addrHint);
  addr.addEventListener('click', () => {
    const done = () => {
      addrHint.textContent = 'Copied';
      window.setTimeout(() => (addrHint.textContent = 'Copy'), 1800);
    };
    try {
      void navigator.clipboard?.writeText(`https://${address}`).then(done, () => {});
    } catch {
      // Clipboard blocked: the address stays readable on screen.
    }
  });
  text.append(addr);

  const actions = el('div', 'qc-actions');
  if (options.plan.offerPreview) {
    const preview = el('button', 'qc-primary', 'Preview on this screen');
    preview.type = 'button';
    preview.addEventListener('click', () => {
      track('landing', { kind: 'preview-asked' }, 'landing:preview-asked');
      const url = new URL(location.href);
      url.searchParams.set('preview', '1');
      location.assign(url.toString());
    });
    actions.append(preview);
  }
  if (options.demoUrl != null && /^https:\/\//u.test(options.demoUrl)) {
    const demo = el('a', 'qc-secondary', 'Watch the demo');
    demo.href = options.demoUrl;
    demo.target = '_blank';
    demo.rel = 'noopener';
    actions.append(demo);
  }
  if (actions.childElementCount > 0) text.append(actions);
  if (options.plan.offerPreview) text.append(el('p', 'qc-note', 'The preview is emulated, with your mouse. It is best on Quest.'));
  card.append(text);

  const fig = el('figure', 'qc-qr');
  fig.append(qrSvg(qrTarget, `QR code for ${address}`));
  fig.append(el('figcaption', 'qc-qr-caption', 'Scan to keep the link'));
  card.append(fig);

  landing.append(card);
  return card;
}
