(function () {
  "use strict";

  /* ==================================================================
     FactScribe 法律侧工作台 · FR 判例样板页
     只读三栏工作台：左栏语料库（依据）／中栏件详情＋逐条收据（主张）／
     右栏问题区＋文书段落区＋待批提案（落点）。

     纪律：
     · 页面里的每一个数字都来自接口；代码里不许写死任何读数。
       唯一写死的是契约里写明的枚举值（severity／state／kind／scope／how／face…）。
     · 取不到就写「未取到」，并把后端 error.message 原样显示出来，不静默、不编造。
     · token 只放内存（URL 查询参数或顶栏粘贴），不写 localStorage、不落盘。
     ================================================================== */

  /* -------------------- 契约枚举（允许写死的只有这些） -------------------- */
  var RECEIPT_FIELDS_FALLBACK = ["id", "sha16", "span", "face", "how"];
  var MISSING = "—";
  var ENVELOPE_KEYS = ["ok", "version", "endpoint", "exit", "severity", "contract"];
  var PROPOSAL_KINDS = ["receipt_quote", "corpus_item", "fact_claim"];
  var PROPOSAL_SCOPES = ["receipt", "item", "fact"];
  var LINE_STATUS_LABEL = {
    ran: "已跑",
    skipped: "未跑（材料没拿到，不是错误）",
    na: "不适用"
  };
  var HOW_EXPLAIN = {
    contains: "contains＝逐字命中（空白归一后字面命中）",
    numnorm: "numnorm＝数字/日期型走法式归一后对账",
    catalog: "catalog＝按目录/索引比对命中"
  };
  var FACE_EXPLAIN = {
    body: "body＝命中官方正文区间",
    "résumé": "résumé＝只命中官方摘要段（SOMMAIRE/ANA）"
  };
  var SPAN_EXPLAIN = "span＝官方正文坐标区间（官方 txt 的字符区间）";

  /* -------------------- 通道清单（只读通道，路径照契约） -------------------- */
  var CHANNELS = [
    { key: "summary", label: "summary", path: "/api/legal/summary" },
    { key: "findings", label: "findings", path: "/api/legal/findings" },
    { key: "receipts", label: "receipts", path: "/api/legal/receipts" },
    { key: "corpus", label: "corpus", path: "/api/legal/corpus" },
    { key: "codes", label: "codes", path: "/api/legal/codes" },
    { key: "timeliness", label: "timeliness", path: "/api/legal/timeliness" },
    { key: "proposals", label: "proposals", path: "/api/legal/proposals" },
    { key: "document", label: "document", path: "/api/legal/document" },
    { key: "cli", label: "cli", path: "/api/legal/cli" },
    { key: "evidence", label: "论文锁", path: "/api/evidence" }
  ];

  /* -------------------- 状态 -------------------- */
  var S = {
    token: "",
    tokenFrom: "",
    data: {},
    status: {},
    filters: { country: "all", domain: "all", kind: "all", state: "all" },
    selectedId: "",
    selectedDomain: "",
    receiptId: "",
    receiptLine: "",
    detail: null,
    proposalMsg: null,
    busy: false
  };

  /* -------------------- 小工具 -------------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function esc(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function isEmpty(v) { return v === undefined || v === null || v === ""; }
  function uniq(list) {
    var out = [], seen = {};
    list.forEach(function (v) {
      var key = String(v);
      if (v === undefined || v === null || v === "" || seen[key]) return;
      seen[key] = true;
      out.push(v);
    });
    return out;
  }
  function toast(msg) {
    var t = $("#toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove("on"); }, 3200);
  }
  function setStatus(key, state, message, code) {
    S.status[key] = { state: state, message: message || "", code: code || "" };
  }
  function statusOf(key) { return S.status[key] || { state: "idle", message: "", code: "" }; }
  function errBox(st, prefix) {
    return '<div class="errbox"><b>' + esc(st.code || "接口错误") + '</b>：' +
      esc(st.message || "（后端没有给出错误文案）") +
      (prefix ? '<div style="margin-top:3px">' + esc(prefix) + "</div>" : "") + "</div>";
  }
  function emptyPane(title, hint, todo) {
    return '<div class="emptypane"><b>' + esc(title) + "</b>" + esc(hint) +
      (todo ? '<div class="todo">' + esc(todo) + "</div>" : "") + "</div>";
  }
  function tokenNeeded() {
    return '<div class="emptypane"><b>需要令牌</b>' +
      "本页读数全部来自同源 /api/legal/*，需要 Bearer token。请在顶栏粘贴 token 后点「连接」，" +
      "或用 ?token=… 打开本页。token 只放在内存里，不写 localStorage、不落盘。" +
      '<div class="todo">GET /api/legal/summary</div></div>';
  }
  function kvList(obj, skip) {
    var rows = [];
    if (!obj || typeof obj !== "object") return "";
    Object.keys(obj).sort().forEach(function (k) {
      if (skip && skip.indexOf(k) >= 0) return;
      var v = obj[k];
      if (v === undefined || v === null || v === "") return;
      var text = (typeof v === "object") ? JSON.stringify(v) : String(v);
      rows.push("<dt>" + esc(k) + '</dt><dd class="mono-sm">' + esc(text) + "</dd>");
    });
    return rows.join("");
  }
  function shortText(value, max) {
    var text = (value === null || value === undefined) ? "" : String(value);
    if (text.length > max) text = text.slice(0, max) + "…";
    return text;
  }

  /* -------------------- 同源请求 -------------------- */
  function apiRequest(path, method, body) {
    var headers = { Accept: "application/json" };
    if (S.token) headers.Authorization = "Bearer " + S.token;
    var init = { method: method || "GET", headers: headers, cache: "no-store" };
    if (body !== undefined && body !== null) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return fetch(path, init).then(function (res) {
      return res.text().then(function (txt) {
        var payload = null;
        try { payload = txt ? JSON.parse(txt) : null; } catch (e) { payload = null; }
        if (!res.ok) {
          var err = (payload && payload.error) ? payload.error : {};
          return {
            ok: false, status: res.status, payload: payload,
            code: err.code || ("HTTP " + res.status),
            message: err.message || ("HTTP " + res.status + (txt ? "：" + shortText(txt, 200) : ""))
          };
        }
        return { ok: true, status: res.status, payload: payload };
      });
    }).catch(function (e) {
      return {
        ok: false, status: 0, payload: null, code: "NETWORK",
        message: "同源请求失败（服务没起来？）：" + (e && e.message ? e.message : String(e))
      };
    });
  }

  /* -------------------- 取数 -------------------- */
  function applyChannel(key, payload) {
    var contract = payload && payload.contract ? payload.contract : null;
    switch (key) {
      case "summary":
        S.data.contractMeta = contract;
        S.data.summary = contract && contract.summary ? contract.summary : null;
        break;
      case "findings":
        S.data.findings = contract && contract.findings ? contract.findings : null;
        break;
      case "receipts":
        S.data.receipts = contract && contract.receipts ? contract.receipts : null;
        break;
      case "corpus":
        S.data.corpus = contract && contract.corpus ? contract.corpus : null;
        break;
      case "codes":
        S.data.codes = contract && contract.codes ? contract.codes : null;
        break;
      case "timeliness":
        S.data.timeliness = contract && contract.timeliness ? contract.timeliness : null;
        break;
      case "proposals":
        S.data.proposals = contract && contract.proposals ? contract.proposals : null;
        break;
      case "document":
        S.data.document = contract;
        break;
      case "cli":
        S.data.cli = contract;
        break;
      case "evidence": {
        var out = {};
        if (payload && typeof payload === "object") {
          Object.keys(payload).forEach(function (k) {
            if (ENVELOPE_KEYS.indexOf(k) >= 0) return;
            out[k] = payload[k];
          });
        }
        S.data.evidence = out;
        break;
      }
      default:
        break;
    }
  }

  async function loadAll() {
    if (!S.token) { renderAll(); return; }
    S.busy = true;
    renderStatusStrip();
    var results = await Promise.all(CHANNELS.map(async function (ch) {
      var r = await apiRequest(ch.path, "GET");
      return { ch: ch, r: r };
    }));
    results.forEach(function (x) {
      if (x.r.ok) {
        setStatus(x.ch.key, "ok", "", "");
        applyChannel(x.ch.key, x.r.payload);
      } else {
        setStatus(x.ch.key, "err", x.r.message, x.r.code);
        if (x.ch.key === "evidence") S.data.evidence = null;
      }
    });
    S.busy = false;
    renderAll();
    if (S.selectedId) await loadDetail(S.selectedId, S.selectedDomain);
  }

  function detailPath(id, domain) {
    var safe = String(id).replace(/\?/g, "%3F").replace(/#/g, "%23").replace(/ /g, "%20");
    var path = "/api/legal/corpus/" + safe;
    if (domain) path += "?domain=" + encodeURIComponent(domain);
    return path;
  }

  async function loadDetail(id, domain) {
    var r = await apiRequest(detailPath(id, domain), "GET");
    if (r.ok) {
      S.detail = r.payload && r.payload.contract ? r.payload.contract : null;
      setStatus("detail", "ok", "", "");
    } else {
      S.detail = null;
      setStatus("detail", "err", r.message, r.code);
    }
    renderAll();
  }

  /* -------------------- 顶栏 / 接口状态条 -------------------- */
  function renderStatusStrip() {
    var host = $("#iface-status");
    if (!host) return;
    var parts = [];
    if (!S.token) {
      parts.push('<span class="statusitem err"><span class="sdot"></span>' +
        '<span class="smsg">需要令牌：请在顶栏粘贴 token，或用 ?token=… 打开本页</span></span>');
    } else if (S.busy) {
      parts.push('<span class="statusitem wait"><span class="sdot"></span><span class="smsg">正在取数…</span></span>');
    }
    var keys = CHANNELS.map(function (c) { return c.key; });
    if (S.selectedId) keys.push("detail");
    if (S.status.provision) keys.push("provision");
    keys.forEach(function (key) {
      var st = statusOf(key);
      var cls = st.state === "ok" ? "ok" : (st.state === "err" ? "err" : "wait");
      var label = key;
      CHANNELS.forEach(function (c) { if (c.key === key) label = c.label + "（" + c.path + "）"; });
      if (key === "detail") label = "detail（GET /api/legal/corpus/{id}）";
      if (key === "provision") label = "provision（GET /api/legal/provision/{num}/facts）";
      parts.push('<span class="statusitem ' + cls + '"><span class="sdot"></span>' +
        '<span class="sname">' + esc(label) + "</span>" +
        (st.state === "err" ? '<span class="smsg">' + esc(st.code ? st.code + "：" : "") + esc(st.message) + "</span>" : "") +
        "</span>");
    });
    host.innerHTML = '<span class="stitle">' + esc(t("status.title")) + "</span>" + parts.join("");
  }

  /* -------------------- 域级证据锁状态条 -------------------- */
  function renderLocks() {
    var frozenEl = $("#lock-frozen"), matchEl = $("#lock-matches");
    var keysEl = $("#legal-keys"), noteEl = $("#legal-lock-note");
    var summary = S.data.summary;
    var lock = summary && summary.lock ? summary.lock : null;
    var st = statusOf("summary");
    if (!lock) {
      keysEl.innerHTML = "";
      frozenEl.className = "badge dash";
      frozenEl.textContent = "未取到";
      matchEl.className = "badge dash";
      matchEl.textContent = "未取到";
      noteEl.innerHTML = (st.state === "err")
        ? errBox(st, "法律域锁：未取到（域级锁来自 GET /api/legal/summary 的 contract.summary.lock）。")
        : "法律域锁未取到（GET /api/legal/summary 未返回 contract.summary.lock）。";
      return;
    }
    var keyNames = (lock.keys && lock.keys.length) ? lock.keys : ["corpus", "date", "index_sha256", "view"];
    var html = "";
    keyNames.forEach(function (k) {
      var v = lock[k];
      html += '<div class="key"><span class="k">' + esc(k) + '</span><span class="v">' +
        (isEmpty(v) ? '<span style="color:var(--muted-3)">（未声明）</span>' : esc(v)) +
        "</span></div>";
    });
    html += '<div class="key"><span class="k">current_canonical_sha256</span><span class="v">' +
      esc(isEmpty(lock.current_canonical_sha256) ? MISSING : lock.current_canonical_sha256) + "</span></div>";
    html += '<div class="key"><span class="k">frozen_canonical_sha256</span><span class="v">' +
      esc(isEmpty(lock.frozen_canonical_sha256) ? MISSING : lock.frozen_canonical_sha256) + "</span></div>";
    keysEl.innerHTML = html;
    frozenEl.className = lock.frozen ? "badge green" : "badge dash";
    frozenEl.textContent = lock.frozen ? "已冻结" : "未冻结";
    if (lock.matches === true) {
      matchEl.className = "badge green";
      matchEl.textContent = "一致";
    } else if (lock.matches === false) {
      matchEl.className = "badge red";
      matchEl.textContent = "不一致";
    } else {
      matchEl.className = "badge dash";
      matchEl.textContent = "没冻过";
    }
    var note = '锁件 <span class="mono">' + esc(isEmpty(lock.path) ? MISSING : lock.path) +
      '</span>（canonical 四键闭集）。冻结键值：<span class="mono">' +
      esc(JSON.stringify(lock.frozen_keys || {})) + '</span>。';
    if (!isEmpty(lock.last_action)) note += " 最近动作：" + esc(lock.last_action);
    noteEl.innerHTML = note;
  }

  function renderPaperLock() {
    var keysEl = $("#paper-keys"), noteEl = $("#paper-lock-note");
    var ev = S.data.evidence;
    var st = statusOf("evidence");
    if (!ev || !Object.keys(ev).length) {
      keysEl.innerHTML = "";
      noteEl.innerHTML = (st.state === "err")
        ? errBox(st, "论文锁：未取到（论文锁来自 GET /api/evidence）。")
        : "论文锁：未取到（GET /api/evidence 没有返回可列的键值）。";
      return;
    }
    var html = "";
    Object.keys(ev).forEach(function (k) {
      var v = ev[k];
      var text = (v === null || v === undefined) ? MISSING
        : (typeof v === "object" ? JSON.stringify(v) : String(v));
      html += '<div class="key"><span class="k">' + esc(k) + '</span><span class="v">' +
        esc(shortText(text, 240)) + "</span></div>";
    });
    keysEl.innerHTML = html;
    noteEl.innerHTML = "论文侧锁视图：以上键值<b>原样</b>来自 GET /api/evidence 的返回（不猜字段、不改写）。" +
      "论文锁钉的是账本引用的来源材料；法律锁钉的是语料视图身份——两把锁不是一回事。";
  }

  /* -------------------- 左栏：过滤 + 语料列表 + 时效 -------------------- */
  function corpusItems() {
    return (S.data.corpus && S.data.corpus.items) ? S.data.corpus.items : [];
  }
  function filteredItems() {
    var f = S.filters;
    return corpusItems().filter(function (it) {
      if (f.country !== "all" && it.country !== f.country) return false;
      if (f.domain !== "all" && it.domain !== f.domain) return false;
      if (f.kind !== "all" && it.kind !== f.kind) return false;
      var st = (it.timeliness && it.timeliness.state) ? it.timeliness.state : "";
      if (f.state !== "all" && st !== f.state) return false;
      return true;
    });
  }
  function chipRow(group, pairs) {
    return pairs.map(function (p) {
      var on = S.filters[group] === p[0];
      return '<button class="chip" data-group="' + esc(group) + '" data-val="' + esc(p[0]) +
        '" aria-pressed="' + (on ? "true" : "false") + '">' + esc(p[1]) + "</button>";
    }).join("");
  }
  function renderFilters() {
    var items = corpusItems();
    var countries = uniq(items.map(function (i) { return i.country; }));
    var domains = uniq(items.map(function (i) { return i.domain; }));
    var kinds = uniq(items.map(function (i) { return i.kind; }));
    var stateLabels = {};
    items.forEach(function (i) {
      var t = i.timeliness;
      if (t && t.state) stateLabels[t.state] = t.state_label || t.state;
    });
    var states = Object.keys(stateLabels).sort();
    $("#f-country").innerHTML = chipRow("country", [["all", "全部"]].concat(countries.map(function (c) { return [c, c]; })));
    $("#f-domain").innerHTML = chipRow("domain", [["all", "全部"]].concat(domains.map(function (d) { return [d, d]; })));
    $("#f-kind").innerHTML = chipRow("kind", [["all", "全部"]].concat(kinds.map(function (k) { return [k, k]; })));
    $("#f-state").innerHTML = chipRow("state", [["all", "全部"]].concat(states.map(function (s) { return [s, stateLabels[s]]; })));
  }
  function renderCorpusList() {
    var list = filteredItems();
    var all = corpusItems();
    var countEl = $("#c-count");
    if (countEl) countEl.textContent = list.length + " / " + all.length + " 件";
    var host = $("#corpuslist");
    if (!S.token) { host.innerHTML = tokenNeeded(); return; }
    var st = statusOf("corpus");
    if (!all.length) {
      host.innerHTML = (st.state === "err")
        ? errBox(st, "语料清单来自 GET /api/legal/corpus。")
        : emptyPane("没有语料件", "corpus 通道没有返回任何件（只列真实可见的件）。", "GET /api/legal/corpus");
      return;
    }
    if (!list.length) {
      host.innerHTML = emptyPane("没有符合筛选条件的件", "换个国家／域／件型／时效状态再试。", "");
      return;
    }
    host.innerHTML = list.map(function (it) {
      var t = it.timeliness || {};
      var flags = "";
      if (!isEmpty(it.kind)) flags += '<span class="flag">' + esc(it.kind) + "</span>";
      if (!isEmpty(it.domain)) flags += '<span class="flag">' + esc(it.domain) + "</span>";
      if (!isEmpty(t.state_label)) flags += '<span class="flag lock">' + esc(t.state_label) + "</span>";
      if (!isEmpty(it.gate)) flags += '<span class="flag">闸 ' + esc(it.gate) + "</span>";
      return '<button class="citem" data-item="' + esc(it.id) + '" data-domain="' + esc(it.domain || "") +
        '" aria-current="' + (S.selectedId === it.id ? "true" : "false") + '">' +
        '<div class="row1"><span class="cid">' + esc(it.id) + "</span></div>" +
        '<div class="row2">' + esc(isEmpty(it.title) ? MISSING : it.title) + "</div>" +
        '<div class="row3">' + flags + "</div></button>";
    }).join("");
  }
  function renderTimelinessSummary() {
    var host = $("#tl-list"), totalEl = $("#tl-total");
    var tl = S.data.timeliness;
    if (!S.token) { host.innerHTML = tokenNeeded(); if (totalEl) totalEl.textContent = ""; return; }
    var st = statusOf("timeliness");
    if (!tl) {
      host.innerHTML = (st.state === "err") ? errBox(st, "时效来自 GET /api/legal/timeliness。") :
        emptyPane("时效未取到", "GET /api/legal/timeliness 没有返回。", "GET /api/legal/timeliness");
      if (totalEl) totalEl.textContent = "";
      return;
    }
    var items = tl.items || [];
    if (totalEl) totalEl.textContent = (tl.total !== undefined ? tl.total : items.length) + " 件";
    var counts = {};
    items.forEach(function (t) {
      if (!t || !t.state) return;
      counts[t.state] = counts[t.state] || { n: 0, label: t.state_label || t.state };
      counts[t.state].n += 1;
    });
    var states = Object.keys(counts).sort();
    if (!states.length) {
      host.innerHTML = emptyPane("没有时效记录", "timeliness 通道返回的 items 为空。", "");
      return;
    }
    host.innerHTML = states.map(function (s) {
      return '<div class="key"><span class="k">' + esc(counts[s].label) + '</span>' +
        '<span class="v">' + esc(counts[s].n) + "</span></div>";
    }).join("");
  }
  function renderSidenote() {
    var host = $("#sidenote");
    var all = corpusItems();
    var list = filteredItems();
    var text = '<b>语料＝依据</b>：左栏只列 <span class="mono">GET /api/legal/corpus</span> 返回的真实可见件' +
      '（当前共 ' + all.length + ' 件，筛出 ' + list.length + ' 件）。<br>' +
      '服务端也支持 <span class="mono">?country=&domain=&kind=&state=</span> 过滤；' +
      '本页过滤在前端做，改筛选即刻生效，不用重发请求。<br>' +
      '时效状态用统一模型的 <span class="mono">state_label</span>（来自同一份契约，不另造译名）。';
    if (!S.token) text = "<b>需要令牌</b>：本页所有读数都来自同源 /api/legal/*，没有令牌就不取数、不显示假数据。";
    host.innerHTML = text;
  }

  /* -------------------- 中栏：件详情 -------------------- */
  function findCorpusItem(id) {
    var items = corpusItems();
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id) return items[i];
    }
    return null;
  }
  function renderDetail() {
    var host = $("#detail"), hint = $("#detail-hint"), src = $("#detail-src");
    if (!S.selectedId) {
      hint.textContent = "";
      src.innerHTML = "";
      host.innerHTML = S.token
        ? emptyPane("左栏选一件语料", "中栏显示它的真实字段（编号、来源路径、哈希、时效状态）。", "GET /api/legal/corpus/{id}")
        : tokenNeeded();
      return;
    }
    var detail = S.detail;
    var st = statusOf("detail");
    var item = null, receipts = null, candidates = [], ambiguous = false, note = "";
    if (detail) {
      item = detail.item || null;
      receipts = detail.receipts || null;
      candidates = detail.candidates || [];
      ambiguous = !!detail.ambiguous;
      note = detail.note || "";
    }
    var head = "";
    if (st.state === "err") {
      head += errBox(st, "件详情来自 GET /api/legal/corpus/{id}；下面退回用 corpus 通道的列表项显示。");
    }
    if (!item) {
      item = findCorpusItem(S.selectedId);
      if (item && st.state === "err") head += '<div class="notebox">以下字段取自 <span class="mono">corpus</span> 通道的列表项' +
        "（件详情接口未取到，meta／时效可能不完整）。</div>";
    }
    if (!item) {
      host.innerHTML = head + emptyPane("件详情未取到", "corpus 通道里也没有这件。", "");
      hint.textContent = "";
      src.innerHTML = "";
      return;
    }
    hint.textContent = [item.country, item.kind, item.gate ? "闸 " + item.gate : ""]
      .filter(function (x) { return !isEmpty(x); }).join(" · ");
    src.innerHTML = '<span class="badge grey mono">' + esc(isEmpty(item.path) ? MISSING : item.path) + "</span>";
    var rows = [];
    rows.push("<dt>件编号</dt><dd class='mono-sm'>" + esc(item.id) + "</dd>");
    if (!isEmpty(item.title)) rows.push("<dt>标题</dt><dd>" + esc(item.title) + "</dd>");
    if (!isEmpty(item.country)) rows.push("<dt>国家</dt><dd>" + esc(item.country) + "</dd>");
    if (!isEmpty(item.domain)) rows.push("<dt>域</dt><dd class='mono-sm'>" + esc(item.domain) + "</dd>");
    if (!isEmpty(item.kind)) rows.push("<dt>件型</dt><dd>" + esc(item.kind) + "</dd>");
    if (!isEmpty(item.gate)) rows.push("<dt>对应闸</dt><dd class='mono-sm'>" + esc(item.gate) + "</dd>");
    if (!isEmpty(item.path)) rows.push("<dt>来源路径</dt><dd class='mono-sm'>" + esc(item.path) + "</dd>");
    if (!isEmpty(item.root)) rows.push("<dt>语料根</dt><dd class='mono-sm'>" + esc(item.root) + "</dd>");
    var body = "<dl class='kv'>" + rows.join("") + "</dl>";
    var metaRows = kvList(item.meta, []);
    if (metaRows) body += '<div class="sec-label" style="margin-top:12px">meta</div><dl class="kv">' + metaRows + "</dl>";
    if (item.timeliness) {
      body += '<div class="sec-label" style="margin-top:12px">时效（统一模型 11 键）</div>';
      body += "<dl class='kv'>" + kvList(item.timeliness, []) + "</dl>";
    }
    if (receipts && receipts.total !== undefined) {
      body += '<div class="locknote">该件收据 <span class="mono">' + esc(receipts.total) + "</span> 条" +
        (receipts.line ? "（核验线 <span class='mono'>" + esc(receipts.line) + "</span>）" : "") +
        (receipts.gate ? "（闸 <span class='mono'>" + esc(receipts.gate) + "</span>）" : "") + "</div>";
    }
    if (note) body += '<div class="locknote">后端注记：' + esc(note) + "</div>";
    if (ambiguous || candidates.length) {
      body += '<div class="sec-label" style="margin-top:12px">同名件候选（后端标 ambiguous）</div>';
      body += '<div class="chips">' + candidates.map(function (c) {
        return '<button class="chip" data-cand-domain="' + esc(c.domain || "") + '" data-cand-id="' + esc(c.id || "") +
          '" aria-pressed="' + (S.selectedDomain === c.domain) + '">' +
          esc((c.domain || MISSING) + " · " + (c.path || MISSING)) + "</button>";
      }).join("") + "</div>";
    }
    host.innerHTML = head + body;
  }

  /* -------------------- 中栏：逐条收据（五元组） -------------------- */
  function receiptFields() {
    if (S.detail && S.detail.receipts && S.detail.receipts.fields && S.detail.receipts.fields.length) {
      return S.detail.receipts.fields;
    }
    if (S.data.receipts && S.data.receipts.fields && S.data.receipts.fields.length) {
      return S.data.receipts.fields;
    }
    return RECEIPT_FIELDS_FALLBACK;
  }
  function missingMarker() {
    if (S.detail && S.detail.receipts && S.detail.receipts.missing_marker) return S.detail.receipts.missing_marker;
    if (S.data.receipts && S.data.receipts.missing_marker) return S.data.receipts.missing_marker;
    return MISSING;
  }
  function receiptTable(fields, items) {
    var miss = missingMarker();
    var head = '<table class="tbl"><thead><tr>' + fields.map(function (f) {
      return '<th>' + esc(f) + "</th>";
    }).join("") + "</tr></thead><tbody>";
    var body = items.map(function (r) {
      var selected = S.receiptId === r.id;
      return '<tr class="rrow" data-rid="' + esc(r.id) + '" aria-selected="' + (selected ? "true" : "false") + '">' +
        fields.map(function (f) {
          var v = r[f];
          if (isEmpty(v)) v = miss;
          var cls = (f === "face" || f === "how") ? "" : "mono-sm";
          return '<td class="' + cls + '">' + esc(v) + "</td>";
        }).join("") + "</tr>";
    }).join("");
    return head + body + "</tbody></table>";
  }
  function receiptDetail(row) {
    if (!row) return "";
    var fact = row.fact || null;
    var rows = [];
    rows.push("<dt>span</dt><dd>" + esc(row.span || MISSING) + "　<span style='color:var(--muted)'>" +
      esc(SPAN_EXPLAIN) + "</span></dd>");
    rows.push("<dt>face</dt><dd>" + esc(row.face || MISSING) + "　<span style='color:var(--muted)'>" +
      esc(FACE_EXPLAIN[row.face] || (isEmpty(row.face) ? "—＝未能定面（按全正文口径处理）" : "后端给出的命中面")) +
      "</span></dd>");
    rows.push("<dt>how</dt><dd>" + esc(row.how || MISSING) + "　<span style='color:var(--muted)'>" +
      esc(HOW_EXPLAIN[row.how] || (isEmpty(row.how) ? "—＝该条未跑到核验方式" : "后端给出的核验方式")) +
      "</span></dd>");
    if (fact) {
      rows.push("<dt>claim</dt><dd>" + esc(isEmpty(fact.claim) ? MISSING : fact.claim) + "</dd>");
      rows.push("<dt>value</dt><dd class='mono-sm'>" + esc(isEmpty(fact.value) ? MISSING : fact.value) + "</dd>");
      rows.push("<dt>定位</dt><dd class='mono-sm'>" + esc(isEmpty(fact.location) ? MISSING : fact.location) + "</dd>");
      if (!isEmpty(fact.source)) rows.push("<dt>source</dt><dd class='mono-sm'>" + esc(fact.source) + "</dd>");
      if (!isEmpty(fact.file)) rows.push("<dt>file</dt><dd class='mono-sm'>" + esc(fact.file) + "</dd>");
      if (!isEmpty(fact.id)) rows.push("<dt>fact id</dt><dd class='mono-sm'>" + esc(fact.id) + "</dd>");
    } else {
      rows.push("<dt>fact</dt><dd style='color:var(--muted)'>接口没有给这条收据附 fact（claim／value／定位）。</dd>");
    }
    return '<div class="receipt-detail"><header><span class="mono">' + esc(row.id) + "</span>" +
      '<span class="badge accent">收据</span><span style="flex:1"></span>' +
      '<span style="font-weight:400;font-size:11px;color:var(--muted)">点表格任意一行可展开／收起</span></header>' +
      '<div class="rbody"><dl class="explain">' + rows.join("") + "</dl></div></div>";
  }
  function findReceiptRow(items, id) {
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id) return items[i];
    }
    return null;
  }
  function renderReceipts() {
    var host = $("#receipts"), hint = $("#receipt-hint");
    if (!S.token) { hint.textContent = ""; host.innerHTML = tokenNeeded(); return; }
    var fields = receiptFields();
    if (S.selectedId && S.detail) {
      if (S.detail.receipts && S.detail.receipts.items) {
        var items = S.detail.receipts.items;
        hint.textContent = items.length + " 条（" + String(S.detail.receipts.line || "本件") + "）";
        host.innerHTML = receiptTable(fields, items) + receiptDetail(findReceiptRow(items, S.receiptId));
      } else {
        hint.textContent = "";
        host.innerHTML = emptyPane("该件没有收据", "GET /api/legal/corpus/{id} 返回的 receipts 为空。", "");
      }
      return;
    }
    var ch = S.data.receipts;
    if (!ch || !ch.lines || !ch.lines.length) {
      hint.textContent = "";
      var st = statusOf("receipts");
      var dSt = statusOf("detail");
      var box = "";
      if (dSt.state === "err") box += errBox(dSt, "按件收据来自 GET /api/legal/corpus/{id}。");
      if (st.state === "err") box += errBox(st, "全量收据来自 GET /api/legal/receipts。");
      host.innerHTML = box || emptyPane("没有收据读数", "收据通道没有返回任何条。", "GET /api/legal/receipts");
      return;
    }
    var lines = ch.lines;
    var sel = S.receiptLine;
    var found = false;
    lines.forEach(function (l) { if (l.line === sel) found = true; });
    if (!found) { sel = lines[0].line; S.receiptLine = sel; }
    var chips = lines.map(function (l) {
      var n = (l.items && l.items.length) ? l.items.length : 0;
      return '<button class="chip" data-line="' + esc(l.line) + '" aria-pressed="' + (l.line === sel) + '">' +
        esc(l.label || l.line) + "（" + esc(n) + "）</button>";
    }).join("");
    var cur = null;
    lines.forEach(function (l) { if (l.line === sel) cur = l; });
    var items = cur && cur.items ? cur.items : [];
    hint.textContent = items.length + " 条（核验线 " + String(sel) + "）";
    host.innerHTML = '<div class="sec-label">按核验线分组（' +
      (S.selectedId ? "按件收据接口未取到，这里退到 receipts 通道" : "未选件：这里显示 receipts 通道按核验线分组的收据") + "）</div>" +
      '<div class="chips" style="margin-bottom:9px">' + chips + "</div>" +
      receiptTable(fields, items) + receiptDetail(findReceiptRow(items, S.receiptId));
  }

  /* -------------------- 右栏：KPI -------------------- */
  function kpiNum(value) {
    return (value === undefined || value === null) ? "—" : String(value);
  }
  function renderKpis() {
    var f = S.data.findings, r = S.data.receipts, c = S.data.corpus, s = S.data.summary;
    var red = f ? f.red : (s ? s.red : null);
    var yellow = f ? f.yellow : (s ? s.yellow : null);
    var receipts = r ? r.total : null;
    var items = c ? c.total : null;
    $("#kpis").innerHTML =
      '<div class="kpi red"><div class="n' + (red === null ? " na" : "") + '">' + esc(kpiNum(red)) + '</div><div class="l">红牌</div></div>' +
      '<div class="kpi yellow"><div class="n' + (yellow === null ? " na" : "") + '">' + esc(kpiNum(yellow)) + '</div><div class="l">黄牌</div></div>' +
      '<div class="kpi green"><div class="n' + (receipts === null ? " na" : "") + '">' + esc(kpiNum(receipts)) + '</div><div class="l">收据数</div></div>' +
      '<div class="kpi accent"><div class="n' + (items === null ? " na" : "") + '">' + esc(kpiNum(items)) + '</div><div class="l">件数</div></div>';
  }

  /* -------------------- 右栏：问题区 -------------------- */
  function codeIndex() {
    var idx = {};
    var codes = S.data.codes;
    if (codes && codes.items) {
      codes.items.forEach(function (c) { idx[c.code] = c; });
    }
    return idx;
  }
  function renderIssues() {
    var host = $("#issues"), hint = $("#issues-hint");
    if (!S.token) { hint.textContent = ""; host.innerHTML = tokenNeeded(); return; }
    var f = S.data.findings;
    if (!f) {
      var st = statusOf("findings");
      host.innerHTML = (st.state === "err") ? errBox(st, "问题清单来自 GET /api/legal/findings。") :
        emptyPane("问题清单未取到", "GET /api/legal/findings 没有返回。", "GET /api/legal/findings");
      hint.textContent = "";
      return;
    }
    var idx = codeIndex();
    var lines = f.lines || [];
    hint.textContent = (f.total !== undefined ? f.total : "—") + " 条（红 " +
      (f.red !== undefined ? f.red : "—") + " / 黄 " + (f.yellow !== undefined ? f.yellow : "—") + "）";
    if (!lines.length) {
      host.innerHTML = emptyPane("没有问题清单", "findings 通道的 lines 为空。", "");
      return;
    }
    host.innerHTML = lines.map(function (line) {
      var status = line.status || "";
      var badge = status === "ran" ? "green" : (status === "skipped" ? "yellow" : "grey");
      var head = '<div class="linecard"><div class="irow">' +
        '<span class="badge ' + badge + '">' + esc(status || MISSING) + "</span>" +
        '<span class="ilabel">' + esc(isEmpty(line.label) ? MISSING : line.label) + "</span>" +
        '<span class="badge red">红 ' + esc(line.red) + "</span>" +
        '<span class="badge yellow">黄 ' + esc(line.yellow) + "</span></div>" +
        '<div class="imeta">' + esc(line.line || MISSING) +
        (isEmpty(line.country) ? "" : " · " + esc(line.country)) +
        (isEmpty(line.kind) ? "" : " · " + esc(line.kind)) +
        (isEmpty(line.gate) ? "" : " · 闸 " + esc(line.gate)) +
        " · status " + esc(status || MISSING) +
        (LINE_STATUS_LABEL[status] ? "（" + esc(LINE_STATUS_LABEL[status]) + "）" : "") + "</div>";
      if (!isEmpty(line.note)) {
        head += '<div class="imeta">' + (status === "skipped" ? "没跑的原因：" : "注记：") + esc(line.note) + "</div>";
      }
      var items = line.items || [];
      var body = items.map(function (it) {
        var sev = it.severity === "red" ? "red" : "yellow";
        var known = idx[it.code];
        var label = known && !isEmpty(known.label) ? known.label : "";
        return '<button class="issue sev-' + sev + '">' +
          '<div class="irow"><span class="badge ' + sev + '">' + (sev === "red" ? "红" : "黄") + "</span>" +
          (label ? '<span class="ilabel">' + esc(label) + "</span>" : "") + "</div>" +
          '<div class="icode">' + esc(it.code) + (known && !isEmpty(known.gate) ? " · 闸 " + esc(known.gate) : "") + "</div>" +
          (isEmpty(it.location) ? "" : '<div class="iloc">' + esc(it.location) + "</div>") +
          (isEmpty(it.message) ? "" : '<div class="imsg">' + esc(it.message) + "</div>") +
          (isEmpty(it.detail) ? "" : '<div class="imsg">' + esc(it.detail) + "</div>") +
          "</button>";
      }).join("");
      var tail = items.length ? body : '<div class="notebox">这一条线没有判定码' +
        (status === "skipped" ? "（材料没拿到，不是错误）" : "") + "。</div>";
      return head + tail + "</div>";
    }).join("");
  }
  function renderCodes() {
    var host = $("#codes-right");
    if (!S.token) { host.innerHTML = tokenNeeded(); return; }
    var c = S.data.codes;
    if (!c) {
      var st = statusOf("codes");
      host.innerHTML = (st.state === "err") ? errBox(st, "判定码表来自 GET /api/legal/codes。") :
        emptyPane("判定码表未取到", "GET /api/legal/codes 没有返回。", "GET /api/legal/codes");
      return;
    }
    var items = c.items || [];
    if (!items.length) {
      host.innerHTML = emptyPane("判定码表为空", "codes 通道返回的 items 为空。", "");
      return;
    }
    var byDomain = {};
    items.forEach(function (x) {
      var d = isEmpty(x.domain) ? MISSING : x.domain;
      (byDomain[d] = byDomain[d] || []).push(x);
    });
    var html = "";
    Object.keys(byDomain).sort().forEach(function (d) {
      var list = byDomain[d];
      var red = 0;
      list.forEach(function (x) { if (x.severity === "red") red += 1; });
      html += '<div style="margin-bottom:12px"><div class="sec-label">' + esc(d) +
        ' <span class="badge red">红 ' + esc(red) + '</span> <span class="badge yellow">黄 ' + esc(list.length - red) + "</span></div>" +
        '<table class="tbl"><thead><tr><th style="width:210px">code</th><th style="width:130px">中文短名</th>' +
        '<th style="width:44px">分级</th><th>gate</th></tr></thead><tbody>' +
        list.map(function (x) {
          var sev = x.severity === "red" ? "red" : "yellow";
          return '<tr><td class="mono-sm">' + esc(x.code) + "</td>" +
            "<td>" + esc(isEmpty(x.label) ? MISSING : x.label) + "</td>" +
            '<td><span class="badge ' + sev + '">' + (sev === "red" ? "红" : "黄") + "</span></td>" +
            '<td class="mono-sm" style="color:var(--muted)">' + esc(isEmpty(x.gate) ? MISSING : x.gate) + "</td></tr>";
        }).join("") + "</tbody></table></div>";
    });
    host.innerHTML = html;
  }

  /* -------------------- 右栏：文书段落区 -------------------- */
  function markerKey(marker) {
    if (!marker) return "";
    if (marker.receipt && !isEmpty(marker.receipt.id)) return marker.receipt.id;
    if (!isEmpty(marker.fact_id)) return marker.fact_id;
    return "";
  }
  function renderDocument() {
    var host = $("#doc");
    if (!S.token) { host.innerHTML = tokenNeeded(); return; }
    var doc = S.data.document;
    if (!doc) {
      var st = statusOf("document");
      host.innerHTML = (st.state === "err") ? errBox(st, "文书段落来自 GET /api/legal/document。") :
        emptyPane("文书段落未取到", "GET /api/legal/document 没有返回。", "GET /api/legal/document");
      return;
    }
    var sections = doc.sections || [];
    var paragraphs = doc.paragraphs || [];
    var html = '<div class="lede">段落正文与引证标记都来自 <span class="mono">GET /api/legal/document</span>。' +
      "点引证标记 → 高亮中栏对应收据行；点收据行 → 高亮这里的标记。标记里的 official 是官方逐字片段，展开可看。</div>";
    if (sections.length) {
      html += '<div class="sec-label">文书段落文件</div><div class="keyrow">' +
        sections.map(function (s) { return '<div class="key"><span class="v">' + esc(s) + "</span></div>"; }).join("") +
        "</div>";
    }
    if (!paragraphs.length) {
      html += emptyPane("没有段落", "document 通道的 paragraphs 为空。", "");
      host.innerHTML = html;
      return;
    }
    html += '<div class="sec-label" style="margin-top:10px">段落（' + esc(doc.total !== undefined ? doc.total : paragraphs.length) + "）</div>";
    html += paragraphs.map(function (p) {
      var markers = p.markers || [];
      var head = '<div class="phead">§' + esc(p.index) + (isEmpty(p.file) ? "" : " · " + esc(p.file)) + "</div>";
      var text = '<div class="doc">' + esc(isEmpty(p.text) ? MISSING : p.text) + "</div>";
      var mk = "";
      if (markers.length) {
        mk = '<div class="chips" style="margin-top:6px">' + markers.map(function (m) {
          var key = markerKey(m);
          var active = key && key === S.receiptId;
          var label = isEmpty(m.fact_id) ? (key || MISSING) : m.fact_id;
          var extra = isEmpty(m.value) ? "" : " · " + shortText(m.value, 40);
          return '<button class="mark' + (active ? "" : "") + '" data-mk="' + esc(key) +
            '" aria-current="' + (active ? "true" : "false") + '" title="' + esc(m.location || m.source || "") + '">' +
            esc(label) + esc(extra) + "</button>";
        }).join("") + "</div>";
        mk += markers.map(function (m) {
          var off = m.official;
          if (!off) return "";
          var body = "";
          if (!isEmpty(off.text)) body += '<div class="quote">' + esc(off.text) + "</div>";
          var meta = [];
          if (!isEmpty(off.span)) meta.push("span " + off.span);
          if (!isEmpty(off.face)) meta.push("face " + off.face);
          if (!isEmpty(off.source)) meta.push("source " + off.source);
          if (meta.length) body += '<div class="locknote">' + esc(meta.join(" · ")) + "</div>";
          return '<details class="official"><summary>官方逐字片段</summary>' + body + "</details>";
        }).join("");
      }
      return '<div class="para">' + head + text + mk + "</div>";
    }).join("");
    if (!isEmpty(doc.note)) html += '<div class="locknote">后端注记：' + esc(doc.note) + "</div>";
    host.innerHTML = html;
  }

  /* -------------------- 右栏：条 → 事实反查 -------------------- */
  async function loadProvisionFacts() {
    var input = $("#prov-num");
    var num = input ? input.value.trim() : "";
    if (!num) { toast("请先填条号（num）"); return; }
    var path = "/api/legal/provision/" + encodeURIComponent(num) + "/facts";
    var r = await apiRequest(path, "GET");
    if (r.ok) {
      S.data.provision = (r.payload && r.payload.contract) ? r.payload.contract : null;
      setStatus("provision", "ok", "", "");
    } else {
      S.data.provision = null;
      setStatus("provision", "err", r.message, r.code);
    }
    renderProvisionFacts();
    renderStatusStrip();
  }
  function renderProvisionFacts() {
    var host = $("#prov-results");
    if (!host) return;
    if (!S.token) { host.innerHTML = tokenNeeded(); return; }
    var p = S.data.provision;
    if (!p) {
      var st = statusOf("provision");
      host.innerHTML = (st.state === "err")
        ? errBox(st, "条→事实反查来自 GET /api/legal/provision/{num}/facts。")
        : emptyPane("还没反查", "填一个条号（num）再点「反查」；本页不预置任何条号。",
            "GET /api/legal/provision/{num}/facts");
      return;
    }
    var items = p.items || [];
    var html = '<div class="sec-label">反查结果（' + esc(p.total !== undefined ? p.total : items.length) + "）</div>";
    if (!items.length) {
      html += emptyPane("没有事实引用这个条号", p.note || "", "");
    } else {
      html += '<div class="proplist">' + items.map(function (it) {
        var rc = it.receipt || null;
        var ci = it.corpus_item || null;
        var tl = it.timeliness || null;
        var rows = '<div class="prow-head"><span class="pid">' + esc(it.fact_id) + "</span>" +
          (rc ? '<span class="badge accent">收据 ' + esc(rc.id) + "</span>" : '<span class="badge dash">无收据</span>') + "</div>";
        rows += '<div class="pmeta">claim：' + esc(isEmpty(it.claim) ? MISSING : it.claim) + "</div>";
        rows += '<div class="pmeta">value：<span class="mono">' + esc(isEmpty(it.value) ? MISSING : it.value) + "</span></div>";
        rows += '<div class="pmeta">定位：<span class="mono">' + esc(isEmpty(it.location) ? MISSING : it.location) + "</span></div>";
        if (rc) {
          rows += '<div class="pmeta">收据：span <span class="mono">' + esc(isEmpty(rc.span) ? MISSING : rc.span) +
            "</span> · face <span class=\"mono\">" + esc(isEmpty(rc.face) ? MISSING : rc.face) +
            "</span> · how <span class=\"mono\">" + esc(isEmpty(rc.how) ? MISSING : rc.how) + "</span></div>";
        }
        if (ci) {
          rows += '<div class="pmeta">语料件：<span class="mono">' + esc(ci.id) + "</span> " +
            esc(isEmpty(ci.title) ? "" : ci.title) + "（" + esc(isEmpty(ci.domain) ? MISSING : ci.domain) + "）</div>";
        }
        if (tl) {
          rows += '<div class="pmeta">时效：' +
            esc(isEmpty(tl.state_label) ? (isEmpty(tl.state) ? MISSING : tl.state) : tl.state_label) + "</div>";
        }
        return '<div class="proprow">' + rows + "</div>";
      }).join("") + "</div>";
      if (!isEmpty(p.note)) html += '<div class="locknote">后端注记：' + esc(p.note) + "</div>";
    }
    host.innerHTML = html;
  }

  /* -------------------- 右栏：待批提案 -------------------- */
  function renderProposals() {
    var host = $("#proposals");
    if (!S.token) { host.innerHTML = tokenNeeded(); return; }
    var p = S.data.proposals;
    var st = statusOf("proposals");
    var html = '<div class="sec-label">建单（POST /api/legal/proposals · 不写盘）</div>';
    html += '<div class="pform">' +
      '<div><label for="p-kind">kind</label><select id="p-kind">' +
      PROPOSAL_KINDS.map(function (k) { return '<option value="' + esc(k) + '">' + esc(k) + "</option>"; }).join("") +
      "</select></div>" +
      '<div><label for="p-scope">target.scope</label><select id="p-scope">' +
      PROPOSAL_SCOPES.map(function (k) { return '<option value="' + esc(k) + '">' + esc(k) + "</option>"; }).join("") +
      "</select></div>" +
      '<div><label for="p-fact">target.fact_id</label><input id="p-fact" type="text" autocomplete="off"></div>' +
      '<div><label for="p-item">target.item_id</label><input id="p-item" type="text" autocomplete="off"></div>' +
      '<div class="full"><label for="p-source">target.source</label><input id="p-source" type="text" autocomplete="off"></div>' +
      '<div class="full"><label for="p-payload">payload（JSON；填不出 JSON 就按摘要包成 {"summary": 文本}）</label>' +
      '<textarea id="p-payload"></textarea></div>' +
      '<div class="full"><label for="p-beforesha">before_sha（可选；填了就走指纹闸）</label>' +
      '<input id="p-beforesha" type="text" autocomplete="off"></div>' +
      '<div class="full btnrow"><button class="tbtn primary" id="btn-propose" type="button">建单</button>' +
      '<span class="locknote" style="margin:0">建单只登记提议，不写盘。</span></div>' +
      "</div>";
    if (S.proposalMsg) {
      html += '<div class="' + (S.proposalMsg.ok ? "notebox" : "errbox") + '" style="margin-top:9px">' +
        (S.proposalMsg.ok ? "" : "<b>" + esc(S.proposalMsg.code || "接口错误") + "</b>：") +
        esc(S.proposalMsg.text) + "</div>";
    }
    html += '<div class="sec-label" style="margin-top:12px">提议单列表（GET /api/legal/proposals）</div>';
    if (!p) {
      html += (st.state === "err") ? errBox(st, "") :
        emptyPane("提议单未取到", "GET /api/legal/proposals 没有返回。", "GET /api/legal/proposals");
    } else {
      var items = p.items || [];
      if (!items.length) {
        html += emptyPane("没有提议单", p.note || "proposals 通道的 items 为空。", "");
      } else {
        html += '<div class="proplist">' + items.map(function (it) {
          var fp = it.fingerprint || {};
          var dec = it.decision || {};
          var statusBadge = it.status === "rejected" ? "red" : (it.status === "adopted_pending" ? "green" : "grey");
          var rows = "";
          rows += '<div class="prow-head"><span class="pid">' + esc(it.id) + "</span>" +
            '<span class="badge accent">' + esc(it.kind || MISSING) + "</span>" +
            '<span class="badge ' + statusBadge + '">' + esc(it.status || MISSING) + "</span>" +
            '<span style="flex:1"></span>' +
            '<button class="tbtn" data-pid="' + esc(it.id) + '" type="button">采纳写回</button></div>';
          var target = it.target || {};
          rows += '<div class="pmeta">target：' + esc(JSON.stringify(target)) + "</div>";
          rows += '<div class="pmeta">before_sha：<span class="mono">' + esc(isEmpty(it.before_sha) ? MISSING : it.before_sha) +
            '</span>　after_sha：<span class="mono">' + esc(isEmpty(it.after_sha) ? MISSING : it.after_sha) + '</span></div>';
          rows += '<div class="pmeta">fingerprint：source <span class="mono">' + esc(isEmpty(fp.source) ? MISSING : fp.source) +
            '</span> · current <span class="mono">' + esc(isEmpty(fp.current) ? MISSING : fp.current) +
            '</span> · matches ' + esc(fp.matches === undefined ? MISSING : String(fp.matches)) + '</div>';
          if (!isEmpty(dec.action) || !isEmpty(dec.reason)) {
            rows += '<div class="pmeta">decision：action <span class="mono">' + esc(isEmpty(dec.action) ? MISSING : dec.action) +
              '</span> · write_path ' + esc(isEmpty(dec.write_path) ? MISSING : String(dec.write_path)) +
              (isEmpty(dec.reason) ? '' : ' · ' + esc(dec.reason)) + '</div>';
          }
          var afterText = (it.status === "adopted_pending")
            ? "已登记采纳意图 · 未写盘"
            : ((it.status === "rejected") ? "已拒写（指纹闸拦下）" : "待采纳 · 未写盘");
          rows += '<div class="diff">' +
            '<div><div class="dlabel">现状（before_sha）</div><div class="dval">' +
              esc(isEmpty(it.before_sha) ? MISSING : it.before_sha) + "</div>" +
              '<div class="dlabel" style="margin-top:6px">指纹来源</div><div class="dval">' +
              esc(isEmpty(fp.source) ? MISSING : fp.source) + "</div></div>" +
            '<div class="after"><div class="dlabel">采纳后（' + esc(it.status || MISSING) + "）</div>" +
              '<div class="dval">' + esc(afterText) + "</div>" +
              '<div class="dlabel" style="margin-top:6px">write_path</div><div class="dval">' +
              esc(dec.write_path === undefined ? MISSING : String(dec.write_path)) + "</div></div></div>";
          return '<div class="proprow">' + rows + "</div>";
        }).join("") + "</div>";
        if (!isEmpty(p.note)) html += '<div class="locknote">后端注记：' + esc(p.note) + "</div>";
      }
    }
    host.innerHTML = html;
  }

  /* -------------------- 页脚：CLI -------------------- */
  function renderCli() {
    var host = $("#cli-list");
    if (!S.token) { host.innerHTML = tokenNeeded(); return; }
    var cli = S.data.cli;
    if (!cli) {
      var st = statusOf("cli");
      host.innerHTML = (st.state === "err") ? errBox(st, "CLI 清单来自 GET /api/legal/cli。") :
        emptyPane("CLI 清单未取到", "GET /api/legal/cli 没有返回。", "GET /api/legal/cli");
      return;
    }
    var items = cli.items || [];
    if (!items.length) {
      host.innerHTML = emptyPane("CLI 清单为空", "cli 通道的 items 为空。", "");
      return;
    }
    host.innerHTML = '<table class="tbl"><thead><tr><th style="width:170px">name</th><th style="width:150px">group</th>' +
      '<th>help</th><th style="width:260px">args</th></tr></thead><tbody>' +
      items.map(function (c) {
        var args = (c.args || []).map(function (a) {
          return '<span class="mono">' + esc(a.name) + (a.required ? "（必填）" : "") + "</span>" +
            (isEmpty(a.help) ? "" : "：" + esc(a.help));
        }).join("、");
        return '<tr><td class="mono-sm">' + esc(c.name) + "</td>" +
          '<td class="mono-sm" style="color:var(--muted)">' + esc(isEmpty(c.group) ? MISSING : c.group) + "</td>" +
          "<td>" + esc(isEmpty(c.help) ? MISSING : c.help) + "</td>" +
          '<td class="mono-sm" style="color:var(--muted)">' + (args ? args : MISSING) + "</td></tr>";
      }).join("") + "</tbody></table>";
  }

  /* -------------------- 写动作（只有两个） -------------------- */
  async function createProposal() {
    var kind = $("#p-kind").value;
    var scope = $("#p-scope").value;
    var target = { scope: scope };
    var fact = $("#p-fact").value.trim();
    var item = $("#p-item").value.trim();
    var source = $("#p-source").value.trim();
    if (fact) target.fact_id = fact;
    if (item) target.item_id = item;
    if (source) target.source = source;
    var raw = $("#p-payload").value.trim();
    var payload = {};
    if (raw) {
      try { payload = JSON.parse(raw); }
      catch (e) { payload = { summary: raw }; }
    }
    var body = { kind: kind, target: target, payload: payload };
    var beforeSha = $("#p-beforesha").value.trim();
    if (beforeSha) body.before_sha = beforeSha;
    var r = await apiRequest("/api/legal/proposals", "POST", body);
    if (r.ok) {
      S.proposalMsg = { ok: true, text: "提议单已建（不写盘）：" +
        JSON.stringify((r.payload && r.payload.contract && r.payload.contract.proposal) || r.payload) };
      toast("提议单已建（不写盘）");
    } else {
      S.proposalMsg = { ok: false, code: r.code, text: r.message };
      toast("建单失败：" + r.code);
    }
    var again = await apiRequest("/api/legal/proposals", "GET");
    if (again.ok) {
      applyChannel("proposals", again.payload);
      setStatus("proposals", "ok", "", "");
    } else {
      setStatus("proposals", "err", again.message, again.code);
    }
    renderAll();
  }
  async function adoptProposal(id) {
    var r = await apiRequest("/api/legal/proposals/" + encodeURIComponent(id) + "/adopt", "POST", {});
    if (r.ok) {
      S.proposalMsg = { ok: true, text: "已登记采纳意图（未写盘：法律闸无写路径，等第③步真写路径）" };
      toast("已登记采纳意图（未写盘）");
    } else {
      S.proposalMsg = { ok: false, code: r.code, text: r.message };
      toast("采纳被闸挡住：" + r.code);
    }
    var again = await apiRequest("/api/legal/proposals", "GET");
    if (again.ok) {
      applyChannel("proposals", again.payload);
      setStatus("proposals", "ok", "", "");
    } else {
      setStatus("proposals", "err", again.message, again.code);
    }
    renderAll();
  }

  /* -------------------- 总渲染 -------------------- */
  function renderAll() {
    renderStatusStrip();
    renderLocks();
    renderPaperLock();
    renderFilters();
    renderCorpusList();
    renderTimelinessSummary();
    renderSidenote();
    renderDetail();
    renderReceipts();
    renderKpis();
    renderIssues();
    renderCodes();
    renderDocument();
    renderProvisionFacts();
    renderProposals();
    renderCli();
  }

  /* -------------------- 事件 -------------------- */
  function bindEvents() {
    $("#btn-token").addEventListener("click", function () {
      var v = $("#token-input").value.trim();
      if (!v) { toast("请先粘贴 token"); return; }
      S.token = v;
      S.tokenFrom = "顶栏粘贴";
      toast("token 已放在内存里，开始取数");
      loadAll();
    });
    $("#token-input").addEventListener("keydown", function (e) {
      if (e.key === "Enter") $("#btn-token").click();
    });
    $("#btn-refresh").addEventListener("click", function () {
      if (!S.token) { toast("需要令牌"); return; }
      loadAll();
    });
    document.addEventListener("click", function (e) {
      var target = e.target;
      if (!target || !target.closest) return;
      var chip = target.closest(".chip[data-group]");
      if (chip) {
        S.filters[chip.getAttribute("data-group")] = chip.getAttribute("data-val");
        renderFilters();
        renderCorpusList();
        renderTimelinessSummary();
        renderSidenote();
        return;
      }
      var item = target.closest(".citem[data-item]");
      if (item) {
        S.selectedId = item.getAttribute("data-item");
        S.selectedDomain = item.getAttribute("data-domain") || "";
        S.receiptId = "";
        S.receiptLine = "";
        renderCorpusList();
        if (S.token) loadDetail(S.selectedId, S.selectedDomain);
        else renderAll();
        return;
      }
      var cand = target.closest("[data-cand-domain]");
      if (cand) {
        S.selectedDomain = cand.getAttribute("data-cand-domain") || "";
        S.selectedId = cand.getAttribute("data-cand-id") || S.selectedId;
        if (S.token) loadDetail(S.selectedId, S.selectedDomain);
        return;
      }
      var row = target.closest("tr[data-rid]");
      if (row) {
        var rid = row.getAttribute("data-rid");
        S.receiptId = (S.receiptId === rid) ? "" : rid;
        renderReceipts();
        renderDocument();
        var again = document.querySelector("tr[data-rid]");
        if (again) { /* 重新渲染后位置不变，无需滚动 */ }
        return;
      }
      var mark = target.closest(".mark[data-mk]");
      if (mark) {
        var key = mark.getAttribute("data-mk");
        if (!key) return;
        S.receiptId = (S.receiptId === key) ? "" : key;
        renderReceipts();
        renderDocument();
        return;
      }
      var lineChip = target.closest(".chip[data-line]");
      if (lineChip) {
        S.receiptLine = lineChip.getAttribute("data-line");
        S.receiptId = "";
        renderReceipts();
        return;
      }
      var pid = target.closest("[data-pid]");
      if (pid) {
        if (!S.token) { toast("需要令牌"); return; }
        adoptProposal(pid.getAttribute("data-pid"));
        return;
      }
      if (target.closest("#btn-prov")) {
        if (!S.token) { toast("需要令牌"); return; }
        loadProvisionFacts();
        return;
      }
      if (target.closest("#btn-prov-fill")) {
        var numInput = $("#prov-num");
        if (!S.selectedId) { toast("先在左栏选一件语料"); return; }
        if (numInput) numInput.value = S.selectedId;
        toast("已带入选中件的 id（可自行改）");
        return;
      }
      var propose = target.closest("#btn-propose");
      if (propose) {
        if (!S.token) { toast("需要令牌"); return; }
        createProposal();
        return;
      }
      var tab = target.closest(".tab[data-tab]");
      if (tab) {
        var which = tab.getAttribute("data-tab");
        $$(".tab[data-tab]").forEach(function (x) {
          x.setAttribute("aria-selected", x.getAttribute("data-tab") === which ? "true" : "false");
        });
        $("#issues").hidden = which !== "issues";
        $("#codes-right").hidden = which !== "codes";
      }
    });
    $("#prov-num").addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        if (!S.token) { toast("需要令牌"); return; }
        loadProvisionFacts();
      }
    });
    window.addEventListener("error", function (e) {
      toast("页面脚本出错：" + (e && e.message ? e.message : "未知错误"));
    });
  }


  /* -------------------- 界面语言（中/EN）--------------------
     基准：miniapp app.js:5379（#langSeg 点击切语言）。
     范围：只切**静态外壳**文案；接口返回的文案（码的中文短名、注记、
     错误原文）保持后端原样——后端给什么就显示什么，不替它翻译。 */
  var LANG_KEY = "factscribe.legal.lang";
  var I18N = {
    zh: {
      "brand.sub": "法律侧工作台 · FR 判例样板页",
      "tb.readonly": "法律闸暂无写路径",
      "tb.connect": "连接",
      "tb.refresh": "刷新读数",
      "tb.rerun": "重新核验",
      "lock.legal.tag": "法律域锁",
      "lock.legal.desc": "域级证据锁 · 四键闭集",
      "lock.paper.tag": "论文锁",
      "lock.paper.desc": "论文侧证据锁 · 另一把锁（不是上面这把）",
      "status.title": "接口状态",
      "rail.country": "国家 / 法域",
      "rail.domain": "域（对应闸）",
      "rail.kind": "件型",
      "rail.state": "时效状态",
      "rail.corpus": "语料（依据）",
      "rail.tl": "时效状态分布",
      "main.detail": "件详情",
      "main.receipts": "事实账 · 逐条收据",
      "main.receipts.hint": "列＝契约 fields 顺序：id｜sha16｜span｜face｜how；点行展开",
      "right.issues": "问题区",
      "right.issues.hint": "红牌 / 黄牌 · 码用 codes 通道的中文短名",
      "tab.issues": "问题清单",
      "tab.codes": "判定码表",
      "right.doc": "文书段落区（落点）",
      "right.doc.hint": "带引证标记的段落 · 点标记 ⇄ 点收据 双向高亮",
      "right.prov": "条 → 事实反查",
      "right.prov.hint": "GET /api/legal/provision/{num}/facts · 条号由你给，本页不预置",
      "right.prov.go": "反查",
      "right.prov.fill": "用选中件的 id",
      "right.prop": "待批提案",
      "right.prop.hint": "建单 · 采纳只登记意图，不写盘",
      "foot.cli": "法律侧 CLI 子命令（来自 GET /api/legal/cli）",
      "foot.unmounted": "未挂载的接口（页面不调、不假装有）",
      "foot.consume": "本页怎么消费接口"
    },
    en: {
      "brand.sub": "Legal workbench · FR case sample",
      "tb.readonly": "No write path in the legal gate",
      "tb.connect": "Connect",
      "tb.refresh": "Refresh",
      "tb.rerun": "Re-verify",
      "lock.legal.tag": "Legal lock",
      "lock.legal.desc": "Domain evidence lock · 4-key closed set",
      "lock.paper.tag": "Paper lock",
      "lock.paper.desc": "Paper-side evidence lock · a different lock (not the one above)",
      "status.title": "Endpoint status",
      "rail.country": "Country / jurisdiction",
      "rail.domain": "Domain (gate)",
      "rail.kind": "Kind",
      "rail.state": "Timeliness",
      "rail.corpus": "Corpus (evidence)",
      "rail.tl": "Timeliness distribution",
      "main.detail": "Item detail",
      "main.receipts": "Fact ledger · receipts",
      "main.receipts.hint": "Columns = contract fields order: id|sha16|span|face|how; click a row to expand",
      "right.issues": "Findings",
      "right.issues.hint": "Red / yellow cards · code labels come from the codes channel (Chinese, as returned)",
      "tab.issues": "Findings",
      "tab.codes": "Code table",
      "right.doc": "Document segments (landing)",
      "right.doc.hint": "Segments with citation markers · click a marker ⇄ click a receipt",
      "right.prov": "Provision → facts",
      "right.prov.hint": "GET /api/legal/provision/{num}/facts · the number is yours to type; nothing is preset here",
      "right.prov.go": "Look up",
      "right.prov.fill": "Use selected item id",
      "right.prop": "Pending proposals",
      "right.prop.hint": "Create a ticket · adopt only registers intent, writes nothing",
      "foot.cli": "Legal CLI subcommands (from GET /api/legal/cli)",
      "foot.unmounted": "Unmounted endpoints (the page neither calls nor pretends to have)",
      "foot.consume": "How this page consumes the API"
    }
  };
  var S_LANG = "zh";
  function t(key) {
    var dict = I18N[S_LANG] || I18N.zh;
    return dict[key] || (I18N.zh[key] || key);
  }
  function applyLang(lang) {
    S_LANG = (lang === "en") ? "en" : "zh";
    var dict = I18N[S_LANG] || I18N.zh;
    $$("[data-i18n]").forEach(function (el) {
      var k = el.getAttribute("data-i18n");
      if (dict[k]) el.textContent = dict[k];
    });
    document.documentElement.setAttribute("lang", S_LANG === "en" ? "en" : "zh-CN");
    $$("#langSeg button").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-lang") === S_LANG);
    });
    try { localStorage.setItem(LANG_KEY, S_LANG); } catch (e) { /* 无痕模式：存不下就算了 */ }
  }
  function initLang() {
    var saved = "";
    try { saved = localStorage.getItem(LANG_KEY) || ""; } catch (e) { saved = ""; }
    applyLang(saved === "en" ? "en" : "zh");
    var seg = $("#langSeg");
    if (!seg) return;
    seg.addEventListener("click", function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest("button[data-lang]") : null;
      if (!btn) return;
      applyLang(btn.getAttribute("data-lang"));
    });
  }

  /* -------------------- 右栏宽度拖拽 --------------------
     基准：miniapp app.js:5757-5827（NAVW_KEY；拖动实时变、松手才记）。
     宽度是**本机界面偏好**，记在 localStorage，与项目数据无关。 */
  var NAVW_KEY = "factscribe.legal.navw";
  var NAVW_MIN = 300, NAVW_MAX = 680, NAVW_DEFAULT = 392;
  function navWidth(raw) {
    var w = parseInt(raw, 10) || 0;
    if (!w) w = NAVW_DEFAULT;
    return Math.min(NAVW_MAX, Math.max(NAVW_MIN, w));
  }
  function initSplitter() {
    var el = $("#nav-splitter");
    if (!el) return;
    var saved = 0;
    try { saved = localStorage.getItem(NAVW_KEY) || ""; } catch (e) { saved = ""; }
    document.documentElement.style.setProperty("--nav-w", navWidth(saved) + "px");
    var dragging = false;
    el.addEventListener("mousedown", function (ev) {
      dragging = true;
      document.body.classList.add("nav-dragging");
      ev.preventDefault();
    });
    window.addEventListener("mousemove", function (ev) {
      if (!dragging) return;
      var w = window.innerWidth - ev.clientX;
      document.documentElement.style.setProperty("--nav-w", navWidth(w) + "px");
    });
    window.addEventListener("mouseup", function () {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("nav-dragging");
      var now = getComputedStyle(document.documentElement).getPropertyValue("--nav-w");
      try { localStorage.setItem(NAVW_KEY, String(navWidth(now))); } catch (e) { /* 忽略 */ }
    });
  }

  /* -------------------- 启动 -------------------- */
  function init() {
    var q = new URLSearchParams(window.location.search || "");
    var token = q.get("token");
    if (token && token.trim()) {
      S.token = token.trim();
      S.tokenFrom = "URL 查询参数";
      $("#token-input").value = S.token;
    }
    initLang();
    initSplitter();
    bindEvents();
    renderAll();
    if (S.token) loadAll();
  }

  init();
})();
