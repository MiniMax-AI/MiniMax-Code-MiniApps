import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
await build({
  entryPoints: [root + 'workbench.tsx'],
  outfile: root + '../miniapp/client/workbench-ui.js',
  bundle: true,
  external: ['./photo-i18n.js'],
  format: 'esm',
  minify: true,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'linked',
});
execFileSync(
  process.execPath,
  [
    root + 'node_modules/@tailwindcss/cli/dist/index.mjs',
    '-i',
    root + 'theme.css',
    '-o',
    root + '../miniapp/client/components.css',
    '--minify',
  ],
  { stdio: 'inherit', cwd: root },
);
