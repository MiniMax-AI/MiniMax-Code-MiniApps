// 测试用的假数据：12 个"已 Star"的项目 + 几个没 Star 的，名字、简介、README 都是编的。
const STARRED = [
  ['alice', 'rocket-core', 'Rocket engine simulator in TypeScript', 'TypeScript', 4200, true],
  ['bob', 'lunar-notes', 'Markdown notes with offline sync', 'Go', 310, true],
  ['carol', 'agent-kit', 'Toolkit for building AI agents and MCP servers', 'Python', 9800, true],
  ['dave', 'pixel-forge', 'Tiny pixel art editor', 'Rust', 128, false],
  ['erin', 'wave-player', 'Terminal music player', 'Rust', 77, true],
  ['frank', 'tide-charts', 'Tide tables as a command line tool', 'Go', 12, false],
  ['grace', 'ink-blog', 'Static site generator', 'JavaScript', 560, true],
  ['heidi', 'cloud-backup', 'Encrypted backups to object storage', 'Go', 2300, true],
  ['ivan', 'type-guard', 'Runtime type checks', 'TypeScript', 940, false],
  ['judy', 'chess-engine', 'A small chess engine', 'C++', 85, true],
  ['mallory', 'dns-probe', 'Diagnose DNS problems', 'Python', 44, false],
  ['oscar', 'no-readme-demo', 'A repository without a README', '', 3, null], // null：没有 README
];

const readmeOf = (owner, name, desc, withInstall) =>
  '# ' + name + '\n\n' + desc + '.\n\n' +
  (withInstall ? '## Install\n\nRun the install script, then start the tool.\n\n' : '## Usage\n\nOpen the app and follow the prompts.\n\n') +
  '## About\n\nMaintained by ' + owner + '. Unique-token: ' + owner + '-' + name + '-readme.\n';

const repoJson = (owner, name, desc, language, stars, i) => ({
  full_name: owner + '/' + name,
  html_url: 'https://github.com/' + owner + '/' + name,
  description: desc,
  language: language || null,
  stargazers_count: stars,
  forks_count: Math.floor(stars / 10),
  topics: i % 3 === 0 ? ['ai', 'tools'] : ['tools'],
  license: { spdx_id: 'MIT', name: 'MIT License' },
  homepage: '',
  pushed_at: new Date(Date.UTC(2026, 5, 1 + i)).toISOString(),
  created_at: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(),
  archived: false,
  fork: false,
  default_branch: 'main',
  size: 200 + i * 10,
});

export function makeFixtures() {
  const repos = [];
  const readmes = {};
  STARRED.forEach(([owner, name, desc, language, stars, install], i) => {
    const repo = repoJson(owner, name, desc, language, stars, i);
    repo.starred_at = new Date(Date.UTC(2026, 0, 31 - i)).toISOString(); // 越靠前越新
    repos.push(repo);
    if (install !== null) readmes[repo.full_name] = readmeOf(owner, name, desc, install);
  });
  // 没 Star 的：手动「添加项目」时会用到
  const extra = [repoJson('octocat', 'Hello-World', 'My first repository on GitHub!', '', 4000, 20)];
  readmes['octocat/Hello-World'] = 'Hello World!\n';
  return { login: 'tester', repos, extra, readmes };
}

/** GitHub 接口返回「已 Star」列表时的样子（带 starred_at） */
export const starEntries = (fx) => fx.repos.map(({ starred_at, ...repo }) => ({ starred_at, repo }));

/** 一条最简单的「已 Star」记录 */
export const starEntry = (fullName, stars = 1) => ({ starred_at: '2026-01-01T00:00:00Z', repo: { full_name: fullName, html_url: 'https://github.com/' + fullName, description: 'd', stargazers_count: stars, language: 'C' } });

/** 很多个「已 Star」的项目：测翻页（每页 100 条）用 */
export function makeManyFixtures(count) {
  const repos = [];
  const readmes = {};
  const langs = ['Go', 'Rust', 'Python', 'TypeScript'];
  for (let i = 0; i < count; i += 1) {
    const repo = repoJson('user' + (i % 40), 'repo-' + i, 'Generated repository number ' + i, langs[i % 4], i * 3, i);
    repo.starred_at = new Date(Date.UTC(2026, 0, 1) - i * 60000).toISOString();
    repos.push(repo);
    readmes[repo.full_name] = '# repo-' + i + '\n\nGenerated.\n';
  }
  return { login: 'tester', repos, extra: [], readmes };
}
