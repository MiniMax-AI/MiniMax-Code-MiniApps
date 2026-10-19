// Layer record keys from Adobe Photoshop File Formats Specification.
// https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/
export const psdBlendKeys = Object.freeze({
  'source-over': 'norm',
  dissolve: 'diss',
  multiply: 'mul ',
  screen: 'scrn',
  overlay: 'over',
  darken: 'dark',
  lighten: 'lite',
  'color-dodge': 'div ',
  'color-burn': 'idiv',
  'hard-light': 'hLit',
  'soft-light': 'sLit',
  difference: 'diff',
  exclusion: 'smud',
  hue: 'hue ',
  saturation: 'sat ',
  color: 'colr',
  luminosity: 'lum ',
  'linear-burn': 'lbrn',
  'linear-dodge': 'lddg',
  subtract: 'fsub',
  divide: 'fdiv',
  'vivid-light': 'vLit',
  'linear-light': 'lLit',
  'pin-light': 'pLit',
  'hard-mix': 'hMix',
  'darker-color': 'dkCl',
  'lighter-color': 'lgCl',
});
const modes = new Map(Object.entries(psdBlendKeys).map(([mode, key]) => [key, mode]));
export function readBlendKey(key) {
  const mode = modes.get(key);
  if (!mode) throw Error(`PSD 混合模式暂不支持：${key}。请先在原软件转换图层。`);
  return mode;
}
export function writeBlendKey(mode) {
  const key = psdBlendKeys[mode];
  if (!key) throw Error(`无法导出混合模式：${mode}`);
  return key;
}
