/**
 * Performance probe (always on, ~0 cost): frame interval, ECS update CPU time,
 * render submit CPU time, draw calls and triangles per frame, kept in ring
 * buffers and exposed as `window.__wdd.perf()` for tools/perf-probe.mjs.
 */
import { createSystem } from '@iwsdk/core';

const N = 600;

class Ring {
  readonly data = new Float32Array(N);
  count = 0;
  private head = 0;
  push(value: number): void {
    this.data[this.head] = value;
    this.head = (this.head + 1) % N;
    this.count = Math.min(N, this.count + 1);
  }
  reset(): void {
    this.count = 0;
    this.head = 0;
  }
  stats(): { avg: number; p50: number; p95: number; p99: number; max: number } {
    const values = Array.from(this.data.slice(0, this.count)).sort((a, b) => a - b);
    const at = (q: number) => (values.length === 0 ? 0 : values[Math.min(values.length - 1, Math.floor(q * values.length))]);
    const avg = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
    return { avg: +avg.toFixed(3), p50: +at(0.5).toFixed(3), p95: +at(0.95).toFixed(3), p99: +at(0.99).toFixed(3), max: +(values[values.length - 1] ?? 0).toFixed(3) };
  }
}

const frame = new Ring();
const update = new Ring();
const render = new Ring();
const calls = new Ring();
const triangles = new Ring();
/** Frames over 22 ms with their time (performance.now()), to line them up with what the app was doing. */
const longFrames: Array<[number, number]> = [];
let frameStart = 0;
let lastFrameStart = 0;

/** Runs first (lowest priority value). */
export class PerfBeginSystem extends createSystem({}) {
  init(): void {
    const renderer = this.renderer;
    const original = renderer.render.bind(renderer);
    renderer.render = (scene, camera) => {
      const t0 = performance.now();
      original(scene, camera);
      render.push(performance.now() - t0);
      calls.push(renderer.info.render.calls);
      triangles.push(renderer.info.render.triangles);
    };
    const api = {
      perf: () => ({
        frameMs: frame.stats(),
        updateMs: update.stats(),
        renderMs: render.stats(),
        drawCalls: calls.stats(),
        triangles: triangles.stats(),
        samples: frame.count,
        programs: renderer.info.programs?.length ?? 0,
        textures: renderer.info.memory.textures,
        geometries: renderer.info.memory.geometries,
        pixelRatio: renderer.getPixelRatio(),
        xr: renderer.xr.isPresenting,
        longFrames: longFrames.slice(),
      }),
      perfReset: () => {
        [frame, update, render, calls, triangles].forEach((r) => r.reset());
        longFrames.length = 0;
      },
    };
    const w = window as unknown as { __wdd?: Record<string, unknown> };
    w.__wdd = Object.assign(w.__wdd ?? {}, api);
  }

  update(): void {
    frameStart = performance.now();
    if (lastFrameStart > 0) {
      const frameMs = frameStart - lastFrameStart;
      frame.push(frameMs);
      if (frameMs > 22) {
        longFrames.push([Math.round(performance.now()), +frameMs.toFixed(1)]);
        if (longFrames.length > 50) longFrames.shift();
      }
    }
    lastFrameStart = frameStart;
  }
}

/** Runs last (highest priority value). */
export class PerfEndSystem extends createSystem({}) {
  update(): void {
    update.push(performance.now() - frameStart);
  }
}
