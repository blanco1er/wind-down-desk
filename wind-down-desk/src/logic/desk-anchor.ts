/**
 * The desk remembers where it lives in your room (pure, unit-tested).
 *
 * WebXR anchors on Meta Quest Browser (checked 22 Oct 2026, developers.meta.com/horizon/documentation/web/
 * webxr-mixed-reality): `XRFrame.createAnchor(pose, space)`, `XRAnchor.requestPersistentHandle()` → a UUID the
 * site keeps, `XRSession.restorePersistentAnchor(uuid)` next time; `deletePersistentAnchor(uuid)` and
 * `persistentAnchors` come from the WebXR Anchors module (IWER implements all four). Meta: "A site can currently
 * only create 8 persistent anchors at a time"; none in private mode; clearing the site's history deletes them.
 * IWSDK 1.0.1 already keeps ONE of those 8 for its own origin anchor (`iwsdk_scene_anchor_uuid`).
 *
 * The cycle, evening after evening:
 *   saved UUID → restore → pose judged against where you sit now
 *     ├ near you  → the desk comes back exactly there (even out of view: its sound tells you where)
 *     ├ far / implausible / UUID rejected → find the table again (surfaces.ts), anchor the new place
 *     └ no answer in time → find the table again for tonight only; the old UUID is kept for tomorrow
 *       (a slow relocalisation must not erase the place), and replaced after 3 such evenings.
 *   "Move my desk" → find the table again from where you sit, the new place replaces the old.
 */
import type { DeskFrame, Vec3 } from './desk-layout.ts';
import type { HeadPose, PlaneCandidate } from './placement.ts';
import { closestPointOnPlane } from './placement.ts';

export const DESK_ANCHOR_KEY = 'wdd.desk-anchor.v1';
/** IWSDK's own origin anchor (SceneUnderstandingSystem.ANCHOR_UUID_STORAGE_KEY): never pruned. */
export const IWSDK_ANCHOR_KEY = 'iwsdk_scene_anchor_uuid';

export const ANCHOR = {
  /** Restore + first tracked pose must arrive within this (s); then the evening goes on without it. */
  restoreTimeout: 3,
  /** A restored desk farther than this (horizontal, from the eyes to the desk centre) is another seat. */
  maxDistance: 1.3,
  /** Within this angle of where you look, the restored desk counts as in view. */
  viewHalfAngle: (55 * Math.PI) / 180,
  /** Timeouts in a row before the saved place is given up. */
  maxMisses: 3,
  /** Quest Browser limit per site, and how many slots stay free for us + IWSDK. */
  siteLimit: 8,
  reserve: 2,
  /** Follow the anchor when the runtime corrects it by more than this (relocalisation). */
  followMetres: 0.005,
  followRadians: (0.6 * Math.PI) / 180,
  /** A detected table this close under a restored desk corrects its height (vertical drift). */
  snapMetres: 0.06,
} as const;

export type DeskMode = 'table' | 'floating';
export type PlaceSource = 'plane' | 'mesh' | 'hit' | 'floating' | 'anchor';

export interface SavedDesk {
  v: 1;
  uuid: string;
  mode: DeskMode;
  /** Where the place first came from (plane, mesh, hit, floating). */
  source: Exclude<PlaceSource, 'anchor'>;
  savedAt: number;
  /** Evenings in a row the restore did not answer in time. */
  misses: number;
}

/** Reads the saved record; anything malformed is treated as nothing saved. */
export function parseSaved(raw: string | null | undefined): SavedDesk | null {
  if (raw == null || raw.length === 0) return null;
  try {
    const o = JSON.parse(raw) as Partial<SavedDesk>;
    if (o == null || o.v !== 1 || typeof o.uuid !== 'string' || o.uuid.length < 8) return null;
    if (o.mode !== 'table' && o.mode !== 'floating') return null;
    const source = (['plane', 'mesh', 'hit', 'floating'] as const).find((s) => s === o.source) ?? 'plane';
    return {
      v: 1,
      uuid: o.uuid,
      mode: o.mode,
      source,
      savedAt: typeof o.savedAt === 'number' ? o.savedAt : 0,
      misses: typeof o.misses === 'number' && o.misses >= 0 ? Math.floor(o.misses) : 0,
    };
  } catch {
    return null;
  }
}

/** Desk frame from an anchor pose (position + quaternion): yaw is the rotation around +Y. */
export function frameFromPose(p: Vec3, q: { x: number; y: number; z: number; w: number }, out?: DeskFrame): DeskFrame {
  // Yaw of the local +Z axis projected on the floor (robust to a little pitch/roll from the runtime).
  const zx = 2 * (q.x * q.z + q.y * q.w);
  const zz = 1 - 2 * (q.x * q.x + q.y * q.y);
  const f = out ?? { x: 0, y: 0, z: 0, yaw: 0 };
  f.x = p.x;
  f.y = p.y;
  f.z = p.z;
  f.yaw = Math.atan2(zx, zz);
  return f;
}

/** Anchor orientation for a desk frame: a pure rotation of `yaw` around +Y. */
export function poseQuaternion(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

export type Bearing = 'ahead' | 'left' | 'right' | 'behind';

/** Where the desk is relative to where you look (for the "your desk is on your left" cue). */
export function bearingOf(frame: DeskFrame, head: HeadPose): { angle: number; bearing: Bearing } {
  const fx = head.forward.x;
  const fz = head.forward.z;
  const fl = Math.hypot(fx, fz) || 1;
  const tx = frame.x - head.position.x;
  const tz = frame.z - head.position.z;
  const tl = Math.hypot(tx, tz) || 1;
  const cos = (fx * tx + fz * tz) / (fl * tl);
  // Right of the view (Three.js, looking down -Z with +X on the right): cross(forward, to).y < 0.
  const cross = (fz * tx - fx * tz) / (fl * tl);
  const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
  let bearing: Bearing = 'ahead';
  if (angle > ANCHOR.viewHalfAngle) bearing = angle > (135 * Math.PI) / 180 ? 'behind' : cross < 0 ? 'right' : 'left';
  return { angle, bearing };
}

export type RestoreVerdict =
  | { kind: 'restore'; frame: DeskFrame; bearing: Bearing }
  | { kind: 'too-far'; distance: number }
  | { kind: 'implausible'; reason: string };

/**
 * Is a restored desk pose usable where the person sits tonight? Out of view is fine (it is where you left it);
 * another seat or a broken pose is not. A detected table right under the desk corrects small vertical drift.
 */
export function judgeRestored(
  frame: DeskFrame,
  head: HeadPose,
  mode: DeskMode,
  planes: readonly PlaneCandidate[] = [],
  /** Desk frame height above the table top it rests on (tray board + clearance). */
  trayHeight = 0.02,
): RestoreVerdict {
  if (![frame.x, frame.y, frame.z, frame.yaw].every(Number.isFinite)) return { kind: 'implausible', reason: 'not finite' };
  const distance = Math.hypot(frame.x - head.position.x, frame.z - head.position.z);
  if (distance > ANCHOR.maxDistance) return { kind: 'too-far', distance };
  const low = mode === 'table' ? 0.3 : 0.4;
  if (frame.y < low || frame.y > 1.4) return { kind: 'implausible', reason: `height ${frame.y.toFixed(2)} m` };
  if (frame.y > head.position.y - 0.1) return { kind: 'implausible', reason: 'above the eyes' };
  let y = frame.y;
  if (mode === 'table') {
    let best = Infinity;
    for (const p of planes) {
      if (p.orientation !== 'horizontal') continue;
      const c = closestPointOnPlane(p, frame.x, frame.z);
      if (Math.hypot(c.x - frame.x, c.z - frame.z) > 0.01) continue; // not under the desk
      const dy = p.center.y + trayHeight - frame.y;
      if (Math.abs(dy) <= ANCHOR.snapMetres && Math.abs(dy) < Math.abs(best)) best = dy;
    }
    if (Number.isFinite(best)) y = frame.y + best;
  }
  return { kind: 'restore', frame: { ...frame, y }, bearing: bearingOf(frame, head).bearing };
}

export type RestoreResult =
  | { kind: 'no-record' }
  | { kind: 'unsupported' }
  | { kind: 'rejected' }
  | { kind: 'timeout' }
  | { kind: 'pose'; frame: DeskFrame };

/** What to do with tonight's place once it is chosen. */
export type Persist =
  /** The restored anchor is the place: keep it. */
  | 'keep'
  /** New persistent anchor; the previous UUID (if any) is deleted once the new one is saved. */
  | 'replace'
  /** Anchor for tonight only (follows relocalisation); the saved record is left for tomorrow. */
  | 'session-only';

export interface RestoreDecision {
  /** 'anchor': use `frame`; 'surfaces': find the table now (surfaces.ts), floating if none. */
  place: 'anchor' | 'surfaces';
  frame: DeskFrame | null;
  mode: DeskMode | null;
  bearing: Bearing | null;
  persist: Persist;
  /** The record to store now (null = remove it; undefined = leave it as it is). */
  record: SavedDesk | null | undefined;
  /** Why, in a few words (debug API, report). */
  why: string;
}

export function decideAfterRestore(
  result: RestoreResult,
  saved: SavedDesk | null,
  head: HeadPose,
  planes: readonly PlaneCandidate[] = [],
  trayHeight = 0.02,
): RestoreDecision {
  const surfaces = (persist: Persist, record: SavedDesk | null | undefined, why: string): RestoreDecision => ({
    place: 'surfaces',
    frame: null,
    mode: null,
    bearing: null,
    persist,
    record,
    why,
  });
  switch (result.kind) {
    case 'no-record':
      return surfaces('replace', undefined, 'first evening here');
    case 'unsupported':
      // No persistence in this browser (or immersive-vr without anchors): tonight's anchor only, if any.
      return surfaces('session-only', undefined, 'anchors not persistent here');
    case 'rejected':
      // The runtime does not know this UUID any more (history cleared, Space Setup redone, other headset).
      return surfaces('replace', null, 'saved place forgotten by the headset');
    case 'timeout': {
      if (saved == null) return surfaces('replace', undefined, 'no answer, nothing saved');
      const misses = saved.misses + 1;
      if (misses >= ANCHOR.maxMisses) return surfaces('replace', null, `no answer ${misses} evenings in a row`);
      return surfaces('session-only', { ...saved, misses }, `no answer in time (${misses}/${ANCHOR.maxMisses})`);
    }
    case 'pose': {
      const mode = saved?.mode ?? 'table';
      const verdict = judgeRestored(result.frame, head, mode, planes, trayHeight);
      if (verdict.kind === 'restore') {
        return {
          place: 'anchor',
          frame: verdict.frame,
          mode,
          bearing: verdict.bearing,
          persist: 'keep',
          record: saved == null ? undefined : { ...saved, misses: 0 },
          why: verdict.bearing === 'ahead' ? 'back where you left it' : `back where you left it (${verdict.bearing})`,
        };
      }
      return surfaces('replace', null, verdict.kind === 'too-far' ? `another seat (${verdict.distance.toFixed(2)} m away)` : verdict.reason);
    }
  }
}

/** Should the desk follow the anchor's newest pose (the runtime refined the map)? */
export function shouldFollow(current: DeskFrame, anchored: DeskFrame): boolean {
  const d = Math.hypot(anchored.x - current.x, anchored.y - current.y, anchored.z - current.z);
  let dy = Math.abs(anchored.yaw - current.yaw) % (2 * Math.PI);
  if (dy > Math.PI) dy = 2 * Math.PI - dy;
  return d > ANCHOR.followMetres || dy > ANCHOR.followRadians;
}

/**
 * Persistent anchors to delete so that a new one fits under the site limit: the oldest-listed ones that are
 * neither ours nor IWSDK's (left over by earlier builds or failed restores). Nothing if there is room.
 */
export function anchorsToPrune(existing: readonly string[], keep: ReadonlyArray<string | null | undefined>): string[] {
  const room = ANCHOR.siteLimit - ANCHOR.reserve;
  if (existing.length <= room) return [];
  const protect = new Set(keep.filter((k): k is string => typeof k === 'string'));
  const candidates = existing.filter((u) => !protect.has(u));
  return candidates.slice(0, existing.length - room);
}

/** Record for a freshly persisted place. */
export function newRecord(uuid: string, mode: DeskMode, source: Exclude<PlaceSource, 'anchor'>, now: number): SavedDesk {
  return { v: 1, uuid, mode, source, savedAt: now, misses: 0 };
}

/**
 * Caption for a desk restored outside your view. The caption lives on the desk, so it is read once you have
 * turned to it (guided by the appear sound, played from the desk itself, and played again if you have not turned).
 */
export function bearingCaption(bearing: Bearing): string | null {
  return bearing === 'ahead' ? null : 'Back where you left it.';
}
