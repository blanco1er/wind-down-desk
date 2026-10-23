/**
 * Axe 5 measure (play-test only, never called by the app): GPU time of the place backdrop ALONE, drawn n times into
 * one Quest 3 eye-sized target (2064 × 2208) looking 35° down, ground projection on vs off, alternated to cancel
 * drift. Returns ms per eye-draw. The absolute numbers are this machine's GPU; the on/off DIFFERENCE is the cost.
 */
import { PerspectiveCamera, WebGLRenderTarget, type Mesh, type ShaderMaterial, type Vector4, type WebGLRenderer } from '@iwsdk/core';

export function benchBackdrop(renderer: WebGLRenderer, mesh: Mesh, eye: { x: number; y: number; z: number }, n = 30): { offMs: number; onMs: number; rounds: number[][]; drew: number; centre: number[] } {
  const w = 2064, h = 2208;
  const target = new WebGLRenderTarget(w, h);
  const cam = new PerspectiveCamera(100, w / h, 0.1, 200);
  cam.position.set(eye.x, eye.y, eye.z);
  cam.rotation.set((-35 * Math.PI) / 180, 0, 0, 'YXZ');
  cam.updateMatrixWorld();
  const ground = (mesh.material as ShaderMaterial).uniforms.uGround.value as Vector4;
  const saved = ground.w;
  const xr = renderer.xr.enabled;
  const prevTarget = renderer.getRenderTarget();
  const visible = mesh.visible;
  renderer.xr.enabled = false;
  mesh.visible = true;
  renderer.setRenderTarget(target);
  // gl.finish() does not wait on every backend (ANGLE / Metal): reading one pixel back does.
  const px = new Uint8Array(4);
  const sync = (): void => renderer.readRenderTargetPixels(target, w >> 1, h >> 1, 1, 1, px);
  let drew = 0;
  const time = (w0: number): number => {
    ground.w = w0;
    renderer.render(mesh, cam);
    drew = renderer.info.render.calls; // info auto-resets at each render: the calls of this one
    sync();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) renderer.render(mesh, cam);
    sync();
    return (performance.now() - t0) / n;
  };
  const rounds: number[][] = [];
  for (let r = 0; r < 4; r++) rounds.push([time(0), time(saved > 0 ? saved : 1.2)]);
  renderer.setRenderTarget(prevTarget);
  renderer.xr.enabled = xr;
  mesh.visible = visible;
  ground.w = saved;
  target.dispose();
  const med = (a: number[]): number => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  return { offMs: +med(rounds.map((x) => x[0])).toFixed(3), onMs: +med(rounds.map((x) => x[1])).toFixed(3), rounds: rounds.map((x) => x.map((v) => +v.toFixed(3))), drew, centre: [...px] };
}
