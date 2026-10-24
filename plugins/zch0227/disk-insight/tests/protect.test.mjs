// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';
import { createProtection } from '../miniapp/node/protect.mjs';
import { createPathOps } from '../miniapp/node/util.mjs';

const macDisks = [
  { id: 'mac-data', mount: '/', deletable: true },
  { id: 'mac-vol-1', mount: '/Volumes/USB', deletable: false },
];

test('macOS 保护名单：本身、内部、包含，以及 $TMPDIR 豁免', () => {
  const po = createPathOps('posix');
  const p = createProtection({ platform: 'darwin', pathOps: po, home: '/Users/u', env: {}, goModCache: '/Users/u/go/pkg/mod', mcodeDataDir: '/Users/u/.minimax', dataDir: '/Users/u/.minimax/agents/x/miniapps/disk-insight' });
  const lock = (/** @type {string} */ path, exempt = false) => p.lockReason(path, { disks: macDisks, exempt });

  assert.equal(lock('/System'), '系统目录', '本身');
  assert.equal(lock('/System/Library/Caches/foo'), '系统目录', '内部');
  assert.equal(lock('/system/library'), '系统目录', '不区分大小写');
  assert.match(String(lock('/Users')), /里面包含受保护的路径/, '包含');
  assert.match(String(lock('/Users/u/go')), /Go 模块缓存/, '包含 Go 模块缓存');
  assert.match(String(lock('/Users/u/go/pkg/mod/github.com/x')), /Go 模块缓存，请在终端运行 go clean -modcache 清理/);
  assert.equal(lock('/Users/u/.ssh/id_rsa'), 'SSH 凭据');
  assert.match(String(lock('/Users/u/Library/Mobile Documents/com~apple~CloudDocs/a')), /iCloud/);
  assert.equal(lock('/Users/u/.minimax/config.yaml'), 'MiniMax Code 数据目录');
  assert.equal(lock('/Users/u/.Trash/old'), '已经在废纸篓里');

  assert.equal(lock('/'), '磁盘根目录');
  assert.equal(lock('/Users/u'), '用户主目录');
  assert.equal(lock('/Users/u/Library'), '资源库文件夹');
  assert.equal(lock('/Users/u/Downloads'), '下载文件夹本身');
  assert.equal(lock('/Users/u/Downloads/a.dmg'), null, '标准文件夹里面的条目不受限制');
  assert.equal(lock('/Users/u/Library/Caches/com.foo'), null);
  assert.equal(lock('/Users/u/proj/.git'), 'git 仓库数据（.git 目录本身）');
  assert.equal(lock('/Users/u/proj'), null, '含 .git 的项目目录可以勾选');

  const tmpItem = '/private/var/folders/ab/xyz/T/old';
  assert.equal(lock(tmpItem), '系统目录', '不豁免时在 /private 里');
  assert.equal(lock(tmpItem, true), null, 'temp 规则的条目豁免保护名单');
  assert.equal(lock('/Users/u', true), '用户主目录', '豁免只跳过保护名单，不跳过主目录等本身锁定');
  assert.equal(lock('/private/var/folders/ab/xyz/T/proj/.git', true), 'git 仓库数据（.git 目录本身）');

  assert.equal(lock('/Volumes/USB'), '磁盘根目录');
  assert.match(String(lock('/Volumes/USB/movie.mp4')), /外接磁盘/, '不可删除的磁盘');
});

test('Windows 保护名单（path.win32）', () => {
  const po = createPathOps('win32');
  const env = { USERPROFILE: 'C:\\Users\\a', APPDATA: 'C:\\Users\\a\\AppData\\Roaming', SystemRoot: 'C:\\Windows', SystemDrive: 'C:', ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', ProgramData: 'C:\\ProgramData', OneDrive: 'C:\\Users\\a\\OneDrive - Corp' };
  const p = createProtection({ platform: 'win32', pathOps: po, home: 'C:\\Users\\a', env, goModCache: null });
  const disks = [
    { id: 'win-c', mount: 'C:\\', deletable: true },
    { id: 'win-d', mount: 'D:\\', deletable: true },
    { id: 'win-e', mount: 'E:\\', deletable: false },
  ];
  const lock = (/** @type {string} */ path, exempt = false) => p.lockReason(path, { disks, exempt });
  assert.equal(lock('C:\\Windows\\Temp'), '系统目录');
  assert.equal(lock('c:\\program files\\App'), '程序目录');
  assert.equal(lock('C:\\ProgramData\\x'), '系统程序数据目录');
  assert.equal(lock('C:\\Users\\a\\AppData\\Roaming\\Microsoft\\Credentials'), '凭据和系统设置目录');
  assert.equal(lock('C:\\Users\\a\\AppData\\Roaming'), '应用数据根目录');
  assert.equal(lock('C:\\Users\\a\\AppData\\Local\\npm-cache'), null);
  assert.equal(lock('D:\\pagefile.sys'), '系统文件');
  assert.equal(lock('D:\\$Recycle.Bin\\S-1-5'), '系统目录');
  assert.match(String(lock('C:\\Users\\a\\OneDrive - Corp\\doc.docx')), /OneDrive/);
  assert.equal(lock('C:\\'), '磁盘根目录');
  assert.equal(lock('C:\\Users\\a'), '用户主目录');
  assert.equal(lock('C:\\Users\\a\\Videos'), '视频文件夹本身');
  assert.equal(lock('C:\\Users\\a\\Videos\\clip.mp4'), null);
  assert.match(String(lock('C:\\Users')), /里面包含受保护的路径/);
  assert.match(String(lock('E:\\backup.zip')), /外接磁盘/);
});
