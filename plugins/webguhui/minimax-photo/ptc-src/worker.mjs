import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-wasmfile-release-sync';

// User code only runs inside QuickJS. No Node objects enter that VM.
const bytes = await readFile(new URL('./quickjs.wasm', import.meta.url));
const module = await newQuickJSWASMModuleFromVariant(newVariant(variant, { wasmBinary: bytes }));
const runtime = module.newRuntime();
runtime.setMemoryLimit(32 * 1024 * 1024);
runtime.setMaxStackSize(512 * 1024);
runtime.setInterruptHandler(() => Date.now() > workerData.deadline);
const vm = runtime.newContext();
let sequence = 0,
  done = false;
const pending = new Map();
function fail(error) {
  if (!done) {
    done = true;
    parentPort.postMessage({ type: 'done', error: String(error).slice(0, 2000) });
  }
}
function pump() {
  if (done) return;
  const result = runtime.executePendingJobs(100);
  if (result.error) {
    const error = vm.dump(result.error);
    result.error.dispose();
    fail(error.message || JSON.stringify(error));
  }
}
vm.newFunction('__call', (name, input) => {
  const method = vm.getString(name),
    json = vm.getString(input);
  if (json.length > 65536) return { error: vm.newError('工具参数超过 64 KB') };
  const promise = vm.newPromise(),
    id = ++sequence;
  pending.set(id, promise);
  parentPort.postMessage({ type: 'call', id, method, args: JSON.parse(json) });
  return promise.handle;
}).consume((handle) => vm.setProp(vm.global, '__call', handle));
vm.newFunction('__done', (value, error) => {
  if (pending.size) return fail('存在未 await 的工具调用，请查询 trace 中的任务结果');
  const json = vm.getString(value);
  if (json.length > 65536) return fail('脚本返回值超过 64 KB');
  if (!done) {
    done = true;
    parentPort.postMessage({
      type: 'done',
      result: JSON.parse(json),
      error: vm.getString(error) || undefined,
    });
  }
}).consume((handle) => vm.setProp(vm.global, '__done', handle));
parentPort.on('message', (message) => {
  if (done) return;
  const promise = pending.get(message.id);
  if (!promise) return;
  pending.delete(message.id);
  const value = message.error
    ? vm.newError(message.error)
    : vm.newString(JSON.stringify(message.result));
  if (message.error) promise.reject(value);
  else promise.resolve(value);
  value.dispose();
  promise.dispose();
  pump();
});
const source = `
const editor = Object.freeze(Object.fromEntries(
  ['inspect','capabilities','preview','edit','create','export','commands','execute','draw'].map(name =>
    [name, async (args) => JSON.parse(await __call(name, JSON.stringify(args ?? null)))])
));
(async () => { ${workerData.code}\n })()
  .then(value => __done(JSON.stringify(value ?? null), ''))
  .catch(error => __done('null', String(error) + '\\n' + String(error?.stack || '')));
`;
const evaluated = vm.evalCode(source, 'editor-script.js');
if (evaluated.error) {
  const error = vm.dump(evaluated.error);
  evaluated.error.dispose();
  fail(error.message || JSON.stringify(error));
} else evaluated.value.dispose();
pump();
setInterval(pump, 10);
