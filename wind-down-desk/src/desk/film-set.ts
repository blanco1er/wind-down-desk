/**
 * Emulator-only film set: stands in for passthrough when we record the demo
 * video in IWER, where the room is otherwise a grey low-poly scan.
 *
 * - Loaded only in `vite dev` (dynamic import behind `import.meta.env.DEV`,
 *   so it is not in the production bundle) AND only when the IWER emulator
 *   is present (`window.IWER_DEVICE`). On a real Quest the browser has native
 *   WebXR, IWER is never injected, and the user sees real passthrough.
 * - A real room: a CC0 360° photograph (Poly Haven "Hotel Room" by Greg Zaal,
 *   tone-mapped JPG, graded to evening in the shader: exposure down, daylight
 *   windows turned to night, warm lamps kept, slight defocus like passthrough).
 * - A real table under the tray: an oiled oak top fitted to the emulator's
 *   detected table plane, lit by the same evening rig as the tray.
 *
 * Opt out with `?set=off`. Everything here is outside the device perf budget.
 */
import {
  BackSide,
  BoxGeometry,
  LinearMipmapLinearFilter,
  Mesh,
  NoColorSpace,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  TextureLoader,
  Vector2,
  Vector3,
  type World,
} from '@iwsdk/core';
import type { DeskFrame } from '../logic/desk-layout.ts';
import type { PlaneCandidate } from '../logic/placement.ts';
import { deskCap } from '../logic/session.ts';
import { deskPlacedListeners } from '../systems/ritual-system.ts';
import { services, testClock } from '../services.ts';
import { placeListeners } from './environment.ts';
import { TRAY } from './geometry.ts';
import { RIG, RIG_UNIFORMS, rig } from './materials.ts';

interface FilmOptions {
  photo: string;
  /** Yaw of the photo relative to the desk (radians). */
  rotation: number;
  exposure: number;
  night: number;
  blur: number;
}

const PHOTOS: Record<string, string> = {
  // 8K (8192 × 4096, Poly Haven tone-mapped JPG, MD5 5675e838…, CC0): the 4K one looked soft and blocky on a Retina Mac.
  hotel: './film-set/hotel_room-8k.jpg',
  fireplace: './film-set/fireplace-4k.jpg',
};

export function mountFilmSet(world: World): void {
  const iwer = (window as unknown as { IWER_DEVICE?: { fovy: number } }).IWER_DEVICE;
  const params = new URLSearchParams(location.search);
  if (iwer == null || params.get('set') === 'off') {
    return;
  }
  const options: FilmOptions = {
    photo: params.get('photo') ?? 'hotel',
    rotation: Number(params.get('rot') ?? 2.45),
    exposure: 0.33,
    night: 1,
    // A light defocus like passthrough; 2.2 on the 4K photo magnified a coarse mip into visible blocks (owner, 19 Oct).
    blur: 0.6,
  };
  const loader = new TextureLoader();
  const photo = loader.load(PHOTOS[options.photo] ?? PHOTOS.hotel);
  photo.colorSpace = NoColorSpace;
  photo.minFilter = LinearMipmapLinearFilter;
  photo.anisotropy = 4;

  // --- the room -----------------------------------------------------------
  const roomMaterial = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      uPhoto: { value: photo },
      uExposure: { value: options.exposure },
      uNight: { value: options.night },
      uBlur: { value: options.blur },
      uDim: rig.uDim,
      uWarmDir: { value: new Vector3(-0.6, 0.25, -0.75).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vDir;
      void main() {
        vUv = vec2(1.0 - uv.x, uv.y);
        vDir = normalize(mat3(modelMatrix) * position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uPhoto;
      uniform float uExposure;
      uniform float uNight;
      uniform float uBlur;
      uniform float uDim;
      uniform vec3 uWarmDir;
      varying vec2 vUv;
      varying vec3 vDir;
      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      void main() {
        vec3 c = pow(texture2D(uPhoto, vUv, uBlur).rgb, vec3(2.2));
        float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
        // Daylight through the windows becomes night: bright, neutral-to-cool areas go deep blue. The masks read a
        // smoothed copy (JPEG stores colour in 16 px blocks: a sharp "is it cool?" test flipped block by block on the
        // white bed sheets, owner 19 Oct "pixelated"), and only above the horizon, where the windows are.
        vec3 cs = pow(texture2D(uPhoto, vUv, uBlur + 3.5).rgb, vec3(2.2));
        float lumaS = dot(cs, vec3(0.2126, 0.7152, 0.0722));
        float cool = smoothstep(-0.02, 0.08, cs.b - cs.r * 0.92);
        float windowMask = smoothstep(0.12, 0.45, max(luma, lumaS)) * cool * uNight * smoothstep(-0.12, 0.06, normalize(vDir).y);
        // Warm lamps stay (they are the light of the evening).
        float warm = smoothstep(0.04, 0.2, c.r - c.b) * smoothstep(0.2, 0.7, luma);
        vec3 graded = c * uExposure * (1.0 - 0.5 * uDim) * vec3(1.1, 0.9, 0.7);
        // Night behind the sheer curtains: deep blue, with the blurred lights of the city.
        // Sheer curtains at night: warm fabric lit by the room lamps, a little blue night glass behind.
        vec3 night = mix(vec3(luma) * vec3(0.16, 0.12, 0.085), vec3(0.008, 0.011, 0.022) + vec3(luma) * vec3(0.02, 0.025, 0.04), 0.35);
        graded = mix(graded, night, windowMask);
        graded += c * warm * 0.6;
        // Lamp light from behind-left (the same key light as the desk) warms the walls on that side.
        float toward = max(dot(normalize(vDir), uWarmDir), 0.0);
        graded += vec3(0.07, 0.04, 0.018) * pow(toward, 3.0) * (1.0 - 0.5 * uDim);
        // Gentle vignette toward the floor and ceiling.
        graded *= mix(0.5, 1.0, smoothstep(0.0, 0.35, vUv.y)) * mix(0.45, 1.0, smoothstep(0.95, 0.62, vUv.y));
        graded = (graded * (2.51 * graded + 0.03)) / (graded * (2.43 * graded + 0.59) + 0.14);
        gl_FragColor = vec4(pow(clamp(graded, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
      }
    `,
  });
  const room = new Mesh(new SphereGeometry(7, 96, 48), roomMaterial);
  room.renderOrder = -10;
  room.frustumCulled = false;
  room.raycast = () => {};
  room.visible = false;
  world.createTransformEntity(room);

  // --- the table ----------------------------------------------------------
  // v7: the tray is light oak now; the table under it is a dark walnut (as in the owner's reference).
  const walnut = loader.load('./film-set/walnut-table.jpg');
  walnut.colorSpace = NoColorSpace;
  walnut.wrapS = RepeatWrapping;
  walnut.wrapT = RepeatWrapping;
  walnut.minFilter = LinearMipmapLinearFilter;
  walnut.anisotropy = 8;
  const tableMaterial = new ShaderMaterial({
    uniforms: { ...RIG_UNIFORMS, uWood: { value: walnut }, uSize: { value: new Vector2(1.3, 0.76) } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vN;
      varying vec3 vLocal;
      void main() {
        vLocal = position;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uWood;
      uniform vec2 uSize;
      varying vec3 vWorld;
      varying vec3 vN;
      varying vec3 vLocal;
      ${RIG}
      void main() {
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vWorld);
        vec2 uv = vLocal.xz / vec2(0.8, 0.4) + 0.5;
        vec3 wood = toLinear(texture2D(uWood, uv).rgb);
        // A dark walnut dining table under the honey-oak tray.
        vec3 albedo = wood * vec3(0.74, 0.5, 0.36) * 0.55;
        float edge = 1.0 - step(0.5, N.y);
        vec3 col = shade(vWorld, N, V, albedo, 0.42, 0.04, 0.1, 1.0) * (1.0 - edge * 0.45);
        // Stands in for the real table seen in passthrough: the Breathe room dimming darkens it too.
        gl_FragColor = vec4(toDisplay(col) * (1.0 - uRoomDim), 1.0);
      }
    `,
  });
  const table = new Mesh(new BoxGeometry(1, 0.032, 1), tableMaterial);
  table.renderOrder = -5;
  table.visible = false;
  table.raycast = () => {};
  world.createTransformEntity(table);

  deskPlacedListeners.push((frame: DeskFrame, mode, plane: PlaneCandidate | null) => {
    if (mode === 'preview') {
      room.visible = false;
      table.visible = false;
      return;
    }
    // The room is centred on the seated viewer's eyes at the moment the desk lands.
    const eye = world.camera.getWorldPosition(room.position.clone());
    room.position.copy(eye);
    room.rotation.set(0, frame.yaw + options.rotation, 0);
    // Warm light comes from the lamp side (behind-left of the desk), in world space.
    roomMaterial.uniforms.uWarmDir.value.set(-0.6, 0.25, -0.75).normalize().applyAxisAngle(new Vector3(0, 1, 0), frame.yaw);
    room.visible = true;
    const tableTop = frame.y - (mode === 'table' ? TRAY.height : 0.06);
    if (plane != null) {
      const c = Math.cos(plane.yaw);
      const s = Math.sin(plane.yaw);
      table.scale.set(plane.halfX * 2 + 0.5, 1, plane.halfZ * 2 + 0.5);
      table.position.set(
        plane.center.x + plane.offsetX * c + plane.offsetZ * s,
        tableTop - 0.016,
        plane.center.z - plane.offsetX * s + plane.offsetZ * c,
      );
      table.rotation.set(0, plane.yaw, 0);
    } else {
      table.scale.set(1.4, 1, 0.8);
      table.position.set(frame.x, tableTop - 0.016, frame.z - 0.1);
      table.rotation.set(0, frame.yaw, 0);
    }
    table.visible = true;
  });

  // In a place with full immersion the real room (here: the photo and the stand-in table) is hidden, as on Quest.
  let placed = false;
  let hiddenByUser = false;
  deskPlacedListeners.push((_f, mode) => {
    placed = mode !== 'preview';
  });
  placeListeners.push((_place, _immersion, coverage) => {
    if (!placed || hiddenByUser) return;
    room.visible = coverage < 1;
    table.visible = coverage < 1;
  });

  const api = {
    /** Film camera: vertical field of view in degrees (Quest-recording-like crop). */
    fov: (degrees: number) => {
      iwer.fovy = (degrees * Math.PI) / 180;
    },
    room: (rotation?: number, exposure?: number) => {
      if (rotation != null) {
        room.rotation.y += rotation - options.rotation;
        options.rotation = rotation;
      }
      if (exposure != null) {
        roomMaterial.uniforms.uExposure.value = exposure;
      }
      return { rotation: options.rotation, exposure: roomMaterial.uniforms.uExposure.value };
    },
    /** Film only: weeks of evenings in memory (the sky that grows, the streak). Then re-place the desk. */
    /** Stability pass: this evening happens N days later (chains evenings in one emulator session). */
    day: (n: number) => {
      const d = new Date();
      d.setHours(21, 30, 0, 0);
      d.setDate(d.getDate() + Math.max(0, Math.min(400, Math.round(n))));
      Object.assign(testClock, { on: true, base: d.getTime(), setAt: Date.now() });
      return d.toString();
    },
    /** Draw budget proof (stone-draws tool): the desk may hold n stones tonight (the app's own cap is 8). */
    cap: (n: number) => {
      deskCap.max = Math.max(1, Math.min(24, Math.round(n)));
      return deskCap.max;
    },
    history: (evenings: number) => {
      services.memory.seedHistory(evenings);
      return { streak: services.memory.streak(), stars: services.memory.totalLetGo() };
    },
    /** Swap the room photo (hotel | fireplace). */
    photo: (name: string) => {
      const url = PHOTOS[name];
      if (url == null) return Object.keys(PHOTOS);
      const next = loader.load(url);
      next.colorSpace = NoColorSpace;
      next.minFilter = LinearMipmapLinearFilter;
      next.anisotropy = 4;
      roomMaterial.uniforms.uPhoto.value = next;
      options.photo = name;
      return name;
    },
    grade: (night?: number, blur?: number) => {
      if (night != null) roomMaterial.uniforms.uNight.value = night;
      if (blur != null) roomMaterial.uniforms.uBlur.value = blur;
      return { night: roomMaterial.uniforms.uNight.value, blur: roomMaterial.uniforms.uBlur.value };
    },
    hide: (hidden = true) => {
      hiddenByUser = hidden;
      room.visible = !hidden;
      table.visible = !hidden;
    },
  };
  const w = window as unknown as { __wdd?: Record<string, unknown> };
  w.__wdd = Object.assign(w.__wdd ?? {}, { film: api });
}
