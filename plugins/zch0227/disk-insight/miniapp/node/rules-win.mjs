// @ts-check
// Windows 清理规则（按公开资料编写，未在 Windows 上验证）。从 rules.mjs 拆出。

/** @typedef {import('./rules.mjs').RuleSpec} RuleSpec */

/** Windows 规则按公开资料编写，未在 Windows 上验证。 @returns {RuleSpec[]} */
export function winSpecs() {
  const L = '%LOCALAPPDATA%';
  const R = '%APPDATA%';
  const U = '%USERPROFILE%';
  const CHROME = [L, 'Google', 'Chrome', 'User Data', '*'];
  const EDGE = [L, 'Microsoft', 'Edge', 'User Data', '*'];
  const WX3 = [U, 'Documents', 'WeChat Files', '*', 'FileStorage'];
  const WX4 = [U, 'Documents', 'xwechat_files', '*'];
  const QQNT = [U, 'Documents', 'Tencent Files', '*', 'nt_qq', 'nt_data'];
  const QQ = [U, 'Documents', 'Tencent Files', '*'];
  const WXWORK = [U, 'Documents', 'WXWork', '*', 'Cache'];
  const DING = [R, 'DingTalk', '*'];
  const LARK = [R, 'LarkShell', 'sdk_storage', '*', 'resources'];
  /** @type {RuleSpec[]} */
  const list = [
    { cat: 'temp', name: '临时文件', at: ['%TEMP%'], mode: 'children', ageDays: 3 },

    // npm 缓存只收 _cacache（和 macOS 的 ~/.npm/_cacache 对应），npx 临时包单独成项，避免两条规则嵌套重复统计。
    { cat: 'pkg-cache', name: 'npm 缓存', at: [L, 'npm-cache', '_cacache'], devCache: true },
    { cat: 'pkg-cache', name: 'npx 缓存', at: [L, 'npm-cache', '_npx'], devCache: true },
    { cat: 'pkg-cache', name: 'pip 缓存', at: [L, 'pip', 'Cache'], devCache: true },
    { cat: 'pkg-cache', name: 'Yarn 缓存', at: [L, 'Yarn', 'Cache'], devCache: true },
    { cat: 'pkg-cache', name: 'NuGet 包缓存', at: [U, '.nuget', 'packages'], devCache: true },
    { cat: 'pkg-cache', name: 'Gradle 缓存', at: [U, '.gradle', 'caches'], devCache: true },
    { cat: 'pkg-cache', name: 'Maven 本地仓库', at: [U, '.m2', 'repository'], devCache: true },
    { cat: 'pkg-cache', name: 'Cargo 下载缓存', at: [U, '.cargo', 'registry', 'cache'], devCache: true },
    { cat: 'pkg-cache', name: 'uv 缓存', at: [L, 'uv', 'cache'], devCache: true },
    { cat: 'pkg-cache', name: 'pip 缓存（.cache）', at: [U, '.cache', 'pip'], devCache: true },
    { cat: 'pkg-cache', name: 'pnpm 缓存（.cache）', at: [U, '.cache', 'pnpm'], devCache: true },

    { cat: 'logs', name: '崩溃转储', at: [L, 'CrashDumps'] },
    { cat: 'logs', name: 'Windows 错误报告', at: [L, 'Microsoft', 'Windows', 'WER'] },

    { cat: 'thumbnails', name: '缩略图缓存', at: [L, 'Microsoft', 'Windows', 'Explorer'], mode: 'thumbs' },

    { cat: 'installers', name: '旧安装包', at: [U, 'Downloads'], mode: 'installers', ageDays: 30 },
    { cat: 'installers', name: '旧安装包', at: [U, 'Desktop'], mode: 'installers', ageDays: 30 },

    { cat: 'pnpm-store', name: 'pnpm 存储', at: [L, 'pnpm', 'store'], devCache: true },

    { cat: 'app-cache', name: 'VS Code 缓存', at: [R, 'Code', 'Cache'], app: 'vscode' },
    { cat: 'app-cache', name: 'VS Code 代码缓存', at: [R, 'Code', 'CachedData'], app: 'vscode' },
    { cat: 'app-cache', name: 'VS Code 脚本缓存', at: [R, 'Code', 'Code Cache'], app: 'vscode' },
    { cat: 'app-cache', name: 'VS Code GPU 缓存', at: [R, 'Code', 'GPUCache'], app: 'vscode' },
    { cat: 'app-cache', name: 'VS Code 扩展安装包缓存', at: [R, 'Code', 'CachedExtensionVSIXs'], app: 'vscode' },
    { cat: 'app-cache', name: 'Slack 缓存', at: [R, 'Slack', 'Cache'], app: 'slack' },
    { cat: 'app-cache', name: 'Slack 脚本缓存', at: [R, 'Slack', 'Code Cache'], app: 'slack' },
    { cat: 'app-cache', name: 'Slack Service Worker 缓存', at: [R, 'Slack', 'Service Worker', 'CacheStorage'], app: 'slack' },
    { cat: 'app-cache', name: 'Teams 缓存', at: [L, 'Packages', 'MSTeams_8wekyb3d8bbwe', 'LocalCache'], app: 'teams' },
    { cat: 'app-cache', name: 'Discord 缓存', at: [R, 'discord', 'Cache'], app: 'discord' },
    { cat: 'app-cache', name: 'Discord 脚本缓存', at: [R, 'discord', 'Code Cache'], app: 'discord' },
    { cat: 'app-cache', name: 'Spotify 缓存', at: [L, 'Spotify', 'Data'], app: 'spotify' },
    { cat: 'app-cache', name: '飞书 网页缓存', at: [R, 'LarkShell', 'Cache'], app: 'lark' },
    { cat: 'app-cache', name: '飞书 脚本缓存', at: [R, 'LarkShell', 'Code Cache'], app: 'lark' },

    { cat: 'chat-cache', name: '微信 图片', at: [...WX3, 'Image'], chat: true, app: 'wechat' },
    { cat: 'chat-cache', name: '微信 视频', at: [...WX3, 'Video'], chat: true, app: 'wechat' },
    { cat: 'chat-cache', name: '微信 缓存', at: [...WX3, 'Cache'], chat: true, app: 'wechat' },
    { cat: 'chat-received', name: '微信 接收的文件', at: [...WX3, 'File'], chat: true, app: 'wechat' },
    { cat: 'chat-cache', name: '微信 图片和附件', at: [...WX4, 'msg', 'attach'], chat: true, app: 'wechat' },
    { cat: 'chat-cache', name: '微信 视频', at: [...WX4, 'msg', 'video'], chat: true, app: 'wechat' },
    { cat: 'chat-cache', name: '微信 缓存', at: [...WX4, 'cache'], chat: true, app: 'wechat' },
    { cat: 'chat-received', name: '微信 接收的文件', at: [...WX4, 'msg', 'file'], chat: true, app: 'wechat' },
    { cat: 'chat-cache', name: 'QQ 图片', at: [...QQNT, 'Pic'], chat: true, app: 'qq' },
    { cat: 'chat-cache', name: 'QQ 视频', at: [...QQNT, 'Video'], chat: true, app: 'qq' },
    { cat: 'chat-received', name: 'QQ 接收的文件', at: [...QQNT, 'File'], chat: true, app: 'qq' },
    { cat: 'chat-cache', name: 'QQ 图片（旧版）', at: [...QQ, 'Image'], chat: true, app: 'qq' },
    { cat: 'chat-received', name: 'QQ 接收的文件（旧版）', at: [...QQ, 'FileRecv'], chat: true, app: 'qq' },
    { cat: 'chat-cache', name: '企业微信 图片', at: [...WXWORK, 'Image'], chat: true, app: 'wework' },
    { cat: 'chat-cache', name: '企业微信 视频', at: [...WXWORK, 'Video'], chat: true, app: 'wework' },
    { cat: 'chat-received', name: '企业微信 接收的文件', at: [...WXWORK, 'File'], chat: true, app: 'wework' },
    { cat: 'chat-cache', name: '钉钉 图片', at: [...DING, 'ImageFiles'], chat: true, app: 'dingtalk' },
    { cat: 'chat-cache', name: '钉钉 视频', at: [...DING, 'VideoFiles'], chat: true, app: 'dingtalk' },
    { cat: 'chat-cache', name: '钉钉 资源缓存', at: [...DING, 'resource_cache'], chat: true, app: 'dingtalk' },
    { cat: 'chat-cache', name: '飞书 图片', at: [...LARK, 'images'], chat: true, app: 'lark' },
    { cat: 'chat-cache', name: '飞书 视频和媒体', at: [...LARK, 'medias'], chat: true, app: 'lark' },
    { cat: 'chat-received', name: '飞书 接收的文件', at: [...LARK, 'files'], chat: true, app: 'lark' },

    { cat: 'simulators', name: 'Android 模拟器', at: [U, '.android', 'avd'] },

    { cat: 'system-junk', name: 'Windows 更新缓存', at: ['%SystemRoot%', 'SoftwareDistribution', 'Download'] },
    { cat: 'system-junk', name: '系统临时文件', at: ['%SystemRoot%', 'Temp'] },
    { cat: 'system-junk', name: '旧版 Windows（Windows.old）', at: ['%SystemDrive%', 'Windows.old'] },
    { cat: 'system-junk', name: '传递优化缓存', at: ['%SystemRoot%', 'ServiceProfiles', 'NetworkService', 'AppData', 'Local', 'Microsoft', 'Windows', 'DeliveryOptimization', 'Cache'] },
    { cat: 'system-junk', name: '传递优化缓存（旧位置）', at: ['%SystemRoot%', 'SoftwareDistribution', 'DeliveryOptimization'] },

    { cat: 'docker', name: 'Docker 数据', at: [L, 'Docker', 'wsl'], mode: 'scan' },

    { cat: 'go-mod-cache', name: 'Go 模块缓存', at: ['$GOMODCACHE'], devCache: true },
  ];
  // 浏览器缓存：每个配置文件下的三个目录。
  for (const [base, label, app] of /** @type {[string[], string, string][]} */ ([[CHROME, 'Chrome', 'chrome'], [EDGE, 'Edge', 'edge']])) {
    list.push({ cat: 'browser-cache', name: `${label} 缓存`, at: [...base, 'Cache'], app });
    list.push({ cat: 'browser-cache', name: `${label} 脚本缓存`, at: [...base, 'Code Cache'], app });
    list.push({ cat: 'browser-cache', name: `${label} GPU 缓存`, at: [...base, 'GPUCache'], app });
  }
  list.push({ cat: 'browser-cache', name: 'Firefox 缓存', at: [L, 'Mozilla', 'Firefox', 'Profiles', '*', 'cache2'], app: 'firefox' });
  return list;
}
