// @ts-check

const IGNORE_DIR = /(^|\/)(node_modules|vendor|third_party|3rdparty|dist|build|out|target|\.next|\.nuxt|coverage|__pycache__|Pods|\.yarn|bower_components|\.venv|venv)\//;

const LANG = {
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  py: 'Python', pyi: 'Python', ipynb: 'Jupyter Notebook',
  go: 'Go', rs: 'Rust', java: 'Java', kt: 'Kotlin', kts: 'Kotlin', scala: 'Scala', groovy: 'Groovy',
  swift: 'Swift', m: 'Objective-C', mm: 'Objective-C',
  c: 'C', h: 'C/C++ Header', cc: 'C++', cpp: 'C++', cxx: 'C++', hpp: 'C++', hh: 'C++',
  cs: 'C#', fs: 'F#', vb: 'Visual Basic',
  rb: 'Ruby', php: 'PHP', pl: 'Perl', lua: 'Lua', r: 'R', jl: 'Julia', dart: 'Dart', ex: 'Elixir', exs: 'Elixir', erl: 'Erlang', clj: 'Clojure', hs: 'Haskell', ml: 'OCaml', zig: 'Zig', nim: 'Nim', sol: 'Solidity',
  vue: 'Vue', svelte: 'Svelte', astro: 'Astro',
  html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'SCSS', sass: 'SCSS', less: 'Less', styl: 'Stylus',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell', fish: 'Shell', ps1: 'PowerShell', bat: 'Batch',
  sql: 'SQL', proto: 'Protocol Buffers', thrift: 'Thrift', graphql: 'GraphQL', gql: 'GraphQL',
  tf: 'HCL', hcl: 'HCL', nix: 'Nix', dockerfile: 'Dockerfile', cmake: 'CMake', gradle: 'Gradle',
  md: 'Markdown', mdx: 'MDX', rst: 'reStructuredText',
  json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML', xml: 'XML',
};
const DATA_LANGS = new Set(['Markdown', 'MDX', 'reStructuredText', 'JSON', 'YAML', 'TOML', 'XML']);

/** [regex on path, name, category] */
const MARKERS = [
  [/(^|\/)Dockerfile[^/]*$|\.dockerfile$/i, 'Docker', '构建与部署'],
  [/(^|\/)(docker-)?compose[^/]*\.ya?ml$/i, 'Docker Compose', '构建与部署'],
  [/(^|\/)\.gitlab-ci\.ya?ml$/, 'GitLab CI', 'CI/CD'],
  [/^\.github\/workflows\/[^/]+\.ya?ml$/, 'GitHub Actions', 'CI/CD'],
  [/(^|\/)Jenkinsfile$/, 'Jenkins', 'CI/CD'],
  [/(^|\/)\.circleci\/config\.yml$/, 'CircleCI', 'CI/CD'],
  [/(^|\/)azure-pipelines\.ya?ml$/, 'Azure Pipelines', 'CI/CD'],
  [/(^|\/)Chart\.yaml$/, 'Helm', '构建与部署'],
  [/(^|\/)(kustomization\.ya?ml)$/, 'Kustomize', '构建与部署'],
  [/\.tf$/, 'Terraform', '构建与部署'],
  [/(^|\/)(Makefile|GNUmakefile)$/, 'Make', '构建与部署'],
  [/(^|\/)CMakeLists\.txt$/, 'CMake', '构建与部署'],
  [/(^|\/)BUILD(\.bazel)?$|(^|\/)WORKSPACE(\.bazel)?$|(^|\/)MODULE\.bazel$/, 'Bazel', '构建与部署'],
  [/(^|\/)pnpm-workspace\.yaml$/, 'pnpm workspace', 'Monorepo'],
  [/(^|\/)turbo\.json$/, 'Turborepo', 'Monorepo'],
  [/(^|\/)nx\.json$/, 'Nx', 'Monorepo'],
  [/(^|\/)lerna\.json$/, 'Lerna', 'Monorepo'],
  [/(^|\/)(\.eslintrc[^/]*|eslint\.config\.[cm]?[jt]s)$/, 'ESLint', '代码质量'],
  [/(^|\/)biome\.jsonc?$/, 'Biome', '代码质量'],
  [/(^|\/)\.prettierrc[^/]*$|(^|\/)prettier\.config\.[cm]?js$/, 'Prettier', '代码质量'],
  [/(^|\/)\.golangci\.ya?ml$/, 'golangci-lint', '代码质量'],
  [/(^|\/)(ruff\.toml|\.ruff\.toml)$/, 'Ruff', '代码质量'],
  [/(^|\/)\.pre-commit-config\.yaml$/, 'pre-commit', '代码质量'],
  [/(^|\/)\.husky\//, 'Husky', '代码质量'],
  [/(^|\/)sonar-project\.properties$/, 'SonarQube', '代码质量'],
  [/(^|\/)tsconfig[^/]*\.json$/, 'TypeScript', '语言与运行时'],
  [/(^|\/)\.nvmrc$|(^|\/)\.node-version$/, 'Node.js', '语言与运行时'],
  [/(^|\/)\.python-version$/, 'Python', '语言与运行时'],
  [/(^|\/)\.tool-versions$|(^|\/)mise\.toml$|(^|\/)\.mise\.toml$/, 'mise / asdf', '语言与运行时'],
  [/(^|\/)vite\.config\.[cm]?[jt]s$/, 'Vite', '构建工具'],
  [/(^|\/)webpack\.config\.[cm]?[jt]s$/, 'webpack', '构建工具'],
  [/(^|\/)rollup\.config\.[cm]?[jt]s$/, 'Rollup', '构建工具'],
  [/(^|\/)electron-builder\.(ya?ml|json|[cm]?js)$|(^|\/)forge\.config\.[cm]?[jt]s$/, 'Electron 打包', '构建工具'],
  [/(^|\/)vitest\.(config|workspace)\.[cm]?[jt]s$/, 'Vitest', '测试'],
  [/(^|\/)jest\.config\.[cm]?[jt]s$/, 'Jest', '测试'],
  [/(^|\/)playwright\.config\.[cm]?[jt]s$/, 'Playwright', '测试'],
  [/(^|\/)cypress\.config\.[cm]?[jt]s$/, 'Cypress', '测试'],
  [/(^|\/)(pytest\.ini|conftest\.py)$/, 'pytest', '测试'],
  [/(^|\/)tailwind\.config\.[cm]?[jt]s$/, 'Tailwind CSS', '前端'],
  [/(^|\/)next\.config\.[cm]?[jt]s$/, 'Next.js', '前端'],
  [/(^|\/)nuxt\.config\.[cm]?[jt]s$/, 'Nuxt', '前端'],
  [/(^|\/)svelte\.config\.[cm]?js$/, 'SvelteKit', '前端'],
  [/(^|\/)angular\.json$/, 'Angular', '前端'],
  [/(^|\/)schema\.prisma$/, 'Prisma', '数据'],
  [/(^|\/)alembic\.ini$/, 'Alembic', '数据'],
  [/(^|\/)openapi[^/]*\.(ya?ml|json)$|(^|\/)swagger[^/]*\.(ya?ml|json)$/i, 'OpenAPI', '接口定义'],
  [/\.proto$/, 'Protocol Buffers', '接口定义'],
  [/\.thrift$/, 'Thrift', '接口定义'],
  [/(^|\/)buf\.(gen\.)?yaml$/, 'Buf', '接口定义'],
  [/\.graphqls?$/, 'GraphQL', '接口定义'],
  [/(^|\/)Podfile$/, 'CocoaPods', '移动端'],
  [/(^|\/)Package\.swift$/, 'Swift Package Manager', '移动端'],
  [/\.xcodeproj\//, 'Xcode', '移动端'],
  [/(^|\/)AndroidManifest\.xml$/, 'Android', '移动端'],
  [/(^|\/)pubspec\.yaml$/, 'Flutter / Dart', '移动端'],
  [/(^|\/)(AGENTS|CLAUDE)\.md$/, 'AI Agent 指令（AGENTS.md / CLAUDE.md）', '工程实践'],
  [/(^|\/)\.cursor(rules|\/rules\/)/, 'Cursor rules', '工程实践'],
  [/(^|\/)CODEOWNERS$/, 'CODEOWNERS', '工程实践'],
  [/(^|\/)\.changeset\//, 'Changesets', '工程实践'],
];

const LOCKFILES = [
  [/(^|\/)pnpm-lock\.yaml$/, 'pnpm'],
  [/(^|\/)yarn\.lock$/, 'Yarn'],
  [/(^|\/)package-lock\.json$/, 'npm'],
  [/(^|\/)bun\.lockb?$/, 'Bun'],
  [/(^|\/)uv\.lock$/, 'uv'],
  [/(^|\/)poetry\.lock$/, 'Poetry'],
  [/(^|\/)Pipfile\.lock$/, 'Pipenv'],
  [/(^|\/)Cargo\.lock$/, 'Cargo'],
  [/(^|\/)go\.sum$/, 'Go modules'],
  [/(^|\/)Gemfile\.lock$/, 'Bundler'],
  [/(^|\/)composer\.lock$/, 'Composer'],
  [/(^|\/)gradle\.lockfile$|(^|\/)gradlew$/, 'Gradle'],
  [/(^|\/)mvnw$/, 'Maven'],
];

/** Known dependency → [display name, category]. Keys are exact names or prefixes ending with '*'. */
const DEPS = {
  react: ['React', '前端'], 'react-dom': ['React', '前端'], vue: ['Vue', '前端'], svelte: ['Svelte', '前端'], 'solid-js': ['Solid', '前端'], preact: ['Preact', '前端'], '@angular/core': ['Angular', '前端'],
  next: ['Next.js', '前端'], nuxt: ['Nuxt', '前端'], '@remix-run/react': ['Remix', '前端'], astro: ['Astro', '前端'], gatsby: ['Gatsby', '前端'],
  'react-native': ['React Native', '移动端'], expo: ['Expo', '移动端'],
  electron: ['Electron', '桌面端'], '@tauri-apps/api': ['Tauri', '桌面端'],
  tailwindcss: ['Tailwind CSS', '前端'], 'styled-components': ['styled-components', '前端'], '@emotion/react': ['Emotion', '前端'], sass: ['Sass', '前端'], 'antd': ['Ant Design', '前端'], '@mui/material': ['MUI', '前端'], '@radix-ui/*': ['Radix UI', '前端'], 'lucide-react': ['Lucide', '前端'], 'framer-motion': ['Framer Motion', '前端'],
  redux: ['Redux', '前端'], '@reduxjs/toolkit': ['Redux Toolkit', '前端'], zustand: ['Zustand', '前端'], jotai: ['Jotai', '前端'], mobx: ['MobX', '前端'], pinia: ['Pinia', '前端'], '@tanstack/react-query': ['TanStack Query', '前端'], swr: ['SWR', '前端'], 'react-router': ['React Router', '前端'], 'react-router-dom': ['React Router', '前端'], '@tanstack/react-router': ['TanStack Router', '前端'],
  echarts: ['ECharts', '前端'], 'chart.js': ['Chart.js', '前端'], d3: ['D3', '前端'], three: ['three.js', '前端'], '@xyflow/react': ['React Flow', '前端'], 'monaco-editor': ['Monaco Editor', '前端'], '@codemirror/*': ['CodeMirror', '前端'], 'xterm': ['xterm.js', '前端'], '@xterm/xterm': ['xterm.js', '前端'],
  express: ['Express', '后端'], fastify: ['Fastify', '后端'], koa: ['Koa', '后端'], hono: ['Hono', '后端'], '@nestjs/core': ['NestJS', '后端'], 'socket.io': ['Socket.IO', '后端'], ws: ['ws (WebSocket)', '后端'], '@trpc/server': ['tRPC', '后端'], 'graphql': ['GraphQL', '后端'], '@grpc/grpc-js': ['gRPC', '后端'], 'undici': ['undici', '后端'],
  prisma: ['Prisma', '数据'], '@prisma/client': ['Prisma', '数据'], 'drizzle-orm': ['Drizzle', '数据'], typeorm: ['TypeORM', '数据'], sequelize: ['Sequelize', '数据'], mongoose: ['Mongoose', '数据'], 'better-sqlite3': ['SQLite', '数据'], sqlite3: ['SQLite', '数据'], ioredis: ['Redis', '数据'], redis: ['Redis', '数据'], pg: ['PostgreSQL', '数据'], mysql2: ['MySQL', '数据'], kysely: ['Kysely', '数据'], dexie: ['IndexedDB (Dexie)', '数据'],
  zod: ['Zod', '工具库'], 'class-validator': ['class-validator', '工具库'], lodash: ['Lodash', '工具库'], 'date-fns': ['date-fns', '工具库'], dayjs: ['Day.js', '工具库'], immer: ['Immer', '工具库'], rxjs: ['RxJS', '工具库'], effect: ['Effect', '工具库'], 'yaml': ['YAML', '工具库'], 'commander': ['Commander', '工具库'], 'yargs': ['yargs', '工具库'], 'ink': ['Ink (CLI UI)', '工具库'],
  openai: ['OpenAI SDK', 'AI'], '@anthropic-ai/sdk': ['Anthropic SDK', 'AI'], '@anthropic-ai/claude-agent-sdk': ['Claude Agent SDK', 'AI'], langchain: ['LangChain', 'AI'], '@langchain/*': ['LangChain', 'AI'], ai: ['Vercel AI SDK', 'AI'], '@ai-sdk/*': ['Vercel AI SDK', 'AI'], '@modelcontextprotocol/sdk': ['MCP SDK', 'AI'], '@google/genai': ['Google GenAI SDK', 'AI'], 'tiktoken': ['tiktoken', 'AI'], '@mariozechner/pi-ai': ['pi-ai', 'AI'],
  typescript: ['TypeScript', '语言与运行时'], vite: ['Vite', '构建工具'], webpack: ['webpack', '构建工具'], esbuild: ['esbuild', '构建工具'], rollup: ['Rollup', '构建工具'], tsup: ['tsup', '构建工具'], turbo: ['Turborepo', 'Monorepo'], '@swc/core': ['SWC', '构建工具'], 'electron-builder': ['electron-builder', '构建工具'], '@electron-forge/cli': ['Electron Forge', '构建工具'], 'electron-vite': ['electron-vite', '构建工具'], rspack: ['Rspack', '构建工具'], '@rspack/core': ['Rspack', '构建工具'], tsx: ['tsx', '构建工具'],
  vitest: ['Vitest', '测试'], jest: ['Jest', '测试'], mocha: ['Mocha', '测试'], '@playwright/test': ['Playwright', '测试'], playwright: ['Playwright', '测试'], cypress: ['Cypress', '测试'], '@testing-library/react': ['Testing Library', '测试'], msw: ['MSW', '测试'], storybook: ['Storybook', '测试'],
  eslint: ['ESLint', '代码质量'], prettier: ['Prettier', '代码质量'], '@biomejs/biome': ['Biome', '代码质量'], husky: ['Husky', '代码质量'], 'lint-staged': ['lint-staged', '代码质量'], knip: ['Knip', '代码质量'],
  '@sentry/*': ['Sentry', '可观测性'], '@opentelemetry/*': ['OpenTelemetry', '可观测性'], pino: ['pino', '可观测性'], winston: ['winston', '可观测性'], 'electron-log': ['electron-log', '可观测性'],
  // Python
  django: ['Django', '后端'], flask: ['Flask', '后端'], fastapi: ['FastAPI', '后端'], starlette: ['Starlette', '后端'], tornado: ['Tornado', '后端'], uvicorn: ['Uvicorn', '后端'], gunicorn: ['Gunicorn', '后端'], celery: ['Celery', '后端'], aiohttp: ['aiohttp', '后端'], grpcio: ['gRPC', '后端'], pydantic: ['Pydantic', '工具库'],
  sqlalchemy: ['SQLAlchemy', '数据'], alembic: ['Alembic', '数据'], 'psycopg2': ['PostgreSQL', '数据'], 'psycopg2-binary': ['PostgreSQL', '数据'], pymongo: ['MongoDB', '数据'], pandas: ['pandas', '数据'], numpy: ['NumPy', '数据'], polars: ['Polars', '数据'],
  torch: ['PyTorch', 'AI'], tensorflow: ['TensorFlow', 'AI'], jax: ['JAX', 'AI'], transformers: ['Transformers', 'AI'], vllm: ['vLLM', 'AI'], 'scikit-learn': ['scikit-learn', 'AI'], 'llama-index': ['LlamaIndex', 'AI'], anthropic: ['Anthropic SDK', 'AI'], 'langgraph': ['LangGraph', 'AI'],
  pytest: ['pytest', '测试'], ruff: ['Ruff', '代码质量'], mypy: ['mypy', '代码质量'], black: ['Black', '代码质量'],
  // Go
  'github.com/gin-gonic/gin': ['Gin', '后端'], 'github.com/labstack/echo/v4': ['Echo', '后端'], 'github.com/gofiber/fiber/v2': ['Fiber', '后端'], 'github.com/cloudwego/hertz': ['Hertz', '后端'], 'github.com/cloudwego/kitex': ['Kitex', '后端'], 'google.golang.org/grpc': ['gRPC', '后端'], 'github.com/go-kratos/kratos/v2': ['Kratos', '后端'], 'github.com/zeromicro/go-zero': ['go-zero', '后端'],
  'gorm.io/gorm': ['GORM', '数据'], 'github.com/redis/go-redis/v9': ['Redis', '数据'], 'github.com/go-redis/redis/v8': ['Redis', '数据'], 'go.mongodb.org/mongo-driver': ['MongoDB', '数据'], 'github.com/jmoiron/sqlx': ['sqlx', '数据'], 'entgo.io/ent': ['ent', '数据'],
  'github.com/spf13/cobra': ['Cobra', '工具库'], 'github.com/spf13/viper': ['Viper', '工具库'], 'go.uber.org/zap': ['zap', '可观测性'], 'github.com/sirupsen/logrus': ['logrus', '可观测性'], 'go.opentelemetry.io/otel': ['OpenTelemetry', '可观测性'], 'github.com/prometheus/client_golang': ['Prometheus', '可观测性'], 'github.com/stretchr/testify': ['testify', '测试'],
  // Rust
  tokio: ['Tokio', '后端'], axum: ['Axum', '后端'], 'actix-web': ['Actix Web', '后端'], serde: ['Serde', '工具库'], clap: ['clap', '工具库'], tauri: ['Tauri', '桌面端'], sqlx: ['SQLx', '数据'], diesel: ['Diesel', '数据'], tracing: ['tracing', '可观测性'], reqwest: ['reqwest', '后端'],
  // JVM
  'spring-boot-starter*': ['Spring Boot', '后端'], 'spring-boot-starter-web': ['Spring Boot', '后端'], 'mybatis*': ['MyBatis', '数据'], 'junit*': ['JUnit', '测试'], 'lombok': ['Lombok', '工具库'], 'ktor*': ['Ktor', '后端'],
  // Ruby / PHP
  rails: ['Ruby on Rails', '后端'], sinatra: ['Sinatra', '后端'], rspec: ['RSpec', '测试'], 'laravel/framework': ['Laravel', '后端'], 'symfony/*': ['Symfony', '后端'],
  // Flutter
  flutter: ['Flutter', '移动端'], provider: ['provider', '前端'], riverpod: ['Riverpod', '前端'],
};
const DEP_PREFIX = Object.entries(DEPS)
  .filter(([k]) => k.endsWith('*'))
  .map(([k, v]) => [k.slice(0, -1), v]);
function knownDep(name) {
  if (DEPS[name] && !name.endsWith('*')) return DEPS[name];
  for (const [p, v] of DEP_PREFIX) if (name.startsWith(p)) return v;
  return null;
}

const MANIFEST_RE = /(^|\/)(package\.json|go\.mod|Cargo\.toml|pyproject\.toml|requirements[^/]*\.txt|Pipfile|setup\.cfg|pom\.xml|build\.gradle(\.kts)?|Gemfile|composer\.json|pubspec\.yaml)$/;
const MANIFEST_CAP = { 'package.json': 60, default: 15 };

/** Pick manifest blobs to read (shallow first, bounded). */
export function pickManifests(tree) {
  const byName = new Map();
  for (const t of tree) {
    if (IGNORE_DIR.test(t.path) || !MANIFEST_RE.test(t.path) || /(^|\/)(test|tests|fixtures?|examples?|__tests__|testdata|e2e)\//.test(t.path)) continue;
    const name = t.path.split('/').pop();
    const key = /^requirements/.test(name) ? 'requirements' : name;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(t);
  }
  const picked = [];
  for (const [key, list] of byName) {
    list.sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path));
    picked.push(...list.slice(0, MANIFEST_CAP[key] ?? MANIFEST_CAP.default));
  }
  return picked;
}

function depsFrom(path, text) {
  const name = path.split('/').pop();
  const out = [];
  try {
    if (name === 'package.json') {
      const j = JSON.parse(text);
      for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) if (j[k] && typeof j[k] === 'object') out.push(...Object.keys(j[k]));
      return { deps: out, meta: { name: j.name, workspaces: Boolean(j.workspaces), engines: j.engines?.node || null, pm: typeof j.packageManager === 'string' ? j.packageManager.split('@')[0] : null } };
    }
    if (name === 'go.mod') {
      let inReq = false;
      let goVer = null;
      for (const raw of text.split('\n')) {
        const l = raw.trim();
        if (l.startsWith('go ')) goVer = l.slice(3).trim();
        if (l.startsWith('require (')) {
          inReq = true;
          continue;
        }
        if (inReq && l === ')') inReq = false;
        const m = inReq ? l.match(/^(\S+)\s+v/) : l.match(/^require\s+(\S+)\s+v/);
        if (m && !l.includes('// indirect')) out.push(m[1]);
      }
      return { deps: out, meta: { go: goVer } };
    }
    if (name === 'Cargo.toml') {
      let sec = '';
      for (const raw of text.split('\n')) {
        const l = raw.trim();
        const s = l.match(/^\[([^\]]+)\]/);
        if (s) {
          sec = s[1];
          continue;
        }
        if (/dependencies$/.test(sec)) {
          const m = l.match(/^([A-Za-z0-9_-]+)\s*=/);
          if (m) out.push(m[1]);
        }
      }
      return { deps: out, meta: {} };
    }
    if (name === 'pyproject.toml' || name === 'Pipfile' || name === 'setup.cfg') {
      const lines = text.split('\n');
      let sec = '';
      let inArr = false;
      for (const raw of lines) {
        const l = raw.trim();
        const s = l.match(/^\[([^\]]+)\]/);
        if (s) {
          sec = s[1];
          inArr = false;
          continue;
        }
        if (/^(dependencies|requires|install_requires)\s*=\s*\[/.test(l) || /^[a-z-]+\s*=\s*\[/.test(l) && /optional-dependencies|dependency-groups/.test(sec)) inArr = true;
        if (inArr) {
          for (const m of l.matchAll(/["']([A-Za-z0-9_.\-[\]]+)/g)) out.push(m[1].replace(/\[.*$/, '').toLowerCase());
          if (l.includes(']') && !/^\[/.test(l)) inArr = false;
          continue;
        }
        if (/(poetry\.(dev-)?dependencies|^packages$|^dev-packages$|poetry\.group\.[^.]+\.dependencies)/.test(sec)) {
          const m = l.match(/^([A-Za-z0-9_.-]+)\s*=/);
          if (m && m[1] !== 'python') out.push(m[1].toLowerCase());
        }
      }
      return { deps: out, meta: {} };
    }
    if (/^requirements/.test(name)) {
      for (const raw of text.split('\n')) {
        const m = raw.trim().match(/^([A-Za-z0-9_.-]+)/);
        if (m && !raw.trim().startsWith('-')) out.push(m[1].toLowerCase());
      }
      return { deps: out, meta: {} };
    }
    if (name === 'pom.xml') {
      for (const m of text.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)) out.push(m[1]);
      return { deps: out, meta: {} };
    }
    if (/^build\.gradle/.test(name)) {
      for (const m of text.matchAll(/(?:implementation|api|compileOnly|testImplementation|kapt|ksp)\s*\(?\s*["']([^:"']+):([^:"']+)/g)) out.push(m[2]);
      return { deps: out, meta: {} };
    }
    if (name === 'Gemfile') {
      for (const m of text.matchAll(/^\s*gem\s+["']([^"']+)/gm)) out.push(m[1]);
      return { deps: out, meta: {} };
    }
    if (name === 'composer.json') {
      const j = JSON.parse(text);
      for (const k of ['require', 'require-dev']) if (j[k]) out.push(...Object.keys(j[k]));
      return { deps: out, meta: {} };
    }
    if (name === 'pubspec.yaml') {
      let inDeps = false;
      for (const raw of text.split('\n')) {
        if (/^(dev_)?dependencies:/.test(raw)) {
          inDeps = true;
          continue;
        }
        if (/^\S/.test(raw)) inDeps = false;
        const m = inDeps && raw.match(/^ {2}([a-z0-9_]+):/);
        if (m) out.push(m[1]);
      }
      return { deps: out, meta: {} };
    }
  } catch {
    return { deps: [], meta: { parseError: true } };
  }
  return { deps: out, meta: {} };
}

/**
 * @param {{ path: string, oid: string }[]} tree
 * @param {Map<string, string>} blobs oid -> text
 * @param {{ path: string, oid: string }[]} manifests
 */
export function buildTechStack(tree, blobs, manifests) {
  const lang = new Map();
  let codeFiles = 0;
  for (const t of tree) {
    if (IGNORE_DIR.test(t.path)) continue;
    const base = t.path.split('/').pop() || '';
    const ext = /^Dockerfile/i.test(base) ? 'dockerfile' : base.includes('.') ? base.split('.').pop().toLowerCase() : '';
    const l = LANG[ext];
    if (!l) continue;
    if (/\.min\.(js|css)$/.test(base) || /(^|\/)(package-lock|pnpm-lock)\./.test(t.path)) continue;
    lang.set(l, (lang.get(l) || 0) + 1);
    if (!DATA_LANGS.has(l)) codeFiles++;
  }
  const languages = [...lang.entries()].filter(([l]) => !DATA_LANGS.has(l)).sort((a, b) => b[1] - a[1]).map(([name, files]) => ({ name, files, share: codeFiles ? files / codeFiles : 0 }));
  const docs = [...lang.entries()].filter(([l]) => DATA_LANGS.has(l)).sort((a, b) => b[1] - a[1]).map(([name, files]) => ({ name, files }));

  /** name -> { category, evidence:Set, count } */
  const items = new Map();
  const add = (name, category, evidence, weight = 1) => {
    let it = items.get(name);
    if (!it) items.set(name, (it = { name, category, evidence: [], count: 0 }));
    it.count += weight;
    if (it.evidence.length < 3 && !it.evidence.includes(evidence)) it.evidence.push(evidence);
  };
  for (const t of tree) {
    if (IGNORE_DIR.test(t.path)) continue;
    for (const [re, name, cat] of MARKERS) if (re.test(t.path)) add(name, cat, t.path);
  }
  const pms = new Map();
  for (const t of tree) {
    if (IGNORE_DIR.test(t.path)) continue;
    for (const [re, name] of LOCKFILES) if (re.test(t.path)) pms.set(name, (pms.get(name) || 0) + 1);
  }

  const depCount = new Map();
  const unknown = new Map();
  let pkgCount = 0;
  let workspaces = false;
  const engines = new Set();
  let goVersion = null;
  const manifestStats = new Map();
  for (const m of manifests) {
    const text = blobs.get(m.oid);
    const file = m.path.split('/').pop();
    manifestStats.set(file, (manifestStats.get(file) || 0) + 1);
    if (text == null) continue;
    const { deps, meta } = depsFrom(m.path, text);
    if (file === 'package.json') {
      pkgCount++;
      if (meta.workspaces) workspaces = true;
      if (meta.engines) engines.add(`Node ${meta.engines}`);
      if (meta.pm) pms.set(meta.pm === 'pnpm' ? 'pnpm' : meta.pm === 'yarn' ? 'Yarn' : meta.pm, (pms.get(meta.pm) || 0) + 1);
    }
    if (meta.go) goVersion = meta.go;
    for (const d of new Set(deps)) {
      const k = knownDep(d);
      if (k) add(k[0], k[1], `${m.path} → ${d}`);
      else if (!d.startsWith('@types/')) unknown.set(d, (unknown.get(d) || 0) + 1);
      depCount.set(d, (depCount.get(d) || 0) + 1);
    }
  }
  if (workspaces || pkgCount > 3) add('npm workspaces / monorepo', 'Monorepo', `${pkgCount} 个 package.json`);
  if (goVersion) add(`Go ${goVersion}`, '语言与运行时', 'go.mod');
  for (const e of engines) add(e, '语言与运行时', 'package.json engines');

  const ORDER = ['语言与运行时', '前端', '桌面端', '移动端', '后端', 'AI', '数据', '接口定义', '工具库', '构建工具', 'Monorepo', '测试', '代码质量', '可观测性', 'CI/CD', '构建与部署', '工程实践'];
  const groups = ORDER.map((cat) => ({
    category: cat,
    items: [...items.values()].filter((i) => i.category === cat).sort((a, b) => b.count - a.count),
  })).filter((g) => g.items.length);
  return {
    languages,
    docs,
    groups,
    packageManagers: [...pms.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n })),
    manifests: [...manifestStats.entries()].map(([name, n]) => ({ name, n })),
    packages: pkgCount,
    otherDeps: [...unknown.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16).map(([name, n]) => ({ name, n })),
    files: tree.length,
  };
}
