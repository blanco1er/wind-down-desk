/**
 * Canvas typography for the desk: stone labels (atlas), the labels engraved in
 * the tray, the caption, the plan card and the buttons. Drawn only when
 * content changes.
 *
 * Sizes (visionOS HIG: default 17 pt, minimum 12 pt, bolder weights; see
 * design-tokens.ts for the point → metre conversion and the Quest factor):
 * - stone text 10–15 mm at ~0.6 m      ≈ 17–25 pt equivalent
 * - bin names engraved on the bowl fronts 15.5 mm at ~0.55 m ≈ 28 pt equivalent
 * - caption 21 mm / 15 mm at ~0.75 m   ≈ 28 / 20 pt equivalent
 */
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, SRGBColorSpace } from '@iwsdk/core';
import type { DeskLayout } from '../logic/desk-layout.ts';
import { wrapLines } from '../logic/text.ts';
import { DS, FONT } from './design-tokens.ts';

export { FONT };

export function canvasTexture(canvas: HTMLCanvasElement, anisotropy = 4, mipmaps = true): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.minFilter = mipmaps ? LinearMipmapLinearFilter : LinearFilter;
  texture.generateMipmaps = mipmaps;
  return texture;
}

/**
 * Pixel density of the glass UI canvases (caption, plan card, buttons, menus). 1 on a headset (budget: TECH.md, home
 * textures ≤ 16 MB). 2 in the desktop play-test player mode (dev server + emulator + `npm run playtest` or ?player=1,
 * not ?dev=1) and in the public emulated preview on a computer: a Retina screen shows these panels larger than a
 * Quest eye does. Never 2 on a headset.
 */
export const TEXT_SCALE: number = (() => {
  if (typeof window === 'undefined') return 1;
  const params = new URLSearchParams(window.location.search);
  // 29 Oct (owner, live site on a Retina Mac: "the text is pixelated, not sharp"): the public emulated preview
  // (?preview=1 on a computer, never in the Quest Browser) gets the play-test density too. Read from the URL:
  // this module is evaluated before the emulator is installed.
  if (params.get('preview') === '1' && !/OculusBrowser|Quest/i.test(navigator.userAgent)) return 2;
  if (!import.meta.env.DEV) return 1;
  const player = (import.meta.env.VITE_WDD_PLAYTEST === '1' || params.get('player') === '1') && params.get('dev') !== '1' && params.get('player') !== '0';
  const emulator = (window as unknown as { IWER_DEVICE?: unknown }).IWER_DEVICE != null;
  return player && emulator ? 2 : 1;
})();

/** A UI canvas of `w × h` logical pixels, drawn at TEXT_SCALE. */
function sized(canvas: HTMLCanvasElement, w: number, h: number, sx = 1, sy = 1): CanvasRenderingContext2D {
  canvas.width = Math.round(w * TEXT_SCALE);
  canvas.height = Math.round(h * TEXT_SCALE);
  const ctx = ctx2d(canvas);
  ctx.setTransform(TEXT_SCALE * sx, 0, 0, TEXT_SCALE * sy, 0, 0);
  return ctx;
}

/** UI texture: at desktop density it is minified, so it gets mipmaps and stronger anisotropy. */
function uiTexture(canvas: HTMLCanvasElement): CanvasTexture {
  return TEXT_SCALE > 1 ? canvasTexture(canvas, 8, true) : canvasTexture(canvas, 4, false);
}

function ctx2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (ctx == null) {
    throw new Error('2D canvas unavailable');
  }
  return ctx;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/**
 * Engraving mask, drawn opaque so the three channels stay independent:
 * R = letter shape (sharp), G = softened shape (the height field: its slope
 * gives the groove walls), B = wide soft shape (cavity occlusion around the
 * letters). Black elsewhere. `draw` only issues fillText calls.
 */
function engrave(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, draw: () => void, soft = 2.2, wide = 6): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.fillStyle = '#000000';
  ctx.fillRect(x, y, w, h);
  ctx.globalCompositeOperation = 'lighter';
  const passes: Array<[string, number]> = [
    ['#00ff00', soft],
    ['#0000ff', wide],
    ['#ff0000', 0],
  ];
  for (const [color, blur] of passes) {
    ctx.filter = blur > 0 ? `blur(${blur}px)` : 'none';
    ctx.fillStyle = color;
    draw();
  }
  ctx.restore();
}

/** Splits words into `n` lines minimising the widest line (n ≤ 3, short titles). */
function balance(words: string[], n: number, width: (line: string) => number): string[] {
  if (n <= 1 || words.length <= 1) {
    return [words.join(' ')];
  }
  let best: string[] = [words.join(' ')];
  let bestW = Infinity;
  const cuts = (start: number, left: number): number[][] => {
    if (left === 0) return [[]];
    const out: number[][] = [];
    for (let i = start + 1; i <= words.length - left; i++) {
      for (const rest of cuts(i, left - 1)) out.push([i, ...rest]);
    }
    return out;
  };
  for (const c of cuts(0, Math.min(n, words.length) - 1)) {
    const bounds = [0, ...c, words.length];
    const lines = bounds.slice(0, -1).map((b, i) => words.slice(b, bounds[i + 1]).join(' '));
    // Never leave a short function word alone on a line.
    const penalty = lines.some((l) => l.length <= 3) ? 1.25 : 1;
    const w = Math.max(...lines.map(width)) * penalty;
    if (w < bestW) {
      bestW = w;
      best = lines;
    }
  }
  return best;
}

// --------------------------------------------------------------------------
// Stone atlas: 4 × 4 cells of 320 × 196 px mapped on a 7.2 × 4.4 cm area.
// --------------------------------------------------------------------------

/** Engraved type weight (Manrope semibold: open, humanist-modern, legible when cut). */
const STONE_WEIGHT = 620;

export class StoneAtlas {
  readonly canvas: HTMLCanvasElement;
  readonly texture: CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly free: number[] = [];
  static readonly COLS = 4;
  static readonly ROWS = 4;
  static readonly CELL_W = 384;
  static readonly CELL_H = 245;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = StoneAtlas.COLS * StoneAtlas.CELL_W;
    this.canvas.height = StoneAtlas.ROWS * StoneAtlas.CELL_H;
    this.ctx = ctx2d(this.canvas);
    this.texture = canvasTexture(this.canvas, 8);
    this.texture.colorSpace = NoColorSpace;
    for (let i = StoneAtlas.COLS * StoneAtlas.ROWS - 1; i >= 0; i--) {
      this.free.push(i);
    }
  }

  /** Draws a label into a free cell; returns the cell index and its UV rect. */
  allocate(text: string, twoLines = false): { cell: number; uv: [number, number, number, number] } {
    const cell = this.free.pop() ?? 0;
    this.draw(cell, text, twoLines);
    return { cell, uv: this.uv(cell) };
  }

  release(cell: number): void {
    if (!this.free.includes(cell)) {
      this.free.push(cell);
    }
  }

  uv(cell: number): [number, number, number, number] {
    const { CELL_W, CELL_H, COLS } = StoneAtlas;
    const px = (cell % COLS) * CELL_W;
    const py = Math.floor(cell / COLS) * CELL_H;
    const W = this.canvas.width;
    const H = this.canvas.height;
    return [px / W, 1 - (py + CELL_H) / H, CELL_W / W, CELL_H / H];
  }

  /** `twoLines`: always two balanced, centred lines (the Release stone: "The meeting / with Paul"). */
  private draw(cell: number, text: string, twoLines = false): void {
    const { CELL_W, CELL_H, COLS } = StoneAtlas;
    const px = (cell % COLS) * CELL_W;
    const py = Math.floor(cell / COLS) * CELL_H;
    const ctx = this.ctx;
    // v7: 40.9 px per cm on a 9.4 × 6 cm label (owner's reference: large words, 2–3 centred lines).
    // Two balanced lines first (≈ 15–17 mm type), one line for a single short word, three for long titles.
    const maxW = CELL_W * 0.8;
    const words = text.replace(/\s+/gu, ' ').trim().split(' ');
    let lines: string[] = [text];
    let size = 42;
    const plans: Array<[number, number, number]> = twoLines && words.length > 1 ? [[2, 70, 36]] : words.length === 1 ? [[1, 72, 52]] : [[2, 66, 50], [3, 56, 44]];
    for (const [n, max, min] of plans) {
      const candidate = balance(words, n, (l) => {
        ctx.font = `${STONE_WEIGHT} ${max}px ${FONT}`;
        return ctx.measureText(l).width;
      });
      let s = max;
      for (; s > min; s -= 2) {
        ctx.font = `${STONE_WEIGHT} ${s}px ${FONT}`;
        if (candidate.every((l) => ctx.measureText(l).width <= maxW)) {
          break;
        }
      }
      ctx.font = `${STONE_WEIGHT} ${s}px ${FONT}`;
      lines = candidate;
      size = s;
      if (candidate.every((l) => ctx.measureText(l).width <= maxW)) {
        break;
      }
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Cut letters read better slightly open (engraving closes counters visually).
    ctx.letterSpacing = `${Math.round(size * 0.02)}px`;
    const lineH = size * (lines.length > 2 ? 1.04 : 1.1);
    const top = py + CELL_H / 2 - ((lines.length - 1) * lineH) / 2 + size * 0.06;
    engrave(ctx, px, py, CELL_W, CELL_H, () => lines.forEach((line, i) => ctx.fillText(line, px + CELL_W / 2, top + i * lineH, maxW)));
    ctx.letterSpacing = '0px';
    this.texture.needsUpdate = true;
  }
}

// --------------------------------------------------------------------------
// Engraved bin names on the bowl fronts: three cells side by side.
// v7 (owner's reference): large, bold, dark ink-filled names centred on the
// front wall. Each cell spans ±0.64 rad of a 10.4 cm bowl (13.3 cm of arc)
// and 3.6 cm of height (≈ 51 / 58 px per cm): cap height ≈ 19 mm, weight 760,
// read at a glance from the seated position (≈ 0.55 m).
// --------------------------------------------------------------------------

export function drawEngravedLabels(layout: DeskLayout): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 208;
  const ctx = ctx2d(canvas);
  const cell = canvas.width / layout.bins.length;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  layout.bins.forEach((bin, i) => {
    let size = 156;
    ctx.letterSpacing = '2px';
    ctx.font = `680 ${size}px ${FONT}`;
    while (ctx.measureText(bin.label).width > cell * 0.86 && size > 100) {
      size -= 2;
      ctx.font = `680 ${size}px ${FONT}`;
    }
    // Optical centre on the cap height (descenders of "g" may dip below).
    const m = ctx.measureText('H');
    const baseline = canvas.height * 0.5 + (m.actualBoundingBoxAscent ?? size * 0.72) * 0.5;
    engrave(ctx, cell * i, 0, cell, canvas.height, () => ctx.fillText(bin.label, cell * (i + 0.5), baseline), 2.4, 6);
  });
  const texture = canvasTexture(canvas, 8);
  texture.colorSpace = NoColorSpace;
  return texture;
}

// --------------------------------------------------------------------------
// Glass surfaces (visionOS-style): neutral translucent fill, light top edge.
// --------------------------------------------------------------------------

function glass(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  // Soft ambient shadow under the pane (depth cue, not a text shadow).
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.34)';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 6;
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = 'rgba(0, 0, 0, 1)';
  ctx.fill();
  ctx.restore();
  // Keep only the shadow outside the pane, then lay the glass.
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.restore();
  const fill = ctx.createLinearGradient(0, y, 0, y + h);
  fill.addColorStop(0, DS.glass.fillTop);
  fill.addColorStop(1, DS.glass.fillBottom);
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  // Light falls on the glass from above: a faint inner glow at the top.
  const light = ctx.createRadialGradient(x + w * 0.35, y - h * 0.4, 0, x + w * 0.35, y - h * 0.4, Math.max(w, h) * 0.9);
  light.addColorStop(0, 'rgba(255, 244, 228, 0.10)');
  light.addColorStop(1, 'rgba(255, 244, 228, 0)');
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = light;
  ctx.fill();
  const edge = ctx.createLinearGradient(0, y, 0, y + h);
  edge.addColorStop(0, DS.glass.edgeTop);
  edge.addColorStop(0.4, DS.glass.edgeBottom);
  edge.addColorStop(1, 'rgba(255, 250, 240, 0.1)');
  roundRect(ctx, x + 1.5, y + 1.5, w - 3, h - 3, r - 1.5);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 3;
  ctx.stroke();
}

function setType(ctx: CanvasRenderingContext2D, style: { size: number; weight: number }, scale = 1): void {
  ctx.font = `${style.weight} ${Math.round(style.size * scale)}px ${FONT}`;
  ctx.letterSpacing = '0px';
}

/** Instruction line above the desk: one primary sentence, an optional secondary line. */
export class CaptionCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly texture: CanvasTexture;
  /** Last drawn pill, fractions of the canvas (0..1, y from the top). */
  box = { x0: 0, x1: 1, y0: 0, y1: 1 };
  private readonly ctx: CanvasRenderingContext2D;
  private last = '';
  private readonly w: number;
  private readonly h: number;

  /** 1536 × 384 px on a 0.72 × 0.18 m quad (2133 px/m): room for two lines and a two-line note. */
  constructor(width = 1536, height = 384) {
    this.canvas = document.createElement('canvas');
    this.w = width;
    this.h = height;
    this.ctx = sized(this.canvas, width, height);
    this.texture = uiTexture(this.canvas);
  }

  /** Returns false when nothing changed (no texture upload). */
  draw(text: string, sub = ''): boolean {
    const key = `${text}|${sub}`;
    if (key === this.last) {
      return false;
    }
    this.last = key;
    const { ctx } = this;
    const W = this.w;
    const H = this.h;
    ctx.clearRect(0, 0, W, H);
    // 24 Oct (Talk it through): a longer sentence of the lamp gets three smaller lines rather than an ellipsis.
    const long = text.length > 76;
    const maxLines = long ? 3 : 2;
    // Primary: 52 px ≈ 24 mm. Secondary: 32 px ≈ 15 mm.
    let size = long ? 46 : 56;
    // The small line first: its width sets the panel's.
    const subSize = 34;
    ctx.font = `500 ${subSize}px ${FONT}`;
    // 29 Oct (owner: the title broke at 36 characters in mid-panel while the small line ran to the edge, a lone word
    // under it): both are cut by their real width on the panel, into lines of close lengths, and the title takes the
    // number of lines that brings it closest to the small line's width.
    const avail = W - 180;
    const subWords = sub.replace(/\s+/gu, ' ').trim().split(' ');
    const subMeasure = (l: string) => ctx.measureText(l).width;
    const subFull = sub.length > 0 ? subMeasure(sub) : 0;
    const subLines = sub.length === 0 ? [] : subFull <= Math.min(avail, 1120) ? [sub] : subFull > avail * 2 ? wrapLines(sub, 60, 2) : balance(subWords, 2, subMeasure);
    const subW = subLines.length > 0 ? Math.max(...subLines.map(subMeasure)) : 0;
    const words = text.replace(/\s+/gu, ' ').trim().split(' ');
    ctx.font = `600 ${size}px ${FONT}`;
    const measure = (l: string) => ctx.measureText(l).width;
    const full = measure(words.join(' '));
    const target = subW > 0 ? Math.max(subW, 560) : Math.min(avail, 820);
    let lines: string[];
    if (full > avail * maxLines) {
      // More than fits: the old cut, with its ellipsis.
      lines = wrapLines(text, long ? 54 : 36, maxLines);
    } else {
      let best: string[] = [words.join(' ')];
      let bestScore = Infinity;
      for (let n = 1; n <= maxLines; n++) {
        const cand = n === 1 ? [words.join(' ')] : balance(words, n, measure);
        const w = Math.max(...cand.map(measure));
        if (w > avail && n < maxLines) continue;
        // Close to the target width; a little wider than the small line is fine, much narrower leaves a void.
        const score = Math.abs(w - target) / target + (n - 1) * 0.12;
        if (score < bestScore) {
          bestScore = score;
          best = cand;
        }
      }
      lines = best;
    }
    while (size > (long ? 34 : 38) && lines.some((l) => ctx.measureText(l).width > avail)) {
      size -= 2;
      ctx.font = `600 ${size}px ${FONT}`;
    }
    const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
    // v7 (owner's reference): a left-aligned two-level panel: the instruction, then a quieter line
    // (what you just said, in quotes, or a hint), separated by air rather than a rule.
    const lineH = size * 1.2;
    const subGap = subLines.length > 0 ? subSize * 0.9 : 0;
    const subH = subLines.length > 0 ? subSize * 1.3 * subLines.length : 0;
    const padX = 62;
    const padY = 40;
    const boxW = Math.min(W - 60, Math.max(textW, subW, 560) + padX * 2);
    const boxH = Math.min(H - 40, lines.length * lineH + subGap + subH + padY * 2);
    const x = (W - boxW) / 2;
    const y = (H - boxH) / 2 - 8;
    // The pill actually drawn, as fractions of the canvas (overlap tests: the canvas is wider than the pill).
    this.box = { x0: x / W, x1: (x + boxW) / W, y0: y / H, y1: (y + boxH) / H };
    glass(ctx, x, y, boxW, boxH, Math.min(boxH / 2, 44));
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${size}px ${FONT}`;
    ctx.fillStyle = DS.text.primary;
    lines.forEach((l, i) => ctx.fillText(l, x + padX, y + padY + lineH * (i + 0.5)));
    if (subLines.length > 0) {
      ctx.font = `500 ${subSize}px ${FONT}`;
      ctx.fillStyle = DS.text.secondary;
      const top = y + padY + lines.length * lineH + subGap;
      subLines.forEach((l, i) => ctx.fillText(l, x + padX, top + subSize * 1.3 * (i + 0.5)));
    }
    this.texture.needsUpdate = true;
    return true;
  }
}

export interface CardContent {
  title: string;
  subtitle: string;
  rows: Array<{ time: string; title: string; detail: string }>;
  footer: string;
  accent: string;
}

/** Plan / morning sheet: title, subtitle, a list with separators, a quiet footer. */
export class CardCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly texture: CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly w: number;
  private readonly h: number;

  /** 1152 × 760 px on a 0.52 × 0.343 m quad (2215 px/m). */
  constructor(width = 1152, height = 760) {
    this.canvas = document.createElement('canvas');
    this.w = width;
    this.h = height;
    this.ctx = sized(this.canvas, width, height);
    this.texture = uiTexture(this.canvas);
  }

  draw(content: CardContent): void {
    const { ctx } = this;
    const W = this.w;
    const H = this.h;
    const m = 24;
    const pad = 72;
    ctx.clearRect(0, 0, W, H);
    glass(ctx, m, m, W - 2 * m, H - 2 * m, 60);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    setType(ctx, DS.type.title);
    ctx.fillStyle = DS.text.primary;
    ctx.fillText(content.title, pad, 136, W - pad * 2);
    setType(ctx, DS.type.callout);
    ctx.fillStyle = DS.text.secondary;
    ctx.fillText(content.subtitle, pad, 190, W - pad * 2);

    const top = 232;
    const rowH = 128;
    // No times on the page (the journal): the rows start at the left edge, not after an empty time column.
    const col = content.rows.some((r) => r.time.length > 0) ? 168 : 0;
    content.rows.slice(0, 3).forEach((row, i) => {
      const y = top + i * rowH;
      ctx.fillStyle = DS.glass.separator;
      ctx.fillRect(pad, y, W - pad * 2, 2);
      ctx.font = `600 ${DS.type.headline.size}px ${FONT}`;
      ctx.fillStyle = content.accent;
      ctx.fillText(row.time, pad, y + 60);
      ctx.fillStyle = DS.text.primary;
      ctx.fillText(row.title, pad + col, y + 60, W - pad * 2 - col);
      setType(ctx, DS.type.footnote, 1.05);
      ctx.fillStyle = DS.text.secondary;
      ctx.fillText(row.detail, pad + col, y + 102, W - pad * 2 - col);
    });
    if (content.footer.length > 0) {
      setType(ctx, DS.type.footnote, 1.05);
      ctx.fillStyle = DS.text.tertiary;
      ctx.fillText(content.footer, pad, H - m - 46, W - pad * 2);
    }
    this.texture.needsUpdate = true;
  }
}

/**
 * Capsule button (rounded shape: easier to target with eyes and hands).
 * Prominent = lamp-coloured fill with dark text; standard = glass.
 * Hover is a separate shader effect (light + lift + scale).
 * `width` (canvas px, height stays 208): a narrower capsule for short replies; the mesh's x scale must match (width / 640).
 */
export function drawButton(label: string, accent: string, prominent: boolean, width = 640): CanvasTexture {
  const canvas = document.createElement('canvas');
  const ctx = sized(canvas, width, 208);
  if (prominent) {
    roundRect(ctx, 8, 8, width - 16, 192, 96);
    const fill = ctx.createLinearGradient(0, 8, 0, 200);
    fill.addColorStop(0, '#f8d39c');
    fill.addColorStop(1, accent);
    ctx.fillStyle = fill;
    ctx.fill();
    roundRect(ctx, 9.5, 9.5, width - 19, 189, 94.5);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 3;
    ctx.stroke();
  } else {
    glass(ctx, 8, 8, width - 16, 192, 96);
  }
  ctx.font = `600 ${Math.round(DS.type.headline.size * 1.32)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = prominent ? 'rgba(36, 26, 16, 0.94)' : DS.text.primary;
  ctx.fillText(label, width / 2, 108);
  return uiTexture(canvas);
}

/**
 * A word to touch (quiet evening: Unload topics, Release stones, Write…): one centred word on a glass capsule,
 * 15.5 × 4.6 cm, text ≈ 16 mm em (≈ 29 pt at 55 cm, well above the visionOS 17 pt body). Drawn on a 768 × 228 grid at
 * half resolution (0.17 MB each on a headset), only while the grid is open.
 */
/** Width ratio of a "wide" chip (a suggestion bubble spanning two word columns, 32 cm instead of 15.5). */
export const WIDE_CHIP = 2.065;

export function drawWordChip(label: string, dim: boolean, accent: boolean, wide = false): CanvasTexture {
  const canvas = document.createElement('canvas');
  const W = wide ? Math.round(768 * WIDE_CHIP) : 768;
  const ctx = sized(canvas, W / 2, 114, 0.5, 0.5);
  if (accent) {
    roundRect(ctx, 8, 8, W - 16, 212, 106);
    const fill = ctx.createLinearGradient(0, 8, 0, 220);
    fill.addColorStop(0, '#f8d39c');
    fill.addColorStop(1, DS.accent.lamp);
    ctx.fillStyle = fill;
    ctx.fill();
  } else {
    glass(ctx, 8, 8, W - 16, 212, 106);
  }
  ctx.font = `${wide ? 500 : 600} ${wide ? (label.length > 30 ? 66 : 74) : label.length > 16 ? 62 : 78}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // A word already used stays readable (≈ 62 % white) with a small check before it.
  ctx.fillStyle = accent ? 'rgba(36, 26, 16, 0.94)' : dim ? 'rgba(255, 255, 255, 0.62)' : DS.text.primary;
  const w = ctx.measureText(label).width;
  const x = dim ? W / 2 + 26 : W / 2;
  ctx.fillText(label, x, 118, W - 128);
  if (dim) {
    const cx = x - Math.min(w, 640) / 2 - 44;
    ctx.strokeStyle = 'rgba(244, 194, 126, 0.85)';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 16, 118);
    ctx.lineTo(cx - 4, 131);
    ctx.lineTo(cx + 18, 102);
    ctx.stroke();
  }
  return uiTexture(canvas);
}

/**
 * "Places" ornament next to the lamp: a small glass capsule with a horizon
 * glyph (a crescent over a line), sentence-case label. 4.4 cm tall target.
 */
export function drawOrnament(label: string, open: boolean, glyph: 'horizon' | 'voice' | 'muted' | 'rituals' | 'finish' | 'settings' = 'horizon'): CanvasTexture {
  const canvas = document.createElement('canvas');
  let ctx = sized(canvas, 512, 256);
  glass(ctx, 10, 10, 492, 236, 118);
  if (open) {
    roundRect(ctx, 10, 10, 492, 236, 118);
    ctx.fillStyle = 'rgba(244, 194, 126, 0.22)';
    ctx.fill();
  }
  ctx.strokeStyle = DS.text.primary;
  ctx.fillStyle = DS.text.primary;
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (glyph === 'rituals') {
    // A small cairn: three balanced stones.
    ctx.beginPath();
    ctx.ellipse(123, 168, 46, 15, 0, 0, Math.PI * 2);
    ctx.ellipse(126, 132, 33, 13, -0.08, 0, Math.PI * 2);
    ctx.ellipse(121, 101, 21, 11, 0.1, 0, Math.PI * 2);
    ctx.fill();
  } else if (glyph === 'finish') {
    // A soft check in a ring: "done, gently".
    ctx.beginPath();
    ctx.arc(123, 134, 42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(102, 136);
    ctx.lineTo(118, 152);
    ctx.lineTo(146, 118);
    ctx.stroke();
  } else if (glyph === 'settings') {
    // 29 Oct: Settings — a gear of eight rounded teeth around an open hub.
    const cx = 123;
    const cy = 134;
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a0 = (i / 16) * Math.PI * 2;
      const r = i % 2 === 0 ? 44 : 33;
      ctx.arc(cx, cy, r, a0, a0 + Math.PI / 8);
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cy, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  } else if (glyph === 'horizon') {
    // A horizon line with a rising crescent.
    ctx.beginPath();
    ctx.moveTo(78, 162);
    ctx.lineTo(168, 162);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(123, 118, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(138, 106, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  } else {
    // A speaker centred in the same 78–168 icon box as the other glyphs; two sound arcs when the sound is on,
    // one clean slash across the whole speaker when muted (SF Symbols' speaker.slash), never a cross by the word.
    // Drawn on its own layer so the slash can cut a clean gap through the speaker, not through the glass.
    const layer = document.createElement('canvas');
    const main = ctx;
    ctx = sized(layer, 512, 256);
    ctx.strokeStyle = DS.text.primary;
    ctx.fillStyle = DS.text.primary;
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(84, 118);
    ctx.lineTo(102, 118);
    ctx.lineTo(126, 96);
    ctx.lineTo(126, 172);
    ctx.lineTo(102, 150);
    ctx.lineTo(84, 150);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(130, 134, 20, -0.8, 0.8);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(130, 134, 37, -0.78, 0.78);
    ctx.stroke();
    if (glyph === 'muted') {
      // Cut a gap along the slash, then draw the slash: it reads on any glass behind it.
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = 26;
      ctx.beginPath();
      ctx.moveTo(78, 90);
      ctx.lineTo(170, 178);
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      ctx.moveTo(78, 90);
      ctx.lineTo(170, 178);
      ctx.stroke();
    }
    main.save();
    main.setTransform(1, 0, 0, 1, 0, 0);
    main.drawImage(layer, 0, 0);
    main.restore();
    ctx = main;
  }
  // 29 Oct: the label shrinks to its room ("Settings" is wider than "Places"): never squeezed, never past the glass.
  let size = 76;
  ctx.font = `600 ${size}px ${FONT}`;
  while (size > 56 && ctx.measureText(label).width > 270) {
    size -= 2;
    ctx.font = `600 ${size}px ${FONT}`;
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 196, 134);
  return uiTexture(canvas);
}

/**
 * 29 Oct (owner: "it must be obvious it switches from one mode to the other"): the immersion capsule at the end of
 * the bottom row, two segments side by side — « ◠ Mixed | ● Full » — 0.132 × 0.044 m (canvas 768 × 256). The active
 * mode is filled in lamp colour, the other is clear glass; each has its own glyph (an arch onto your room, a full
 * disc) and its word. `pulse` (0..1) brightens the edge for the one-time hint.
 */
export function drawImmersionOrnament(full: boolean, pulse = 0): CanvasTexture {
  const canvas = document.createElement('canvas');
  const ctx = sized(canvas, 768, 256);
  glass(ctx, 10, 10, 748, 236, 118);
  if (pulse > 0) {
    roundRect(ctx, 12, 12, 744, 232, 116);
    ctx.strokeStyle = `rgba(255, 222, 170, ${0.35 + 0.5 * pulse})`;
    ctx.lineWidth = 6;
    ctx.stroke();
  }
  // The active half, filled (an inner capsule with a 14 px margin).
  roundRect(ctx, full ? 384 : 24, 24, 360, 208, 104);
  ctx.fillStyle = DS.accent.lamp;
  ctx.fill();
  const seg = (x0: number, label: string, active: boolean, glyph: 'arch' | 'disc') => {
    const ink = active ? 'rgba(36, 26, 16, 0.94)' : DS.text.primary;
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const cx = x0 + 86;
    const cy = 128;
    if (glyph === 'arch') {
      ctx.beginPath();
      ctx.moveTo(cx - 24, cy + 30);
      ctx.lineTo(cx - 24, cy - 2);
      ctx.arc(cx, cy - 2, 24, Math.PI, 0);
      ctx.lineTo(cx + 24, cy + 30);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 38, cy + 32);
      ctx.lineTo(cx + 38, cy + 32);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, 32, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = `600 64px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x0 + 138, 134, 200);
  };
  seg(24, 'Mixed', !full, 'arch');
  seg(384, 'Full', full, 'disc');
  return uiTexture(canvas);
}

/** 29 Oct: one row of the Settings panel (the ritual rows' glass): glyph, name, and its state on the right. */
export type SettingId = 'volume' | 'voice' | 'text' | 'contrast' | 'gaze' | 'recenter' | 'forget' | 'close';
export function drawSettingChip(id: SettingId, name: string, state: string | null, on: boolean): CanvasTexture {
  const { canvas, ctx } = chipCanvas();
  glass(ctx, 10, 10, 748, 204, 102);
  if (on) {
    roundRect(ctx, 10, 10, 748, 204, 102);
    ctx.fillStyle = 'rgba(244, 194, 126, 0.2)';
    ctx.fill();
  }
  const cx = 112;
  const cy = 112;
  const g = ctx.createRadialGradient(cx - 18, cy - 22, 6, cx, cy, 66);
  g.addColorStop(0, 'rgba(92, 70, 52, 0.95)');
  g.addColorStop(1, 'rgba(40, 30, 24, 0.95)');
  ctx.beginPath();
  ctx.arc(cx, cy, 66, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 252, 246, 0.42)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 236, 206, 0.95)';
  ctx.strokeStyle = 'rgba(255, 236, 206, 0.95)';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (id === 'volume') {
    // Two level rails with their beads.
    for (const [y, u] of [[-14, 0.7], [16, 0.4]] as const) {
      ctx.beginPath();
      ctx.moveTo(cx - 34, cy + y);
      ctx.lineTo(cx + 34, cy + y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx - 34 + 68 * u, cy + y, 9, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (id === 'voice') {
    // The lamp's voice: a small speaker and one arc.
    ctx.beginPath();
    ctx.moveTo(cx - 30, cy - 12);
    ctx.lineTo(cx - 16, cy - 12);
    ctx.lineTo(cx + 2, cy - 28);
    ctx.lineTo(cx + 2, cy + 28);
    ctx.lineTo(cx - 16, cy + 12);
    ctx.lineTo(cx - 30, cy + 12);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 6, cy, 24, -0.8, 0.8);
    ctx.stroke();
  } else if (id === 'text') {
    ctx.font = `700 52px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Aa', cx, cy + 3);
  } else if (id === 'contrast') {
    ctx.beginPath();
    ctx.arc(cx, cy, 30, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 30, -Math.PI / 2, Math.PI / 2);
    ctx.fill();
  } else if (id === 'gaze') {
    // An eye.
    ctx.beginPath();
    ctx.moveTo(cx - 38, cy);
    ctx.quadraticCurveTo(cx, cy - 34, cx + 38, cy);
    ctx.quadraticCurveTo(cx, cy + 34, cx - 38, cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 11, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === 'recenter') {
    // A target: ring, centre, four short ticks.
    ctx.beginPath();
    ctx.arc(cx, cy, 22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      ctx.beginPath();
      ctx.moveTo(cx + dx * 30, cy + dy * 30);
      ctx.lineTo(cx + dx * 40, cy + dy * 40);
      ctx.stroke();
    }
  } else if (id === 'forget') {
    // A small trash bin.
    ctx.beginPath();
    ctx.moveTo(cx - 26, cy - 20);
    ctx.lineTo(cx + 26, cy - 20);
    ctx.moveTo(cx - 8, cy - 28);
    ctx.lineTo(cx + 8, cy - 28);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 20, cy - 12);
    ctx.lineTo(cx - 16, cy + 30);
    ctx.lineTo(cx + 16, cy + 30);
    ctx.lineTo(cx + 20, cy - 12);
    ctx.stroke();
  } else {
    // Close: a soft ×.
    ctx.beginPath();
    ctx.moveTo(cx - 20, cy - 20);
    ctx.lineTo(cx + 20, cy + 20);
    ctx.moveTo(cx + 20, cy - 20);
    ctx.lineTo(cx - 20, cy + 20);
    ctx.stroke();
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const stateW = state == null ? 0 : 150;
  let size = 60;
  ctx.font = `600 ${size}px ${FONT}`;
  while (size > 42 && ctx.measureText(name).width > 520 - stateW) {
    size -= 2;
    ctx.font = `600 ${size}px ${FONT}`;
  }
  ctx.fillStyle = DS.text.primary;
  ctx.fillText(name, 206, 112);
  if (state != null) {
    ctx.font = `600 40px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillStyle = on ? DS.accent.lamp : DS.text.secondary;
    ctx.fillText(state, 724, 112);
  }
  return uiTexture(canvas);
}

/**
 * Menu rows (Places, rituals) are laid out on a 768 × 224 grid but rendered at 2/3 (512 × 149 px on a 16 cm row:
 * ≈ 31 px per degree at 55 cm, above the Quest 3's ≈ 25): 0.3 MB of GPU memory per row instead of 0.69 MB (v6).
 */
function chipCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  const ctx = sized(canvas, 512, 149, 512 / 768, 149 / 224);
  return { canvas, ctx };
}

/**
 * 26 Oct (the lamp shows the places): a small round glass button beside the grown globe — previous / next place,
 * or close. One glyph, no text (the label above the globe names the place). 256 × 256.
 */
export function drawGlobeButton(kind: 'prev' | 'next' | 'close'): CanvasTexture {
  const canvas = document.createElement('canvas');
  const ctx = sized(canvas, 192, 192, 192 / 256, 192 / 256);
  glass(ctx, 14, 14, 228, 228, 114);
  ctx.strokeStyle = DS.text.primary;
  ctx.lineWidth = 13;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (kind === 'close') {
    ctx.moveTo(100, 100);
    ctx.lineTo(156, 156);
    ctx.moveTo(156, 100);
    ctx.lineTo(100, 156);
  } else {
    const d = kind === 'prev' ? -1 : 1;
    ctx.moveTo(128 - 14 * d, 90);
    ctx.lineTo(128 + 22 * d, 128);
    ctx.lineTo(128 - 14 * d, 166);
  }
  ctx.stroke();
  return uiTexture(canvas);
}

/**
 * The title over the grown globe: the place's name, where it sits among the places (one dot each, the shown one in
 * lamp light, a ring on the place you are in), and how to choose. 768 × 224, one line of name at 58 px.
 */
export function drawGlobeLabel(name: string, index: number, count: number, current: number, hint: string): CanvasTexture {
  const { canvas, ctx } = chipCanvas();
  glass(ctx, 10, 10, 748, 204, 102);
  let size = 58;
  ctx.font = `600 ${size}px ${FONT}`;
  while (size > 44 && ctx.measureText(name).width > 600) {
    size -= 2;
    ctx.font = `600 ${size}px ${FONT}`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = DS.text.primary;
  ctx.fillText(name, 384, 74, 640);
  const gap = 34;
  const x0 = 384 - ((count - 1) * gap) / 2;
  for (let i = 0; i < count; i++) {
    ctx.beginPath();
    ctx.arc(x0 + i * gap, 132, i === index ? 9 : 6, 0, Math.PI * 2);
    ctx.fillStyle = i === index ? DS.accent.lamp : DS.text.tertiary;
    ctx.fill();
    if (i === current) {
      ctx.beginPath();
      ctx.arc(x0 + i * gap, 132, 14, 0, Math.PI * 2);
      ctx.strokeStyle = DS.text.secondary;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }
  // 29 Oct (owner: the line under the name was too small): 48 px on a 26 cm label ≈ the caption's own small line
  // (≈ 16 mm); a longer hint steps down, never squeezed.
  let hintSize = 48;
  ctx.font = `500 ${hintSize}px ${FONT}`;
  while (hintSize > 38 && ctx.measureText(hint).width > 700) {
    hintSize -= 2;
    ctx.font = `500 ${hintSize}px ${FONT}`;
  }
  ctx.fillStyle = DS.text.secondary;
  ctx.fillText(hint, 384, 184, 720);
  return uiTexture(canvas);
}

/** One row of the Places menu: round photo, name, a lamp-coloured dot on the current place. */
export function drawPlaceChip(name: string, thumb: HTMLImageElement | null, current: boolean): CanvasTexture {
  const { canvas, ctx } = chipCanvas();
  glass(ctx, 10, 10, 748, 204, 102);
  if (current) {
    roundRect(ctx, 10, 10, 748, 204, 102);
    ctx.fillStyle = 'rgba(244, 194, 126, 0.2)';
    ctx.fill();
  }
  const cx = 112;
  const cy = 112;
  const r = 70;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  if (thumb != null && thumb.complete && thumb.naturalWidth > 0) {
    // Centre crop of the panorama (the view you face).
    const sw = thumb.naturalHeight * 1.1;
    ctx.drawImage(thumb, (thumb.naturalWidth - sw) / 2, thumb.naturalHeight * 0.05, sw, thumb.naturalHeight * 0.9, cx - r, cy - r, r * 2, r * 2);
  } else {
    // "My room": passthrough, drawn as a soft warm interior light.
    const g = ctx.createRadialGradient(cx - 20, cy - 24, 4, cx, cy, r);
    g.addColorStop(0, 'rgba(255, 214, 160, 0.95)');
    g.addColorStop(1, 'rgba(120, 84, 58, 0.9)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 252, 246, 0.5)';
  ctx.lineWidth = 3;
  ctx.stroke();
  // One line, never squeezed: the size steps down until the name fits (58 → 44 px on the 768 grid).
  let size = 58;
  ctx.font = `600 ${size}px ${FONT}`;
  while (size > 44 && ctx.measureText(name).width > 470) {
    size -= 2;
    ctx.font = `600 ${size}px ${FONT}`;
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = DS.text.primary;
  ctx.fillText(name, 214, 114, 470);
  if (current) {
    ctx.beginPath();
    ctx.arc(714, 112, 12, 0, Math.PI * 2);
    ctx.fillStyle = DS.accent.lamp;
    ctx.fill();
  }
  return uiTexture(canvas);
}

/**
 * v6: one row of the ritual menu by the lamp: a round glyph, the name, a one-line description,
 * a quiet count of evenings (reason to come back), and the lamp's warm tint on the proposed ritual.
 */
export function drawRitualChip(id: 'unload' | 'breathe' | 'release' | 'talk' | 'squeeze' | 'keep' | 'sky' | 'sleep', name: string, sub: string, proposed: boolean, evenings: number): CanvasTexture {
  const { canvas, ctx } = chipCanvas();
  glass(ctx, 10, 10, 748, 204, 102);
  if (proposed) {
    roundRect(ctx, 10, 10, 748, 204, 102);
    ctx.fillStyle = 'rgba(244, 194, 126, 0.24)';
    ctx.fill();
    roundRect(ctx, 11.5, 11.5, 745, 201, 100.5);
    ctx.strokeStyle = 'rgba(255, 222, 170, 0.55)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  const cx = 112;
  const cy = 112;
  const r = 66;
  // Glyph disc: deep warm glass with a light drawing.
  const g = ctx.createRadialGradient(cx - 18, cy - 22, 6, cx, cy, r);
  g.addColorStop(0, 'rgba(92, 70, 52, 0.95)');
  g.addColorStop(1, 'rgba(40, 30, 24, 0.95)');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 252, 246, 0.42)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 236, 206, 0.95)';
  ctx.strokeStyle = 'rgba(255, 236, 206, 0.95)';
  ctx.lineCap = 'round';
  if (id === 'unload') {
    ctx.beginPath();
    ctx.ellipse(cx - 18, cy + 14, 22, 13, -0.15, 0, Math.PI * 2);
    ctx.ellipse(cx + 20, cy + 10, 17, 11, 0.2, 0, Math.PI * 2);
    ctx.ellipse(cx + 2, cy - 18, 15, 10, 0.05, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === 'breathe') {
    const moon = ctx.createRadialGradient(cx, cy - 4, 2, cx, cy, 34);
    moon.addColorStop(0, 'rgba(255, 238, 210, 1)');
    moon.addColorStop(0.7, 'rgba(255, 196, 130, 0.95)');
    moon.addColorStop(1, 'rgba(255, 170, 100, 0)');
    ctx.fillStyle = moon;
    ctx.beginPath();
    ctx.arc(cx, cy, 36, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === 'talk') {
    // A soft speech bubble with three small waves of voice.
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 6, 34, 24, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 14, cy + 15);
    ctx.lineTo(cx - 22, cy + 32);
    ctx.lineTo(cx - 2, cy + 17);
    ctx.stroke();
    for (const dx of [-13, 0, 13]) {
      ctx.beginPath();
      ctx.arc(cx + dx, cy - 6, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (id === 'squeeze') {
    // 28 Oct: two soft fists, a few rays of light escaping between them.
    ctx.lineWidth = 5;
    for (const dx of [-17, 17]) {
      roundRect(ctx, cx + dx - 13, cy - 8, 26, 30, 10);
      ctx.fill();
    }
    for (const a of [-0.9, -0.45, 0, 0.45, 0.9]) {
      ctx.beginPath();
      ctx.moveTo(cx + Math.sin(a) * 26, cy - 14 - Math.cos(a) * 6);
      ctx.lineTo(cx + Math.sin(a) * 40, cy - 14 - Math.cos(a) * 22);
      ctx.stroke();
    }
  } else if (id === 'keep') {
    // 28 Oct: three warm drops of light, the middle one larger.
    for (const [dx, dy, rr] of [[-20, 10, 9], [0, -8, 14], [20, 10, 9]] as const) {
      const drop = ctx.createRadialGradient(cx + dx, cy + dy, 1, cx + dx, cy + dy, rr * 1.8);
      drop.addColorStop(0, 'rgba(255, 236, 200, 1)');
      drop.addColorStop(0.5, 'rgba(255, 190, 110, 0.9)');
      drop.addColorStop(1, 'rgba(255, 170, 90, 0)');
      ctx.fillStyle = drop;
      ctx.beginPath();
      ctx.arc(cx + dx, cy + dy, rr * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (id === 'sky') {
    // 28 Oct: a little constellation (your sky, evening by evening).
    const pts = [[-26, 14], [-8, -10], [12, 2], [28, -18]] as const;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(cx + x, cy + y) : ctx.lineTo(cx + x, cy + y)));
    ctx.stroke();
    ctx.globalAlpha = 1;
    for (const [x, y] of pts) {
      ctx.beginPath();
      ctx.arc(cx + x, cy + y, 5.5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (id === 'release') {
    ctx.lineWidth = 5;
    for (const [rx, a] of [[14, 1], [28, 0.7], [42, 0.4]] as const) {
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.ellipse(cx, cy + 10, rx, rx * 0.42, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 16, 13, 9, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx + 15, cy - 11, 27, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  // Progressive disclosure: the quiet line under the name only on the row the lamp proposes (where it helps decide);
  // the other rows are one clear word, larger and centred.
  const withSub = proposed && sub.length > 0;
  ctx.font = `600 ${withSub ? 56 : 62}px ${FONT}`;
  ctx.fillStyle = DS.text.primary;
  ctx.fillText(name, 206, withSub ? 86 : 112, 420);
  if (withSub) {
    ctx.font = `500 38px ${FONT}`;
    ctx.fillStyle = DS.text.secondary;
    ctx.fillText(sub, 206, 148, 500);
  }
  // 29 Oct (owner: "the screen is crowded with text"): no small "1 evening" count on the rows any more — one word
  // per row (the journal keeps the counts). `evenings` stays in the signature for the callers.
  void evenings;
  const stat = '';
  ctx.font = `600 32px ${FONT}`;
  if (stat.length > 0) {
    ctx.textAlign = 'right';
    ctx.fillStyle = DS.text.tertiary;
    ctx.fillText(stat, 722, withSub ? 86 : 112);
  }
  if (proposed) {
    ctx.beginPath();
    ctx.arc(stat.length > 0 ? 722 - ctx.measureText(stat).width - 22 : 714, withSub ? 86 : 112, 10, 0, Math.PI * 2);
    ctx.fillStyle = DS.accent.lamp;
    ctx.fill();
  }
  return uiTexture(canvas);
}
