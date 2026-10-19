// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRuleIndex, buildRuleSpecs, categoriesFor, expandSpecs, isArtifactDir, newMeta } from '../miniapp/node/rules.mjs';
import { createPathOps } from '../miniapp/node/util.mjs';

/** 内存里的假文件系统：只支持规则展开需要的 readdir / realpath。 @param {import('../miniapp/node/util.mjs').PathOps} po @param {string[]} dirs */
function fakeFs(po, dirs) {
  const set = new Map();
  for (const d of dirs) {
    let cur = po.norm(d);
    for (;;) {
      set.set(po.key(cur), cur);
      const parent = po.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }
  return {
    async readdir(/** @type {string} */ p) {
      const k = po.key(p);
      if (!set.has(k)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      const names = [];
      for (const [ck, orig] of set) if (po.key(po.dirname(orig)) === k && ck !== k) names.push(po.basename(orig));
      return names.map((name) => ({ name, isDirectory: () => true }));
    },
    async realpath(/** @type {string} */ p) {
      const hit = set.get(po.key(p));
      if (!hit) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return hit;
    },
  };
}

test('macOS 规则：固定位置、子项规则、应用缓存剩余部分、通配展开', async () => {
  const po = createPathOps('posix');
  const home = '/Users/u';
  const tmp = '/private/var/folders/ab/xyz/T';
  const specs = buildRuleSpecs({ platform: 'darwin', env: {}, home, tmpdir: tmp, goModCache: '/Users/u/go/pkg/mod', pathOps: po });
  const fs = fakeFs(po, [
    tmp,
    `${home}/.npm/_cacache`,
    `${home}/.npm/_npx`,
    `${home}/.cache/uv`,
    `${home}/Library/Caches/Google/Chrome`,
    `${home}/Library/Caches/Google/Chrome for Testing`,
    `${home}/Library/Caches/Homebrew`,
    `${home}/Library/Caches/pnpm`,
    `${home}/Library/Caches/com.foo.bar`,
    `${home}/Library/Logs`,
    `${home}/Library/pnpm/store`,
    `${home}/Downloads`,
    `${home}/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_abc/msg/file`,
    `${home}/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_abc/msg/attach`,
    `${home}/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/all_users/config`,
    `${home}/Library/Application Support/DingTalkMac/abc_v3/ImageFiles`,
    `${home}/Library/Application Support/LarkShell/sdk_storage/hash1/resources/files`,
    `${home}/Library/Containers/com.tencent.meeting/Data/Library/.nx_caches`,
    `${home}/go/pkg/mod`,
    '/Library/Caches',
    '/private/var/log',
    `${home}/.Trash`,
  ]);
  const concrete = await expandSpecs(specs, fs, po);
  const idx = buildRuleIndex({ specs: concrete, pathOps: po, platform: 'darwin', protectedKeys: [], skipPaths: [] });
  const cat = (/** @type {string} */ p) => idx.lookup(p)?.category ?? null;

  assert.equal(cat(`${home}/.npm/_cacache`), 'pkg-cache');
  assert.equal(idx.lookup(`${home}/.npm/_npx`)?.name, 'npx 缓存');
  assert.equal(cat(`${home}/.npm/_npx`), 'pkg-cache');
  assert.equal(idx.lookup(`${home}/.cache/uv`)?.name, 'uv 缓存');
  assert.equal(cat(`${home}/.cache/pip`), null, '不存在的 ~/.cache/pip 不收录');
  assert.equal(cat(`${home}/Library/Caches/Homebrew`), 'pkg-cache');
  assert.equal(cat(`${home}/Library/Caches/Google/Chrome`), 'browser-cache');
  assert.equal(cat(`${home}/Library/Caches/Google`), null, '规则目标的祖先只穿透');
  assert.equal(cat(`${home}/Library/Caches/Google/Chrome for Testing`), 'app-cache');
  assert.equal(cat(`${home}/Library/Caches/com.foo.bar`), 'app-cache');
  assert.equal(cat(`${home}/Library/Caches/pnpm`), 'pnpm-store');
  assert.equal(cat(`${home}/Library/pnpm/store`), 'pnpm-store');
  assert.equal(cat(`${home}/Library/Logs`), 'logs');
  assert.equal(cat(`${tmp}/old-thing`), 'temp');
  assert.equal(cat(`${home}/Downloads/sub/app.dmg`), 'installers');
  assert.equal(cat(`${home}/Downloads/notes.txt`), null);
  assert.equal(cat(`${home}/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_abc/msg/file`), 'chat-received');
  assert.equal(cat(`${home}/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_abc/msg/attach`), 'chat-cache');
  assert.equal(cat(`${home}/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/all_users/msg/file`), null, '不存在的通配路径不展开');
  assert.equal(cat(`${home}/Library/Application Support/DingTalkMac/abc_v3/ImageFiles`), 'chat-cache');
  assert.equal(cat(`${home}/Library/Application Support/LarkShell/sdk_storage/hash1/resources/files`), 'chat-received');
  assert.equal(cat(`${home}/Library/Containers/com.tencent.meeting/Data/Library/.nx_caches`), 'chat-cache');
  assert.equal(cat(`${home}/go/pkg/mod`), 'go-mod-cache');
  assert.equal(cat('/Library/Caches'), 'system-junk');
  assert.equal(cat('/private/var/log'), 'system-junk');
  assert.equal(cat(`${home}/.Trash`), 'trash');
  assert.equal(cat(`${home}/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw`), 'docker');
  // 快速扫描的根不嵌套
  assert.ok(idx.quickRoots.includes(`${home}/Library/Caches`));
  assert.ok(!idx.quickRoots.includes(`${home}/Library/Caches/Homebrew`));
});

test('Windows 规则：path.win32 样例路径、环境变量展开、大小写不敏感', async () => {
  const po = createPathOps('win32');
  const env = {
    USERPROFILE: 'C:\\Users\\a',
    LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local',
    APPDATA: 'C:\\Users\\a\\AppData\\Roaming',
    TEMP: 'C:\\Users\\a\\AppData\\Local\\Temp',
    SystemRoot: 'C:\\Windows',
    SystemDrive: 'C:',
  };
  const specs = buildRuleSpecs({ platform: 'win32', env, home: 'C:\\Users\\a', tmpdir: '', goModCache: 'C:\\Users\\a\\go\\pkg\\mod', pathOps: po });
  const L = env.LOCALAPPDATA;
  const fs = fakeFs(po, [
    env.TEMP,
    `${L}\\npm-cache\\_cacache`,
    `${L}\\npm-cache\\_npx`,
    `${L}\\uv\\cache`,
    'C:\\Users\\a\\.cache\\pip',
    `${L}\\Google\\Chrome\\User Data\\Default\\Cache`,
    `${L}\\Google\\Chrome\\User Data\\Profile 1\\Code Cache`,
    `${L}\\Microsoft\\Edge\\User Data\\Default\\GPUCache`,
    `${L}\\Mozilla\\Firefox\\Profiles\\x1.default\\cache2`,
    `${L}\\Microsoft\\Windows\\Explorer`,
    `${L}\\CrashDumps`,
    `${L}\\pnpm\\store`,
    `${env.APPDATA}\\Code\\Cache`,
    'C:\\Users\\a\\Downloads',
    'C:\\Users\\a\\Documents\\WeChat Files\\wxid_1\\FileStorage\\File',
    'C:\\Users\\a\\Documents\\Tencent Files\\12345\\nt_qq\\nt_data\\Pic',
    'C:\\Windows.old',
    'C:\\Windows\\SoftwareDistribution\\Download',
    'C:\\Users\\a\\.android\\avd',
    'C:\\Users\\a\\go\\pkg\\mod',
  ]);
  const concrete = await expandSpecs(specs, fs, po);
  const idx = buildRuleIndex({ specs: concrete, pathOps: po, platform: 'win32', protectedKeys: [] });
  const cat = (/** @type {string} */ p) => idx.lookup(p)?.category ?? null;

  assert.equal(cat(`${L}\\npm-cache\\_cacache`), 'pkg-cache');
  assert.equal(cat('c:\\users\\A\\appdata\\local\\NPM-CACHE\\_CACACHE'), 'pkg-cache', '不区分大小写');
  assert.equal(idx.lookup(`${L}\\npm-cache\\_npx`)?.name, 'npx 缓存');
  assert.equal(cat(`${L}\\npm-cache`), null, 'npm-cache 整体不再成项，_cacache 和 _npx 分开，避免嵌套重复统计');
  assert.equal(idx.lookup(`${L}\\uv\\cache`)?.name, 'uv 缓存');
  assert.equal(cat('C:\\Users\\a\\.cache\\pip'), 'pkg-cache');
  assert.equal(cat('C:\\Users\\a\\.cache\\pnpm'), null, '不存在时不收录');
  assert.equal(cat(`${L}\\Google\\Chrome\\User Data\\Default\\Cache`), 'browser-cache');
  assert.equal(cat(`${L}\\Google\\Chrome\\User Data\\Profile 1\\Code Cache`), 'browser-cache');
  assert.equal(cat(`${L}\\Microsoft\\Edge\\User Data\\Default\\GPUCache`), 'browser-cache');
  assert.equal(cat(`${L}\\Mozilla\\Firefox\\Profiles\\x1.default\\cache2`), 'browser-cache');
  assert.equal(cat(`${env.TEMP}\\setup123.tmp`), 'temp');
  assert.equal(cat(`${L}\\Microsoft\\Windows\\Explorer\\thumbcache_256.db`), 'thumbnails');
  assert.equal(cat(`${L}\\CrashDumps`), 'logs');
  assert.equal(cat(`${L}\\pnpm\\store`), 'pnpm-store');
  assert.equal(cat(`${env.APPDATA}\\Code\\Cache`), 'app-cache');
  assert.equal(cat('C:\\Users\\a\\Downloads\\tool.msi'), 'installers');
  assert.equal(cat('C:\\Users\\a\\Downloads\\tool.dmg'), null, 'Windows 不收 .dmg');
  assert.equal(cat('C:\\Users\\a\\Documents\\WeChat Files\\wxid_1\\FileStorage\\File'), 'chat-received');
  assert.equal(cat('C:\\Users\\a\\Documents\\Tencent Files\\12345\\nt_qq\\nt_data\\Pic'), 'chat-cache');
  assert.equal(cat('C:\\Windows.old'), 'system-junk');
  assert.equal(cat('C:\\Windows\\SoftwareDistribution\\Download'), 'system-junk');
  assert.equal(cat('C:\\Users\\a\\.android\\avd'), 'simulators');
  assert.equal(cat('C:\\Users\\a\\go\\pkg\\mod'), 'go-mod-cache');
  assert.equal(cat(`${L}\\Docker\\wsl\\data\\ext4.vhdx`), 'docker');
});

test('构建产物模式规则和分类表', () => {
  const meta = newMeta();
  assert.equal(isArtifactDir('node_modules', meta, 'darwin'), false, '没有 package.json 不算项目');
  meta.hasPkgJson = true;
  assert.equal(isArtifactDir('node_modules', meta, 'darwin'), true);
  assert.equal(isArtifactDir('.next', meta, 'darwin'), true);
  assert.equal(isArtifactDir('target', meta, 'darwin'), false);
  meta.hasCargo = true;
  assert.equal(isArtifactDir('target', meta, 'darwin'), true);
  assert.equal(isArtifactDir('__pycache__', newMeta(), 'darwin'), false, '父目录没有 .py 文件的 __pycache__ 不算');
  const py = newMeta();
  py.hasPy = true;
  assert.equal(isArtifactDir('__pycache__', py, 'darwin'), true, '父目录有 .py 文件才算');
  assert.equal(isArtifactDir('__pycache__', null, 'darwin'), false, '不知道父目录内容时不算');
  const cs = newMeta();
  cs.hasCsproj = true;
  assert.equal(isArtifactDir('bin', cs, 'win32'), true);
  assert.equal(isArtifactDir('bin', cs, 'darwin'), false);
  const mac = categoriesFor('darwin').map((c) => c.id);
  const win = categoriesFor('win32').map((c) => c.id);
  assert.ok(!mac.includes('thumbnails'));
  assert.ok(win.includes('thumbnails'));
  assert.equal(mac.length, 18);
  assert.equal(win.length, 19);
});

test('macOS 系统卷与 firmlink：系统卷目录记 SYSVOL，映射到数据卷的子目录清掉 SYSVOL', async () => {
  const { CF } = await import('../miniapp/node/tree.mjs');
  const { MAC_SYSVOL, parseFirmlinks } = await import('../miniapp/node/rules.mjs');
  const po = createPathOps('posix');
  const firm = parseFirmlinks('/Applications\tApplications\n/usr/local\tusr/local\n/System/Library/Caches\tSystem/Library/Caches\n\n# x\n');
  assert.deepEqual(firm, ['/Applications', '/usr/local', '/System/Library/Caches']);
  const idx = buildRuleIndex({ specs: [], pathOps: po, platform: 'darwin', protectedKeys: [], sysVolPaths: MAC_SYSVOL, dataVolPaths: firm });
  assert.ok(idx.ancestorCf('/usr/bin/ls') & CF.SYSVOL);
  assert.ok(idx.ancestorCf('/System/Library/Frameworks') & CF.SYSVOL);
  assert.equal(idx.ancestorCf('/usr/local/bin') & CF.SYSVOL, 0, 'firmlink 指向数据卷');
  assert.equal(idx.ancestorCf('/System/Library/Caches/com.apple.x') & CF.SYSVOL, 0);
  assert.equal(idx.ancestorCf('/Users/u') & CF.SYSVOL, 0);
  assert.equal(idx.specials.get('/usr/local').dataVol, true);
});
