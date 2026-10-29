// 29 Oct (v9 film): IWER has three hand poses (relaxed, pinch, point) and no fist: its "point" pose keeps the index
// straight, which reads as pointing, not squeezing. This adds a "fist" pose to the EMULATOR's input (not to the app):
// the point pose with the index finger curled like the middle finger (same joint chain, moved to the index's
// knuckle). The app reads it through the same joint poses as a real fist.
export const installFist = (f) =>
  f.evaluate(() => {
    for (const side of ['left', 'right']) {
      const h = window.IWER_DEVICE.hands[side];
      const sym = Object.getOwnPropertySymbols(h).find((s) => h[s] != null && h[s].poses != null);
      const poses = h[sym].poses;
      if (poses.fist) continue;
      const P = poses.point.jointTransforms;
      const fist = { jointTransforms: {}, gripOffsetMatrix: poses.point.gripOffsetMatrix };
      for (const [k, v] of Object.entries(P)) fist.jointTransforms[k] = { offsetMatrix: v.offsetMatrix.slice(), radius: v.radius };
      const im = P['index-finger-metacarpal'].offsetMatrix;
      const mm = P['middle-finger-metacarpal'].offsetMatrix;
      const d = [im[12] - mm[12], im[13] - mm[13], im[14] - mm[14]];
      for (const j of ['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip']) {
        const m = P[`middle-finger-${j}`].offsetMatrix.slice();
        m[12] += d[0]; m[13] += d[1]; m[14] += d[2];
        fist.jointTransforms[`index-finger-${j}`] = { offsetMatrix: m, radius: P[`index-finger-${j}`].radius };
      }
      poses.fist = fist;
    }
    return Object.keys(window.IWER_DEVICE.hands.right[Object.getOwnPropertySymbols(window.IWER_DEVICE.hands.right).find((s) => window.IWER_DEVICE.hands.right[s]?.poses)].poses);
  });
