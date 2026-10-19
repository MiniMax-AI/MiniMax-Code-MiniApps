import { filterPixels } from './filters.js';
self.onmessage = ({ data: { id, buffer, width, height, type, value } }) => {
  try {
    const out = filterPixels(new Uint8ClampedArray(buffer), width, height, type, value);
    self.postMessage({ id, buffer: out.buffer }, [out.buffer]);
  } catch (e) {
    self.postMessage({ id, error: e.message });
  }
};
