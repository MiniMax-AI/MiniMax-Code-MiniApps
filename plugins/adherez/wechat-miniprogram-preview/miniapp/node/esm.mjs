import { transformJavaScript } from './vendor/js-transform.mjs';

export function transformEsm(source, options = {}) {
  return transformJavaScript(source, options);
}
