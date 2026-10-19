import { brushParameters } from './draw-path.js';
// Each stroke is an actual engine edit. Never simulate progress over a finished image.
export async function drawStrokes(args, expectedVersion, call, wait = ms => new Promise(r => setTimeout(r, ms))) {
  const { strokes, intervalMs = 550 } = args || {};
  if (!Array.isArray(strokes) || strokes.length < 1 || strokes.length > 96)
    throw Error(`draw requires 1..96 strokes; received ${strokes?.length}. Split the array with strokes.slice(i, i + 96).`);
  if (!Number.isFinite(intervalMs) || intervalMs < 100 || intervalMs > 600)
    throw Error('intervalMs must be between 100 and 600');
  // Validate and flatten all geometry before applying the first stroke.
  const prepared = strokes.map(brushParameters);
  let state = await call('inspect');
  if (state.version !== expectedVersion) throw Error('document changed; inspect again');
  let completed = 0;
  try {
    for (const params of prepared) {
      const result = await call('execute', { command: 'paint.stroke', params }, state.version);
      state = result.state;
      completed++;
      // Allow the WASM canvas to render before the next real stroke is submitted.
      await wait(intervalMs);
    }
  } catch (error) {
    throw Error(`draw stopped after ${completed}/${strokes.length} strokes; completed strokes remain. ${error}`);
  }
  return { value: { completed }, state };
}
