import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';
await build({
  entryPoints: [new URL('./worker.mjs', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: true,
  outfile: new URL('../miniapp/node/ptc-worker.mjs', import.meta.url).pathname,
});
await copyFile(
  new URL(
    './node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm',
    import.meta.url,
  ),
  new URL('../miniapp/node/quickjs.wasm', import.meta.url),
);
