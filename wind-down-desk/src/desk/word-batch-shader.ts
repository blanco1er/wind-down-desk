/**
 * 29 Oct — the card shader (materials.ts createCardMaterial) rewritten for the instanced word chips (word-batch.ts):
 * per-instance UV rectangle (the chip's row in the atlas) and fade (opacity, hover) instead of uniforms. Pure (text),
 * unit-tested: any change to the card shader either follows, or the rewrite returns null and the chips draw themselves.
 */
/** The card shader → instanced: per-instance UV rectangle (atlas row) and fade (opacity, hover). Null if it changed. */
export function instancedCardShaders(vertex: string, fragment: string): { vertexShader: string; fragmentShader: string } | null {
  const mainV = vertex.indexOf('void main() {');
  const mainF = fragment.indexOf('void main() {');
  if (mainV < 0 || mainF < 0 || !vertex.includes('vUv = uv;')) return null;
  if (!/uniform float uOpacity;/u.test(fragment) || !/uniform float uHighlight;/u.test(fragment)) return null;
  const vHead = vertex.slice(0, mainV);
  const vBody = vertex
    .slice(mainV + 'void main() {'.length)
    .replace('vUv = uv;', 'vUv = mix(iRect.xy, iRect.zw, uv);\n        vFade = iFade;')
    .replace(/\bmodelMatrix\b/gu, 'iModel');
  const v = `${vHead}attribute vec4 iRect;\n      attribute vec2 iFade;\n      varying vec2 vFade;\n      void main() {\n        mat4 iModel = modelMatrix * instanceMatrix;${vBody}`;
  let f = fragment.replace(/\n\s*uniform float uOpacity;/u, '').replace(/\n\s*uniform float uHighlight;/u, '');
  const at = f.indexOf('void main() {');
  f = `${f.slice(0, at)}varying vec2 vFade;\n      #define uOpacity vFade.x\n      #define uHighlight vFade.y\n      ${f.slice(at)}`;
  return { vertexShader: v, fragmentShader: f };
}

