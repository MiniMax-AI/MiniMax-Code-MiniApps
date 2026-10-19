import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';

async function execute(code, duration = 2000) {
  const worker = new Worker(new URL('../miniapp/node/ptc-worker.mjs', import.meta.url), {
    workerData: { code, deadline: Date.now() + duration },
  });
  let calls = 0;
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('PTC 未终止')), 5000);
      worker.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      worker.on('message', (message) => {
        if (message.type === 'call') {
          calls++;
          worker.postMessage({ id: message.id, result: { value: calls } });
        } else {
          clearTimeout(timer);
          resolve({ ...message, calls });
        }
      });
    });
  } finally {
    await worker.terminate();
  }
}
const composed = await execute(
  'let sum=0; for(let i=0;i<3;i++) { const v=await editor.inspect(); if(v.value>1) sum+=v.value; } return {sum,process:typeof process,fetch:typeof fetch,require:typeof require};',
);
assert.deepEqual(composed.result, {
  sum: 5,
  process: 'undefined',
  fetch: 'undefined',
  require: 'undefined',
});
assert.equal(composed.calls, 3);
assert.match((await execute('while(true){}', 150)).error, /interrupt/i);
assert.match(
  (await execute('return new Uint8Array(64 * 1024 * 1024);')).error,
  /memory|allocation/i,
);
assert.match(
  (await execute('await editor.inspect(); throw Error("stop here")')).error,
  /stop here/,
);
console.log('PASS PTC：真实 JS 异步循环、条件、环境隔离、死循环中止、内存上限、异常返回');
