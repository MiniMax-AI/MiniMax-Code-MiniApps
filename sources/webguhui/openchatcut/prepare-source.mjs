import { mkdir, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const source = import.meta.dirname;
if (!process.argv[2]) throw new Error('Usage: node prepare-source.mjs <new-build-directory>');
const destination = resolve(process.argv[2]);
await mkdir(destination); // Refuse to overwrite an existing checkout.
const upstream = join(destination, 'upstream');
const run = (args) => execFileSync('git', args, { stdio: 'inherit' });
run(['clone', 'https://github.com/0xsline/OpenChatCut.git', upstream]);
run(['-C', upstream, 'checkout', '--detach', '2e6f4a29b784200cfb32b859b16f2561592bc3e8']);
run(['-C', upstream, 'apply', join(source, 'upstream.patch')]);
await cp(join(source, 'overlay'), upstream, { recursive: true });
await cp(join(source, 'adapter'), destination, { recursive: true });
const plugin = resolve(source, '../../../plugins/webguhui/openchatcut');
for (const file of ['INSTALL.md', 'README.md', 'README.zh-CN.md', 'LICENSE', 'package.json', 'servers.mcp.json', 'icon.png', '.minimax-plugin', 'miniapp/miniapp.json', 'miniapp/node/server.mjs', 'miniapp/node/setup-server.mjs', 'miniapp/node/install-dependencies.mjs', 'miniapp/node/native-dependencies.json', 'miniapp/node/lazy-resources.mjs', 'miniapp/node/resource-manifest.json']) {
  await cp(join(plugin, file), join(destination, file), { recursive: true });
}
console.log(`Prepared ${upstream}. Follow README.md to install build dependencies and compile.`);
