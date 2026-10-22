// Art iteration: sets the emulator camera from VIEW (JSON): {fov, aim:[x,y,z] desk-local, back: metres toward
// the seat (negative = lean in), up: metres, yaw: extra degrees} and optional JS (WDD_JS) before the shot.
//   VIEW='{"fov":30,"aim":[-0.38,0.01,0.2],"back":-0.3}' npx @iwsdk/cli browser run tools/film-v7/view.mjs
export default async function run({ frame, page }) {
  const f = frame ?? page;
  const v = JSON.parse(process.env.VIEW ?? '{}');
  return await f.evaluate(async ([v, extra]) => {
    if (window.__rig) clearInterval(window.__rig.timer);
    if (extra) await new Function(`return (async () => { ${extra} })()`)();
    const d = window.__wdd;
    if (v.fov) d.film.fov(v.fov);
    const aim = v.aim ? d.deskPoint(v.aim[0], v.aim[1], v.aim[2]) : d.deskPoint(0, 0, 0);
    const seat = window.__seat ?? (window.__seat = { x: window.IWER_DEVICE.position.x, y: window.IWER_DEVICE.position.y, z: window.IWER_DEVICE.position.z });
    const dx = aim.x - seat.x, dy = aim.y - seat.y, dz = aim.z - seat.z;
    const len = Math.hypot(dx, dy, dz);
    const back = v.back ?? 0;
    const pos = { x: seat.x - (dx / len) * back, y: seat.y - (dy / len) * back + (v.up ?? 0), z: seat.z - (dz / len) * back };
    if (v.side) { pos.x += v.side[0]; pos.z += v.side[1]; }
    window.IWER_DEVICE.position.set(pos.x, pos.y, pos.z);
    const ex = aim.x - pos.x, ey = aim.y - pos.y, ez = aim.z - pos.z;
    const yaw = Math.atan2(-ex, -ez) + ((v.yaw ?? 0) * Math.PI) / 180;
    const pitch = Math.atan2(ey, Math.hypot(ex, ez));
    const sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2), sx = Math.sin(pitch / 2), cx = Math.cos(pitch / 2);
    window.IWER_DEVICE.quaternion.set(cy * sx, sy * cx, -sy * sx, cy * cx);
    await new Promise((r) => setTimeout(r, 900));
    return { pos, yaw: (yaw * 180) / Math.PI, pitch: (pitch * 180) / Math.PI };
  }, [v, process.env.WDD_JS ?? '']);
}
