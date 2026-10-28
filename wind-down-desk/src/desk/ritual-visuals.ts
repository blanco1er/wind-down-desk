/**
 * v6: what the two new rituals add to the desk, on top of DeskVisuals (same tray, same lamp).
 *
 *   Breathe   the lamp's globe becomes a soft moon above the tray (DeskVisuals.orbTo), a row of glass
 *             pearls (one per breath), the moon's warm light on your open hands, slow motes rising and
 *             falling with the breath, the room dimming a little on each exhale.
 *   Release   a polished black bowl of still water rises out of the tray; the lamp floats behind it and
 *             is mirrored in the water; ripples, bubbles and light when the stone sinks.
 *
 * Draw calls while in use (per eye): bowl 1 + water 1 (Release) · pearls 1 + palm glow 1 + dimmer 1 (Breathe).
 * Nothing here is drawn (or updated) when no ritual needs it.
 */
import { Group, Mesh, Vector3, type World } from '@iwsdk/core';
import { WATER_BOWL } from '../logic/release.ts';
import type { DeskVisuals } from './desk-visuals.ts';
import { rig, timeUniform } from './materials.ts';
import { createBlackBowlGeometry, createPalmGlowGeometry, createPearlsGeometry, createWaterGeometry } from './ritual-geometry.ts';
import { createBlackBowlMaterial, createDimmerMaterial, createPalmGlowMaterial, createPearlMaterial, createWaterMaterial, MAX_BUBBLES, MAX_PEARLS, MAX_RIPPLES, type PalmUniforms, type PearlUniforms, type WaterUniforms } from './ritual-materials.ts';
import { SphereGeometry } from '@iwsdk/core';

function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/** Desk-local row of pearls, in front of the moon. */
export const PEARL_ROW = { x: 0, z: 0.125, spacing: 0.031, radius: 0.0092 } as const;
/** The breathing moon's pose lives with the lamp's geometry (shared with tests/breathe-replies.test.ts). */
export { MOON } from './geometry.ts';

export class RitualVisuals {
  readonly bowl = new Group();
  readonly water: Mesh;
  readonly waterUniforms: WaterUniforms;
  private readonly bowlMesh: Mesh;
  readonly pearls: Mesh;
  readonly pearlUniforms: PearlUniforms;
  readonly palm: Mesh;
  readonly palmUniforms: PalmUniforms;
  readonly dimmer: Mesh;
  private readonly desk: DeskVisuals;
  private nextRipple = 0;
  private nextBubble = 0;

  /** Animated targets. */
  bowlTarget = 0;
  private bowlRise = 0;
  pearlTarget = 0;
  private pearlShow = 0;
  dimTarget = 0;
  /** The evening's own dimming of your room (passthrough on Quest, the photo room in the emulator); Breathe adds to it. */
  eveningDim = 0;
  private readonly pearlLitTarget = new Array<number>(MAX_PEARLS).fill(0);

  constructor(world: World, desk: DeskVisuals) {
    this.desk = desk;
    // Black bowl + water, children of the desk: they rise out of the tray.
    this.bowlMesh = new Mesh(createBlackBowlGeometry(), createBlackBowlMaterial());
    this.bowlMesh.renderOrder = 1;
    this.bowlMesh.raycast = () => {};
    const water = createWaterMaterial(WATER_BOWL.inner - 0.0008);
    this.waterUniforms = water.uniforms;
    this.water = new Mesh(createWaterGeometry(), water);
    this.water.position.y = WATER_BOWL.water;
    this.water.renderOrder = 5;
    this.water.raycast = () => {};
    this.bowl.add(this.bowlMesh, this.water);
    this.bowl.position.set(WATER_BOWL.x, -WATER_BOWL.height - 0.006, WATER_BOWL.z);
    this.bowl.visible = false;
    desk.root.add(this.bowl);

    const pearl = createPearlMaterial();
    this.pearlUniforms = pearl.uniforms;
    pearl.uniforms.uSpacing.value = PEARL_ROW.spacing;
    pearl.uniforms.uRadius.value = PEARL_ROW.radius;
    this.pearls = new Mesh(createPearlsGeometry(), pearl);
    this.pearls.position.set(PEARL_ROW.x, 0, PEARL_ROW.z);
    this.pearls.renderOrder = 2;
    this.pearls.visible = false;
    this.pearls.raycast = () => {};
    desk.root.add(this.pearls);

    const palm = createPalmGlowMaterial();
    this.palmUniforms = palm.uniforms;
    this.palm = new Mesh(createPalmGlowGeometry(), palm);
    this.palm.frustumCulled = false;
    this.palm.renderOrder = 11;
    this.palm.visible = false;
    this.palm.raycast = () => {};
    world.createTransformEntity(this.palm);

    this.dimmer = new Mesh(new SphereGeometry(1, 12, 6), createDimmerMaterial());
    this.dimmer.frustumCulled = false;
    this.dimmer.renderOrder = -7;
    this.dimmer.visible = false;
    this.dimmer.raycast = () => {};
    world.createTransformEntity(this.dimmer);
  }

  // ------------------------------------------------------------------ Release

  /** Starts concentric ripples at a desk-local point (amplitude in metres, ≈ 1 mm). */
  ripple(x: number, z: number, amplitude = 0.0012): void {
    const r = this.waterUniforms.uRipples.value[this.nextRipple];
    this.nextRipple = (this.nextRipple + 1) % MAX_RIPPLES;
    r.set(x - WATER_BOWL.x, z - WATER_BOWL.z, timeUniform.value, amplitude);
  }

  /** A few warm bubbles popping around a desk-local point, staggered over `spread` seconds. */
  bubbles(x: number, z: number, count = 4, spread = 1.2): void {
    for (let i = 0; i < count; i++) {
      const b = this.waterUniforms.uBubbles.value[this.nextBubble];
      this.nextBubble = (this.nextBubble + 1) % MAX_BUBBLES;
      const a = i * 2.39996 + timeUniform.value;
      const r = 0.006 + 0.012 * ((i * 0.618) % 1);
      b.set(x - WATER_BOWL.x + Math.cos(a) * r, z - WATER_BOWL.z + Math.sin(a) * r, timeUniform.value + 0.15 + (i / Math.max(1, count - 1)) * spread, 0.0035 + 0.0025 * ((i * 0.37) % 1));
    }
  }

  /** A stone held over the water (desk-local x, z), or none. */
  hover(x: number, z: number, strength: number): void {
    this.waterUniforms.uHover.value.set(x - WATER_BOWL.x, z - WATER_BOWL.z, strength);
  }

  /** The engraving's light under the water (desk-local x, z), 0..1. */
  under(x: number, z: number, strength: number): void {
    this.waterUniforms.uUnder.value.set(x - WATER_BOWL.x, z - WATER_BOWL.z, strength);
  }

  /** World height of the water surface right now (the stone darkens under it). */
  waterWorldY(): number {
    return this.desk.root.position.y + this.bowl.position.y + WATER_BOWL.water;
  }

  /** Desk-local height offset of the bowl (it rises out of the tray). */
  get bowlOffset(): number {
    return this.bowl.position.y;
  }

  get bowlShown(): number {
    return this.bowlRise;
  }

  // ------------------------------------------------------------------ Breathe

  setPearlCount(count: number): void {
    this.pearlUniforms.uCount.value = Math.min(MAX_PEARLS, count);
  }

  /** Pearl i is lit (0..1, eased in). `current`: the pearl being breathed now, `breath`: 0..1. */
  setPearl(i: number, lit: number): void {
    if (i >= 0 && i < MAX_PEARLS) this.pearlLitTarget[i] = lit;
  }

  clearPearls(): void {
    this.pearlLitTarget.fill(0);
    this.pearlUniforms.uLit.value.fill(0);
  }

  setBreath(current: number, breath: number): void {
    this.pearlUniforms.uCurrent.value = current;
    this.pearlUniforms.uBreath.value = breath;
  }

  /** Warm light on each palm (world positions), 0..1 each; null hides it. */
  palms(left: Vector3 | null, right: Vector3 | null, strengthL: number, strengthR: number): void {
    const u = this.palmUniforms;
    if (left != null) u.uPalm.value[0].copy(left);
    if (right != null) u.uPalm.value[1].copy(right);
    u.uStrength.value[0] = left == null ? 0 : strengthL;
    u.uStrength.value[1] = right == null ? 0 : strengthR;
    this.palm.visible = u.uStrength.value[0] > 0.004 || u.uStrength.value[1] > 0.004;
  }

  update(dt: number): void {
    // Black bowl rises out of the tray (≈ 1.4 s, eased), water appears with it.
    this.bowlRise = approach(this.bowlRise, this.bowlTarget, 2.4, dt);
    if (Math.abs(this.bowlRise - this.bowlTarget) < 0.002) this.bowlRise = this.bowlTarget;
    const k = this.bowlRise * this.bowlRise * (3 - 2 * this.bowlRise);
    this.bowl.position.y = -(1 - k) * (WATER_BOWL.height + 0.006);
    this.bowl.visible = this.bowlRise > 0.002;
    this.waterUniforms.uOpacity.value = Math.min(1, k * 1.15);
    const tray = this.desk.trayUniformsV6;
    tray.uBlackBowl.value.set(WATER_BOWL.x, WATER_BOWL.z, WATER_BOWL.outer, k);
    // Pearls.
    this.pearlShow = approach(this.pearlShow, this.pearlTarget, 2.2, dt);
    if (this.pearlTarget === 0 && this.pearlShow < 0.004) this.pearlShow = 0;
    this.pearlUniforms.uShow.value = this.pearlShow;
    this.pearls.visible = this.pearlShow > 0.003;
    const lit = this.pearlUniforms.uLit.value;
    for (let i = 0; i < MAX_PEARLS; i++) {
      lit[i] = approach(lit[i], this.pearlLitTarget[i] * Math.min(1, this.pearlShow * 1.4), 3.2, dt);
      tray.uPearlLit.value[i] = lit[i];
    }
    tray.uPearlRow.value.set(PEARL_ROW.x, PEARL_ROW.z, PEARL_ROW.spacing, this.pearlShow > 0.35 ? this.pearlUniforms.uCount.value : 0);
    // Room dimming (exhale), never the desk.
    rig.uRoomDim.value = approach(rig.uRoomDim.value, Math.max(this.dimTarget, this.eveningDim), 1.6, dt);
    this.dimmer.visible = rig.uRoomDim.value > 0.003;
  }
}
