import assert from 'node:assert/strict';
import { drawStrokes } from '../miniapp/client/photocraft/draw.js';
const stroke = { points: [[0, 0, .2], [10, 10, .7]], size: 2 };
let version = 'v0', count = 0;
const events = [];
const call = async (method, args, expected) => {
  if (method === 'inspect') return { version };
  assert.equal(expected, version);
  events.push('stroke');
  version = `v${++count}`;
  return { state: { version } };
};
const result = await drawStrokes({ strokes: [stroke, stroke] }, 'v0', call, async () => events.push('render'));
assert.deepEqual(events, ['stroke', 'render', 'stroke', 'render']);
assert.equal(result.state.version, 'v2');
await assert.rejects(drawStrokes({ strokes: [stroke] }, 'v0', call), /document changed/);
await assert.rejects(drawStrokes({ strokes: [] }, version, call), /1..96/);
await assert.rejects(drawStrokes({ strokes: [stroke], intervalMs: 0 }, version, call), /100 and 600/);
let executed = 0;
await assert.rejects(drawStrokes({ strokes: [stroke, stroke] }, version, async (...args) => {
  if (args[0] === 'execute' && ++executed === 2) throw Error('invalid brush');
  return call(...args);
}, async () => {}), /after 1\/2 strokes; completed strokes remain/);
assert.equal(count, 3);
console.log('PASS draw: visible sequential edits, version tracking, validation and partial failure');

const { pathPoints, brushParameters } = await import('../miniapp/client/photocraft/draw-path.js');
const samples = [[1,2], [3,4,0,12,13,14,15,16], {x:5,y:6}, {x:7,y:8,pressure:.8}];
const originalSamples = structuredClone(samples);
assert.deepEqual(brushParameters({points:samples,pressure:.5}).points,
  [[1,2,.5], [3,4,0,12,13,14,15,16], {x:5,y:6,pressure:.5}, {x:7,y:8,pressure:.8}]);
assert.deepEqual(samples, originalSamples);
assert.equal(brushParameters({points:samples}).points, samples);
await assert.rejects(drawStrokes({strokes:[stroke,{points:[[0,0]],pressure:2}]}, version,
  async () => { throw Error('must validate before editing'); }), /pressure must/);
console.log('PASS pressure: stroke defaults, per-point override, extended samples and pre-edit validation');
const curve = pathPoints([['M',0,0],['C',0,100,100,100,100,0]], .5);
assert.deepEqual(curve[0], [0,0,.5]);
assert.deepEqual(curve.at(-1), [100,0,.5]);
assert.ok(Math.max(...curve.map(p=>p[1])) > 74);
assert.ok(curve.every(p=>p[0]>=0 && p[0]<=100 && p[1]>=0 && p[1]<=75));
assert.throws(()=>pathPoints([['L',0,0]]), /start with M/);
assert.throws(()=>pathPoints([['M',0,0],['C',1,2,3,NaN,4,5]]), /absolute/);
assert.deepEqual(pathPoints([['M',1,2],['L',3,4],['Z']]).at(-1), [1,2,1]);
console.log('PASS paths: curve endpoints, smooth bounds, closure and invalid geometry');
