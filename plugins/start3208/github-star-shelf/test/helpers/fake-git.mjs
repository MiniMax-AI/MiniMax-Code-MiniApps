#!/usr/bin/env node
// 假 git：会 clone（建一个带 .git 的小文件夹）、fetch、reset，别的报错。
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.SHELF_FAKE_STATE || '';
const args = process.argv.slice(2);
const mode = (() => {
  try {
    return JSON.parse(readFileSync(join(dir, 'mode.json'), 'utf8'));
  } catch {
    return {};
  }
})();
if (dir) {
  const line = { tool: 'git', args, tag: process.env.SHELF_FAKE_TAG || '', GIT_TERMINAL_PROMPT: process.env.GIT_TERMINAL_PROMPT || '', GIT_LFS_SKIP_SMUDGE: process.env.GIT_LFS_SKIP_SMUDGE || '' };
  appendFileSync(join(dir, 'calls.log'), JSON.stringify(line) + '\n');
}
const fail = (message, code = 128) => {
  process.stderr.write(message + '\n');
  process.exit(code);
};

if (args.length === 1 && args[0] === '--version') {
  process.stdout.write('git version 9.9.9 (fake)\n');
  process.exit(0);
}
let i = 0;
while (args[i] === '-c') i += 2; // -c key=value
if (args[i] === '-C') i += 2; // -C <dir>
const cmd = args[i];
if (cmd === 'clone') {
  if (mode.gitPidFile) writeFileSync(mode.gitPidFile, String(process.pid));
  if (mode.cloneSlowMs) await new Promise((r) => setTimeout(r, mode.cloneSlowMs));
  if (mode.cloneFail) fail("fatal: unable to access 'https://github.com/x/y.git/': Could not resolve host: github.com");
  const dest = args[args.length - 1];
  const url = args[args.length - 2];
  const full = /github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/.exec(url)?.[1] || 'unknown/unknown';
  mkdirSync(join(dest, '.git'), { recursive: true });
  mkdirSync(join(dest, 'src'), { recursive: true });
  writeFileSync(join(dest, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  writeFileSync(join(dest, 'README.md'), '# ' + full + '\n\nCloned by the fake git.\n');
  writeFileSync(join(dest, 'src', 'index.js'), "console.log('hello from ' + " + JSON.stringify(full) + ');\n');
  process.exit(0);
}
if (cmd === 'fetch' || cmd === 'reset') {
  if (mode.fetchFail) fail('fatal: unable to access: Could not resolve host: github.com');
  process.exit(0);
}
fail('fake git: unsupported command ' + args.join(' '), 2);
