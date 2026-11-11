'use strict';

// 分享页渲染脚本：只读一次内嵌的数据，没有任何网络请求。
// 渲染原语来自同页内嵌的 blocks.js，与主页面完全一致。
(function () {
  const { fmtDuration, fmtSeconds, fmtDateTime, fmtClock, STAGES, renderBlocks, renderPromptCompare } = window.H3Blocks;
  const data = JSON.parse(document.getElementById('share-data').textContent);
  const snapshot = data.snapshot;
  const images = data.images || {};

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  // largeKey：交付图另带一份 2048px 的大图，点开看大图；没有大图（超出预算或生成失败）就看这张预览。
  const img = (key, alt, className, largeKey) => {
    if (!images[key]) return null;
    const node = document.createElement('img');
    node.src = images[key];
    node.alt = alt || '';
    if (className) node.className = className;
    const full = (largeKey && images[largeKey]) || images[key];
    if (full !== images[key]) node.title = '点击查看大图';
    node.onclick = () => openLightbox(full);
    return node;
  };

  function openLightbox(src) {
    document.getElementById('lightbox-img').src = src;
    document.getElementById('lightbox').hidden = false;
  }
  document.getElementById('lightbox-close').addEventListener('click', () => {
    document.getElementById('lightbox').hidden = true;
    document.getElementById('lightbox-img').src = '';
  });
  document.getElementById('lightbox').addEventListener('click', (event) => {
    if (event.target.id === 'lightbox') document.getElementById('lightbox').hidden = true;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') document.getElementById('lightbox').hidden = true;
  });

  const root = document.getElementById('root');
  const cost = snapshot.cost || {};
  const timing = snapshot.timing || {};

  document.getElementById('share-meta').textContent =
    snapshot.id + ' · ' + fmtDateTime(snapshot.createdAt) + ' · 总用时 ' + fmtDuration(timing.elapsedMs);

  // 装配顺序集中在这里定，不在各段构建处：分享页是给人看结果的，交付必须排在
  // 执行过程和候选前面。各段先构建，最后统一按阅读顺序挂上去。
  let refsCard = null;
  let candidatesCard = null;
  let deliverCard = null;

  // ---------------------------------------------------------------- 概要
  const brief = el('section', 'card');
  brief.appendChild(el('h2', null, '需求'));
  brief.appendChild(el('p', 'share-instruction', snapshot.instruction || '（空）'));

  const metrics = el('div', 'run-metrics');
  const parts = [
    ['会话', snapshot.id],
    ['状态', statusLabel(snapshot.status)],
    ['开始于', fmtDateTime(snapshot.createdAt)],
    ['总用时', fmtDuration(timing.elapsedMs)],
    ['路线', snapshot.route],
    ['生图', (cost.ditImages || 0) + ' 张 · ' + fmtSeconds(cost.ditMs)],
    ['Agent', (cost.agentCalls || 0) + ' 次 · ' + fmtSeconds(cost.agentMs) + ' · ' + (cost.agentTools || 0) + ' 次工具'],
  ];
  if (cost.usage && cost.usage.total_tokens) parts.push(['token', cost.usage.total_tokens]);
  Object.keys(cost.byStep || {}).forEach((step) => {
    const bucket = cost.byStep[step];
    parts.push([step + ' 节点', fmtSeconds(bucket.ms) + ' · ' + bucket.tools + ' 工具']);
  });
  parts.forEach(([label, value]) => {
    const cell = el('div', 'metric');
    cell.append(el('span', 'metric-label', label), el('strong', null, String(value)));
    metrics.appendChild(cell);
  });
  brief.appendChild(metrics);

  if ((snapshot.questions || []).length) {
    const q = el('div', 'questions', '需要确认：' + snapshot.questions.join('；'));
    brief.appendChild(q);
  }
  root.appendChild(brief);

  // ---------------------------------------------------------------- 参考图
  if ((snapshot.refs || []).length) {
    const card = el('section', 'card');
    card.appendChild(el('h2', null, '参考图'));
    const grid = el('div', 'ref-grid');
    snapshot.refs.forEach((ref) => {
      const file = String(ref.file || '').split('/').pop();
      const node = el('div', 'ref-card');
      const picture = img('refs/' + file, ref.id);
      if (picture) node.appendChild(picture);
      node.appendChild(el('strong', null, ref.id));
      node.appendChild(el('span', 'meta', ref.note || ''));
      grid.appendChild(node);
    });
    card.appendChild(grid);
    refsCard = card;
  }

  // ---------------------------------------------------------------- 执行过程
  // 默认折叠：分享页是给人看结果的，执行过程是「想深究再看」的材料。
  // 折叠时也要能看出规模，所以提示挂在标题旁边，不藏进展开后的正文里。
  const runCard = el('details', 'card share-fold');
  const runHead = el('summary', 'share-fold-head');
  runHead.appendChild(el('h2', null, '执行过程'));
  const runHint = el('span', 'share-fold-hint', '');
  runHead.appendChild(runHint);
  runCard.appendChild(runHead);
  const runBody = el('div', 'share-fold-body');
  const tools = el('div', 'timeline-tools');
  const expandAll = el('button', 'btn tiny', '全部展开');
  const collapseAll = el('button', 'btn tiny', '全部收起');
  tools.append(expandAll, collapseAll, el('span', 'hint', '点任意一行展开，能看到这一步实际发给模型的提示词、工具调用和判定依据。'));
  runBody.appendChild(tools);

  const stats = new Map((snapshot.stageStats || []).map((item) => [item.stage, item]));
  const seen = new Set((snapshot.events || []).map((event) => event.stage));
  const stages = el('ol', 'pipeline');
  STAGES.forEach(([key, label]) => {
    const item = el('li');
    item.append(el('span', 'step-dot'), el('span', 'step-name', label));
    const hit = stats.get(key);
    if (hit && hit.spanMs > 0) item.appendChild(el('span', 'step-dur', fmtSeconds(hit.spanMs)));
    if (seen.has(key)) item.className = 'done';
    stages.appendChild(item);
  });
  runBody.appendChild(stages);

  const box = el('details', 'timeline-box');
  box.open = true;
  const summary = el('summary');
  const summaryText = el('span', null, '思考过程时间线');
  summary.appendChild(summaryText);
  box.appendChild(summary);
  const list = el('ul', 'timeline');
  const timelineStats = window.H3Blocks.renderTimeline(list, snapshot.events || [], {
    image: (key) => images[key] || '',
    onImage: openLightbox,
  });
  summaryText.textContent =
    '思考过程时间线（' + timelineStats.events + ' 条 · 合并为 ' + timelineStats.groups + ' 步）';
  runHint.textContent =
    timelineStats.events + ' 条事件 · 合并为 ' + timelineStats.groups + ' 步 · Agent ' + (cost.agentCalls || 0) + ' 次';
  box.appendChild(list);
  runBody.appendChild(box);
  runCard.appendChild(runBody);

  expandAll.addEventListener('click', () => {
    runCard.querySelectorAll('details.event-detail').forEach((node) => { node.open = true; });
  });
  collapseAll.addEventListener('click', () => {
    runCard.querySelectorAll('details.event-detail').forEach((node) => { node.open = false; });
  });

  // ---------------------------------------------------------------- 候选与校验
  if ((snapshot.images || []).length) {
    // 默认折叠：候选与校验是复核材料，不是分享出去的第一眼内容。
    const card = el('details', 'card share-fold');
    const candHead = el('summary', 'share-fold-head');
    candHead.appendChild(el('h2', null, '候选与校验'));
    const totalRounds = snapshot.images.reduce((sum, image) => sum + ((image.rounds || []).length), 0);
    const totalCands = snapshot.images.reduce(
      (sum, image) => sum + (image.rounds || []).reduce((n, round) => n + ((round.candidates || []).length), 0),
      0,
    );
    candHead.appendChild(el('span', 'share-fold-hint',
      snapshot.images.length + ' 张图 · ' + totalRounds + ' 轮 · ' + totalCands + ' 个候选'));
    card.appendChild(candHead);
    const candBody = el('div', 'share-fold-body');
    snapshot.images.forEach((image) => {
      const block = el('div', 'image-block');
      const imageHead = el('div', 'image-head');
      imageHead.append(
        el('h3', null, image.id + ' · ' + image.title),
        el('span', 'pill ' + image.status, imageStatusLabel(image)),
        el('span', 'meta', image.spec.area + ' · ' + image.spec.aspectRatio + ' · ' + (image.spec.entry === 'edit' ? '带参考图' : '文生图')),
      );
      block.appendChild(imageHead);

      (image.rounds || []).forEach((round) => {
        const wrap = el('div', 'round');
        const actionText = round.action && round.action.type === 'edit' ? '局部编辑' : '生成';
        wrap.appendChild(el('div', 'round-title',
          '第 ' + (round.index + 1) + ' 轮 · ' + actionText +
          (round.verdict ? ' · ' + round.verdict.note : '') +
          (round.error ? ' · ' + round.error : '')));

        const grid = el('div', 'candidates');
        (round.candidates || []).forEach((candidate) => {
          grid.appendChild(renderCandidate(candidate, image.chosenId === candidate.id));
        });
        wrap.appendChild(grid);

        renderPromptCompare(wrap, (round.candidates || []).map((candidate) => ({
          id: candidate.id,
          prompt: candidate.prompt,
          revisedPrompt: candidate.revisedPrompt,
        })));

        // 评审材料图：评审当时看到的就是这一张，分享出去才能复核判定依据。
        const sheets = (round.candidates || []).filter((candidate) => candidate.sheetFile && images['sheets/' + candidate.sheetFile]);
        if (sheets.length) {
          const sheetBox = el('details', 'prompt-compare');
          sheetBox.appendChild(el('summary', null, '评审看图材料（' + sheets.length + ' 张）'));
          const sheetBody = el('div', 'detail-body');
          const sheetGrid = el('div', 'sheet-grid');
          sheets.forEach((candidate) => {
            const col = el('div', 'sheet-col');
            col.appendChild(el('div', 'd-pair-head', candidate.id));
            const picture = img('sheets/' + candidate.sheetFile, candidate.id + ' 看图材料');
            if (picture) col.appendChild(picture);
            sheetGrid.appendChild(col);
          });
          sheetBody.appendChild(sheetGrid);
          sheetBox.appendChild(sheetBody);
          wrap.appendChild(sheetBox);
        }

        block.appendChild(wrap);
      });
      candBody.appendChild(block);
    });
    card.appendChild(candBody);
    candidatesCard = card;
  }

  function renderCandidate(candidate, chosen) {
    const card = el('div', 'candidate' + (chosen ? ' chosen' : ''));
    const picture = img('previews/' + candidate.previewFile, candidate.id);
    if (picture) card.appendChild(picture);
    const body = el('div', 'candidate-body');
    body.appendChild(el('div', null, candidate.id + ' · ' + (candidate.size || '')));
    const chips = el('div', 'chips');
    if (candidate.verdict) {
      chips.appendChild(chip('hard ' + candidate.verdict.hardPassed + '/' + candidate.verdict.hardTotal,
        candidate.verdict.hardFailed.length ? 'fail' : 'pass'));
      chips.appendChild(chip('质量 ' + candidate.verdict.quality, ''));
    }
    if (candidate.program && candidate.program.redCast) {
      chips.appendChild(chip('偏红 · 已打回重画', 'fail'));
    } else if (candidate.program && candidate.program.drift) {
      chips.appendChild(chip(candidate.program.drift.label, candidate.program.drift.cast === 'none' ? 'pass' : 'warn'));
    }
    (candidate.checks || []).forEach((check) => {
      if (check.result === 'pass' && check.id.indexOf('P-text') !== 0) return;
      chips.appendChild(chip(check.text, check.result));
    });
    body.appendChild(chips);

    if (candidate.verdict && candidate.verdict.checks) {
      const detailBox = el('details', 'candidate-detail');
      detailBox.appendChild(el('summary', null, '评审逐项判定'));
      const inner = el('div', 'detail-body');
      renderBlocks([
        {
          kind: 'list',
          label: '验收清单',
          items: Object.keys(candidate.verdict.checks).map((key) => {
            const entry = candidate.verdict.checks[key];
            const result = entry.result || '未评';
            return {
              tag: result === 'pass' ? 'pass' : result === 'fail' ? 'fail' : 'warn',
              text: key,
              note: (entry.note || '') + (result === 'uncertain' ? '（拿不准，放行）' : ''),
            };
          }),
        },
        candidate.verdict.summary ? { kind: 'text', label: '总评', text: candidate.verdict.summary } : null,
      ].filter(Boolean), inner);
      detailBox.appendChild(inner);
      body.appendChild(detailBox);
    }

    card.appendChild(body);
    return card;
  }

  // ---------------------------------------------------------------- 交付
  if (snapshot.delivery) {
    const card = el('section', 'card');
    card.appendChild(el('h2', null, '交付'));
    card.appendChild(el('p', 'meta',
      'v' + snapshot.delivery.version +
      ' · 生图 ' + (cost.ditImages || 0) + ' 张' +
      ' · Agent ' + (cost.agentCalls || 0) + ' 次' +
      (cost.usage ? ' · tokens ' + cost.usage.total_tokens : '')));
    const grid = el('div', 'deliver-grid');
    snapshot.delivery.items.forEach((item) => {
      const node = el('div', 'deliver-item');
      if (!item.file) {
        node.textContent = item.id + ' · ' + item.title + '：' + (item.reason || '未生成');
        grid.appendChild(node);
        return;
      }
      const picture = img('deliver/' + item.previewFile, item.title, null, 'large/' + item.file);
      if (picture) node.appendChild(picture);
      node.appendChild(el('h3', null, item.id + ' · ' + item.title));
      node.appendChild(el('span', 'pill ' + (item.status === 'passed' ? 'pass' : 'unpassed'),
        item.status === 'passed' ? '通过' : '未通过（选优交付）'));
      node.appendChild(kv('尺寸', item.size || '-'));
      node.appendChild(kv('轮次', String(item.rounds)));
      if (item.verdict) node.appendChild(kv('hard', item.verdict.hardPassed + '/' + item.verdict.hardTotal));
      node.appendChild(kv('request_id', (item.requestId || '').slice(0, 12)));
      node.appendChild(el('p', 'meta', item.reason || ''));
      grid.appendChild(node);
    });
    card.appendChild(grid);

    renderPromptCompare(card, snapshot.delivery.items.map((item) => ({
      id: item.id + ' · ' + item.title,
      prompt: item.prompt,
      revisedPrompt: item.revisedPrompt,
    })), false, '张交付图');

    if ((snapshot.delivery.questions || []).length) {
      card.appendChild(el('div', 'questions', '需要确认：' + snapshot.delivery.questions.join('；')));
    }
    deliverCard = card;
  }

  // 阅读顺序：需求 → 参考图 → 交付 → 执行过程 → 候选与校验。
  // 结果在前，过程在后：拿到链接的人十有八九只想看图，执行过程和候选是「想深究再看」的材料，
  // 所以后两段默认折叠。参考图属于输入语境，跟着需求走，不插在结果和过程中间。
  if (refsCard) root.appendChild(refsCard);
  if (deliverCard) root.appendChild(deliverCard);
  root.appendChild(runCard);
  if (candidatesCard) root.appendChild(candidatesCard);

  card_footer();

  function card_footer() {
    const foot = el('section', 'card');
    foot.appendChild(el('p', 'meta',
      '本页由 H3-Image-Executor 于 ' + fmtDateTime(data.generatedAt) + ' 导出。' +
      '所有数据与图片均已内嵌，可离线保存或直接转发。'));
    root.appendChild(foot);
  }

  function chip(text, kind) {
    return el('span', 'chip' + (kind ? ' ' + kind : ''), text);
  }

  function kv(label, value) {
    const row = el('div', 'kv');
    row.append(el('span', null, label), el('strong', null, value));
    return row;
  }

  function statusLabel(status) {
    const map = { delivered: '已交付', failed: '失败', cancelled: '已取消', running: '进行中' };
    return map[status] || status;
  }

  function imageStatusLabel(image) {
    if (image.blocked) return '阻塞';
    const map = { pending: '待生成', running: '进行中', passed: '通过', unpassed: '未通过（已选优交付）', failed: '失败' };
    return map[image.status] || image.status;
  }
})();
