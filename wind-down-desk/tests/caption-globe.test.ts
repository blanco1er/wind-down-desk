import assert from 'node:assert/strict';
import { test } from 'node:test';
import { globeCoversPill, skyGlobeLayout, SKY_CAPTION_MAX_SHIFT, SKY_GLOBE_MAX_X } from '../src/logic/caption-layout.ts';

// The values used in the app (desk-visuals.ts): GLOBE_SHOW, the caption plane at the back of the default 0.44 m tray,
// and the caption quad (0.72 m, the pill drawn inside it).
const GLOBE = { x: 0.1, z: -0.08, radius: 0.085 };
const CAPTION_Z = -0.44 / 2 + 0.005;
const QUAD_HALF = 0.36;
/** Right edge of a centred pill `w` metres wide (caption not pushed aside). */
const right = (w: number, shift = 0) => shift + w / 2;

test('29 Oct: the 7th-evening caption (as filmed in solidite-29oct/high-1-bureau.jpg) is no longer covered by the sky globe', () => {
  // The pill of « Seven evenings. A cup of something warm stays with you. » is ≈ 0.30 m wide: it was covered at x = 0.1.
  const pill = right(0.3);
  assert.equal(globeCoversPill(GLOBE.x, pill, CAPTION_Z, GLOBE), true, 'the old spot covered it');
  const { x, captionShift } = skyGlobeLayout(pill, CAPTION_Z, GLOBE);
  assert.equal(captionShift, 0);
  assert.ok(x > GLOBE.x && x <= SKY_GLOBE_MAX_X);
  assert.equal(globeCoversPill(x, pill + captionShift, CAPTION_Z, GLOBE), false);
});

test('a short caption keeps the globe at its usual spot, never further left', () => {
  const { x, captionShift } = skyGlobeLayout(right(0.0), CAPTION_Z, GLOBE);
  assert.ok(x >= GLOBE.x);
  assert.equal(captionShift, 0);
});

test('no caption width ever leaves the pill covered: the globe moves right, then the caption slides left', () => {
  for (let w = 0.1; w <= 2 * QUAD_HALF * 0.96 + 1e-9; w += 0.01) {
    for (const aside of [0, -0.22]) {
      const pill = right(w, aside);
      const { x, captionShift } = skyGlobeLayout(pill, CAPTION_Z, GLOBE);
      assert.ok(x <= SKY_GLOBE_MAX_X + 1e-9, `globe in frame (w ${w.toFixed(2)})`);
      assert.ok(captionShift <= 0 && captionShift >= SKY_CAPTION_MAX_SHIFT - 1e-9);
      assert.equal(globeCoversPill(x, pill + captionShift, CAPTION_Z, GLOBE), false, `w ${w.toFixed(2)} aside ${aside}`);
    }
  }
});

test('every two-line caption (pill ≤ 0.62 m) is cleared without hitting the shift bound', () => {
  for (let w = 0.26; w <= 0.62; w += 0.02) {
    const pill = right(w);
    const { x, captionShift } = skyGlobeLayout(pill, CAPTION_Z, GLOBE);
    assert.ok(captionShift > SKY_CAPTION_MAX_SHIFT, `w ${w.toFixed(2)}`);
    assert.equal(globeCoversPill(x, pill + captionShift, CAPTION_Z, GLOBE), false, `w ${w.toFixed(2)}`);
  }
});
