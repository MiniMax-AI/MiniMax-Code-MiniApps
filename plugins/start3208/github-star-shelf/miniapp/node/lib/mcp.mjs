import { AppError, clamp, keyOf, parseRepoRef } from './util.mjs';

const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const str = (type, description) => ({ type, description });
const REPO = str('string', 'owner/repo 或 GitHub 网址');
const COLL = str('string', '收藏夹的名字或 id');

const TOOLS = [
  { name: 'list_collections', description: '列出所有收藏夹和各自的项目数。', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'create_collection',
    description: '新建收藏夹。',
    inputSchema: { type: 'object', properties: { name: str('string', '名字，最多 30 字'), description: str('string', '一句话说明（可选）') }, required: ['name'] },
  },
  {
    name: 'rename_collection',
    description: '改收藏夹的名字或说明。默认收藏夹不能改名。',
    inputSchema: { type: 'object', properties: { collection: COLL, name: str('string', '新名字'), description: str('string', '新说明') }, required: ['collection'] },
  },
  {
    name: 'delete_collection',
    description: '删除收藏夹。里面的项目不会被删，只是不再属于它。默认收藏夹不能删。',
    inputSchema: { type: 'object', properties: { collection: COLL }, required: ['collection'] },
  },
  {
    name: 'add_to_collection',
    description: '把项目放进收藏夹，保留它原来的归属。项目库里没有的，会先从 GitHub 取信息再加入。',
    inputSchema: { type: 'object', properties: { collection: COLL, repos: { type: 'array', items: REPO, description: '最多 30 个' } }, required: ['collection', 'repos'] },
  },
  {
    name: 'remove_from_collection',
    description: '把项目移出某个收藏夹。项目本身不会被删。',
    inputSchema: { type: 'object', properties: { collection: COLL, repos: { type: 'array', items: REPO, description: '最多 30 个' } }, required: ['collection', 'repos'] },
  },
  {
    name: 'list_projects',
    description: '列出或搜索项目。query 同时搜名称/简介、README、备注，多个词用空格分开（要求都命中）。',
    inputSchema: {
      type: 'object',
      properties: {
        collection: str('string', '只看这个收藏夹（可选）'),
        query: str('string', '关键词（可选）'),
        scope: { type: 'string', enum: ['all', 'name', 'readme', 'notes'], description: '搜哪里，默认 all' },
        limit: str('integer', '默认 20，最多 50'),
        offset: str('integer', '翻页用'),
      },
    },
  },
  { name: 'get_project', description: '看一个项目的详情：简介、所属收藏夹、备注、有没有讲解、README 开头。', inputSchema: { type: 'object', properties: { repo: REPO }, required: ['repo'] } },
  {
    name: 'add_note',
    description: '给项目记一条备注（本地保存，会标成「AI 备注」）。一条一句话。',
    inputSchema: { type: 'object', properties: { repo: REPO, text: str('string', '备注内容，最多 2000 字') }, required: ['repo', 'text'] },
  },
  {
    name: 'update_note',
    description: '修改一条备注。',
    inputSchema: { type: 'object', properties: { repo: REPO, note_id: str('string', '备注 id（get_project 里能看到）'), text: str('string', '新内容') }, required: ['repo', 'note_id', 'text'] },
  },
  {
    name: 'delete_note',
    description: '删除一条备注。',
    inputSchema: { type: 'object', properties: { repo: REPO, note_id: str('string', '备注 id') }, required: ['repo', 'note_id'] },
  },
  {
    name: 'import_stars',
    description: '把 GitHub 的 Star 列表（公开信息）导入默认收藏夹。user 是 GitHub 用户名；不传就用设置里的用户名或 gh 登录的账号。',
    inputSchema: { type: 'object', properties: { user: str('string', 'GitHub 用户名（可选）') } },
  },
];

function needStr(args, name, max = 2000) {
  const v = args?.[name];
  if (typeof v !== 'string' || !v.trim()) throw new AppError('bad_args', '缺少参数：' + name);
  return clamp(v.trim(), max);
}
function projectKey(shelf, ref) {
  const parsed = parseRepoRef(String(ref ?? ''));
  if (!parsed) throw new AppError('bad_repo', '项目地址不对：' + clamp(ref, 80));
  const key = keyOf(parsed.fullName);
  if (!shelf.state.projects[key]) throw new AppError('no_project', '项目库里还没有 ' + parsed.fullName + '，可以先用 add_to_collection 加入');
  return key;
}
function brief(shelf, p) {
  const names = new Map(shelf.state.collections.map((c) => [c.id, c.name]));
  return {
    repo: p.fullName,
    description: p.description || '',
    language: p.language || '',
    stars: p.stars || 0,
    collections: p.collections.map((id) => names.get(id)).filter(Boolean),
    notes: p.notes.length,
    explained: [p.explain?.cloud ? '云讲解' : '', p.explain?.local ? '本地讲解' : ''].filter(Boolean),
  };
}

async function callTool(shelf, name, args) {
  switch (name) {
    case 'list_collections':
      return shelf.collections();
    case 'create_collection':
      return shelf.createCollection({ name: needStr(args, 'name', 60), description: args?.description });
    case 'rename_collection':
      return shelf.updateCollection(needStr(args, 'collection', 80), { name: args?.name, description: args?.description });
    case 'delete_collection':
      return { deleted: shelf.deleteCollection(needStr(args, 'collection', 80)) };
    case 'add_to_collection':
    case 'remove_from_collection': {
      const c = shelf.resolveCollection(needStr(args, 'collection', 80));
      if (!c) throw new AppError('no_collection', '没有这个收藏夹：' + args.collection);
      const repos = Array.isArray(args.repos) ? args.repos.slice(0, 30) : [];
      if (!repos.length) throw new AppError('bad_args', 'repos 不能是空的');
      const done = [];
      const failed = [];
      for (const ref of repos) {
        try {
          const parsed = parseRepoRef(String(ref));
          if (!parsed) throw new AppError('bad_repo', '项目地址不对');
          const key = keyOf(parsed.fullName);
          if (name === 'add_to_collection') {
            if (!shelf.state.projects[key]) await shelf.addProject(ref, []);
            shelf.setMembership(key, { add: [c.id] });
          } else {
            shelf.project(key);
            shelf.setMembership(key, { remove: [c.id] });
          }
          done.push(parsed.fullName);
        } catch (error) {
          failed.push({ repo: clamp(ref, 80), reason: error.message });
        }
      }
      return { collection: c.name, done, failed };
    }
    case 'list_projects': {
      let collection = 'all';
      if (args?.collection) {
        const c = shelf.resolveCollection(args.collection);
        if (!c) throw new AppError('no_collection', '没有这个收藏夹：' + args.collection);
        collection = c.id;
      }
      const scope = args?.scope;
      const scopes = scope === 'name' ? { name: true, readme: false, notes: false } : scope === 'readme' ? { name: false, readme: true, notes: false } : scope === 'notes' ? { name: false, readme: false, notes: true } : undefined;
      const r = await shelf.list({ q: args?.query, collection, scopes, limit: Math.min(50, Number(args?.limit) || 20), offset: Number(args?.offset) || 0, sort: 'starred' });
      const items = r.items.map((c) => brief(shelf, shelf.state.projects[c.key]));
      return { total: r.total, items };
    }
    case 'get_project': {
      const p = shelf.state.projects[projectKey(shelf, args?.repo)];
      const readme = await shelf.store.readReadme(p.key);
      return {
        ...brief(shelf, p),
        url: p.url,
        topics: p.topics || [],
        license: p.license || '',
        notes: p.notes.map((n) => ({ id: n.id, by: n.author, text: n.text })),
        readme_head: readme ? clamp(readme, 1500) : null,
        local_code_cached: Boolean(p.cache),
      };
    }
    case 'add_note': {
      const key = projectKey(shelf, args?.repo);
      const n = shelf.addNote(key, needStr(args, 'text'), 'ai');
      return { id: n.id, repo: shelf.state.projects[key].fullName };
    }
    case 'update_note': {
      const key = projectKey(shelf, args?.repo);
      const n = shelf.updateNote(key, needStr(args, 'note_id', 40), needStr(args, 'text'));
      return { id: n.id, updated: true };
    }
    case 'delete_note': {
      const key = projectKey(shelf, args?.repo);
      return shelf.deleteNote(key, needStr(args, 'note_id', 40));
    }
    case 'import_stars': {
      const user = typeof args?.user === 'string' ? args.user.trim() : undefined;
      if (shelf.importJob?.status !== 'running') shelf.startImport({ user });
      for (let i = 0; i < 90; i += 1) {
        if (shelf.importJob.status !== 'running') break;
        await new Promise((r) => setTimeout(r, 500));
      }
      const v = shelf.importView();
      if (v.status === 'error') throw new AppError('import_failed', v.error || '导入失败');
      return v.status === 'running' ? { ...v, note: '还在导入，稍后再用 list_projects 看结果' } : v;
    }
    default:
      throw new AppError('no_tool', '没有这个工具：' + name, 404);
  }
}

export function createMcp(shelf) {
  const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

  async function handleOne(msg) {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(msg?.id, -32600, 'Invalid Request');
    const { id, method, params } = msg;
    const notification = id === undefined || id === null;
    switch (method) {
      case 'initialize': {
        const asked = params?.protocolVersion;
        return ok(id, {
          protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'github-star-shelf', version: '1.0.0' },
          instructions: '管理用户的 GitHub 收藏夹：收藏夹、项目、备注、搜索。只做用户要求的改动，不删除用户的备注。',
        });
      }
      case 'ping':
        return ok(id, {});
      case 'tools/list':
        return ok(id, { tools: TOOLS });
      case 'tools/call': {
        const name = params?.name;
        if (!TOOLS.some((t) => t.name === name)) return fail(id, -32602, 'Unknown tool: ' + String(name).slice(0, 60));
        try {
          const out = await callTool(shelf, name, params?.arguments && typeof params.arguments === 'object' ? params.arguments : {});
          return ok(id, { content: [{ type: 'text', text: JSON.stringify(out) }] });
        } catch (error) {
          const text = error instanceof AppError ? error.message : '操作失败';
          if (!(error instanceof AppError)) shelf.ctx.logger.error('shelf.mcp.failed', { tool: name });
          return ok(id, { isError: true, content: [{ type: 'text', text: '错误：' + text }] });
        }
      }
      default:
        if (notification || method.startsWith('notifications/')) return null;
        return fail(id, -32601, 'Method not found: ' + method.slice(0, 60));
    }
  }

  /** Streamable HTTP：POST 一条或一批 JSON-RPC 消息，直接用 JSON 回答 */
  return async function handle(request, response, body) {
    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'POST', 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'method_not_allowed' }));
      return;
    }
    const batch = Array.isArray(body);
    const msgs = batch ? body : [body];
    const out = [];
    for (const m of msgs) {
      const r = await handleOne(m);
      if (r) out.push(r);
    }
    if (out.length === 0) {
      response.writeHead(202);
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify(batch ? out : out[0]));
  };
}
