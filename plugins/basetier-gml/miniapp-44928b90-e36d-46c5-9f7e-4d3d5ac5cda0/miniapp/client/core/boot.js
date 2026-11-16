/* ============================================================
   GML 项目存档管理器 —— 网页内注入层（运行在 iframe 里）
   1. 用「当前存档槽」的数据虚拟出 window.localStorage / sessionStorage
   2. 网页每次自动存档（setItem / removeItem / clear）都回传宿主，由管理器落盘
   3. 提供命令通道，让宿主调用网页自带的 export / import 存档接口
   ============================================================ */
(function(){
  'use strict';
  var B = window.__GML_PM_BOOT__ || { saveId:'', data:{} };
  var TAG = '__gml_pm';
  var LANG = (B.lang === 'en') ? 'en' : 'zh';
  var ls = Object.create(null);      /* 当前存档槽的 localStorage 镜像 */
  var ss = Object.create(null);      /* sessionStorage 不持久化 */
  Object.keys(B.data || {}).forEach(function(k){ ls[k] = String(B.data[k]); });

  /* 界面语言由管理器统一决定：在网页任何脚本启动之前，把 lang 写进虚拟 settings。
     网页的 detectLang() 优先级最高就读这里，所以打开项目时不会先闪一下中文/英文。 */
  (function(){
    var KEY = 'gml-practice-log-v2:settings';
    try{
      var o = ls[KEY] ? JSON.parse(ls[KEY]) : {};
      if(!o || typeof o !== 'object') o = {};
      o.lang = LANG;
      ls[KEY] = JSON.stringify(o);
    }catch(e){
      ls[KEY] = JSON.stringify({ dailyGoal:5, lang:LANG, carrierColors:{}, customTypes:[] });
    }
  })();

  var timer = null, dirty = false, seq = 0;
  function has(m, k){ return Object.prototype.hasOwnProperty.call(m, k); }

  /* 注：早期版本这里有一层「API 介绍（desc）持久化补丁」，用来兜住网页版
     partApi() 落盘时丢掉 desc 的老 bug。现在内置版与抓取版都已自行修复
     （out[id] = { code, desc, params }），补丁纯属冗余，且每 2 秒拉一次
     export 存档，开销不值当，故已撤掉。 */

  function snap(){
    var o = {}, ks = Object.keys(ls);
    for(var i=0;i<ks.length;i++) o[ks[i]] = ls[ks[i]];
    return o;
  }
  function post(type, extra){
    var m = {};
    m[TAG] = true; m.dir = 'to-host'; m.saveId = B.saveId; m.type = type; m.seq = (++seq);
    if(extra) for(var k in extra) if(Object.prototype.hasOwnProperty.call(extra, k)) m[k] = extra[k];
    try{ parent.postMessage(m, '*'); }catch(e){}
  }
  function flush(){
    if(timer){ clearTimeout(timer); timer = null; }
    if(!dirty){ post('pong'); return; }
    dirty = false;
    post('commit', { data: snap(), ts: Date.now() });
  }
  function mark(){
    dirty = true;
    if(timer) clearTimeout(timer);
    timer = setTimeout(flush, 90);
  }
  /* 造一个和 Storage 行为一致的虚拟对象，支持点语法 / 方括号 / 枚举 */
  function makeStore(m, onChange){
    function h(k){ return has(m, k); }
    return new Proxy({}, {
      get: function(t, p){
        if(p === 'length') return Object.keys(m).length;
        if(p === 'key') return function(i){ var ks = Object.keys(m); return (i >= 0 && i < ks.length) ? ks[i] : null; };
        if(p === 'getItem') return function(k){ k = String(k); return h(k) ? m[k] : null; };
        if(p === 'setItem') return function(k, v){ m[String(k)] = String(v); onChange(); };
        if(p === 'removeItem') return function(k){ delete m[String(k)]; onChange(); };
        if(p === 'clear') return function(){ Object.keys(m).forEach(function(k){ delete m[k]; }); onChange(); };
        if(typeof p === 'string' && h(p)) return m[p];
        return undefined;
      },
      set: function(t, p, v){ if(typeof p === 'string'){ m[p] = String(v); onChange(); } return true; },
      has: function(t, p){ return typeof p === 'string' && h(p); },
      deleteProperty: function(t, p){ if(typeof p === 'string') delete m[p]; onChange(); return true; },
      ownKeys: function(){ return Object.keys(m); },
      getOwnPropertyDescriptor: function(t, p){
        if(typeof p === 'string' && h(p))
          return { value:m[p], writable:true, enumerable:true, configurable:true };
        return undefined;
      }
    });
  }
  var LS = makeStore(ls, mark);
  var SS = makeStore(ss, function(){});
  function def(name, val){
    try{ Object.defineProperty(window, name, { value:val, configurable:true, writable:true }); }
    catch(e){ try{ window[name] = val; }catch(e2){} }
  }
  def('localStorage', LS);
  def('sessionStorage', SS);

  /* ---- 宿主 ⇄ 网页的命令通道 ---- */
  function runCmd(d){
    var tries = 0;
    (function attempt(){
      if(window.gml && typeof window.gml.cmd === 'function'){
        var r;
        try{ r = window.gml.cmd(d.name, d.args || {}); }
        catch(e){ post('cmd-result', { id:d.id, ok:false, error:String((e && e.message) || e) }); return; }
        Promise.resolve(r).then(function(v){ post('cmd-result', { id:d.id, ok:true, result:v }); })
          .catch(function(e){ post('cmd-result', { id:d.id, ok:false, error:String((e && e.message) || e) }); });
        return;
      }
      if(tries++ < 240) setTimeout(attempt, 50);
      else post('cmd-result', { id:d.id, ok:false, error:'网页接口未就绪' });
    })();
  }
  window.addEventListener('message', function(e){
    var d = e.data;
    if(!d || d[TAG] !== true || d.dir !== 'to-app') return;
    if(d.type === 'flush'){ flush(); post('cmd-result', { id:d.id, ok:true, result:{ flushed:true } }); return; }
    if(d.type === 'cmd'){ runCmd(d); return; }
    if(d.type === 'ping'){ post('pong', { id:d.id }); return; }
  });
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);

  /* ---- 屏蔽网页版的「退出前要不要导出存档」提醒 ----
     网页在 beforeunload 里做两件事：
       ① e.preventDefault() + e.returnValue  → 浏览器原生「离开此网站？」提示
       ② showExitModal()                      → 网页自己的 #exitModal 弹层
     在 Chrome 里 iframe 挂了 beforeunload 还会连带拦住整个页面的关闭/刷新，
     管理器里关掉项目就会卡住用户。

     存档本来已经由宿主自动落盘，不需要这个提醒 ⇒ 这里屏蔽掉。
     做法（不改网页本体，内置版和抓取回来的网页版都生效）：
       · beforeunload 用捕获阶段抢先跑，把 preventDefault / returnValue 摆平，
         浏览器就不会弹原生提示（网页自己的处理器仍会跑，flushPendingSave 不受影响）；
       · 再用 MutationObserver 盯着 #exitModal 的 open 类，一加上就撤掉。 */
  window.addEventListener('beforeunload', function(e){
    /* Blink 的 legacy setter：event.returnValue = 任何非 "false" 的值都等价于调用
       preventDefault()，会直接拉起浏览器原生「离开此网站？」框。
       ⇒ 先用 defineProperty 把 returnValue 换成普通数据属性，绕开 setter；
         网页后面写 e.returnValue = '' 只落到这个数据属性上，不再有任何副作用。
       ⇒ 绝不能先写 e.returnValue = xxx，那一行自己就会把 canceled 置位。 */
    try{
      Object.defineProperty(e, 'returnValue', { value: '', writable: true, configurable: true });
    }catch(err){}
    try{
      Object.defineProperty(e, 'preventDefault', { value: function(){}, writable: true, configurable: true });
    }catch(err){}
  }, true);
  function ready(){ post('ready'); }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
  setTimeout(flush, 400);
})();

/* ============================================================
   界面接管：屏蔽网页菜单里会和「项目存档管理器」冲突的入口
   存档 / 读档 / 清空缓存 / 新手教程 / 切换到 English
   只隐藏 + 拦截点击，不删除 DOM —— 网页脚本会直接给这些元素绑事件，
   删掉会让它在初始化时抛 null 错误，整页功能就废了。
   ============================================================ */
(function(){
  'use strict';
  var B = window.__GML_PM_BOOT__ || {};
  var NOTE = {
    zh: '存档由项目管理器写进 Mini App 的数据目录（.json 文件）；换设备前请在管理页点「导出全部」备份。',
    en: 'Saves are written by the project manager into the Mini App data folder (.json files). Use "Export all" on the manager page before switching devices.'
  };
  var curLang = (B.lang === 'en') ? 'en' : 'zh';
  var IDS = ['miExport','miImport','miClear','miTutorial','miLang'];
  var SEL = '#' + IDS.join(',#');
  var css = SEL + '{display:none !important;}'
    + '#userMenu .um-note:not(.gml-pm-note){display:none !important;}'
    + '#userMenu .gml-pm-note{display:block !important;}';
  var st = document.createElement('style');
  st.setAttribute('data-gml-pm','menu-guard');
  st.textContent = css;
  try{ (document.head || document.documentElement).appendChild(st); }catch(e){}

  /* ---- 退出前的「要不要导出存档」弹层：屏蔽 ----
     存档在 Mini App 里由宿主自动落盘，这个提醒只会挡住用户。
     网页的 showExitModal() 是给 #exitModal 加 open 类 ⇒ 盯着这个类，
     一加上就撤掉，等于弹层从未出现过。
     不删 DOM（网页脚本还握着它的引用）。 */
  function killExitModal(){
    var m = document.getElementById('exitModal');
    if(!m) return;
    if(m.classList.contains('open')){
      m.classList.remove('open');
      try{ document.body.style.overflow = ''; }catch(e){}
    }
  }
  function watchExitModal(){
    killExitModal();
    try{
      var mo = new MutationObserver(killExitModal);
      mo.observe(document.documentElement, { attributes:true, subtree:true, attributeFilter:['class'] });
    }catch(e){}
    setInterval(killExitModal, 400);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchExitModal);
  else watchExitModal();

  /* 即使样式被绕过，也在捕获阶段拦下这 5 个按钮的点击 */
  document.addEventListener('click', function(e){
    var t = e.target;
    if(!t || typeof t.closest !== 'function') return;
    if(t.closest(SEL)){ e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  /* 原菜单底部那句「存档只存在浏览器里」在管理器里是错的，换成准确说明。
     新节点带 data-i18n-skip，网页自己的中英翻译不会改写它，由管理器按下发的语言更新。 */
  function applyNote(){
    var n = document.querySelector('#userMenu .gml-pm-note');
    if(n) n.textContent = NOTE[curLang];
  }
  function patchNote(){
    var menu = document.getElementById('userMenu');
    if(!menu || menu.querySelector('.gml-pm-note')) return;
    var p = document.createElement('p');
    p.className = 'um-note gml-pm-note';
    p.setAttribute('data-i18n-skip','');
    p.textContent = NOTE[curLang];
    menu.appendChild(p);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', patchNote);
  else patchNote();
  setTimeout(patchNote, 1200);   /* 兜底：菜单若被网页重建，再补一次 */

  /* 管理器切换语言时下发：菜单提示跟着变英文/中文；
     网页本身的界面切换由宿主调用 gml.cmd('lang') 完成。 */
  window.addEventListener('message', function(e){
    var d = e.data;
    if(!d || d.__gml_pm !== true || d.dir !== 'to-app' || d.type !== 'ui-lang') return;
    curLang = (d.lang === 'en') ? 'en' : 'zh';
    applyNote(); patchNote();
    setTimeout(function(){ applyNote(); patchNote(); }, 400);
  });
})();

/* ============================================================
   文案校正层：原网页的文案假设「数据存在浏览器的 localStorage 里」，
   这在 Mini App 里不成立——数据由项目管理器写进数据目录。
   网页的字典对象不是全局的（拿不到），所以这里直接改渲染出来的文本：
     · RULES   —— 整句固定的文案
     · PATTERNS —— 带数量的文案（「当前设备上有 1 条记录、0 个 API。」）
   对内置版和「抓取最新版本」下载回来的网页都有效。
   ============================================================ */
(function(){
  'use strict';
  var B = window.__GML_PM_BOOT__ || {};
  var lang = (B.lang === 'en') ? 'en' : 'zh';

  /* 整句文案：olds 里是中英文旧说法，zh/en 是 Mini App 里该显示的说法 */
  var RULES = [
    { olds: ['存档只存在这台设备的浏览器里。换设备或清缓存前，先导出备份。',
             'Your data lives only in this browser on this device. Export a backup before switching devices or clearing the cache.'],
      zh: '存档由项目管理器写进 Mini App 的数据目录（.json 文件）；换设备前请在管理页点「导出全部」备份。',
      en: 'Saves are written by the project manager into the Mini App data folder (.json files). Use "Export all" on the manager page before switching devices.' },
    { olds: ['存档只存在这台设备的浏览器里，刷新、换浏览器、清缓存都会丢。要现在导出一份完整存档文件吗？',
             'Your data only lives in this browser on this device - refreshing, switching browsers or clearing cache will lose it. Export a full backup file now?'],
      zh: '存档写在 Mini App 的数据目录里（.json 文件），刷新不会丢；换设备前请在管理页点「导出全部」备份。要现在导出一份完整存档文件吗？',
      en: 'Saves are stored in the Mini App data folder (.json files); a refresh will not lose them, but export a full backup before switching devices. Export a full backup file now?' },
    { olds: ['昵称与记录只保存在这台设备的浏览器里，刷新后依然在。<br>别人首次打开时看到的是默认昵称和空白记录。',
             'Your nickname and records are stored only in this browser on this device and survive a refresh.<br>Anyone else opening it sees the default nickname and no records.'],
      zh: '昵称与记录保存在当前项目文件里，刷新后依然在。<br>别人首次打开时看到的是默认昵称和空白记录。',
      en: 'Your nickname and records are stored in the current project file and survive a refresh.<br>Anyone else opening it sees the default nickname and no records.' },
    { olds: ['昵称与记录只保存在这台设备的浏览器里，刷新后依然在。',
             'Your nickname and records are stored only in this browser on this device and survive a refresh.'],
      zh: '昵称与记录保存在当前项目文件里，刷新后依然在。',
      en: 'Your nickname and records are stored in the current project file and survive a refresh.' },
    { olds: ['图片会自动缩到 1024px 以内保存，只存在这台设备上。',
             'Images are scaled to fit within 1024px before saving, and stay on this device only.'],
      zh: '图片会自动缩到 1024px 以内保存，只存在当前项目里。',
      en: 'Images are scaled to fit within 1024px before saving, and stay in the current project only.' },
    /* 内置的新手教程说明（Mini App 里入口已隐藏，但数据仍要改对） */
    { olds: ['数据只存在这台设备的浏览器里。\n换设备或清缓存前，\n先导出备份。\n\n页面里没有上报代码，\n断网也能用。',
             'The data only lives in this browser\non this device.\nExport a backup before switching\ndevices or clearing the cache.\n\nNothing is uploaded:\nthe site works offline.'],
      zh: '数据写在 Mini App 的数据目录里。\n换设备前，\n先在管理页导出备份。\n\n页面里没有上报代码，\n断网也能用。',
      en: 'The data is written into the Mini App\ndata folder.\nExport a backup from the manager page\nbefore switching devices.\n\nNothing is uploaded:\nthe site works offline.' },
    { olds: ['清空会删掉这台设备上的全部数据，\n包括这几条说明。\n删之前想留一份，就先「存档」。',
             'Clearing deletes everything stored on\nthis device, including this guide.\nExport an archive first if you want to keep it.'],
      zh: '清空会删掉当前项目的全部数据，\n包括这几条说明。\n删之前想留一份，就先「存档」。',
      en: 'Clearing deletes everything stored in\nthe current project, including this guide.\nExport an archive first if you want to keep it.' }
  ];

  /* 带数量的文案：记录条数会变，只能按模式匹配。
     新旧两种写法都列出来，这样中英互切时不会卡在对方那一边。 */
  var PATTERNS = [
    { re: /当前设备上有\s*(\d+)\s*条记录、\s*(\d+)\s*个 API。/g,
      zh: '当前项目里有 $1 条记录、$2 个 API。',
      en: 'This project has $1 records and $2 APIs.' },
    { re: /这台设备上有\s*(\d+)\s*条记录、\s*(\d+)\s*个 API。/g,
      zh: '当前项目里有 $1 条记录、$2 个 API。',
      en: 'This project has $1 records and $2 APIs.' },
    { re: /当前项目里有\s*(\d+)\s*条记录、\s*(\d+)\s*个 API。/g,
      zh: '当前项目里有 $1 条记录、$2 个 API。',
      en: 'This project has $1 records and $2 APIs.' },
    { re: /On this device - records: (\d+), APIs: (\d+)/g,
      zh: '当前项目里有 $1 条记录、$2 个 API。',
      en: 'In this project - records: $1, APIs: $2' },
    { re: /This device currently has (\d+) records and (\d+) APIs\./g,
      zh: '当前项目里有 $1 条记录、$2 个 API。',
      en: 'This project has $1 records and $2 APIs.' },
    { re: /In this project - records: (\d+), APIs: (\d+)/g,
      zh: '当前项目里有 $1 条记录、$2 个 API。',
      en: 'In this project - records: $1, APIs: $2' },
    { re: /This project has (\d+) records and (\d+) APIs\./g,
      zh: '当前项目里有 $1 条记录、$2 个 API。',
      en: 'This project has $1 records and $2 APIs.' }
  ];

  function fixText(raw, outLang){
    var L = outLang || lang;
    var trimmed = raw.trim();
    if(!trimmed) return null;
    var i, j, out = null;
    for(i=0;i<RULES.length;i++){
      var r = RULES[i];
      for(j=0;j<r.olds.length;j++){
        if(trimmed === r.olds[j]){
          var rep = (L === 'en') ? r.en : r.zh;
          if(rep === trimmed) return null;
          out = raw.replace(trimmed, rep);
          return out;
        }
      }
      /* 已经改过的中文，在英文模式下网页按旧原文查不到字典，要能翻回去 */
      if(L === 'en' && trimmed === r.zh && r.en !== r.zh){
        out = raw.replace(trimmed, r.en);
        return out;
      }
    }
    for(i=0;i<PATTERNS.length;i++){
      var p = PATTERNS[i];
      if(!p.re.test(trimmed)) continue;
      p.re.lastIndex = 0;
      var nxt = trimmed.replace(p.re, (L === 'en') ? p.en : p.zh);
      if(nxt === trimmed) continue;
      out = raw.replace(trimmed, nxt);
      return out;
    }
    return null;
  }

  /* 网页自带的中英切换会把旧文案写回去，这里再校正一次 */
  function applyDom(){
    if(!document.body) return;
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while(walker.nextNode()) nodes.push(walker.currentNode);
    for(var i=0;i<nodes.length;i++){
      var n = nodes[i];
      if(!n.nodeValue) continue;
      /* 别动脚本和样式里的源码：替换字符串可能破坏脚本语法 */
      var p = n.parentElement;
      if(p && /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(p.tagName)) continue;
      var fixed = fixText(n.nodeValue);
      if(fixed != null) n.nodeValue = fixed;
    }
  }

  /* 内置的新手教程说明也是数据，单独校正一次（每种语言各按自己的语言改） */
  function patchTutorial(){
    var data = window.GML_TUTORIAL_DATA;
    if(!data) return;
    var langs = ['zh','en'];
    for(var i=0;i<langs.length;i++){
      var list = data[langs[i]];
      if(!list || !list.length) continue;
      for(var j=0;j<list.length;j++){
        var rec = list[j];
        if(!rec) continue;
        var keys = ['name','requirement','hint'];
        for(var k=0;k<keys.length;k++){
          var v = rec[keys[k]];
          if(typeof v !== 'string' || !v) continue;
          var fixed = fixText(v, langs[i]);
          if(fixed != null) rec[keys[k]] = fixed;
        }
        if(Object.prototype.toString.call(rec.descs) === '[object Array]'){
          for(var m=0;m<rec.descs.length;m++){
            var dv = rec.descs[m];
            if(typeof dv !== 'string') continue;
            var df = fixText(dv, langs[i]);
            if(df != null) rec.descs[m] = df;
          }
        }
      }
    }
  }

  var timer = null;
  function schedule(){
    if(timer) return;
    timer = setTimeout(function(){ timer = null; applyDom(); }, 60);
  }

  function start(){
    applyDom(); patchTutorial();
    /* 网页切语言 / 改 DOM 后都再校正一次 */
    try{
      var mo = new MutationObserver(schedule);
      mo.observe(document.body, { childList:true, subtree:true, characterData:true });
    }catch(e){}
    setInterval(schedule, 1500);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  /* 宿主下发语言时立刻跟上（网页的字典不暴露，语言只能从宿主这条消息拿） */
  window.addEventListener('message', function(e){
    var d = e.data;
    if(!d || d.__gml_pm !== true || d.dir !== 'to-app' || d.type !== 'ui-lang') return;
    lang = (d.lang === 'en') ? 'en' : 'zh';
    schedule();
  });
})();
