// 弹窗：导入 Star、添加项目、设置、收藏夹管理、AI 整理
import { S, on } from './state.js';
import { h, icon, toast, dialog, confirmDialog, copyText, fmtSize, fmtDate, timeAgo, fill, info } from './ui.js';
import { runCard } from './view-detail.js';
import * as A from './actions.js';

// 说明（hint）默认收在标题旁边的 ⓘ 里，点一下才展开
const field = (label, hint, control) => {
  const tip = hint ? info(hint) : null;
  return h('label.f', null, h('span.fl', null, label, tip?.tog), tip?.note, control);
};

// ---------- 导入 Star ----------
export function importForm() {
  const input = h('input.input', { type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: '你的 GitHub 用户名', 'aria-label': 'GitHub 用户名' });
  const btn = h('button.btn.primary', { type: 'button' });
  const note = h('div.hint', { style: 'margin:0' });
  const status = h('div');
  let touched = false;
  input.addEventListener('input', () => { touched = true; });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && S.st?.import?.status !== 'running') {
      e.preventDefault();
      btn.click();
    }
  });
  const start = () => A.startImport(input.value.trim());
  function render() {
    const st = S.st;
    if (!st) return;
    const gh = st.github || {};
    const imp = st.import || { status: 'idle' };
    const running = imp.status === 'running';
    if (!touched && document.activeElement !== input) input.value = st.settings.githubUser || gh.user || '';
    input.disabled = running;
    fill(btn, icon(running ? 'stop' : 'download'), running ? '取消' : '开始导入');
    btn.onclick = running ? () => A.cancelImport() : start;
    note.textContent = gh.checking
      ? '正在检测 gh 是否可用…'
      : gh.authed
      ? '检测到 gh 已登录（' + gh.user + '），会用它来读取，额度大，不受匿名限制。填别人的用户名也行，Star 是公开的。'
      : gh.gh
        ? 'gh 已安装但没登录，将用公开接口读取（匿名每小时有额度，一次导入通常只用 1 次）。'
        : '没装 gh 也可以，用公开接口读取（匿名每小时有额度，一次导入通常只用 1 次）。';
    const out = [];
    if (running) {
      const pct = imp.total ? Math.min(100, Math.round((imp.fetched / imp.total) * 100)) : null;
      out.push(
        h('div.strip', { role: 'status', style: 'border-radius:8px;border:0' },
          h('span.grow', null, '正在读取 Star… 已读 ' + imp.fetched + (imp.total ? ' / ' + imp.total : '') + ' 个'),
          pct !== null ? h('div.bar', null, h('i', { style: 'width:' + pct + '%' })) : null,
        ),
      );
    } else if (imp.status === 'done') {
      out.push(
        h('div.notice.info', { role: 'status' }, icon('check'), h('div', null,
          h('div', null, '导入完成：读取 ' + imp.fetched + ' 个，新增 ' + imp.added + ' 个，更新 ' + imp.updated + ' 个。'),
          h('div.hint', null, '都放进了「默认收藏夹」。README 会在后台缓存，缓存好之后就能按内容搜索。'),
        )),
      );
    } else if (imp.status === 'error') {
      out.push(h('div.notice.err', { role: 'alert' }, icon('alert'), h('div', null, h('div', null, imp.error || '导入失败'), imp.errorCode === 'need_user' ? h('div.hint', null, '在上面填你的 GitHub 用户名就行。') : null)));
    } else if (imp.status === 'cancelled') {
      out.push(h('p.hint', null, '已取消。'));
    } else if (st.importReport) {
      const r = st.importReport;
      out.push(h('p.hint', null, '上次导入：' + timeAgo(r.at) + '，' + r.user + '，共 ' + r.fetched + ' 个。再导入一次会把新 Star 的项目补进来，已有的备注和讲解不受影响。'));
    }
    fill(status, ...out);
  }
  const el = h('div.form', null,
    field('GitHub 用户名', 'Star 列表是公开的，不用登录。', h('div', { style: 'display:flex;gap:8px' }, input, btn)),
    note,
    status,
  );
  render();
  return { el, render, input };
}

export function openImport() {
  const f = importForm();
  const offs = [on('import', f.render), on('state', f.render)];
  dialog({ title: '导入 GitHub Star', body: h('div', { style: 'padding:16px' }, f.el), onClose: () => offs.forEach((o) => o()) });
  setTimeout(() => f.input.focus(), 30);
}

// ---------- 添加项目 ----------
export function openAdd() {
  const input = h('input.input', { type: 'text', placeholder: 'owner/repo 或 https://github.com/owner/repo', autocomplete: 'off', spellcheck: 'false', 'aria-label': '项目地址' });
  const sel = h('select', { 'aria-label': '放进哪个收藏夹', style: 'width:100%;height:36px' });
  for (const c of S.st?.collections || []) sel.append(h('option', { value: c.id, selected: S.collection === c.id || (S.collection === 'all' && c.isDefault) }, c.name));
  const err = h('div.hint', { style: 'color:var(--mcode-danger);margin:0', role: 'alert' });
  const ok = h('button.btn.primary', { type: 'button' }, icon('plus'), '添加');
  const submit = async () => {
    if (!input.value.trim() || ok.disabled) return;
    ok.disabled = true;
    err.textContent = '';
    try {
      const card = await A.addProject(input.value.trim(), sel.value);
      dlg.closeNow();
      toast('已添加 ' + card.fullName);
      A.selectProject(card.key);
    } catch (e) {
      err.textContent = e?.message || '添加失败，稍后再试';
      input.focus();
    } finally {
      ok.disabled = false;
    }
  };
  ok.onclick = submit;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });
  const dlg = dialog({
    title: '添加项目',
    body: h('div.form', { style: 'padding:16px' },
      field('项目地址', '支持 owner/repo、网址、git 地址', input),
      field('放进哪个收藏夹', null, sel),
      err,
    ),
    footer: [h('button.btn', { type: 'button', onclick: () => dlg.closeNow() }, '取消'), ok],
  });
  setTimeout(() => input.focus(), 30);
}

// ---------- 收藏夹管理 ----------
export function openCollections() {
  const list = h('div');
  const nameIn = h('input.input', { type: 'text', placeholder: '新收藏夹的名字', maxlength: 30, 'aria-label': '新收藏夹的名字', style: 'flex:1' });
  const create = async () => {
    const name = nameIn.value.trim();
    if (!name) return;
    const c = await A.createCollection(name);
    if (c) {
      nameIn.value = '';
      toast('已新建「' + c.name + '」');
    }
  };
  nameIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      create();
    }
  });
  const rowOf = (c) => {
    if (c.isDefault) {
      return h('div.collrow', null, h('div', null, h('b', null, c.name), ' ', h('span.badge', null, '默认'), h('span.hint', { style: 'display:inline;margin-left:8px' }, c.count + ' 个项目 · 导入的 Star 放在这里，不能改名或删除')));
    }
    const name = h('input.input', { type: 'text', value: c.name, maxlength: 30, 'aria-label': '收藏夹名字' });
    const desc = h('input.input', { type: 'text', value: c.description || '', maxlength: 200, placeholder: '说明（可选）', 'aria-label': '收藏夹说明', style: 'grid-column:1/-1;height:30px' });
    const save = async () => {
      if ((await A.updateCollection(c.id, { name: name.value, description: desc.value })) ) toast('已保存');
    };
    name.addEventListener('keydown', (e) => e.key === 'Enter' && save());
    desc.addEventListener('keydown', (e) => e.key === 'Enter' && save());
    return h('div.collrow', null,
      name,
      h('div.acts', null,
        h('span.hint', { style: 'margin:0;align-self:center' }, c.count + ' 个'),
        h('button.btn.sm', { type: 'button', onclick: save }, '保存'),
        h('button.btn.sm.danger', { type: 'button', onclick: async () => { if (await confirmDialog({ title: '删除收藏夹', message: '「' + c.name + '」会被删除，里面的项目不会删，只是不再属于它。', okText: '删除', danger: true })) A.deleteCollection(c.id); } }, icon('trash'), '删除'),
      ),
      desc,
    );
  };
  const render = () => fill(list, ...(S.st?.collections || []).map(rowOf));
  render();
  const off = on('state', () => {
    if (!list.querySelector('input:focus')) render();
  });
  dialog({
    title: '管理收藏夹',
    body: h('div', { style: 'padding:16px' },
      list,
      h('h3.sec', null, '新建收藏夹'),
      h('div', { style: 'display:flex;gap:8px' }, nameIn, h('button.btn.primary', { type: 'button', onclick: create }, icon('plus'), '新建')),
      h('p.hint', null, '也可以让 AI 来整理：点顶部的「AI 整理」，告诉它想怎么分。'),
    ),
    onClose: off,
  });
}

// ---------- 设置 ----------
const EFFORT_LADDER = ['max', 'xhigh', 'high', 'medium', 'low']; // 页面和服务端都认的几档，从高到低
const EFFORT_NAME = { max: '最高', xhigh: '超高', high: '高', medium: '中', low: '低' };
const effortLabel = (e) => (EFFORT_NAME[e] || e) + '（' + e + '）';

export function openSettings() {
  const body = h('div.form', { style: 'padding:16px' });
  let paintLive = null; // 重画「会随后台状态变化」的三块；每次 render() 都会换成新的
  let stopWatching = () => {};
  const dlg = dialog({ title: '设置', body, wide: true, onClose: () => stopWatching() });
  const save = async (patch, quiet) => {
    const r = await A.saveSettings(patch);
    if (r && !quiet) toast('已保存');
    return r;
  };
  const render = async () => {
    const st = S.st;
    if (!st) return;
    const s = st.settings;
    const models = st.agent?.available ? await A.loadModels() : null;
    const cache = await A.loadCache();
    const user = h('input.input', { type: 'text', value: s.githubUser || '', placeholder: st.github?.user || '你的 GitHub 用户名', 'aria-label': 'GitHub 用户名' });
    user.addEventListener('change', () => save({ githubUser: user.value.trim() }));
    const model = h('select', { 'aria-label': 'AI 模型', style: 'width:100%;height:36px', disabled: !models });
    model.append(h('option', { value: '' }, '自动' + (models?.preferredKey ? '（优先 ' + models.preferredKey.split('/').pop() + '）' : '（用默认模型）')));
    for (const m of models?.models || []) model.append(h('option', { value: m.key, selected: s.modelKey === m.key }, m.label + '（' + m.key.split('/')[0] + '）'));
    // 思考强度：只列「当前这个模型」在宿主配置里允许的档位，模型换了这里跟着换
    let curEffort = s.effort || 'max';
    // 自动 = 用哪个模型由服务端决定：优先 M3.1 这类首选模型，没有首选就是宿主默认模型。
    // 服务端只给「首选模型」带思考强度，所以自动模式下只有它才有可调的档位，别的选了也不生效。
    const allowedEfforts = () => {
      const entry = model.value
        ? (models?.models || []).find((x) => x.key === model.value)
        : models?.preferredKey
          ? (models?.models || []).find((x) => x.key === models.preferredKey)
          : null;
      const have = new Set(entry?.efforts || []);
      return EFFORT_LADDER.filter((e) => have.has(e)); // 从高到低
    };
    const NO_LEVELS = '这个模型没有可调的思考档位，这里不起作用';
    const AUTO_NO_LEVELS = '自动用的是宿主默认模型，不带思考强度：在上面选一个具体模型才能调';
    const effort = h('select', { 'aria-label': '思考强度', style: 'width:100%;height:36px' });
    const paintEffort = () => {
      const levels = allowedEfforts();
      effort.replaceChildren();
      if (!models || !levels.length) {
        effort.disabled = true;
        effort.append(h('option', { value: curEffort }, !models ? '（AI 现在不可用，暂时不能改）' : !model.value && !models.preferredKey ? AUTO_NO_LEVELS : NO_LEVELS));
        return;
      }
      effort.disabled = false;
      effort.append(h('option', { value: 'max' }, '最高档（默认）：' + effortLabel(levels[0])));
      for (const e of levels.slice(1)) effort.append(h('option', { value: e }, effortLabel(e)));
      effort.append(h('option', { value: 'default' }, '跟随模型自己的默认'));
      const want = curEffort === levels[0] ? 'max' : curEffort; // 选了最高那档，和「最高档」是一回事
      effort.value = want === 'max' || want === 'default' || levels.slice(1).includes(want) ? want : 'max';
    };
    model.addEventListener('change', async () => {
      if (!(await save({ modelKey: model.value }, true))) return;
      const levels = allowedEfforts();
      if (levels.length && curEffort !== 'max' && curEffort !== 'default' && !levels.includes(curEffort)) {
        // 新模型有档位，但没有原来选的那一档：退回最高档（服务端本来也会这么做，这里把设置也改过来）
        curEffort = 'max';
        await save({ effort: 'max' }, true);
        toast('这个模型没有原来选的思考档位，已改回「最高档」');
      } else {
        // 新模型没有档位就不动原来的选择，换回去还在
        toast('已保存');
      }
      paintEffort();
    });
    effort.addEventListener('change', () => {
      curEffort = effort.value;
      save({ effort: curEffort });
    });
    paintEffort();
    const conc = h('select', { 'aria-label': '同时讲解的数量', style: 'width:100%;height:36px' });
    for (const n of [1, 2, 3, 4]) conc.append(h('option', { value: n, selected: s.concurrency === n }, n + ' 个'));
    conc.addEventListener('change', () => save({ concurrency: Number(conc.value) }));
    const size = h('input.input', { type: 'number', min: 20, max: 5000, step: 10, value: s.cloneMaxMB, 'aria-label': '本地拉取大小上限（MB）' });
    size.addEventListener('change', () => save({ cloneMaxMB: Number(size.value) }));
    const img = h('select', { 'aria-label': 'README 图片', style: 'width:100%;height:36px' });
    for (const [v, t] of [['github', '只载入 GitHub 自家的图片（推荐）'], ['all', '全部载入'], ['none', '都不载入']]) img.append(h('option', { value: v, selected: s.imageMode === v }, t));
    img.addEventListener('change', () => save({ imageMode: img.value }));

    const paths = st.paths || {};
    const EXAMPLE = { darwin: { gh: '/opt/homebrew/bin/gh', git: '/opt/homebrew/bin/git' }, win32: { gh: 'C:\\Program Files\\GitHub CLI\\gh.exe', git: 'C:\\Program Files\\Git\\cmd\\git.exe' } }[paths.platform] || { gh: '/usr/local/bin/gh', git: '/usr/bin/git' };
    const ovInput = (label, key) => {
      const input = h('input.input', { type: 'text', value: s[key] || '', placeholder: EXAMPLE[label], spellcheck: 'false', autocomplete: 'off', 'aria-label': label + ' 的完整路径' });
      input.addEventListener('change', async () => {
        const v = input.value.trim();
        if (await A.saveSettings({ [key]: v })) toast(v ? '已保存，正在重新检测' : '已清除，改回自动查找');
      });
      return field(label + ' 的路径', null, input);
    };
    const manual = h('details', null,
      h('summary.hint', { style: 'cursor:pointer;margin:0' }, '找不到，或者想换一个？手动指定路径'),
      h('div.form', { style: 'margin-top:8px' }, ovInput('gh', 'ghPath'), ovInput('git', 'gitPath'), h('p.hint', { style: 'margin:0' }, '填完整路径；清空就改回自动查找。填的文件会先试运行一下，不能用会提示。')),
    );
    const recheck = h('button.btn.sm', { type: 'button' }, icon('refresh'), '重新检测');
    recheck.onclick = async () => {
      recheck.disabled = true;
      const ok = await A.recheckGithub(); // 状态一更新，上面三块会自己刷新
      recheck.disabled = false;
      toast(ok ? '已重新检测' : '检测没成功', ok ? '' : 'err');
    };
    const recheckTip = info('装好 gh 或 git 之后点一下，不用重启。位置都是程序自己找的，一般不用手填。');
    // 下面三块会随后台状态变化（检测完 gh / git、保存了路径、AI 工作文件夹确定了……）自动刷新；
    // 输入框和下拉框不在其中，所以刷新不会打断正在做的输入。
    const statusDl = h('dl.kv');
    const toolsDl = h('dl.kv');
    const promptsBox = h('div');
    const promptsTip = info('给 AI 的话只有一两行，长规则都放在这个文件夹里的文件中（相当于 skill.md），由 Mini App 自动维护。');
    paintLive = () => {
      const st = S.st;
      if (!st) return;
      const gh = st.github || {};
      const agentOk = st.agent?.available;
      const paths = st.paths || {};
      const promptsDir = paths.prompts || '';
      const VIA = { setting: '你手动指定的', path: '来自 PATH', shell: '来自你终端里的 PATH', common: '在常见安装位置找到的' };
      const pathRow = (p) => h('div.pathrow', null, h('code.mono', null, p), h('button.btn.sm.ghost', { type: 'button', 'aria-label': '复制路径', title: '复制路径', onclick: async () => toast((await copyText(p)) ? '路径已复制' : '复制失败', '') }, icon('copy')));
      const toolCell = (found, path, via, version, hint, bad) =>
        gh.checking
          ? '正在检测…'
          : found
            ? h('div', null, pathRow(path), h('div.hint', { style: 'margin:2px 0 0' }, (version ? 'v' + version + ' · ' : '') + (VIA[via] || '') + (bad ? '（你指定的路径不能用，已改用自动找到的）' : '')))
            : h('div', null, '没找到' + (bad ? '（你指定的路径也不能用）' : ''), hint ? h('div.hint', { style: 'margin:2px 0 0' }, hint) : null);
      fill(statusDl,
        h('dt', null, 'GitHub'), h('dd', null, gh.checking ? '正在检测…' : gh.authed ? 'gh 已登录（' + gh.user + '），用 gh 读取' : gh.gh ? 'gh 已安装但没登录，用公开接口读取' : '没装 gh，用公开接口读取'),
        h('dt', null, 'git'), h('dd', null, gh.checking ? '正在检测…' : gh.git ? '可用（本地讲解需要它）' : '没找到（本地讲解用不了）'),
        h('dt', null, 'AI'), h('dd', null, agentOk ? '可用' : st.agent?.reason || '不可用'),
        h('dt', null, '项目'), h('dd', null, st.totals.projects + ' 个 · README ' + st.totals.withReadme + ' 个 · 云讲解 ' + st.totals.explainedCloud + ' 个 · 本地讲解 ' + st.totals.explainedLocal + ' 个 · 有备注 ' + st.totals.noted + ' 个'),
      );
      fill(toolsDl,
        h('dt', null, 'gh'), h('dd', null, toolCell(gh.gh, gh.ghPath, gh.ghVia, gh.ghVersion, gh.ghHint, gh.ghOverrideBad)),
        h('dt', null, 'git'), h('dd', null, toolCell(gh.git, gh.gitPath, gh.gitVia, gh.gitVersion, gh.gitHint, gh.gitOverrideBad)),
        h('dt', null, '数据'), h('dd', null, paths.data ? pathRow(paths.data) : '—'),
        h('dt', null, 'AI 工作'), h('dd', null, paths.agentDir ? pathRow(paths.agentDir) : h('span.hint', { style: 'margin:0' }, '第一次让 AI 工作时确定')),
      );
      fill(promptsBox, promptsDir ? h('div', { style: 'display:flex;gap:8px;align-items:center' }, h('code.mono', { style: 'flex:1;word-break:break-all;font-size:12px' }, promptsDir), h('button.btn.sm', { type: 'button', onclick: async () => toast((await copyText(promptsDir)) ? '路径已复制' : '复制失败', '') }, icon('copy'), '复制')) : h('p.hint', null, '第一次让 AI 工作时会创建。'));
    };
    paintLive();
    fill(body, 
      h('h3.sec', null, '状态'),
      statusDl,
      h('h3.sec', null, '工具和位置'),
      toolsDl,
      h('div', null, h('div', { style: 'display:flex;gap:6px;align-items:center' }, recheck, recheckTip.tog), recheckTip.note),
      manual,
      h('h3.sec', null, '导入'),
      field('GitHub 用户名', '导入 Star 时默认用它；留空就用 gh 登录的账号。', user),
      h('h3.sec', null, 'AI'),
      field('用哪个模型来讲解', '默认优先选 MiniMax M3.1。这里只影响这个 Mini App 的会话。', model),
      field('思考强度', '只列出当前这个模型在 MiniMax Code 配置里允许的档位，换模型这里会跟着变。越高 AI 想得越仔细，也越慢、越费额度。', effort),
      field('同时讲解几个项目', '多开更快，也更费额度。', conc),
      field('本地讲解的大小上限（MB）', '超过就先问你一声再拉取，避免一不小心拉下一个大仓库。', size),
      field('README 里的图片', '第三方图片会让对方网站看到你的 IP，默认只载入 GitHub 自家的。', img),
      h('h3.sec', null, '本地缓存'),
      cache
        ? h('div', null,
            h('p.hint', { style: 'margin:0 0 8px' }, cache.items.length ? '已缓存 ' + cache.items.length + ' 个项目的代码，共 ' + fmtSize(cache.totalKB) + '。位置：' + (cache.dir || '（还没拉取过）') : '还没有缓存代码。本地讲解时才会拉取。位置：' + (cache.dir || '第一次本地讲解时确定')),
            ...cache.items.map((it) =>
              h('div.collrow', null, h('span', null, it.fullName, h('span.hint', { style: 'display:inline;margin-left:8px' }, fmtSize(it.sizeKB) + ' · ' + timeAgo(it.clonedAt))),
                h('button.btn.sm.ghost', { type: 'button', onclick: async () => { await A.clearProjectCache(it.key); render(); } }, icon('trash'), '清除')),
            ),
            cache.items.length ? h('div', { style: 'margin-top:10px' }, h('button.btn.sm.danger', { type: 'button', onclick: async () => { if (await confirmDialog({ title: '清除全部缓存', message: '删除所有项目的本地代码缓存（' + fmtSize(cache.totalKB) + '）。讲解和备注不受影响。', okText: '全部清除', danger: true })) { await A.clearAllCache(); render(); } } }, icon('trash'), '清除全部缓存')) : null,
          )
        : null,
      h('h3.sec', null, '固定提示词', promptsTip.tog),
      promptsTip.note,
      promptsBox,
      h('h3.sec', null, '导出'),
      h('button.btn.sm', { type: 'button', onclick: exportNow }, icon('copy'), '复制当前收藏夹的 Markdown'),
    );
  };
  async function exportNow() {
    const r = await A.exportMarkdown(S.collection);
    if (r) toast((await copyText(r.markdown)) ? '已复制，可以粘贴到任何地方' : '复制失败', '');
  }
  render();
  // 后台状态变了就刷新上面那三块；对话框关闭时取消订阅
  stopWatching = on('state', () => paintLive?.());
}

// ---------- AI 整理 ----------
const MCP_TOOLS = ['list_collections', 'create_collection', 'rename_collection', 'delete_collection', 'add_to_collection', 'remove_from_collection', 'list_projects', 'get_project', 'add_note', 'update_note', 'delete_note', 'import_stars'];
const IDEAS = ['按编程语言，把这些项目分成几个收藏夹', '找出和 AI、Agent 相关的项目，放进一个新收藏夹', '看看哪些项目功能重复或很像，告诉我，先别动', '给还没有备注的项目各记一条备注，说清它是干嘛的'];

export function openManager() {
  A.loadManager();
  const thread = h('div.thread');
  const runs = h('div');
  const sugg = h('div.sugg');
  const send = h('div', { style: 'display:flex;gap:8px;justify-content:flex-end;align-items:center' });
  const ta = h('textarea', { rows: 3, maxlength: 1000, placeholder: '告诉 AI 想怎么整理…（Ctrl/⌘ + 回车 发送）', 'aria-label': '整理要求' });
  const off = S.st && S.st.agent && !S.st.agent.available;
  const submit = async () => {
    const text = ta.value.trim();
    if (!text) return;
    const v = await A.managerSend(text);
    if (v) ta.value = '';
  };
  ta.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });
  const render = () => {
    const m = S.manager;
    fill(runs, ...(m.calls || []).map((c) => runCard(c, { onCancel: () => A.managerCancel(), onPermission: (id, d) => A.managerPermission(id, d) })));
    fill(thread, 
      ...(m.chat || []).map((x) =>
        x.role === 'user' ? h('div.msg.user', null, x.text) : x.role === 'ai' ? h('div.msg.ai', null, h('div.who', null, 'AI'), plainMd(x.text)) : h('div.msg.sys' + (x.error ? '.err' : ''), null, x.text),
      ),
    );
    fill(sugg, ...((m.chat || []).length < 2 ? IDEAS.map((t) => h('button.btn.sm', { type: 'button', onclick: () => { ta.value = t; ta.focus(); } }, t)) : []));
    const busy = (m.calls || []).length > 0;
    ta.disabled = Boolean(off) || busy;
    fill(send, 
      off ? h('span.hint', { style: 'margin:0' }, S.st.agent.reason) : null,
      (m.chat || []).length ? h('button.btn.ghost.sm', { type: 'button', disabled: busy, title: 'AI 忘掉之前的对话重新开始', onclick: async () => { if (await confirmDialog({ title: '新开会话', message: 'AI 会忘掉之前的整理对话，从头开始。已经建好的收藏夹不受影响。', okText: '新开会话' })) A.resetManagerSession(); } }, icon('refresh'), '新开会话') : null,
      h('button.btn.primary', { type: 'button', disabled: Boolean(off) || busy, onclick: submit }, icon('send'), busy ? 'AI 正在整理…' : '发送'),
    );
  };
  render();
  const offs = [on('manager', render)];
  dialog({
    title: 'AI 整理收藏夹',
    wide: true,
    body: h('div', { style: 'padding:16px' },
      h('p', { style: 'margin:0 0 8px' }, '告诉 AI 想怎么整理，它会通过「收藏夹接口」直接新建收藏夹、把项目放进去、记备注。不会擅自删除东西；只想听建议的话，说「先别动」。'),
      h('details', { style: 'margin-bottom:12px' }, h('summary.hint', { style: 'cursor:pointer;margin:0' }, 'AI 能用哪些接口（' + MCP_TOOLS.length + ' 个）'), h('p.hint', { style: 'word-break:break-word' }, MCP_TOOLS.join('、') + '。接口名：github-star-shelf。')),
      runs,
      thread,
      sugg,
      ta,
      h('div', { style: 'height:8px' }),
      send,
    ),
    onClose: () => offs.forEach((o) => o()),
  });
}
import { renderMarkdown } from './md.js';
function plainMd(text) {
  const md = h('div.md');
  md.append(renderMarkdown(text, { imageMode: 'none' }).node);
  return md;
}
