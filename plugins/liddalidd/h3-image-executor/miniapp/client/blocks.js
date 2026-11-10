'use strict';

// 共享渲染原语：主页面和导出的分享页共用这一份，保证两边看到的内容完全一致。
// 纯浏览器 API，不依赖任何框架，也不在 Node 侧执行。
window.H3Blocks = (function () {
  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  // 已运行时间：不到 1 小时用 mm:ss，超过用 h:mm:ss。
  function fmtDuration(ms) {
    const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours) return hours + ':' + pad2(minutes) + ':' + pad2(seconds);
    return pad2(minutes) + ':' + pad2(seconds);
  }

  function fmtSeconds(ms) {
    return (Math.max(0, Number(ms) || 0) / 1000).toFixed(1) + 's';
  }

  function fmtClock(t) {
    const date = new Date(Number(t) || 0);
    return pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds());
  }

  function fmtDateTime(t) {
    const date = new Date(Number(t) || 0);
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) + ' ' + fmtClock(t);
  }

  const TAG_LABELS = {
    pass: '通过',
    fail: '不通过',
    warn: '注意',
    uncertain: '拿不准',
    hard: '必须',
    soft: '偏好',
  };

  const STAGES = [
    ['input', '00 输入'],
    ['think', '02 检索'],
    ['plan', '03 规划'],
    ['paint', '04 生成'],
    ['verify', '05 校验'],
    ['refine', '06 修正'],
    ['select', '选优'],
    ['deliver', '07 交付'],
  ];

  // 长内容默认收起。展开一个节点后如果还是几百行，重点就没了；
  // 折叠后每段只剩一行标题，需要哪段点哪段。
  const LIST_COLLAPSE = 5;
  const TEXT_COLLAPSE = 320;

  function appendBlock(parent, wrap, summaryText) {
    if (!summaryText) {
      parent.appendChild(wrap);
      return;
    }
    const box = document.createElement('details');
    box.className = 'd-collapse';
    const summary = document.createElement('summary');
    summary.textContent = summaryText;
    box.append(summary, wrap);
    parent.appendChild(box);
  }

  // ctx.image(key) 把后端给的寻址键（cache/xxx.jpg、refs/R1.png）解析成可显示的地址：
  // 主页面解析成 /api/file 请求，分享页解析成内嵌的 data URL。两边共用同一份渲染代码。
  function renderBlocks(blocks, parent, ctx) {
    (blocks || []).forEach((block) => {
      if (!block) return;
      if (block.kind === 'kv') {
        const row = document.createElement('div');
        row.className = 'd-kv';
        const label = document.createElement('span');
        label.className = 'd-label';
        label.textContent = block.label;
        const value = document.createElement('span');
        value.className = 'd-value';
        value.textContent = block.value;
        row.append(label, value);
        parent.appendChild(row);
        return;
      }
      if (block.kind === 'text' || block.kind === 'json') {
        const content = block.kind === 'json' ? JSON.stringify(block.value, null, 2) : String(block.text || '');
        const collapse = Boolean(block.label) && content.length > TEXT_COLLAPSE;
        const wrap = document.createElement('div');
        wrap.className = 'd-text';
        if (block.label && !collapse) {
          const label = document.createElement('div');
          label.className = 'd-label';
          label.textContent = block.label;
          wrap.appendChild(label);
        }
        const pre = document.createElement('pre');
        pre.textContent = content;
        wrap.appendChild(pre);
        appendBlock(parent, wrap, collapse ? block.label : '');
        return;
      }
      if (block.kind === 'list') {
        const items = block.items || [];
        // 条数多或者总字数多都算「太长」：分诊思考只有 5 条，但每条都是一整段，
        // 只按条数判会漏掉它，展开后还是一堵墙。
        const chars = items.reduce((sum, entry) => sum + String((entry && entry.text) || '').length, 0);
        const collapse = Boolean(block.label) && (items.length > LIST_COLLAPSE || chars > TEXT_COLLAPSE);
        const wrap = document.createElement('div');
        wrap.className = 'd-list';
        if (block.label && !collapse) {
          const label = document.createElement('div');
          label.className = 'd-label';
          label.textContent = block.label;
          wrap.appendChild(label);
        }
        const ul = document.createElement('ul');
        items.forEach((entry) => {
          const li = document.createElement('li');
          if (entry.tag) {
            const tag = document.createElement('span');
            tag.className = 'd-tag ' + entry.tag;
            tag.textContent = TAG_LABELS[entry.tag] || entry.tag;
            li.appendChild(tag);
          }
          const text = document.createElement('span');
          text.textContent = entry.text;
          li.appendChild(text);
          if (entry.note) {
            const note = document.createElement('em');
            note.className = 'd-note';
            note.textContent = entry.note;
            li.appendChild(note);
          }
          ul.appendChild(li);
        });
        wrap.appendChild(ul);
        appendBlock(parent, wrap, collapse ? block.label + '（' + items.length + ' 项）' : '');
        return;
      }
      if (block.kind === 'thumbs') {
        const items = block.items || [];
        const collapse = Boolean(block.label) && items.length > 6;
        const wrap = document.createElement('div');
        wrap.className = 'd-thumbs';
        if (block.label && !collapse) {
          const label = document.createElement('div');
          label.className = 'd-label';
          label.textContent = block.label;
          wrap.appendChild(label);
        }
        const grid = document.createElement('div');
        grid.className = 'd-thumb-grid';
        items.forEach((item) => {
          const cell = document.createElement('figure');
          cell.className = 'd-thumb' + (item.tag ? ' is-' + item.tag : '');
          const src = item.key && ctx && ctx.image ? ctx.image(item.key) : '';
          if (src) {
            const image = document.createElement('img');
            image.src = src;
            image.alt = item.title || '';
            image.loading = 'lazy';
            if (ctx && ctx.onImage) image.onclick = () => ctx.onImage(src);
            cell.appendChild(image);
          } else {
            const empty = document.createElement('div');
            empty.className = 'd-thumb-empty';
            empty.textContent = item.text || '未下载';
            cell.appendChild(empty);
          }
          const cap = document.createElement('figcaption');
          const title = document.createElement('span');
          title.className = 'd-thumb-title';
          title.textContent = item.title || '（无标题）';
          cap.appendChild(title);
          if (item.tag) {
            const tag = document.createElement('span');
            tag.className = 'd-tag ' + item.tag;
            tag.textContent = TAG_LABELS[item.tag] || item.tag;
            cap.appendChild(tag);
          }
          if (src && item.text) {
            const note = document.createElement('em');
            note.className = 'd-note';
            note.textContent = item.text;
            cap.appendChild(note);
          }
          if (item.note) {
            const from = document.createElement('em');
            from.className = 'd-thumb-src';
            from.textContent = item.note;
            cap.appendChild(from);
          }
          cell.appendChild(cap);
          grid.appendChild(cell);
        });
        wrap.appendChild(grid);
        appendBlock(parent, wrap, collapse ? block.label + '（' + items.length + ' 张）' : '');
        return;
      }
      if (block.kind === 'pair') {
        const wrap = document.createElement('div');
        wrap.className = 'd-pair';
        if (block.label) {
          const label = document.createElement('div');
          label.className = 'd-label';
          label.textContent = block.label;
          wrap.appendChild(label);
        }
        const grid = document.createElement('div');
        grid.className = 'd-pair-grid';
        [block.left, block.right].forEach((side) => {
          const col = document.createElement('div');
          col.className = 'd-pair-col';
          const head = document.createElement('div');
          head.className = 'd-pair-head';
          head.textContent = side.label;
          const pre = document.createElement('pre');
          pre.textContent = side.text || '（无）';
          col.append(head, pre);
          grid.appendChild(col);
        });
        wrap.appendChild(grid);
        parent.appendChild(wrap);
        return;
      }
      if (block.kind === 'group') {
        const wrap = document.createElement('div');
        wrap.className = 'd-group';
        const title = document.createElement('div');
        title.className = 'd-group-title';
        title.textContent = block.label;
        wrap.appendChild(title);
        const body = document.createElement('div');
        body.className = 'd-group-body';
        renderBlocks(block.blocks, body, ctx);
        wrap.appendChild(body);
        parent.appendChild(wrap);
      }
    });
  }

  // Prompt 对照：左边是我们写并送进模型的，右边是服务端改写后真正生效的。
  function renderPromptCompare(host, entries, open, noun) {
    const rows = (entries || []).filter((entry) => entry.prompt || entry.revisedPrompt);
    if (!rows.length) return;
    const box = document.createElement('details');
    box.className = 'prompt-compare';
    if (open) box.open = true;
    const summary = document.createElement('summary');
    summary.textContent = 'Prompt 对照（' + rows.length + ' ' + (noun || '个候选') + '）';
    box.appendChild(summary);
    const body = document.createElement('div');
    body.className = 'detail-body';
    renderBlocks(
      rows.map((entry) => ({
        kind: 'pair',
        label: entry.id,
        left: { label: '我们送进模型的 prompt', text: entry.prompt || '' },
        right: { label: '服务端改写后真正生效的 prompt', text: entry.revisedPrompt || '' },
      })),
      body,
    );
    box.appendChild(body);
    host.appendChild(box);
  }

  // ---------------------------------------------------------------- 时间线
  //
  // 时间线从上往下走（新的在底部），并且把「同一节点的连续事件」合并成一条：
  // 主行只给结论，副行给过程梗概，展开后才是逐条明细。
  // 原始事件流是"我正在干啥"的流水账，直接铺出来没人看得下去。

  const TOOL_RE = /^调用工具\s+(.+)$/;
  // 预算计数是全角括号写的：调用工具 read（1/6）。工具名要把尾巴去掉。
  const TOOL_COUNT_RE = /[（(]\s*\d+\s*\/\s*\d+\s*[）)]\s*$/;
  const LIFECYCLE_RE = /^(开始|完成（[^）]*）|模型\s+\S+\s+已启动)$/;

  function toolNameOf(text) {
    const hit = TOOL_RE.exec(String(text || '').trim());
    return hit ? hit[1].replace(TOOL_COUNT_RE, '').trim() : '';
  }

  function isLifecycle(text) {
    return LIFECYCLE_RE.test(String(text || '').trim());
  }

  function hasBlocks(event) {
    return Boolean(event && event.detail && event.detail.blocks && event.detail.blocks.length);
  }

  function shorten(text, max) {
    const value = String(text || '');
    return value.length > max ? value.slice(0, max - 1) + '…' : value;
  }

  // 工具名去掉 connector__matrix__ 这种命名空间前缀，副行才读得下去。
  function shortToolName(name) {
    const parts = String(name || '').split('__');
    return shorten(parts[parts.length - 1] || name, 26);
  }

  // 组内工具调用汇总成 "read ×2、search_images ×1"。
  function summarizeTools(counts) {
    const names = Object.keys(counts);
    if (!names.length) return '';
    const parts = names.map((name) => {
      const short = shortToolName(name);
      return counts[name] > 1 ? short + ' ×' + counts[name] : short;
    });
    if (parts.length <= 3) return parts.join('、');
    return parts.slice(0, 3).join('、') + ' 等 ' + parts.length + ' 种';
  }

  function buildGroup(stage, events) {
    const tools = {};
    let toolTotal = 0;
    const content = [];
    events.forEach((event) => {
      const tool = toolNameOf(event.text);
      if (tool) {
        tools[tool] = (tools[tool] || 0) + 1;
        toolTotal += 1;
        return;
      }
      if (isLifecycle(event.text)) return;
      content.push(event);
    });

    const first = events[0];
    const last = events[events.length - 1];
    const summed = events.reduce((sum, event) => sum + (Number(event.durMs) || 0), 0);
    const durMs = summed || Math.max(0, (Number(last.t) || 0) - (Number(first.t) || 0));
    const toolText = summarizeTools(tools);

    // 主行优先级：带详情的结论 > 普通结论 > 工具汇总 > 生命周期文本。
    let main;
    const detailed = content.filter(hasBlocks);
    if (detailed.length) main = detailed[detailed.length - 1].text;
    else if (content.length) main = content[content.length - 1].text;
    else if (toolTotal) main = toolTotal + ' 次工具调用：' + toolText;
    else main = last.text;

    // 副行：其余结论 + 工具汇总（主行已经写了工具调用就不重复）。
    const rest = [];
    content.forEach((event) => {
      if (event.text !== main) rest.push(event.text);
    });
    if (toolTotal && String(main).indexOf('工具调用') < 0) {
      rest.push(toolTotal + ' 次工具调用：' + toolText);
    }
    const shown = rest.slice(0, 2);
    if (rest.length > shown.length) shown.push('+' + (rest.length - shown.length) + ' 项');

    let level = 'info';
    events.forEach((event) => {
      if (event.level === 'error') level = 'error';
      else if (event.level === 'warn' && level !== 'error') level = 'warn';
    });

    return {
      key: first.seq,
      stage,
      events,
      main,
      sub: shown.join(' · '),
      level,
      durMs,
      startT: first.t,
      startOffset: first.elapsedMs,
      expandable: events.length > 1 || events.some(hasBlocks),
      count: events.length,
    };
  }

  // 按 stage 的连续段分组：同一个节点连着做的几件事算一类，跨节点才断开。
  // agent 只是在报「哪个模型在跑」，是元信息，并进当前节点，不另起一行。
  function groupEvents(events) {
    const ordered = (events || []).slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
    const raw = [];
    ordered.forEach((event) => {
      const current = raw[raw.length - 1];
      if (current && (current.stage === event.stage || event.stage === 'agent')) {
        current.events.push(event);
        return;
      }
      raw.push({ stage: event.stage, events: [event] });
    });
    return raw.map((group) => buildGroup(group.stage, group.events));
  }

  function renderEventDetail(event, parent, ctx) {
    if (!hasBlocks(event)) return;
    if (event.detail.title) {
      const title = document.createElement('div');
      title.className = 'detail-title';
      title.textContent = event.detail.title;
      parent.appendChild(title);
    }
    renderBlocks(event.detail.blocks, parent, ctx);
  }

  // 过程一句话带过：生命周期（开始 / 模型已启动 / 完成（39s））和逐次工具调用
  // 都是过程噪音，合并成一行就够了，不该和结论抢位置。
  function groupMetaLine(group) {
    const parts = [];
    const done = group.events
      .map((event) => String(event.text || '').trim())
      .filter((text) => text.indexOf('完成（') === 0)
      .pop();
    if (done) parts.push(done.replace(/^完成（/, '').replace(/）$/, ''));
    const tools = {};
    let total = 0;
    group.events.forEach((event) => {
      const name = toolNameOf(event.text);
      if (!name) return;
      tools[name] = (tools[name] || 0) + 1;
      total += 1;
    });
    if (total) parts.push(total + ' 次工具调用：' + summarizeTools(tools));
    return parts.join(' · ');
  }

  // 展开后的明细：只列有结论的事件，每条一行；要看它的完整详情再点一层。
  // 结论那条默认展开，其余收起——这样一进来就能看到重点。
  function renderGroupItems(group, parent, ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'group-items';

    const meta = groupMetaLine(group);
    if (meta) {
      const line = document.createElement('div');
      line.className = 'group-meta';
      line.textContent = meta;
      wrap.appendChild(line);
    }

    const items = group.events.filter((event) => !isLifecycle(event.text) && !toolNameOf(event.text));
    items.forEach((event) => {
      const detailed = hasBlocks(event);
      const row = document.createElement('div');
      row.className = 'group-item' + (detailed ? ' has-detail' : '');

      // 整行就是折叠开关：详情入口跟事件排在同一行、靠右对齐。
      // 之前「展开详情」单独占一行，一组十几个事件堆下来全是重复的入口文字。
      const box = document.createElement(detailed ? 'details' : 'div');
      box.className = 'group-item-detail';
      if (detailed && event.text === group.main) box.open = true;

      const head = document.createElement(detailed ? 'summary' : 'div');
      head.className = 'group-item-head';
      const time = document.createElement('span');
      time.className = 'event-time';
      time.textContent = fmtClock(event.t);
      const offset = document.createElement('span');
      offset.className = 'event-offset';
      offset.textContent = '+' + fmtDuration(event.elapsedMs);
      const text = document.createElement('span');
      text.className = 'group-item-text';
      text.textContent = event.text;
      head.append(time, offset, text);
      if (event.durMs) {
        const dur = document.createElement('span');
        dur.className = 'event-dur';
        dur.textContent = fmtSeconds(event.durMs);
        head.appendChild(dur);
      }
      // 展开后每一条生图各自带自己的请求号：一组里可能有好几轮，
      // 只在组头给一个会分不清是哪一轮的。
      if (event.requestId) head.appendChild(reqChip(event.requestId));
      box.appendChild(head);

      if (detailed) {
        const body = document.createElement('div');
        body.className = 'detail-body';
        renderEventDetail(event, body, ctx);
        box.appendChild(body);
      }
      row.appendChild(box);
      wrap.appendChild(row);
    });
    parent.appendChild(wrap);
  }

  function subLine(text) {
    const node = document.createElement('div');
    node.className = 'event-sub';
    node.textContent = text;
    return node;
  }

  // request_id 整段太长会挤掉结论，显示前 12 位，title 和复制都带完整值。
  function reqChip(requestId) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'req-id';
    chip.textContent = 'req ' + String(requestId).slice(0, 12);
    chip.title = 'request_id ' + requestId + '（点击复制）';
    chip.onclick = (event) => {
      // 这一行可能包在 summary 里，不拦住冒泡就会顺手把详情展开/收起。
      event.preventDefault();
      event.stopPropagation();
      const done = () => {
        chip.classList.add('copied');
        setTimeout(() => chip.classList.remove('copied'), 1200);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(requestId).then(done, () => {});
      } else {
        done();
      }
    };
    return chip;
  }

  // opts.openSet: Set<number>，记住哪些组是展开的（主页面用；分享页不传就都不展开）。
  function renderTimeline(host, events, opts) {
    const options = opts || {};
    const openSet = options.openSet || null;
    const ctx = { image: options.image || null, onImage: options.onImage || null };
    const groups = groupEvents(events);
    host.textContent = '';

    groups.forEach((group) => {
      const item = document.createElement('li');
      item.className =
        'event' +
        (group.expandable ? ' has-detail' : '') +
        (group.level !== 'info' ? ' ' + group.level : '');

      const head = document.createElement(group.expandable ? 'summary' : 'div');
      head.className = 'event-head';

      const time = document.createElement('span');
      time.className = 'event-time';
      time.textContent = fmtClock(group.startT);
      const offset = document.createElement('span');
      offset.className = 'event-offset';
      offset.textContent = '+' + fmtDuration(group.startOffset);
      const tag = document.createElement('span');
      tag.className = 'stage-tag';
      tag.textContent = group.stage;
      const text = document.createElement('span');
      text.className = 'event-text';
      text.textContent = group.main;
      head.append(time, offset, tag, text);

      // 生图请求号：出图那一刻就要能看见、能复制。
      // 以前它只躺在三层折叠的「DiT 输出」详情里，排查一次要展开三次。
      const reqId = group.events.map((event) => event.requestId).filter(Boolean).pop();
      if (reqId) head.appendChild(reqChip(reqId));

      // 步数与耗时合成一组右对齐：窄屏里结论一长，两个徽标会各自掉到第二行，
      // 左对齐在时间列下面，像 bug 不像排版。
      if (group.count > 1 || group.durMs) {
        const badges = document.createElement('span');
        badges.className = 'event-badges';
        if (group.count > 1) {
          const badge = document.createElement('span');
          badge.className = 'event-count';
          badge.textContent = group.count + ' 步';
          badges.appendChild(badge);
        }
        if (group.durMs) {
          const dur = document.createElement('span');
          dur.className = 'event-dur';
          dur.textContent = fmtSeconds(group.durMs);
          badges.appendChild(dur);
        }
        head.appendChild(badges);
      }

      // 副行必须放进 summary 里：details 没展开时，summary 之外的子元素会被浏览器藏掉。
      if (group.sub) head.appendChild(subLine(group.sub));

      if (!group.expandable) {
        item.appendChild(head);
        host.appendChild(item);
        return;
      }

      const box = document.createElement('details');
      box.className = 'event-detail';
      box.open = openSet ? openSet.has(group.key) : false;
      if (openSet) {
        box.ontoggle = () => {
          if (box.open) openSet.add(group.key);
          else openSet.delete(group.key);
        };
      }
      box.appendChild(head);

      const body = document.createElement('div');
      body.className = 'detail-body';
      if (group.count > 1) renderGroupItems(group, body, ctx);
      else renderEventDetail(group.events[0], body, ctx);
      box.appendChild(body);
      item.appendChild(box);
      host.appendChild(item);
    });

    return { groups: groups.length, events: (events || []).length };
  }

  return {
    pad2, fmtDuration, fmtSeconds, fmtClock, fmtDateTime, TAG_LABELS, STAGES,
    renderBlocks, renderPromptCompare, groupEvents, renderTimeline, reqChip,
  };
})();
