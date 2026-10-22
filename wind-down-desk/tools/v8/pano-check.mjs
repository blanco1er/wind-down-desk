// v8 panorama check on the sphere (emulator): for PLACE, full immersion, then stills facing ahead, left, right,
// behind (the left/right seam), straight up (zenith) and down (nadir), and the seated "Table stays" view.
//   PLACE=tea-garden OUT=dir npx @iwsdk/cli browser run tools/v8/pano-check.mjs --timeout 100000
import { mkdirSync } from 'node:fs';
export default async function run({ frame, page }) {
  const f = frame ?? page;
  const place = process.env.PLACE;
  const out = process.env.OUT;
  mkdirSync(out, { recursive: true });
  const views = (process.env.VIEWS ?? 'ahead:0:2,left:-90:2,right:90:2,behind:180:2,up:0:88,down:0:-80,seated:0:-27').split(',').map((v) => {
    const [name, yaw, pitch] = v.split(':');
    return { name, yaw: Number(yaw), pitch: Number(pitch) };
  });
  await f.evaluate(async (p) => {
    const d = window.__wdd;
    d.film?.fov?.(Number(64));
    await d.place(p);
    await new Promise((r) => setTimeout(r, 2600));
  }, place);
  const shots = [];
  for (const v of views) {
    await f.evaluate(async ([v, full]) => {
      const d = window.__wdd;
      d.immersion(v.name === 'seated' ? 'table' : full);
      const a = d.deskPoint(0, 0, 0);
      const b = d.deskPoint(0, 0, 1);
      // desk forward (away from you) in the world, as a yaw.
      const fwd = Math.atan2(-(a.x - b.x), -(a.z - b.z));
      const yaw = fwd - (v.yaw * Math.PI) / 180;
      const pitch = (v.pitch * Math.PI) / 180;
      const sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2), sx = Math.sin(pitch / 2), cx = Math.cos(pitch / 2);
      window.IWER_DEVICE.quaternion.set(cy * sx, sy * cx, -sy * sx, cy * cx);
      await new Promise((r) => setTimeout(r, v.name === 'seated' ? 2600 : 1200));
    }, [v, 'full']);
    const file = `${out}/${place}-${v.name}.png`;
    await page.screenshot({ path: file });
    shots.push(file);
  }
  return shots;
}
