/**
 * WebXR glue for the desk's persistent anchor (decisions live in logic/desk-anchor.ts, unit-tested).
 *
 *   start(session)            reads the saved UUID, asks the runtime to restore it (never throws)
 *   poll(frame, ref, now)     → RestoreResult once known: a tracked pose, rejected, unsupported or timeout
 *   commit(decision, …)       stores / clears the record, keeps the restored anchor or queues a new one
 *   moved(frame, mode, src)   "move my desk": a new persistent anchor replaces the old one
 *   track(frame, ref, desk)   → the anchor's newer pose when the runtime corrected it (relocalisation), else null
 *   end()                     session over: runtime anchors are released (persistent handles stay on the device)
 *
 * Every WebXR call is optional (feature-detected) and wrapped: no anchor support, a private window, blocked
 * storage or a full site quota only ever mean "the desk is not remembered tonight", never an error screen.
 */
import {
  anchorsToPrune,
  ANCHOR,
  DESK_ANCHOR_KEY,
  frameFromPose,
  IWSDK_ANCHOR_KEY,
  newRecord,
  parseSaved,
  poseQuaternion,
  shouldFollow,
  type DeskMode,
  type PlaceSource,
  type RestoreDecision,
  type RestoreResult,
  type SavedDesk,
} from '../logic/desk-anchor.ts';
import type { DeskFrame } from '../logic/desk-layout.ts';

type Source = Exclude<PlaceSource, 'anchor'>;
/** Seconds between two looks at the anchor's pose. */
const TRACK_INTERVAL = 0.25;

function readStore(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStore(key: string, value: string | null): void {
  try {
    if (value == null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
  } catch {
    // Storage blocked (privacy settings): the desk is simply not remembered.
  }
}

export type AnchorStatus = 'off' | 'restoring' | 'restored' | 'anchoring' | 'anchored' | 'persisted' | 'session-only' | 'lost' | 'unsupported';

export class DeskAnchorService {
  status: AnchorStatus = 'off';
  saved: SavedDesk | null = null;
  decision: RestoreDecision | null = null;
  /** Short history for the debug API and the report (no per-frame entries). */
  readonly log: Array<{ t: number; what: string }> = [];
  /** Seconds the last restore took (null if none). */
  restoreSeconds: number | null = null;

  private session: XRSession | null = null;
  private anchor: XRAnchor | null = null;
  private restored: XRAnchor | null = null;
  private result: RestoreResult | null = null;
  private startedAt = 0;
  private generation = 0;
  private pending: { frame: DeskFrame; mode: DeskMode; source: Source; persist: 'replace' | 'session-only' } | null = null;
  private creating = false;
  private lostSince = -1;
  private lastTrackAt = -1e9;
  private readonly tracked: DeskFrame = { x: 0, y: 0, z: 0, yaw: 0 };
  private readonly pos = { x: 0, y: 0, z: 0 };

  private note(what: string): void {
    this.log.push({ t: Math.round(performance.now()), what });
    if (this.log.length > 40) this.log.shift();
  }

  start(session: XRSession | null | undefined, now: number): void {
    this.end();
    const gen = ++this.generation;
    this.session = session ?? null;
    this.startedAt = now;
    this.saved = parseSaved(readStore(DESK_ANCHOR_KEY));
    this.decision = null;
    this.restoreSeconds = null;
    const s = this.session;
    if (s == null) {
      this.result = { kind: 'unsupported' };
      this.status = 'unsupported';
      return;
    }
    const anchorsOn = (s.enabledFeatures as readonly string[] | undefined)?.includes('anchors') ?? true;
    if (!anchorsOn) {
      this.result = { kind: 'unsupported' };
      this.status = 'unsupported';
      this.note('anchors feature not granted');
      return;
    }
    if (this.saved == null) {
      this.result = { kind: 'no-record' };
      this.status = 'off';
      this.note('no saved place');
      return;
    }
    if (typeof s.restorePersistentAnchor !== 'function') {
      this.result = { kind: 'unsupported' };
      this.status = 'unsupported';
      this.note('restorePersistentAnchor missing');
      return;
    }
    this.result = null;
    this.status = 'restoring';
    this.note(`restoring ${this.saved.uuid.slice(0, 8)}`);
    let promise: Promise<XRAnchor>;
    try {
      promise = s.restorePersistentAnchor(this.saved.uuid);
    } catch {
      this.result = { kind: 'rejected' };
      return;
    }
    promise.then(
      (anchor) => {
        if (gen !== this.generation || this.result != null) {
          // Too late (timed out, or the session ended): release it, the saved handle stays on the device.
          this.safeDelete(anchor);
          return;
        }
        if (anchor == null) {
          this.result = { kind: 'rejected' };
          return;
        }
        this.restored = anchor;
        this.note('restore resolved, waiting for a tracked pose');
      },
      () => {
        if (gen !== this.generation || this.result != null) return;
        this.result = { kind: 'rejected' };
        this.note('restore rejected');
      },
    );
  }

  /** The restore outcome once known (call every frame while the desk waits to be placed). */
  poll(frame: XRFrame | null | undefined, ref: XRReferenceSpace | null | undefined, now: number): RestoreResult | null {
    if (this.result != null) return this.result;
    if (this.restored != null && frame != null && ref != null) {
      let pose: XRPose | undefined;
      try {
        pose = frame.getPose(this.restored.anchorSpace, ref);
      } catch {
        pose = undefined;
      }
      if (pose != null) {
        const p = pose.transform.position;
        this.pos.x = p.x;
        this.pos.y = p.y;
        this.pos.z = p.z;
        const f = frameFromPose(this.pos, pose.transform.orientation);
        this.restoreSeconds = +(now - this.startedAt).toFixed(2);
        this.result = { kind: 'pose', frame: f };
        this.note(`restored pose after ${this.restoreSeconds} s`);
        return this.result;
      }
    }
    if (now - this.startedAt > ANCHOR.restoreTimeout) {
      this.result = { kind: 'timeout' };
      this.note('restore timed out');
      if (this.restored != null) {
        this.safeDelete(this.restored);
        this.restored = null;
      }
      return this.result;
    }
    return null;
  }

  /** Applies tonight's decision once the desk has its frame (from the anchor or from the surfaces). */
  commit(decision: RestoreDecision, frame: DeskFrame, mode: DeskMode, source: Source): void {
    this.decision = decision;
    const previous = this.saved;
    if (decision.record === null) {
      writeStore(DESK_ANCHOR_KEY, null);
      this.saved = null;
    } else if (decision.record !== undefined) {
      writeStore(DESK_ANCHOR_KEY, JSON.stringify(decision.record));
      this.saved = decision.record;
    }
    if (decision.persist === 'keep' && this.restored != null) {
      this.anchor = this.restored;
      this.restored = null;
      this.status = 'restored';
      // Keep the small height correction onto the detected table while following the anchor.
      this.heightOffset = this.result?.kind === 'pose' ? frame.y - this.result.frame.y : 0;
      return;
    }
    if (this.restored != null) {
      this.safeDelete(this.restored);
      this.restored = null;
    }
    // A replaced place: the old handle is deleted once the new one is saved (or now, if the runtime forgot it).
    this.staleUuid = decision.persist === 'replace' ? (previous?.uuid ?? null) : null;
    this.pending = { frame: { ...frame }, mode, source, persist: decision.persist === 'replace' ? 'replace' : 'session-only' };
  }

  /** "Move my desk": the new place becomes the remembered one. */
  moved(frame: DeskFrame, mode: DeskMode, source: Source): void {
    this.staleUuid = this.saved?.uuid ?? null;
    this.pending = { frame: { ...frame }, mode, source, persist: 'replace' };
    this.note(`moved (${source})`);
  }

  private staleUuid: string | null = null;

  /**
   * Every frame: creates a queued anchor, and returns the anchor's newer pose when the runtime moved it by a
   * real amount (the desk follows the real table). Tracking lost → null (the desk stays where it was).
   */
  track(frame: XRFrame | null | undefined, ref: XRReferenceSpace | null | undefined, desk: DeskFrame | null, now: number): DeskFrame | null {
    if (frame == null || ref == null) return null;
    if (this.pending != null && !this.creating) this.create(frame, ref);
    const anchor = this.anchor;
    if (anchor == null || desk == null) return null;
    // Relocalisation corrections are rare and small: looking ≈ 4 times a second is plenty, and keeps the
    // per-frame cost (getPose allocates) out of most frames.
    if (now - this.lastTrackAt < TRACK_INTERVAL) return null;
    this.lastTrackAt = now;
    let pose: XRPose | undefined;
    try {
      pose = frame.getPose(anchor.anchorSpace, ref);
    } catch {
      pose = undefined;
    }
    if (pose == null) {
      if (this.lostSince < 0) this.lostSince = now;
      else if (now - this.lostSince > 1.2 && this.status !== 'lost') {
        this.status = 'lost';
        this.note('anchor not tracked: the desk stays where it is');
      }
      return null;
    }
    if (this.lostSince >= 0) {
      this.lostSince = -1;
      if (this.status === 'lost') {
        this.status = 'anchored';
        this.note('anchor tracked again');
      }
    }
    const p = pose.transform.position;
    this.pos.x = p.x;
    this.pos.y = p.y;
    this.pos.z = p.z;
    frameFromPose(this.pos, pose.transform.orientation, this.tracked);
    // The restored frame may have been corrected in height (judgeRestored): follow only horizontal/yaw changes
    // relative to the anchor's own height then. Simple rule: keep the desk's height offset from the anchor.
    this.tracked.y += this.heightOffset;
    return shouldFollow(desk, this.tracked) ? this.tracked : null;
  }

  /** Desk height minus anchor height (a restored desk snapped onto the detected table top). */
  heightOffset = 0;

  private create(frame: XRFrame, ref: XRReferenceSpace): void {
    const job = this.pending;
    this.pending = null;
    if (job == null) return;
    if (typeof frame.createAnchor !== 'function' || typeof XRRigidTransform === 'undefined') {
      this.status = 'unsupported';
      this.note('createAnchor missing: tonight only, without an anchor');
      return;
    }
    const gen = this.generation;
    const session = this.session;
    this.creating = true;
    this.status = 'anchoring';
    this.heightOffset = 0;
    const q = poseQuaternion(job.frame.yaw);
    let promise: Promise<XRAnchor> | undefined;
    try {
      promise = frame.createAnchor(new XRRigidTransform({ x: job.frame.x, y: job.frame.y, z: job.frame.z }, q), ref);
    } catch {
      promise = undefined;
    }
    if (promise == null) {
      this.creating = false;
      this.status = 'session-only';
      return;
    }
    promise
      .then(async (created) => {
        if (gen !== this.generation || created == null) {
          if (created != null) this.safeDelete(created);
          return;
        }
        if (this.anchor != null && this.anchor !== created) this.safeDelete(this.anchor);
        this.anchor = created;
        this.status = 'anchored';
        this.note(`anchored (${job.source}, ${job.persist})`);
        if (job.persist !== 'replace' || typeof created.requestPersistentHandle !== 'function') {
          this.status = 'session-only';
          return;
        }
        const uuid = await this.persist(created, session);
        if (gen !== this.generation) return;
        if (uuid == null) {
          this.status = 'session-only';
          this.note('persistent handle refused: tonight only');
          return;
        }
        this.saved = newRecord(uuid, job.mode, job.source, Date.now());
        writeStore(DESK_ANCHOR_KEY, JSON.stringify(this.saved));
        this.status = 'persisted';
        this.note(`persisted ${uuid.slice(0, 8)}`);
        const stale = this.staleUuid;
        this.staleUuid = null;
        if (stale != null && stale !== uuid) void this.forget(session, stale);
      })
      .catch(() => {
        if (gen === this.generation) {
          this.status = 'session-only';
          this.note('createAnchor failed: tonight only');
        }
      })
      .finally(() => {
        if (gen === this.generation) this.creating = false;
      });
  }

  /** requestPersistentHandle, retried once after freeing leftover slots (Quest: 8 per site). */
  private async persist(anchor: XRAnchor, session: XRSession | null): Promise<string | null> {
    const ask = async (): Promise<string | null> => {
      try {
        const uuid = await anchor.requestPersistentHandle!();
        return typeof uuid === 'string' && uuid.length > 0 ? uuid : null;
      } catch {
        return null;
      }
    };
    const first = await ask();
    if (first != null) return first;
    const list = session?.persistentAnchors;
    if (session == null || list == null || typeof session.deletePersistentAnchor !== 'function') return null;
    const prune = anchorsToPrune(Array.from(list), [this.saved?.uuid, this.staleUuid, readStore(IWSDK_ANCHOR_KEY)]);
    if (prune.length === 0) return null;
    for (const uuid of prune) await this.forget(session, uuid);
    this.note(`pruned ${prune.length} leftover anchor(s)`);
    return ask();
  }

  private async forget(session: XRSession | null, uuid: string): Promise<void> {
    if (session == null || typeof session.deletePersistentAnchor !== 'function') return;
    try {
      await session.deletePersistentAnchor(uuid);
      this.note(`deleted old handle ${uuid.slice(0, 8)}`);
    } catch {
      // Already unknown to the runtime: nothing to free.
    }
  }

  private safeDelete(anchor: XRAnchor | null | undefined): void {
    try {
      anchor?.delete();
    } catch {
      // Session already over.
    }
  }

  end(): void {
    this.generation++;
    this.safeDelete(this.anchor);
    this.safeDelete(this.restored);
    this.anchor = null;
    this.restored = null;
    this.pending = null;
    this.creating = false;
    this.lostSince = -1;
    this.heightOffset = 0;
    this.session = null;
    this.result = null;
    if (this.status !== 'off') this.status = 'off';
  }

  /** Debug API / report. */
  debug(): Record<string, unknown> {
    return {
      status: this.status,
      saved: this.saved == null ? null : { ...this.saved, uuid: `${this.saved.uuid.slice(0, 8)}…` },
      decision: this.decision == null ? null : { place: this.decision.place, persist: this.decision.persist, why: this.decision.why, bearing: this.decision.bearing },
      restoreSeconds: this.restoreSeconds,
      hasAnchor: this.anchor != null,
      log: this.log.slice(-12),
    };
  }
}
