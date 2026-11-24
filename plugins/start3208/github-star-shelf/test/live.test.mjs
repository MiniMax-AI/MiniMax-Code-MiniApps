// 真实环境冒烟测试：默认跳过。SHELF_LIVE=1 npm test 才会运行本机真正的 gh / git，并发 1~2 个真实的 GitHub 请求。
// GitHub 匿名额度每小时只有 60 次，且同一个出口 IP 共用，所以别在循环里反复跑。
import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHub } from '../miniapp/node/lib/github.mjs';

const skip = process.env.SHELF_LIVE === '1' ? false : '设置 SHELF_LIVE=1 才会运行本机真实的 gh / git，并访问 GitHub';
const log = { debug() {}, info() {}, warn() {}, error() {} };

test('真实环境：认得出本机的 git；有 gh 就认得出 gh、版本和来源', { skip }, async (t) => {
  const info = await new GitHub(log).detect(true);
  t.diagnostic('gh: ' + (info.ghPath || '没找到') + ' ' + info.ghVersion + '（' + info.ghVia + '）；git: ' + (info.gitPath || '没找到') + ' ' + info.gitVersion + '（' + info.gitVia + '）；登录: ' + (info.authed ? info.user : '否'));
  assert.ok(info.git, '本机没有可用的 git');
  assert.match(info.gitVersion, /^\d+\.\d+/);
  if (info.gh) assert.match(info.ghVersion, /^\d+\.\d+/);
});

test('真实环境：读 octocat 的公开 Star（1~2 个请求）', { skip }, async (t) => {
  const res = await new GitHub(log).listStars({ user: 'octocat' });
  t.diagnostic('读到 ' + res.items.length + ' 个');
  assert.ok(res.items.length > 0);
  assert.ok(res.items.every((i) => /^[^/]+\/[^/]+$/.test(i.fullName)));
});
