import assert from 'node:assert/strict';
import { operationPaths, projectPoint, validViewport } from '../miniapp/client/photo-activity.js';
const view = {
  origin: [100, 200],
  xAxis: [0, 2],
  yAxis: [-2, 0],
  size: [800, 600],
  clip: [20, 20, 600, 500],
};
assert.deepEqual(projectPoint([10, 20], view), [60, 220]);
assert.ok(validViewport(view));
assert.ok(!validViewport({ ...view, size: [0, 600] }));
assert.deepEqual(
  operationPaths('execute', {
    command: 'paint.stroke',
    params: { points: [[NaN, 0]] },
  }),
  [],
);
assert.deepEqual(operationPaths('preview', {}), []);
const points = Array.from({ length: 5000 }, (_, i) => [i, i === 1 ? 9000 : 0]);
const input = { command: 'paint.stroke', params: { points, size: 20 } };
const original = JSON.stringify(input);
const [path] = operationPaths('execute', input);
assert.ok(path.points.length <= 513);
assert.deepEqual(path.points.at(-1), points.at(-1));
assert.deepEqual(path.bounds, [0, 0, 4999, 9000]);
assert.equal(JSON.stringify(input), original);
assert.equal(operationPaths('batch', Array(64).fill(input)).length, 8);
assert.deepEqual(operationPaths('batch', [input, { command: 'image.rotate', params: {} }]), []);
console.log(
  'PASS activity: rotated coordinates, invalid input, bounded replay, full bounds, unchanged commands',
);
