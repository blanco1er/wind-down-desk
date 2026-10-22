/**
 * Hit-test probe: five rays from the head, forward and down, while the desk looks for a table.
 *
 * Meta Quest Browser answers WebXR hit tests from the live depth sensor on Quest 3 / 3S since Horizon Browser
 * 40.4 (Oct 2025), so this finds a table top even in a room that was never scanned (no Space Setup, no planes).
 * Only runs during placement (≤ a few seconds), then its sources are cancelled. The points are judged by
 * logic/surfaces.ts (surfaceFromHits). Missing feature / API → it simply stays empty.
 */
import type { SurfaceHit } from '../logic/surfaces.ts';

/**
 * (pitch, yaw) of each ray in degrees, RELATIVE TO THE GAZE (viewer space: −Z ahead, +Y up). The viewer space
 * already carries the head's pitch: a seated person looking at a table holds the head ≈ 20–35° down, so these
 * land ≈ 25–70° below the horizon. (First version used −35…−65° here: with the head at −30° the rays went
 * straight down and hit the emulator's furniture under the seat; on a Quest they would see your own knees.)
 */
const RAYS: ReadonlyArray<[number, number]> = [
  [-5, 0],
  [-20, 0],
  [-35, 0],
  [-20, -25],
  [-20, 25],
];
const KEEP = 60;
const WINDOW_MS = 1500;

export class SurfaceProbe {
  status: 'off' | 'starting' | 'on' | 'unsupported' = 'off';
  private sources: XRHitTestSource[] = [];
  private readonly ring: Array<SurfaceHit & { t: number }> = [];
  private generation = 0;

  async start(session: XRSession | null | undefined): Promise<void> {
    if (this.status === 'on' || this.status === 'starting') return;
    const gen = ++this.generation;
    const features = session?.enabledFeatures as readonly string[] | undefined;
    if (session == null || typeof session.requestHitTestSource !== 'function' || (features != null && !features.includes('hit-test')) || typeof XRRay === 'undefined') {
      this.status = 'unsupported';
      return;
    }
    this.status = 'starting';
    try {
      const viewer = await session.requestReferenceSpace('viewer');
      const sources: XRHitTestSource[] = [];
      for (const [pitchDeg, yawDeg] of RAYS) {
        const p = (pitchDeg * Math.PI) / 180;
        const y = (yawDeg * Math.PI) / 180;
        const dir = { x: Math.sin(y) * Math.cos(p), y: Math.sin(p), z: -Math.cos(y) * Math.cos(p), w: 0 };
        const source = await session.requestHitTestSource({ space: viewer, offsetRay: new XRRay({ x: 0, y: 0, z: 0, w: 1 }, dir) });
        if (source != null) sources.push(source);
      }
      if (gen !== this.generation) {
        for (const s of sources) s.cancel();
        return;
      }
      this.sources = sources;
      this.status = sources.length > 0 ? 'on' : 'unsupported';
    } catch {
      if (gen === this.generation) this.status = 'unsupported';
    }
  }

  /** Collects this frame's hits (first result of each ray). */
  update(frame: XRFrame | null | undefined, ref: XRReferenceSpace | null | undefined): void {
    if (this.status !== 'on' || frame == null || ref == null) return;
    const t = performance.now();
    for (const source of this.sources) {
      let pose: XRPose | undefined;
      try {
        pose = frame.getHitTestResults(source)[0]?.getPose(ref);
      } catch {
        pose = undefined;
      }
      if (pose == null) continue;
      const p = pose.transform.position;
      const q = pose.transform.orientation;
      // The hit pose's +Y axis is the surface normal: its world y component.
      const up = 1 - 2 * (q.x * q.x + q.z * q.z);
      if (this.ring.length >= KEEP) this.ring.shift();
      this.ring.push({ x: p.x, y: p.y, z: p.z, up, t });
    }
  }

  /** Hits of the last 1.5 s. */
  recent(): SurfaceHit[] {
    const since = performance.now() - WINDOW_MS;
    return this.ring.filter((h) => h.t >= since);
  }

  get count(): number {
    return this.ring.length;
  }

  stop(): void {
    this.generation++;
    for (const s of this.sources) {
      try {
        s.cancel();
      } catch {
        // Session already over.
      }
    }
    this.sources = [];
    this.ring.length = 0;
    if (this.status !== 'unsupported') this.status = 'off';
  }
}
