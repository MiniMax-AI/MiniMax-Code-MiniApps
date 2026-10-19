import { blendPixel } from './blending.js';
// The patch carries brush coverage. Drawing with source-atop preserves the
// destination alpha while the color blend retains its original luminance.
export function colorReplacementPatch(pixels, coverage, color) {
  const result = new Uint8ClampedArray(coverage);
  const rgb = [0, 0, 0];
  for (let i = 0; i < result.length; i += 4) {
    if (!result[i + 3]) continue;
    result.set(color, i);
    blendPixel('color', pixels, result, i, rgb);
    result[i] = rgb[0];
    result[i + 1] = rgb[1];
    result[i + 2] = rgb[2];
  }
  return result;
}
