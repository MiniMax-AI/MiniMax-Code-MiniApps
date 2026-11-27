/* FactScribe 工作台 · 段二（写回与章节管理）
   交互结构移植自 workbench-redesign/prototype-v4.html；
   段一做只读骨架，段二接上写回（正文就地编辑）与章节管理（调序/删除/新建）。 */
'use strict';

/* 浏览器端错误计数（自查用）：window.__errs 全程应为 0。
   段六起沿用这个约定——交付前在浏览器里读一次这个数。 */
window.__errs = 0;
window.addEventListener('error', () => { window.__errs += 1; });
window.addEventListener('unhandledrejection', () => { window.__errs += 1; });

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];

const TOKEN_RE = /\ue000P\d+\ue001/;

const I18N = {
  zh: {
    'nav.projects': '项目管理', 'tb.new': '新建',
    'doc.title': 'FactScribe 工作台',
    'err.loadProjects': '读项目失败：{e}',
    'err.loadSections': '读章节失败：{e}',
    'err.openBlock': '打不开这一段：{e}',
    'err.saveFailed': '没保存上：{e}',
    'err.tocFailed': '目录操作失败：{e}',
    'pg.title': '论文项目', 'pg.sub': '打开一篇论文继续写，或新建一个项目。',
    'pg.searchPh': '搜索项目名…', 'pg.empty': '这个根目录下没有找到论文项目（含 factscribe.toml 的目录）。',
    'card.open': '打开', 'card.status': '状态', 'card.last': '最近打开',
    'card.disks': '盘', 'card.sections': '节', 'card.facts': '事实',
    'status.placeholder': '段二接入', 'time.placeholder': '段二接入',
    'status.draft': '未建账', 'status.checking': '在写', 'status.released': '已绑完',
    'prog.placeholder': '进度占位',
    'toc.h': '目录', 'toc.collapse': '收起目录', 'toc.toggle': '显示/隐藏目录',
    'tab.report': '检查报告', 'tab.machine': '机器视图', 'tab.ai': 'AI 对话',
    'side.reports': '实验报告', 'side.collapse': '收起右栏', 'side.expand': '展开右栏',
    'rp.sideT': '打开实验报告管理',
    'hc.h': '体检', 'hc.facts': '{n} 条事实', 'hc.sections': '{m} 节正文',
    'hc.build': '最近编译：{t}', 'hc.nobuild': '尚无编译产物',
    'hc.note': '体检读数来自真闸（factscribe audit）：只读，不改盘。',
    'mv.h': '机器视图', 'mv.sub': '这一层是给工具看的，不是给稿子看的——按主题折叠，点开看细节。',
    'seg3': '检查报告 / 机器视图', 'seg3.note': '段三接入：检查报告、机器视图与体检判定在段三接入。',
    'seg3.note2': '段三接入：机器视图（账本完整性、证据链、原始产物）在段三接入。',
    'seg4': '段四接入：AI 对话（带上下文的提问、建议采纳）在段四接入。',
    /* ---- 段三：检查报告 / 机器视图 ---- */
    'rp.rerun': '重跑检查', 'rp.rerunning': '进行中…',
    'rp.rerunOk': '重跑完成：红 {r} · 黄 {y}（{ms} 毫秒）',
    'rp.rerunErr': '重跑失败：{code} {msg}',
    'rp.ry': '红 {r} · 黄 {y}', 'rp.n': '{n} 条',
    'rp.findings': '发现', 'rp.chain': '四步链',
    'rp.findingsT': '发现明细', 'rp.close': '关闭', 'rp.details': '查看明细 ▸',
    'rp.findingsEmpty': '没有发现：这盘干净。',
    'rp.chainEmpty': '没有四步链读数。',
    'rp.idle': '先打开一篇论文。',
    'rp.loading': '读取中…',
    'rp.loadErr': '读检查报告失败：{e}',
    'rp.loadErrM': '读机器视图失败：{e}',
    'rp.digest': '账本指纹', 'rp.numbers': '数字回账', 'rp.cites': '引用', 'rp.pdf': 'PDF',
    'rp.pdfOk': '已核对', 'rp.pdfStale': '已过期', 'rp.pdfNone': '未产出',
    'rp.generated': '体检时间：{t}',
    'rp.roOk': '只读：项目目录零写入',
    'rp.roChanged': '只读：有改动 {files}',
    'rp.stepOk': '就绪', 'rp.stepPartial': '未齐', 'rp.stepMissing': '缺',
    'rp.chainVal': '{v} / {t}',
    /* 四步链：标签与说明由前端翻译（后端给的是结构化 key） */
    'chain.declare': '声明', 'chain.declare.detail': 'facts/*.toml 里的事实条数',
    'chain.bind': '绑定', 'chain.bind.detail': '正文里 \\fact{} 绑定的数字',
    'chain.reconcile': '回账', 'chain.reconcile.detail': '正文数字回对到事实账',
    'chain.certify': '出证', 'chain.certify.detail': '证据冻结与 PDF 闸',
    /* 附加只读闸（文风闸 / 双语对账）：P0-1 */
    'rp.style': '文风闸', 'rp.styleT': '文风闸读数（只读）：公式化写法与证据钢印。',
    'rp.styleOk': '没有文风命中', 'rp.styleYellow': '黄 {n} 条', 'rp.styleRed': '红 {n} 条',
    'rp.styleErr': '文风闸读不到：{e}', 'rp.styleNone': '没有文风读数。',
    'rp.mirror': '双语对账', 'rp.mirrorT': '两个盘的事实账与文献逐条比对（只读）。',
    'rp.mirrorOk': '两盘一致', 'rp.mirrorDrift': '{n} 处漂移',
    'rp.mirrorNa': '本项目只有一个盘，没有第二个盘可比。',
    'rp.mirrorErr': '对账读不到：{e}', 'rp.mirrorNone': '没有对账读数。',
    'rp.mirrorDriftOne': '漂移', 'rp.mirrorA': '甲', 'rp.mirrorB': '乙',
    'rp.gateNote': '只读读数：不改稿、不改盘。',
    /* 证据锁卡（独立只读卡；四步链「出证」的读数与语义不动） */
    'rp.evidenceLock': '证据锁',
    'rp.evLockFrozen': '已冻结', 'rp.evLockNotFrozen': '未冻结',
    'rp.evLockEntries': '冻结条目', 'rp.evLockSha': '冻结件指纹',
    'rp.evLockCurrent': '当前清单指纹', 'rp.evLockMismatch': '冻结件与当前清单不一致',
    'rp.evLockSame': '冻结件与当前清单一致',
    'rp.evLockLastLog': '最后一条日志',
    'rp.evLockNone': '没有证据锁读数。',
    'rp.evLockErr': '证据锁读不到：{e}',
    'rp.evLockNote': '只读读数：参考用。四步链「出证」那一步的判定以闸门为准。',
    'rp.sevRed': '红', 'rp.sevYellow': '黄', 'rp.sevInfo': '提示',
    'mv.ledger': '账本表', 'mv.scan': '正文扫描',
    'mv.evidence': '文献与证据链', 'mv.export': '导出与命令',
    'mv.rows': '{n} 行', 'mv.cov': '覆盖 {n}%', 'mv.sections': '章节', 'mv.coverage': '覆盖率',
    'mv.num': '数字回账', 'mv.unbound': '未绑定', 'mv.unmatched': '未回账',
    'mv.skipped': '跳过注释', 'mv.files': '扫描文件', 'mv.bytes': '{n} 字节',
    'mv.cites': '引用', 'mv.bibEntries': '文献条目', 'mv.bibFiles': '文献文件',
    'mv.bibUnused': '未用条目', 'mv.frozen': '已冻结', 'mv.unfrozen': '未冻结',
    'mv.freezeState': '证据冻结', 'mv.evFp': '证据指纹',
    'mv.entries': '证据条目', 'mv.log': '证据日志', 'mv.cmds': '命令',
    'mv.cmdCount': '{n} 条命令',
    'mv.colId': 'id', 'mv.colClaim': '断言', 'mv.colValue': '值',
    'mv.colConf': '置信', 'mv.colFile': '出处文件', 'mv.colFp': '指纹',
    'mv.none': '（无）',
    /* ---- 段四：AI 对话（真后端）+ 实验报告导入（真文件） ---- */
    'ai.ask': '问 AI', 'ai.askPara': '这一段有什么可改的？',
    'ai.reportQ': '用大白话解读这份检查报告',
    'ai.clear': '清空',
    'ai.you': '你', 'ai.ph': '问一句…', 'ai.send': '发送', 'ai.sending': '发送中…',
    'ai.model': '模型',
    'ai.effort': '思考',
    'ai.effortDefault': '模型默认（{level}）', 'ai.effortDefaultPlain': '模型默认',
    'ai.effortLevelDefault': '默认',
    'ai.effortOff': '关闭思考', 'ai.effortNone': '最低', 'ai.effortMinimal': '极低', 'ai.effortLow': '低',
    'ai.effortMedium': '中', 'ai.effortHigh': '高', 'ai.effortXhigh': '很高', 'ai.effortMax': '最高',
    'ai.kindHost': '宿主模型', 'ai.kindCustom': '自定义模型', 'ai.kindEngine': '本地后端',
    'ai.kindHostDefault': '宿主默认',
    'ai.modelHostDefault': '宿主当前模型',
    'ai.addModel': '＋ 模型', 'ai.delModel': '✕', 'ai.delModelT': '删除这个自定义模型',
    'ai.cmTitle': '添加自定义模型', 'ai.cmLabel': '名称', 'ai.cmBaseUrl': 'Base URL', 'ai.cmModel': '模型名',
    'ai.cmKey': 'API Key', 'ai.cmCancel': '取消', 'ai.cmSave': '保存',
    'ai.cmHint': '密钥只存在插件自己的私有目录里，不进论文目录，也不写进稿件。',
    'ai.cmSaved': '自定义模型已加进清单。', 'ai.cmDeleted': '自定义模型已删掉。',
    'ai.srcIdle': '本轮：—', 'ai.srcAgent': '本轮：MCode 宿主模型', 'ai.srcEngine': '本轮：本地后端',
    'ai.srcCustom': '本轮：自定义模型',
    'ai.toolsDenied': '这一轮没有授权工具调用，模型只按材料回答。',
    'ai.waiting': '模型正在想…', 'ai.err': '提问失败：{e}', 'ai.empty': '（没有返回内容）',
    'ai.ctxHead': '当前段落 · {sec}', 'ai.ctxHeadNone': '当前段落',
    'ai.fbChip': '模拟', 'ai.fbNote': '未接模型{d}',
    'ai.q1': '① 总结这篇论文的状态', 'ai.q2': '② 这一段有什么可改的？', 'ai.q3': '③ 这段为什么被标了缺作者',
    'ai.q1.text': '总结这篇论文的状态', 'ai.q2.text': '这一段有什么可改的？', 'ai.q3.text': '这段为什么被标了缺作者',
    'ai.noProject': '先打开一篇论文。',
    'rp.title.paper': '实验报告 · {p}',
    'rp.sub': '当前项目的实验报告：导入、字段映射、数字绑定与签收状态。',
    'rp.backWs': '返回工作台', 'rp.back': '返回列表',
    'rp.card.time': '导入时间', 'rp.card.bound': '绑定 {n} 个数字', 'rp.card.from': '来源', 'rp.card.file': '文件',
    'rp.st.pending_check': '待核对', 'rp.st.signed': '已签收', 'rp.st.confirmed': '已确认',
    'rp.from.import': '来自导入', 'rp.from.unknown': '未知来源',
    'rp.reportsEmpty': '该项目还没有报告，点右上角「导入实验报告」。',
    'rp.loadingReports': '读取中…', 'rp.loadErrReports': '读实验报告失败：{e}',
    'rp.read': '让 AI 解读这份报告', 'rp.readT': 'AI 用大白话总评当前检查结果',
    'rp.d.bound': '数字绑定清单', 'rp.d.file': '原始文件', 'rp.d.draft': '导入草稿',
    'rp.d.nobound': '这份报告还没有绑定数字。',
    'rp.d.rowsNote': '本版接口只返回绑定条数，逐条明细待后端补齐。',
    'rp.noProject': '先打开一篇论文，再看实验报告。',
    'wz.open': '导入实验报告', 'wz.title': '导入实验报告',
    'wz.s1': '选文件', 'wz.s2': '字段映射', 'wz.s3': '确认绑定',
    'wz.s1.h': '下面是本项目 reports 目录里的真实文件；也可以直接上传一份。',
    'wz.s1.empty': 'reports 目录里还没有文件，先上传一份。',
    'wz.s1.meta': '{size} 字节 · {mtime}',
    'wz.s1.upload': '上传文件', 'wz.s1.uploading': '上传中…', 'wz.s1.upErr': '上传失败：{e}',
    'wz.s2.h': '把报告里的指标对到论文事实账的字段；对不上的可以先跳过。',
    'wz.s2.empty': '这份文件没解析出可绑定的行。',
    'wz.s2.loading': '解析中…', 'wz.s2.err': '解析失败：{e}',
    'wz.col.id': '报告 id', 'wz.col.claim': '断言', 'wz.col.val': '报告值', 'wz.col.field': '事实账字段',
    'wz.skip': '— 跳过 —',
    'wz.failed': '以下行解析失败，已跳过',
    'wz.s3.h': '确认后写入草稿，交人核对后才进正式事实账。',
    'wz.sum.file': '文件', 'wz.sum.sha': '指纹', 'wz.sum.mapped': '将绑定的行',
    'wz.sum.skip': '跳过', 'wz.sum.disk': '目标盘', 'wz.sum.project': '目标项目',
    'wz.draftNote': '导入只写草稿 {path}；正式事实账 facts/*.toml 不会被改动。',
    'wz.next': '下一步', 'wz.back': '上一步', 'wz.confirm': '确认导入',
    'wz.done': '已导入 {n} 行，草稿在 {path}',
    'wz.fail': '导入失败：{e}',
    'wz.nofile': '先选一份文件。', 'wz.norows': '先解析出行。',
    'cover.sub': '盘：{disk}',
    'cover.st': '{n} 条事实 · {m} 节正文',
    'lang.none': '这个项目没有别的语言盘',
    'toast.opened': '已打开：{name}',
    'lang.zh': '中文盘', 'lang.en': '英文盘',
    'disc.zh': '中文盘', 'disc.en': '英文盘',
    'toc.manage': '章节管理', 'toc.new': '＋ 新建章节', 'toc.newT': '新建章节',
    'toc.newTitle': '章节标题', 'toc.newTitlePh': '例如：实验设置',
    'toc.newSlug': '文件名（可空）', 'toc.newSlugPh': 'setup',
    'toc.create': '创建', 'toc.up': '上移', 'toc.down': '下移',
    'toc.del': '删除', 'toc.delAsk': '把这一节挪到 sections/attic/（可恢复）？',
    'toc.done': '目录已更新',
    'toc.rename': '改章节名', 'toc.renameT': '改这一节的标题',
    'toc.renamePh': '例如：实验设置', 'toc.renameDone': '章节名已改',
    'title.edit': '改标题', 'title.editT': '改论文标题',
    'title.main': '主标题', 'title.sub': '副标题',
    'title.hint': '改的是这个盘自己的入口文件里的标题命令；副标题可留空。',
    'title.saved': '标题已改',
    'fact.ins': '插入事实', 'fact.insT': '插入一条事实（数字来自事实账）',
    'fact.insPh': '按 id 或主张筛选…', 'fact.insLoading': '正在读事实账…',
    'fact.insEmpty': '这个盘的事实账是空的——先去「追加事实」入账。',
    'fact.insHint': '数字只能用事实账里的 value；标记插在正文里那个数字后面，正文里没有这个数字就连数字带标记一起插在段末。',
    'fact.insDone': '事实标记已插进正文', 'fact.insFail': '插不进去：{e}',
    'nav.resize': '拖动可改左右比例',
    'edit.hint': '正文可直接编辑；失焦或 Esc 就保存。',
    'edit.savedBadge': '已保存',     'edit.saved': '已保存（原稿留在 .bak）',
    'edit.stale': '这段在别处已被改动，已换上最新内容；您刚输入的字没有保存。',
    'edit.prot': '锁',
    'pf.title': '论文标题', 'pf.titlePh': '例如：多臂实验台的调度策略',
    'pf.lang': '写作语言', 'pf.langEn': '英文盘', 'pf.langZh': '中文盘',
    'pf.langBoth': '英文盘 + 中文盘',
    'pf.langHint': '建几个盘是创建时定下的重操作，建好后不可改。',
    'pf.slug': '文件夹名', 'pf.slugPh': 'my-new-paper',
    'pf.dir': '项目目录', 'pf.dirPh': 'papers/my-new-paper',
    'pf.dirHint': '项目目录是身份锚：事实账与引用都按路径绑定，改它等于断链，所以只读。',
    'pf.reports': '实验报告目录', 'pf.reportsCustom': '自定义实验报告目录',
    'pf.reportsDefault': '恢复默认',
    'pf.reportsHint': '默认是「〈项目目录〉/reports」，点「自定义」才解锁。',
    'pf.journal': '目标期刊 / 会议', 'pf.template': '参考模板',
    'pf.question': '一句话研究问题',
    'pf.save': '保存', 'pf.cancel': '取消',
    'pf.newTitle': '新建论文项目', 'pf.editTitle': '编辑项目',
    'pf.newSub': '建好之后，这个项目会出现在项目列表里。',
    'pf.editSub': '项目目录与语言盘集合已锁死（条目 24 裁定）；其余字段可改。',
    'pf.created': '已建：{n}',
    'prog.facts': '{b}/{t} 事实已绑',
    'prog.none': '暂无定量事实',
    'time.never': '还没打开过',
    'card.edit': '编辑',
    'np.pdf': '导出 PDF', 'np.check': '全检一次', 'np.bundle': '导出投稿包',
    'np.openDir': '打开目录', 'np.collapse': '收起导航', 'np.toc': '目录',
    'np.ai': '智能助手', 'np.reports': '实验报告', 'np.import': '从外部导入',
    'np.more': '更多',
    'nav.open': '展开导航', 'np.tocEmpty': '这个盘还没有章节。',
    'act.pdfTitle': '导出 PDF', 'act.bundleTitle': '导出投稿包',
    'act.openTitle': '打开项目目录', 'act.close': '关闭',
    'act.pdfOk': '编译完成', 'act.pdfFail': '编译没成功',
    'act.pdfCompiling': '编译中…', 'act.pdfDone': '编译完成：{p}',
    'act.pdfPages': '{n} 页 · {b} 字节', 'act.pdfPreview': '预览',
    'act.pdfDownload': '下载 PDF', 'act.pdfPath': '产物路径',
    'act.bundleOk': '投稿包已导出', 'act.bundleFail': '清单门没过',
    'act.bundlePreview': '导出前预览',
    'act.bundlePreviewFiles': '将要收 {n} 件',
    'act.bundlePreviewGo': '继续导出',
    'act.bundlePreviewSkip': '跳过预览，直接导出',
    'act.bundlePreviewNote': '预览只是给你看的：判定权仍在清单门，门不过照样不出包。',
    'act.bundlePreviewGateFail': '清单门不过：这次不会出包。',
    'act.bundlePreviewNone': '没有可预览的件。',
    'act.bundlePath': '包目录', 'act.bundleFiles': '包内 {n} 件',
    'act.bundleGate': '清单门：{p} 过 / {f} 不过 / {w} 豁免',
    'act.openOk': '已在访达里打开', 'act.openUnsupported': '本机不是 macOS：路径如下。',
    'rp.delAsk': '删掉这条导入记录？\n（只删草稿记录；报告源文件不动）',
    'rp.deleted': '已删掉这条导入记录（源文件没动）',
    'rp.deletedFile': '已删掉这条导入记录（源文件 {f} 没动）',
    'rp.noDelete': '这条记录删不掉：{e}',
    'ab.label': '摘要', 'ab.edit': '可直接编辑', 'ab.saved': '摘要已保存',
    'ab.missing': '这个盘的主文件里没有 abstract 环境。',
    'fc.title': '证据', 'fc.nofact': '账本里没有这条事实。',
    'fc.claim': '断言', 'fc.value': '值', 'fc.source': '出处',
    'fc.locator': '定位', 'fc.fp': '指纹', 'fc.conf': '置信',
    'check.title': '全检结果', 'check.tabReport': '检查报告',
    'check.tabMachine': '机器底账', 'rp.card.del': '删除',
    /* ---- 段六 ---- */
    'np.kb': '知识库', 'np.kbUpload': '上传文件',
    'np.venue': '版式', 'np.venueGuide': '选刊指南',
    'para.more': '段落动作', 'para.edit': '编辑',
    'para.continue': '续写', 'para.rewrite': '改写', 'para.ask': '提问',
    'para.menu': '这一段的动作',
    'ai.modeIdea': '聊想法', 'ai.modePaper': '写论文',
    'ai.discipline': '示例数不是你的结果：没有真实跑出来的数，不要写进稿。',
    'ai.copy': '复制', 'ai.writeIn': '写进稿',
    'ai.copied': '已复制到剪贴板', 'ai.copyFail': '复制不了：{e}',
    'ai.written': '已写进稿（在那一段之后，标着「AI 草稿」）',
    'ai.writeFail': '写不进稿：{e}',
    'ai.writeNoTarget': '这条回复没有对应的段落，先用段落菜单里的动作再试。',
    'ai.continueQ': '接着这一段往下写。',
    'ai.rewriteQ': '把这一段改写得更好。',
    'ai.askQ': '这一段有什么可改的？',
    'ai.actionDone': '动作已发出',
    'kb.empty': '项目目录里还没有可收进知识库的文件。',
    'kb.loading': '正在读文件…', 'kb.loadErr': '读知识库失败：{e}',
    'kb.pick': '点左边一个文件看内容。',
    'kb.status': '处理状态', 'kb.size': '大小', 'kb.path': '路径',
    'kb.preview': '内容预览', 'kb.truncated': '（预览已截断）',
    'kb.uploadOk': '已上传：{name}', 'kb.uploadErr': '上传失败：{e}',
    'kb.noFile': '没有选中文件。', 'kb.pending': '待提取', 'kb.ready': '可用',
    'kb.pdfNote': 'PDF 只登记文件名与大小，文本提取段七接入。',
    'kb.actPreview': '预览', 'kb.actDelete': '删除',
    'kb.sourceNote': '源文件由章节管理管',
    'kb.delTitle': '删除知识库文件',
    'kb.delAsk': '删掉这个知识库文件？\n（只删 knowledge/ 里的这份；项目源文件不动）',
    'kb.deleted': '已删掉这个知识库文件', 'kb.delFail': '删不掉：{e}',
    'kb.sha': 'sha256', 'kb.fullNote': '完整内容请打开原文件',
    'rp.actDetail': '详情', 'rp.id': 'id', 'rp.claim': '断言', 'rp.value': '值',
    'rp.boundList': '绑定清单', 'rp.detailEmpty': '这条记录没有绑定条目。',
    'rp.delConfirmTitle': '删除这条导入记录？',
    'rp.delConfirmBody': '只删草稿记录，报告源文件不动。',
    'confirm.ok': '确定', 'confirm.cancel': '取消',
    'more.rpNote': '导入进来的都在待核对区；转正走闸，不在面板里',
    'more.kbNote': '源文件只读；上传的资料才可删除',
    /* 引用与图片：旧节级前端那两页搬过来的（第 ④ 步收口） */
    'np.cite': '引用', 'np.citeAdd': '＋ 加一条', 'np.assets': '图片',
    'more.citeNote': '删条目只动 bib；正文里的引用标记不跟着改',
    'more.assetNote': '盘里的图片文件；点开看大图',
    'cite.sum': '共 {total} 条：被引 {used}，没被引 {unused}',
    'cite.st.ok': '可复核', 'cite.st.no_id': '缺标识',
    'cite.st.bad_id': '标识不合法', 'cite.st.unused': '没被引到',
    'cite.st.duplicate': 'key 重复',
    'cite.addT': '加一条引用', 'cite.key': '引用 key',
    'cite.title': '标题', 'cite.author': '作者', 'cite.year': '年份',
    'cite.doi': 'DOI', 'cite.arxiv': 'arXiv', 'cite.add': '加进去',
    'cite.needKey': 'key 必填', 'cite.addOk': '加好了：{key}',
    'cite.addErr': '加不上：{e}',
    'cite.delT': '删掉这条', 'cite.delTitle': '删掉这条引用？',
    'cite.delBody': '只删 bib 里的这一条；正文里的引用标记还留着。',
    'cite.delOk': '删掉了：{key}', 'cite.delErr': '删不掉：{e}',
    'cite.loadErr': '读引用清单失败：{e}',
    'asset.empty': '这个盘里没有图片文件。',
    'asset.more': '只列了前 {n} 个（盘里还有别的）。',
    'asset.loadErr': '读图片清单失败：{e}',
    'tb.sample': '装个示例', 'tb.sampleOk': '示例装好了：{p}',
    'tb.sampleErr': '装不上示例：{e}',
    'vn.venue': '目标刊物 / 会议', 'vn.venuePh': '例如：ACL 2026',
    'vn.deadline': '截稿日期', 'vn.save': '保存版式配置',
    'vn.lockTag': '语言盘锁定',
    'vn.lockZh': '这一盘是中文稿：版式只管排版与刊物要求，不动语言盘——中文稿不能换成英文刊。',
    'vn.lockEn': '这一盘是英文稿：版式只管排版与刊物要求，不动语言盘——要写中文稿就另开一个中文盘。',
    'vn.tplArticle': 'article（通用单栏论文版式）',
    'vn.saved': '版式配置已存进 workbench.toml',
    'vn.saveErr': '存不了：{e}', 'vn.preview': '首页预览',
    'vn.templates': '模板库', 'vn.tplBuilding': '模板库建设中',
    'vn.previewNone': '这个盘还没编译过 PDF：先点「渲染 PDF」，再回来看首页预览。',
    'vn.previewBtn': '渲染并预览首页',
    'vn.previewErr': '渲染失败：{e}',
    'vn.dueSoon': '截稿提醒：{d}', 'vn.overdue': '已过截稿日 {d} 天',
    'vn.dueNormal': '距截稿 {d} 天',
    'guide.title': '选刊指南', 'guide.go': '按目标版式开写',
    'guide.h1': '一、贡献是什么形状',
    'guide.p1': '先说清你多出来的那一点是什么：新方法、新数据、新测量，还是新的失效边界。' +
      '贡献形状决定你能投哪一类刊物——方法类看新颖性，数据类看覆盖与可复现，' +
      '边界类看这个结论别人多久会自己撞上。说不清形状，选刊就只剩碰运气。',
    'guide.h2': '二、读者是谁',
    'guide.p2': '读者决定你得把哪部分放前面。审稿人每天读十几篇稿子，' +
      '只对「和我要解决的问题相关」的那几段有耐心。' +
      '所以先问：谁会读这份稿子，他是来找方法的还是来找结论的？' +
      '两类读者的入口段不一样，把两拨人塞在同一段里，两拨人都读不下去。',
    'guide.h3': '三、截稿与双投',
    'guide.p3': '截稿日决定你的时间盒：倒排到「最后一版能编过」，' +
      '别倒排到最后一刻。双投规则各家不同，而且常常一年一改——' +
      '投稿之前去看该刊当年的作者须知，别拿去年的记忆投稿。' +
      '扩展会议、连续出版物这些名目看着像加分项，实际规则最容易被忽略。',
    'guide.h4': '四、影响因子怎么用',
    'guide.p4': '影响因子是刊物层面的平均数，不是你这篇稿子的分数。' +
      '它能帮你排除明显不匹配的刊物（比如只发综述的刊），' +
      '但不能替代「这篇稿子会被谁读」的判断。' +
      '拿它当唯一依据，很容易把稿子投到没人读你这类问题的地方去。',
    'guide.foot': '目标刊物定了以后，把它填进上面的表单——版式面会照着它给首页预览，' +
      '截稿日临近时导航钮会提醒你。语言盘不动：中文稿还是中文稿。',
    'draft.badge': 'AI 草稿',
    'draft.hint': '这是 AI 写的草稿块，不是正文；直接改字，也可以删掉。',
    'draft.deleted': 'AI 草稿块已删掉',
    'draft.delFail': '删不掉：{e}',
    /* ---- v2：提议单（差异卡）——AI 提议 → 人确认才写回 ---- */
    'proposal.badge': '待确认',
    'proposal.title': '待确认的改稿提议',
    'proposal.adopt': '采纳写回',
    'proposal.reject': '拒绝',
    'proposal.before': '现状',
    'proposal.after': '采纳后',
    'proposal.stale': '这段在别处已被改动',
    'proposal.empty': '没有待确认的提议。',
    'proposal.adopted': '已采纳写回',
    'proposal.rejected': '已拒绝这条提议',
    'proposal.created': '创建于 {time}',
    'proposal.warnings': '警告：{text}',
    'proposal.queued': '已放进待确认',
    'proposal.queueFail': '没能建提议单：{e}',
    'proposal.confirmFail': '没能采纳：{e}',
    'proposal.rejectFail': '没能拒绝：{e}',
    'proposal.loadFail': '读提议单失败：{e}',
    'proposal.fromMcp': '来自助手',
    'proposal.fromPage': '来自页面',
    'proposal.fromUnknown': '来源不明',
    'proposal.kindEdit': '改稿',
    'proposal.kindDraft': '插入草稿',
    'proposal.kindEvidenceFreeze': '冻结证据清单',
    'proposal.kindEvidenceUnfreeze': '解冻证据清单',
    'proposal.kindAddFact': '追加事实',
    'proposal.kindExportBundle': '导出投稿包',
    /* ---- 追加事实表单（两步） ---- */
    'np.ledger': '事实账',
    'np.addFact': '追加事实',
    'more.factNote': '记账走提议单：建单不写盘，采纳才落账',
    'ff.title': '追加一条事实',
    'ff.s1': '挑产物',
    'ff.s2': '说清这条数字',
    'ff.s1.h': '下面是本盘的真实产物：已签的一组、没进清单的另一组。选中即填成 source，hash 由工具现算，界面不让人手打路径。',
    'ff.s1.ph': '按文件名筛选…',
    'ff.g.signed': '已签产物',
    'ff.g.unsigned': '未进清单的产物',
    'ff.g.unsignedFold': '搜索未签产物',
    'ff.tag.unsigned': '未签（需人签后才能作数）',
    'ff.g.empty': '这一组没有产物。',
    'ff.more': '共 {n} 个，只显示前 {shown} 个；用上面的框缩小范围。',
    'ff.badge.signed': '已签',
    'ff.badge.drift': '签后被改',
    'ff.badge.missing': '文件不在',
    'ff.badge.unsigned': '未签',
    'ff.sha.manifest': '清单 sha256',
    'ff.sha.live': '现算 sha256',
    'ff.s2.h': '说清这条数字主张什么、来自产物的哪一处；落到哪本账由你定。',
    'ff.src': 'source',
    'ff.f.id': '事实 id',
    'ff.f.claim': '一句话主张',
    'ff.f.value': '数字原文',
    'ff.f.locator': '在产物里的位置',
    'ff.f.conf': '置信度',
    'ff.conf.high': 'high',
    'ff.conf.med': 'med',
    'ff.conf.low': 'low',
    'ff.f.note': '备注（可选）',
    'ff.f.valueHint': 'value 必须是产物里的原文——正文要绑的就是它。比对口径：'
      + '数字归一化后（千分位逗号去掉、小数点统一、LaTeX 的百分号与分数写法归一、'
      + '强调标记忽略）逐个按出现顺序比，单位不参与比较；value 里没有数字时按归一化子串比。',
    'ff.ledger.h': '落哪本账',
    'ff.ledger.style': '本盘账本命名风格：{style}',
    'ff.style.letter_topic': '单字母前缀 ＋ 下划线主题（例 a_swebench.toml）',
    'ff.style.index_topic': '两位序号 ＋ 连字符主题（例 01-core.toml）',
    'ff.style.unknown': '认不出来（新建账本文件会被拒）',
    'ff.ledger.new': '新建一个账本文件',
    'ff.ledger.newPh': '例 {name}',
    'ff.ledger.facts': '{n} 条',
    'ff.next': '下一步',
    'ff.create': '建提议单',
    'ff.needSource': '先挑一个产物。',
    'ff.needLedger': '先选一本账。',
    'ff.needFields': 'id、主张、数字都要填。',
    'ff.nameBad': '这个文件名不合本盘的命名风格。',
    'ff.prefixBad': '这个前缀已被本盘现有账本文件占用。',
    'ff.created': '已建单：去「待确认」里点「采纳写回」。',
    'ff.fail': '没能建单：{e}',
    'ff.loadFail': '读产物清单失败：{e}',
  },
  en: {
    'nav.projects': 'Projects', 'tb.new': 'New',
    'doc.title': 'FactScribe Workbench',
    'err.loadProjects': 'Could not load projects: {e}',
    'err.loadSections': 'Could not load sections: {e}',
    'err.openBlock': 'Could not open this paragraph: {e}',
    'err.saveFailed': 'Save failed: {e}',
    'err.tocFailed': 'Contents action failed: {e}',
    'pg.title': 'Paper projects', 'pg.sub': 'Open a paper to keep writing, or create a new project.',
    'pg.searchPh': 'Search projects…', 'pg.empty': 'No paper project found under this root (a directory with factscribe.toml).',
    'card.open': 'Open', 'card.status': 'Status', 'card.last': 'Last opened',
    'card.disks': 'Disks', 'card.sections': 'sections', 'card.facts': 'facts',
    'status.placeholder': 'stage 2', 'time.placeholder': 'stage 2',
    'status.draft': 'No ledger yet', 'status.checking': 'In progress',
    'status.released': 'Fully bound',
    'prog.placeholder': 'progress placeholder',
    'toc.h': 'Contents', 'toc.collapse': 'Collapse contents', 'toc.toggle': 'Show/hide contents',
    'tab.report': 'Check report', 'tab.machine': 'Machine view', 'tab.ai': 'AI chat',
    'side.reports': 'Reports', 'side.collapse': 'Hide panel', 'side.expand': 'Show panel',
    'rp.sideT': 'Open experiment report manager',
    'hc.h': 'Health', 'hc.facts': '{n} facts', 'hc.sections': '{m} sections',
    'hc.build': 'Last build: {t}', 'hc.nobuild': 'No build artefact yet',
    'hc.note': 'Health figures come from the real gate (factscribe audit): read-only, nothing is written.',
    'mv.h': 'Machine view', 'mv.sub': 'This layer is for tools, not for the manuscript — collapsed by topic.',
    'seg3': 'Check report / machine view', 'seg3.note': 'Stage 3: check report, machine view and health verdicts arrive in stage 3.',
    'seg3.note2': 'Stage 3: machine view (ledger integrity, evidence chain, raw artefacts) arrives in stage 3.',
    'seg4': 'Stage 4: AI chat (questions with context, suggestion adoption) arrives in stage 4.',
    /* ---- stage 3: check report / machine view ---- */
    'rp.rerun': 'Re-run check', 'rp.rerunning': 'Running…',
    'rp.rerunOk': 'Re-run done: {r} red · {y} yellow ({ms} ms)',
    'rp.rerunErr': 'Re-run failed: {code} {msg}',
    'rp.ry': '{r} red · {y} yellow', 'rp.n': '{n}',
    'rp.findings': 'Findings', 'rp.chain': 'Four-step chain',
    'rp.findingsT': 'Finding details', 'rp.close': 'Close', 'rp.details': 'View details ▸',
    'rp.findingsEmpty': 'No findings — this disk is clean.',
    'rp.chainEmpty': 'No four-step chain reading.',
    'rp.idle': 'Open a paper first.',
    'rp.loading': 'Loading…',
    'rp.loadErr': 'Failed to load the check report: {e}',
    'rp.loadErrM': 'Failed to load the machine view: {e}',
    'rp.digest': 'Ledger fingerprint', 'rp.numbers': 'Numbers reconciled',
    'rp.cites': 'Citations', 'rp.pdf': 'PDF',
    'rp.pdfOk': 'verified', 'rp.pdfStale': 'stale', 'rp.pdfNone': 'not built',
    'rp.generated': 'Checked at: {t}',
    'rp.roOk': 'Read-only: zero writes to the project directory',
    'rp.roChanged': 'Read-only: changed {files}',
    'rp.stepOk': 'ready', 'rp.stepPartial': 'partial', 'rp.stepMissing': 'missing',
    'rp.chainVal': '{v} / {t}',
    /* Four-step chain: labels and details are translated by the front end
       (the backend hands over structured keys). */
    'chain.declare': 'Declare', 'chain.declare.detail': 'fact entries in facts/*.toml',
    'chain.bind': 'Bind', 'chain.bind.detail': 'numbers bound by \\fact{} in the body',
    'chain.reconcile': 'Reconcile', 'chain.reconcile.detail': 'body numbers reconciled against the ledger',
    'chain.certify': 'Certify', 'chain.certify.detail': 'evidence freeze and the PDF gate',
    /* Extra read-only gates (style / bilingual check): P0-1 */
    'rp.style': 'Style gate', 'rp.styleT': 'Style gate reading (read-only): formulaic writing and the evidence stamp.',
    'rp.styleOk': 'No style hits', 'rp.styleYellow': '{n} yellow', 'rp.styleRed': '{n} red',
    'rp.styleErr': 'Style gate unavailable: {e}', 'rp.styleNone': 'No style reading.',
    'rp.mirror': 'Bilingual check', 'rp.mirrorT': 'Field-by-field comparison of the two disks (read-only).',
    'rp.mirrorOk': 'Both disks agree', 'rp.mirrorDrift': '{n} drifts',
    'rp.mirrorNa': 'This project has one disk only — nothing to compare against.',
    'rp.mirrorErr': 'Comparison unavailable: {e}', 'rp.mirrorNone': 'No comparison reading.',
    'rp.mirrorDriftOne': 'drift', 'rp.mirrorA': 'A', 'rp.mirrorB': 'B',
    'rp.gateNote': 'Read-only readings: nothing is rewritten.',
    /* Evidence lock card (independent read-only card; the chain step is untouched) */
    'rp.evidenceLock': 'Evidence lock',
    'rp.evLockFrozen': 'Frozen', 'rp.evLockNotFrozen': 'Not frozen',
    'rp.evLockEntries': 'Frozen entries', 'rp.evLockSha': 'Lock fingerprint',
    'rp.evLockCurrent': 'Current list fingerprint', 'rp.evLockMismatch': 'Lock and current list differ',
    'rp.evLockSame': 'Lock and current list agree',
    'rp.evLockLastLog': 'Last log entry',
    'rp.evLockNone': 'No evidence lock reading.',
    'rp.evLockErr': 'Evidence lock unavailable: {e}',
    'rp.evLockNote': 'Read-only reference reading; the chain step "Certify" stays authoritative.',
    'rp.sevRed': 'red', 'rp.sevYellow': 'yellow', 'rp.sevInfo': 'info',
    'mv.ledger': 'Ledger', 'mv.scan': 'Body scan',
    'mv.evidence': 'Citations & evidence', 'mv.export': 'Export & commands',
    'mv.rows': '{n} rows', 'mv.cov': '{n}% covered', 'mv.sections': 'Sections', 'mv.coverage': 'Coverage',
    'mv.num': 'Numbers reconciled', 'mv.unbound': 'Unbound', 'mv.unmatched': 'Unmatched',
    'mv.skipped': 'Skipped annotations', 'mv.files': 'Scanned files', 'mv.bytes': '{n} bytes',
    'mv.cites': 'Citations', 'mv.bibEntries': 'Bibliography entries',
    'mv.bibFiles': 'Bibliography files', 'mv.bibUnused': 'Unused keys',
    'mv.frozen': 'frozen', 'mv.unfrozen': 'not frozen',
    'mv.freezeState': 'Evidence freeze', 'mv.evFp': 'Evidence fingerprint',
    'mv.entries': 'Evidence entries', 'mv.log': 'Evidence log', 'mv.cmds': 'Commands',
    'mv.cmdCount': '{n} commands',
    'mv.colId': 'id', 'mv.colClaim': 'Claim', 'mv.colValue': 'Value',
    'mv.colConf': 'Confidence', 'mv.colFile': 'Source file', 'mv.colFp': 'Fingerprint',
    'mv.none': '(none)',
    /* ---- stage 4: AI chat (real backend) + experiment report import (real files) ---- */
    'ai.ask': 'Ask AI', 'ai.askPara': 'What could be improved in this paragraph?',
    'ai.reportQ': 'Explain this check report in plain words',
    'ai.clear': 'Clear',
    'ai.you': 'You', 'ai.ph': 'Ask something…', 'ai.send': 'Send', 'ai.sending': 'Sending…',
    'ai.model': 'Model',
    'ai.effort': 'Effort',
    'ai.effortDefault': 'Model default ({level})', 'ai.effortDefaultPlain': 'Model default',
    'ai.effortLevelDefault': 'Default',
    'ai.effortOff': 'Thinking off', 'ai.effortNone': 'None', 'ai.effortMinimal': 'Minimal', 'ai.effortLow': 'Low',
    'ai.effortMedium': 'Medium', 'ai.effortHigh': 'High', 'ai.effortXhigh': 'Extra high', 'ai.effortMax': 'Max',
    'ai.kindHost': 'Host models', 'ai.kindCustom': 'Custom models', 'ai.kindEngine': 'Local backend',
    'ai.kindHostDefault': 'Host default',
    'ai.modelHostDefault': 'Host current model',
    'ai.addModel': '+ Model', 'ai.delModel': '×', 'ai.delModelT': 'Delete this custom model',
    'ai.cmTitle': 'Add a custom model', 'ai.cmLabel': 'Name', 'ai.cmBaseUrl': 'Base URL', 'ai.cmModel': 'Model',
    'ai.cmKey': 'API Key', 'ai.cmCancel': 'Cancel', 'ai.cmSave': 'Save',
    'ai.cmHint': 'The key stays in the plugin private directory — never in the paper folder or the manuscript.',
    'ai.cmSaved': 'Custom model added to the list.', 'ai.cmDeleted': 'Custom model removed.',
    'ai.srcIdle': 'This turn: —', 'ai.srcAgent': 'This turn: MCode host model', 'ai.srcEngine': 'This turn: local backend',
    'ai.srcCustom': 'This turn: custom model',
    'ai.toolsDenied': 'No tool call was authorised this turn; the model answered from the material only.',
    'ai.waiting': 'The model is thinking…', 'ai.err': 'Request failed: {e}', 'ai.empty': '(no content returned)',
    'ai.ctxHead': 'Current paragraph · {sec}', 'ai.ctxHeadNone': 'Current paragraph',
    'ai.fbChip': 'Mock', 'ai.fbNote': 'model not connected{d}',
    'ai.q1': '① Summarize this paper\'s state', 'ai.q2': '② What could be improved in this paragraph?', 'ai.q3': '③ Why is this flagged missing-author',
    'ai.q1.text': 'Summarize this paper\'s state', 'ai.q2.text': 'What could be improved in this paragraph?', 'ai.q3.text': 'Why is this flagged missing-author',
    'ai.noProject': 'Open a paper first.',
    'rp.title.paper': 'Experiment reports · {p}',
    'rp.sub': 'Experiment reports of the current project: import, field mapping, bound numbers and sign-off status.',
    'rp.backWs': 'Back to workspace', 'rp.back': 'Back to list',
    'rp.card.time': 'Imported', 'rp.card.bound': '{n} numbers bound', 'rp.card.from': 'Source', 'rp.card.file': 'File',
    'rp.st.pending_check': 'To check', 'rp.st.signed': 'Signed off', 'rp.st.confirmed': 'Confirmed',
    'rp.from.import': 'From import', 'rp.from.unknown': 'Unknown source',
    'rp.reportsEmpty': 'No reports for this project yet — import one from the top-right button.',
    'rp.loadingReports': 'Loading…', 'rp.loadErrReports': 'Failed to load the experiment reports: {e}',
    'rp.read': 'Let AI explain this report', 'rp.readT': 'AI summarizes the current check results in plain words',
    'rp.d.bound': 'Bound numbers', 'rp.d.file': 'Original file', 'rp.d.draft': 'Import draft',
    'rp.d.nobound': 'This report has no bound numbers yet.',
    'rp.d.rowsNote': 'This API returns only the bound count; per-row details are not available yet.',
    'rp.noProject': 'Open a paper first to see its experiment reports.',
    'wz.open': 'Import experiment report', 'wz.title': 'Import experiment report',
    'wz.s1': 'Choose file', 'wz.s2': 'Map fields', 'wz.s3': 'Confirm binding',
    'wz.s1.h': 'These are the real files in this project\'s reports directory; you can also upload one.',
    'wz.s1.empty': 'No files in the reports directory yet — upload one first.',
    'wz.s1.meta': '{size} B · {mtime}',
    'wz.s1.upload': 'Upload a file', 'wz.s1.uploading': 'Uploading…', 'wz.s1.upErr': 'Upload failed: {e}',
    'wz.s2.h': 'Map report metrics to fact-ledger fields; skip the ones that don\'t fit.',
    'wz.s2.empty': 'No rows could be parsed from this file.',
    'wz.s2.loading': 'Parsing…', 'wz.s2.err': 'Parse failed: {e}',
    'wz.col.id': 'Report id', 'wz.col.claim': 'Claim', 'wz.col.val': 'Report value', 'wz.col.field': 'Ledger field',
    'wz.skip': '— Skip —',
    'wz.failed': 'These rows failed to parse and were skipped',
    'wz.s3.h': 'Once confirmed it is written as a draft and only enters the live ledger after human sign-off.',
    'wz.sum.file': 'File', 'wz.sum.sha': 'Fingerprint', 'wz.sum.mapped': 'Rows to bind',
    'wz.sum.skip': 'Skipped', 'wz.sum.disk': 'Target disk', 'wz.sum.project': 'Target project',
    'wz.draftNote': 'The import only writes the draft {path}; the live ledger facts/*.toml is not touched.',
    'wz.next': 'Next', 'wz.back': 'Back', 'wz.confirm': 'Confirm import',
    'wz.done': 'Imported {n} rows; draft at {path}',
    'wz.fail': 'Import failed: {e}',
    'wz.nofile': 'Pick a file first.', 'wz.norows': 'Parse the rows first.',
    'cover.sub': 'Disk: {disk}',
    'cover.st': '{n} facts · {m} sections',
    'lang.none': 'This project has no other language disk',
    'toast.opened': 'Opened: {name}',
    'lang.zh': 'Chinese disk', 'lang.en': 'English disk',
    'disc.zh': 'Chinese disk', 'disc.en': 'English disk',
    'toc.manage': 'Sections', 'toc.new': '+ New section', 'toc.newT': 'New section',
    'toc.newTitle': 'Section title', 'toc.newTitlePh': 'e.g. Experimental setup',
    'toc.newSlug': 'File name (optional)', 'toc.newSlugPh': 'setup',
    'toc.create': 'Create', 'toc.up': 'Move up', 'toc.down': 'Move down',
    'toc.del': 'Delete', 'toc.delAsk': 'Move this section to sections/attic/ (reversible)?',
    'toc.done': 'Contents updated',
    'toc.rename': 'Rename section', 'toc.renameT': 'Rename this section',
    'toc.renamePh': 'e.g. Experimental setup', 'toc.renameDone': 'Section renamed',
    'title.edit': 'Edit title', 'title.editT': 'Edit paper title',
    'title.main': 'Title', 'title.sub': 'Subtitle',
    'title.hint': 'This edits the title command in this disk\'s own entry file; the subtitle may be left empty.',
    'title.saved': 'Title updated',
    'fact.ins': 'Insert fact', 'fact.insT': 'Insert a fact (numbers come from the ledger)',
    'fact.insPh': 'Filter by id or claim…', 'fact.insLoading': 'Reading the ledger…',
    'fact.insEmpty': 'The ledger on this disk is empty — add a fact first.',
    'fact.insHint': 'The number can only come from the ledger value; the marker goes right after that number in the text, and if the number is not there the value and the marker are appended at the end of the paragraph.',
    'fact.insDone': 'Fact marker inserted', 'fact.insFail': 'Could not insert: {e}',
    'nav.resize': 'Drag to change the left/right ratio',
    'edit.hint': 'Body text is editable in place; blur or Esc saves.',
    'edit.savedBadge': 'Saved',
    'edit.saved': 'Saved (original kept as .bak)',
    'edit.stale': 'This block changed elsewhere. Latest content loaded; your unsaved typing was dropped.',
    'edit.prot': 'locked',
    'pf.title': 'Paper title', 'pf.titlePh': 'e.g. Scheduling policies for multi-arm testbeds',
    'pf.lang': 'Writing language', 'pf.langEn': 'English disk',
    'pf.langZh': 'Chinese disk', 'pf.langBoth': 'English disk + Chinese disk',
    'pf.langHint': 'How many disks exist is fixed at creation time.',
    'pf.slug': 'Folder name', 'pf.slugPh': 'my-new-paper',
    'pf.dir': 'Project directory', 'pf.dirPh': 'papers/my-new-paper',
    'pf.dirHint': 'The project directory is the identity anchor: facts and citations bind to it, so it is read-only.',
    'pf.reports': 'Experiment report directory',
    'pf.reportsCustom': 'Customise report directory',
    'pf.reportsDefault': 'Restore default',
    'pf.reportsHint': 'Defaults to "<project dir>/reports"; unlock to change it.',
    'pf.journal': 'Target journal / conference', 'pf.template': 'Reference template',
    'pf.question': 'Research question in one line',
    'pf.save': 'Save', 'pf.cancel': 'Cancel',
    'pf.newTitle': 'New paper project', 'pf.editTitle': 'Edit project',
    'pf.editSub': 'Project directory and disk set are locked (item 24); other fields are editable.',
    'pf.newSub': 'Once created, the project shows up in the project list.',
    'pf.created': 'Created: {n}',
    'prog.facts': '{b}/{t} facts bound',
    'prog.none': 'No quantitative facts yet',
    'time.never': 'never opened',
    'card.edit': 'Edit',
    'np.pdf': 'Export PDF', 'np.check': 'Run full check',
    'np.bundle': 'Export submission bundle',
    'np.openDir': 'Open project folder', 'np.collapse': 'Hide panel',
    'np.toc': 'Contents',
    'np.ai': 'Assistant', 'np.reports': 'Reports', 'np.import': 'Import',
    'np.more': 'More',
    'nav.open': 'Show panel', 'np.tocEmpty': 'This disk has no sections yet.',
    'act.pdfTitle': 'Export PDF', 'act.bundleTitle': 'Export submission bundle',
    'act.openTitle': 'Open project folder', 'act.close': 'Close',
    'act.pdfOk': 'Build finished', 'act.pdfFail': 'The build did not succeed',
    'act.pdfCompiling': 'Building…', 'act.pdfDone': 'Build finished: {p}',
    'act.pdfPages': '{n} pages · {b} bytes', 'act.pdfPreview': 'Preview',
    'act.pdfDownload': 'Download PDF', 'act.pdfPath': 'Output path',
    'act.bundleOk': 'Submission bundle exported',
    'act.bundleFail': 'The manifest gate did not pass',
    'act.bundlePreview': 'Preview before export',
    'act.bundlePreviewFiles': '{n} files to be collected',
    'act.bundlePreviewGo': 'Continue exporting',
    'act.bundlePreviewSkip': 'Skip preview, export now',
    'act.bundlePreviewNote': 'The preview is only for you to look at: the manifest gate decides, and nothing is exported when it does not pass.',
    'act.bundlePreviewGateFail': 'The manifest gate does not pass: nothing will be exported.',
    'act.bundlePreviewNone': 'Nothing to preview.',
    'act.bundlePath': 'Bundle folder', 'act.bundleFiles': '{n} files in the bundle',
    'act.bundleGate': 'Manifest gate: {p} passed / {f} failed / {w} waived',
    'act.openOk': 'Opened in Finder',
    'act.openUnsupported': 'This is not macOS — here is the path.',
    'rp.delAsk': 'Remove this import record?\n(Only the draft record goes; the report file itself stays.)',
    'rp.deleted': 'Import record removed (source file untouched)',
    'rp.deletedFile': 'Import record removed (source file {f} untouched)',
    'rp.noDelete': 'Could not remove this record: {e}',
    'ab.label': 'Abstract', 'ab.edit': 'Editable in place',
    'ab.saved': 'Abstract saved',
    'ab.missing': 'The root file of this disk has no abstract environment.',
    'fc.title': 'Evidence', 'fc.nofact': 'No such fact in the ledger.',
    'fc.claim': 'Claim', 'fc.value': 'Value', 'fc.source': 'Source',
    'fc.locator': 'Locator', 'fc.fp': 'Fingerprint', 'fc.conf': 'Confidence',
    'check.title': 'Full check result', 'check.tabReport': 'Check report',
    'check.tabMachine': 'Machine view', 'rp.card.del': 'Delete',
    /* ---- segment six ---- */
    'np.kb': 'Knowledge base', 'np.kbUpload': 'Upload file',
    'np.venue': 'Venue', 'np.venueGuide': 'Venue guide',
    'para.more': 'Paragraph actions', 'para.edit': 'Edit',
    'para.continue': 'Continue', 'para.rewrite': 'Rewrite', 'para.ask': 'Ask',
    'para.menu': 'Actions for this paragraph',
    'ai.modeIdea': 'Brainstorm', 'ai.modePaper': 'Write paper',
    'ai.discipline': 'Example numbers are not your results: nothing you did not actually run belongs in the draft.',
    'ai.copy': 'Copy', 'ai.writeIn': 'Write into draft',
    'ai.copied': 'Copied to the clipboard',
    'ai.copyFail': 'Copy failed: {e}',
    'ai.written': 'Written into the draft (right after that paragraph, tagged "AI draft")',
    'ai.writeFail': 'Could not write into the draft: {e}',
    'ai.writeNoTarget': 'This reply has no paragraph attached — use a paragraph action first.',
    'ai.continueQ': 'Continue this paragraph.',
    'ai.rewriteQ': 'Rewrite this paragraph better.',
    'ai.askQ': 'What could be improved in this paragraph?',
    'ai.actionDone': 'Action sent',
    'kb.empty': 'No file in this project directory can go into the knowledge base yet.',
    'kb.loading': 'Reading files…', 'kb.loadErr': 'Could not load the knowledge base: {e}',
    'kb.pick': 'Pick a file on the left to read it.',
    'kb.status': 'Status', 'kb.size': 'Size', 'kb.path': 'Path',
    'kb.preview': 'Preview', 'kb.truncated': '(preview truncated)',
    'kb.uploadOk': 'Uploaded: {name}', 'kb.uploadErr': 'Upload failed: {e}',
    'kb.noFile': 'No file selected.', 'kb.pending': 'extraction pending',
    'kb.ready': 'Ready',
    'kb.pdfNote': 'PDF: name and size only — text extraction lands in the next stage.',
    'kb.actPreview': 'Preview', 'kb.actDelete': 'Delete',
    'kb.sourceNote': 'Source files are managed by the section manager',
    'kb.delTitle': 'Delete knowledge-base file',
    'kb.delAsk': 'Delete this knowledge-base file?\n(Only the copy under knowledge/ goes; project sources stay untouched.)',
    'kb.deleted': 'Knowledge-base file deleted', 'kb.delFail': 'Could not delete: {e}',
    'kb.sha': 'sha256', 'kb.fullNote': 'Open the original file for the full content',
    'rp.actDetail': 'Details', 'rp.id': 'id', 'rp.claim': 'Claim', 'rp.value': 'Value',
    'rp.boundList': 'Bound items', 'rp.detailEmpty': 'This record has no bound items.',
    'rp.delConfirmTitle': 'Delete this import record?',
    'rp.delConfirmBody': 'Only the draft record goes; the report source file stays.',
    'confirm.ok': 'OK', 'confirm.cancel': 'Cancel',
    'more.rpNote': 'Imported reports sit in the pending-check zone; promoting them goes through the gate, not this panel.',
    'more.kbNote': 'Source files are read-only; only uploaded material can be deleted.',
    /* Citations and images: carried over from the old section-level front end */
    'np.cite': 'Citations', 'np.citeAdd': '+ Add one', 'np.assets': 'Images',
    'more.citeNote': 'Deleting touches the bib only; citation marks in the text stay.',
    'more.assetNote': 'Image files in this disk; click to open.',
    'cite.sum': '{total} entries: {used} cited, {unused} uncited',
    'cite.st.ok': 'Verifiable', 'cite.st.no_id': 'No stable id',
    'cite.st.bad_id': 'Bad id', 'cite.st.unused': 'Not cited',
    'cite.st.duplicate': 'Duplicate key',
    'cite.addT': 'Add a citation', 'cite.key': 'Citation key',
    'cite.title': 'Title', 'cite.author': 'Author', 'cite.year': 'Year',
    'cite.doi': 'DOI', 'cite.arxiv': 'arXiv', 'cite.add': 'Add',
    'cite.needKey': 'The key is required', 'cite.addOk': 'Added: {key}',
    'cite.addErr': 'Could not add: {e}',
    'cite.delT': 'Delete this entry', 'cite.delTitle': 'Delete this citation?',
    'cite.delBody': 'Only this bib entry goes; citation marks in the text stay.',
    'cite.delOk': 'Deleted: {key}', 'cite.delErr': 'Could not delete: {e}',
    'cite.loadErr': 'Could not load the citation list: {e}',
    'asset.empty': 'No image files in this disk.',
    'asset.more': 'Only the first {n} are listed (there are more in the disk).',
    'asset.loadErr': 'Could not load the image list: {e}',
    'tb.sample': 'Install sample', 'tb.sampleOk': 'Sample installed: {p}',
    'tb.sampleErr': 'Could not install the sample: {e}',
    'vn.venue': 'Target journal / conference', 'vn.venuePh': 'e.g. ACL 2026',
    'vn.deadline': 'Deadline', 'vn.save': 'Save venue config',
    'vn.lockTag': 'Language lock',
    'vn.lockZh': 'This disk is a Chinese draft: the venue pane changes layout and venue requirements only, never the language disk — a Chinese draft cannot be swapped for an English venue.',
    'vn.lockEn': 'This disk is an English draft: the venue pane changes layout and venue requirements only, never the language disk — open a separate Chinese disk for Chinese.',
    'vn.tplArticle': 'article (general single-column paper layout)',
    'vn.saved': 'Venue config saved into workbench.toml',
    'vn.saveErr': 'Could not save: {e}', 'vn.preview': 'First-page preview',
    'vn.templates': 'Template library', 'vn.tplBuilding': 'Template library under construction',
    'vn.previewNone': 'This disk has no compiled PDF yet: render one first, then come back for the preview.',
    'vn.previewBtn': 'Render and preview the first page',
    'vn.previewErr': 'Render failed: {e}',
    'vn.dueSoon': 'Deadline reminder: {d}', 'vn.overdue': '{d} days past the deadline',
    'vn.dueNormal': '{d} days to the deadline',
    'guide.title': 'Venue guide', 'guide.go': 'Start writing with this venue',
    'guide.h1': '1. What shape is the contribution',
    'guide.p1': 'Say first what you add that was not there: a new method, new data, a new measurement, ' +
      'or a newly mapped failure boundary. The shape decides which venues are even open to you — ' +
      'method papers live on novelty, data papers on coverage and reproducibility, ' +
      'boundary papers on how long before somebody else bumps into the same wall. ' +
      'If you cannot state the shape, picking a venue is just luck.',
    'guide.h2': '2. Who the reader is',
    'guide.p2': 'The reader decides what has to come first. A reviewer reads a dozen papers a day ' +
      'and stays patient only with the parts that look relevant to their own problem. ' +
      'So ask who will read this: are they after the method or after the conclusion? ' +
      'Those two audiences need different opening paragraphs, and one paragraph serving both ' +
      'loses both.',
    'guide.h3': '3. Deadlines and double submission',
    'guide.p3': 'The deadline is your time box: back-plan to the last version that still compiles, ' +
      'not to the last minute. Double-submission rules differ per venue and often change yearly, ' +
      'so read that venue\'s current author instructions instead of trusting last year\'s memory. ' +
      'Journal extensions and rolling venues sound like bonus tracks but carry the rules people forget.',
    'guide.h4': '4. How to use an impact factor',
    'guide.p4': 'An impact factor is an average across a journal, not a score for your paper. ' +
      'It usefully rules out mismatched venues (a letters-only journal, say), ' +
      'but it cannot replace the judgement "who will read this". ' +
      'Treating it as the only criterion is a reliable way to publish where nobody reads your problem.',
    'guide.foot': 'Once the venue is settled, put it in the form above — the venue pane previews ' +
      'the first page against it, and the navigation button warns you as the deadline nears. ' +
      'The language disk never changes: a Chinese draft stays a Chinese draft.',
    'draft.badge': 'AI draft',
    'draft.hint': 'An AI-written draft block, not body text. Edit it in place, or delete it.',
    'draft.deleted': 'AI draft block deleted',
    'draft.delFail': 'Could not delete: {e}',
    /* ---- v2: proposals (diff cards) -- AI proposes, a human confirms ---- */
    'proposal.badge': 'Pending',
    'proposal.title': 'Pending proposals',
    'proposal.adopt': 'Adopt and write back',
    'proposal.reject': 'Reject',
    'proposal.before': 'Current',
    'proposal.after': 'After adopting',
    'proposal.stale': 'This paragraph was changed elsewhere',
    'proposal.empty': 'No pending proposals.',
    'proposal.adopted': 'Adopted and written back',
    'proposal.rejected': 'Proposal rejected',
    'proposal.created': 'Created at {time}',
    'proposal.warnings': 'Warning: {text}',
    'proposal.queued': 'Queued for confirmation',
    'proposal.queueFail': 'Could not create the proposal: {e}',
    'proposal.confirmFail': 'Could not apply the proposal: {e}',
    'proposal.rejectFail': 'Could not reject the proposal: {e}',
    'proposal.loadFail': 'Could not load proposals: {e}',
    'proposal.fromMcp': 'From assistant',
    'proposal.fromPage': 'From page',
    'proposal.fromUnknown': 'Unknown source',
    'proposal.kindEdit': 'Edit',
    'proposal.kindDraft': 'Insert draft',
    'proposal.kindEvidenceFreeze': 'Freeze evidence list',
    'proposal.kindEvidenceUnfreeze': 'Unfreeze evidence list',
    'proposal.kindAddFact': 'Append fact',
    'proposal.kindExportBundle': 'Export submission bundle',
    /* ---- 追加事实表单（两步） ---- */
    'np.ledger': 'Fact ledger',
    'np.addFact': 'Append fact',
    'more.factNote': 'Recording goes through a proposal: creating it writes nothing, only adoption writes the ledger',
    'ff.title': 'Append one fact',
    'ff.s1': 'Pick an artifact',
    'ff.s2': 'Say what this number is',
    'ff.s1.h': 'These are the real artifacts on this disk: the signed ones and the ones not in the manifest. Picking one fills in the source; the tool computes the hash - there is no box for typing a path.',
    'ff.s1.ph': 'Filter by file name…',
    'ff.g.signed': 'Signed artifacts',
    'ff.g.unsigned': 'Artifacts not in the manifest',
    'ff.g.unsignedFold': 'Search unsigned artifacts',
    'ff.tag.unsigned': 'Unsigned (a human must sign it before it counts)',
    'ff.g.empty': 'Nothing in this group.',
    'ff.more': '{n} in total, showing the first {shown}; narrow it down with the box above.',
    'ff.badge.signed': 'Signed',
    'ff.badge.drift': 'Changed after signing',
    'ff.badge.missing': 'File missing',
    'ff.badge.unsigned': 'Unsigned',
    'ff.sha.manifest': 'manifest sha256',
    'ff.sha.live': 'live sha256',
    'ff.s2.h': 'Say what this number claims and where it comes from in the artifact; you pick the ledger it lands in.',
    'ff.src': 'source',
    'ff.f.id': 'Fact id',
    'ff.f.claim': 'Claim',
    'ff.f.value': 'Value',
    'ff.f.locator': 'Locator in the artifact',
    'ff.f.conf': 'Confidence',
    'ff.conf.high': 'high',
    'ff.conf.med': 'med',
    'ff.conf.low': 'low',
    'ff.f.note': 'Note (optional)',
    'ff.f.valueHint': 'The value must be the verbatim text from the artifact - that is what the body will bind. '
      + 'How it is compared: numbers are matched one by one, in order, after normalization '
      + '(thousands separators dropped, decimal point unified, LaTeX percent and fraction forms normalized, '
      + 'emphasis markers ignored; units are not compared); a value with no digits is compared as a normalized substring.',
    'ff.ledger.h': 'Which ledger',
    'ff.ledger.style': 'Ledger naming style on this disk: {style}',
    'ff.style.letter_topic': 'single-letter prefix + underscore topic (e.g. a_swebench.toml)',
    'ff.style.index_topic': 'two-digit index + hyphen topic (e.g. 01-core.toml)',
    'ff.style.unknown': 'unrecognised (creating a new ledger file will be refused)',
    'ff.ledger.new': 'Create a new ledger file',
    'ff.ledger.newPh': 'e.g. {name}',
    'ff.ledger.facts': '{n} facts',
    'ff.next': 'Next',
    'ff.create': 'Create proposal',
    'ff.needSource': 'Pick an artifact first.',
    'ff.needLedger': 'Pick a ledger first.',
    'ff.needFields': 'The id, the claim and the value are all required.',
    'ff.nameBad': 'This file name does not follow the naming style of this disk.',
    'ff.prefixBad': 'This prefix is already taken by an existing ledger file on this disk.',
    'ff.created': 'Proposal created - open "Pending" and click "Adopt and write back".',
    'ff.fail': 'Could not create the proposal: {e}',
    'ff.loadFail': 'Could not load the artifact list: {e}',
  },
};

const state = {
  lang: 'zh',
  projects: [],
  project: null,
  disk: null,
  blocks: [],
  meta: null,
  nav: { pane: 'toc' },   // 段五：导航面板（目录/智能助手/更多 三面互斥）
  blocksMeta: {},          // 条目 37：块身份（文件＋章节）——原地替换后重新绑定用
  blockSha: {},           // 条目 43：块原文短指纹（保存闸 expect_sha 用）
  blockTokens: {},         // 保护面芯片数（保存闸 expect_tokens 用：这份 DOM 是哪一版**结构**渲染出来的）
  filter: '',
  assembly: [],       // main.tex 的装配清单
  form: null,         // 新建/编辑项目表单 {mode, project, disk}
  abstract: null,     // 段五：封面摘要块模型（cover-abstract）
  report: null,       // 段三：检查报告数据（/report）
  machine: null,      // 段三：机器视图数据（/machine）
  proposalCatalog: {}, // 提议单展示层文案的双语目录（随 /proposal 列表到）
  reportError: '',
  machineError: '',
  reportLoading: false,
  rerun: null,        // 段三：最近一次重跑检查的结果
  ai: { messages: [], quote: null, waiting: false, seq: 0, mode: 'paper',
        model: '', models: [], modelsKey: '', sessionId: '', source: '', sourceLabel: '',
        effort: '', custom: false, customModels: [] },  // 段四：AI 对话；段六：两档模式；条目 42：模型选择（同一 project+disk 只拉一次）；v3：宿主 Agent 会话 id 与本轮后端；v4：思考等级与自定义模型
  reports: { list: [], loading: false, error: '', detail: null }, // 段四：实验报告
  kb: { files: [], loading: false, error: '', current: '', detail: null },   // 段六：知识库
  venue: { data: null, loading: false, error: '', msg: '' },                // 段六：版式
  cites: { data: null, loading: false, error: '' },   // 引用清单（旧节级前端那页搬过来的）
  assets: { data: null, loading: false, error: '' },  // 盘里的图片清单（同上）
  wz: { step: 1, file: '', fileSize: 0, files: [], rows: [], failed: [], suggested: [], sha: '', busy: false, parseError: '' }, // 段四：导入向导
  af: null,            // 追加事实表单（两步：挑产物 → 说清这条数字 ＋ 落哪本账）
  renameTarget: null,   // 改章节名：正在改的那一节 {file, block, sha}
  factInsert: null,     // 插入事实：目标段落 {file, block, sha}
  factRows: [],         // 插入事实：账上的事实清单（只读读数）
  proposals: [],       // v2：待确认提议单（差异卡的数据源）
  staleProposals: {},  // v2：本地判过期的提议单（服务端已不列 pending，留着说清原因）
};

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  let data = null;
  try { data = await res.json(); } catch (err) { data = null; }
  if (!res.ok || !data || data.ok === false) {
    const msg = (data && data.error) || ('HTTP ' + res.status);
    throw new Error(msg);
  }
  return data;
}

/* 槽位填充：{name} → 值。一处填，两处用（t() 与发现文案共用）。 */
function fill(text, vars) {
  let out = String(text === null || text === undefined ? '' : text);
  if (!vars) return out;
  Object.keys(vars).forEach((name) => {
    out = out.split('{' + name + '}').join(vars[name]);
  });
  return out;
}

function t(key, vars) {
  const dict = I18N[state.lang] || I18N.zh;
  const text = dict[key] !== undefined ? dict[key] : (I18N.zh[key] !== undefined ? I18N.zh[key] : key);
  return fill(text, vars);
}

/* 发现文案：后端给了 message_key ＋ params，i18n 目录子集随报告一起到
   （report.i18n）。目录里没有这一条、或这个语言没有，就回落到后端给的
   原文（中文原话）。EN 界面因此不留中文。 */
function findingMsg(f) {
  if (!f) return '';
  const report = state.report;
  const catalog = (report && report.i18n) || {};
  const entry = f.message_key ? catalog[f.message_key] : null;
  if (entry && entry[state.lang]) return fill(entry[state.lang], f.params || {});
  return f.message || '';
}

/* 工作台自己生成的说明文案（机器视图的命令清单、提议单正文与告警）：
   后端给 key ＋ params，双语目录子集随各自的载荷一起到（载荷的 i18n）。
   目录里没有这一条、或这个语言没有，就回落到后端给的中文原话。
   与 findingMsg() 同一条路：EN 界面因此不留中文。 */
function catalogMsg(catalog, key, params, fallback) {
  if (!key) return fallback || '';
  const entry = (catalog || {})[key];
  if (!entry) return fallback || '';
  const text = entry[state.lang] || entry.zh;
  if (!text) return fallback || '';
  return fillParts(text, params || {});
}

/* 槽位替换：缺槽位就原样留着（宁可看得见 {slot}，也不要静默渲染成空串）。 */
function fillParts(text, vars) {
  let out = String(text || '');
  Object.keys(vars || {}).forEach((name) => {
    const value = vars[name];
    if (value === undefined || value === null) return;
    out = out.split('{' + name + '}').join(String(value));
  });
  return out;
}

/* 一组展示层文案（parts）：逐条按界面语言渲染，拼成一段文本。
   任何一条渲染不出来 → 整段回落到后端原话（不半中半英）。
   parts 里带 text 的是契约内容（落盘的那一份），逐字保留、不翻译。 */
function renderParts(parts, catalog, fallback) {
  if (!Array.isArray(parts) || !parts.length) return fallback || '';
  const out = [];
  for (const item of parts) {
    if (!item || typeof item !== 'object') return fallback || '';
    if (item.text !== undefined) { out.push(String(item.text)); continue; }
    const entry = (catalog || {})[item.key];
    if (!entry) return fallback || '';
    const text = entry[state.lang] || entry.zh;
    if (!text) return fallback || '';
    out.push(fillParts(text, item.params || {}));
  }
  return out.join('\n');
}

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function toast(text, opts) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = text;
  // 条目 39：toast 可以挂一个下载钮（导出 PDF 走这条路，不再弹预览模态）。
  const conf = opts || {};
  el.classList.remove('has-link');
  if (conf.url) {
    el.classList.add('has-link');
    const link = document.createElement('a');
    link.className = 'toast-link';
    link.href = conf.url;
    link.download = conf.download || 'main.pdf';
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = conf.label || t('act.pdfDownload');
    el.appendChild(document.createElement('br'));
    el.appendChild(link);
  }
  el.classList.add('on');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('on'), conf.url ? 8000 : 1900);
}

function applyI18n() {
  document.documentElement.lang = state.lang === 'en' ? 'en' : 'zh-CN';
  document.title = t('doc.title');
  $$('[data-i18n]').forEach((el) => { el.textContent = t(el.getAttribute('data-i18n')); });
  $$('[data-i18n-ph]').forEach((el) => { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'))); });
  $$('[data-i18n-title]').forEach((el) => { el.setAttribute('title', t(el.getAttribute('data-i18n-title'))); });
  $$('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))); });
  $('#langSeg').querySelectorAll('button').forEach((btn) => {
    btn.classList.toggle('on', btn.dataset.lang === state.lang);
  });
  document.body.classList.toggle('panel-en', state.lang === 'en');
  // 段五：报告列表在导航面板里，跟着语言重画。
  renderReports();
  renderKb();
  renderVenue();
  // 引用与图片的文案也跟语言走（面板里的字是 t() 现填的）。
  renderCitations();
  renderAssets();
  // v4：模型下拉里的文案（来源标注、思考等级）也要跟着语言重画。
  renderAiModelSelect();
  // v5：「这一轮是谁答的」徽标也跟着语言重画。
  renderAiSource();
  applyLangToggle();
  // 追加事实表单：界面语言换了，表单里的字跟着换。
  if (state.af) renderFactForm();
  // 条目 33：applyI18n 会把钮里的文字整个重写，截稿徽标要补回来。
  updateDeadlineBadge();
}

async function getJSON(url) {
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/* ---------------------------------------------------------------- 项目列表 */

function diskSummary(project) {
  return project.disks.map((disk) => {
    const label = disk.lang === 'zh' ? t('disc.zh') : t('disc.en');
    return `${disk.id}（${label}·${disk.sections}${t('card.sections')}·${disk.facts}${t('card.facts')}）`;
  }).join('　');
}

function renderProjects() {
  const list = $('#pjList');
  const empty = $('#pjEmpty');
  const filter = state.filter.trim().toLowerCase();
  const rows = state.projects.filter((project) => {
    if (!filter) return true;
    return (project.name + ' ' + project.id + ' ' + project.disks.map((d) => d.id).join(' '))
      .toLowerCase().includes(filter);
  });
  list.innerHTML = '';
  empty.hidden = rows.length > 0;
  rows.forEach((project) => {
    const disk = project.disks[0] || {};
    const progress = disk.progress || { bound: 0, total: 0, percent: 0 };
    const progText = progress.total
      ? t('prog.facts', { b: progress.bound, t: progress.total })
      : t('prog.none');
    const last = disk.last_opened ? formatTime(disk.last_opened) : t('time.never');
    const disks = diskSummary(project);
    // 状态：由真实进度派生（跟原型三态一致），不另造字段。
    const status = !progress.total ? 'draft'
      : (progress.bound >= progress.total ? 'released' : 'checking');
    const row = document.createElement('div');
    row.className = 'pj-row-item';
    row.innerHTML = `
      <div class="pj-r-title"><span class="pj-r-name">${esc(project.name)}</span></div>
      <div class="pj-r-line">
        <span class="pj-r-disks" title="${esc(disks)}">${esc(disks)}</span>
        <span class="pj-r-status"><span class="pj-chip pj-${status}">${esc(t('status.' + status))}</span></span>
        <span class="pj-r-last" title="${esc(last)}">${esc(last)}</span>
        <span class="pj-r-prog"><span class="pj-bar"><span class="pj-bar-in" style="width:${progress.percent || 0}%"></span></span><span class="pj-r-time">${esc(progText)}</span></span>
        <span class="pj-r-actions">
          <button type="button" class="btn-ghost pj-edit" data-edit="${esc(project.id)}">${esc(t('card.edit'))}</button>
          <button type="button" class="btn-primary pj-open" data-open="${esc(project.id)}">${esc(t('card.open'))}</button>
        </span>
      </div>`;
    list.appendChild(row);
  });
  $$('#pjList [data-open]').forEach((btn) => {
    btn.addEventListener('click', () => openProject(btn.dataset.open));
  });
  $$('#pjList [data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => openForm('edit', btn.dataset.edit));
  });
}

function formatTime(stamp) {
  const date = new Date(stamp);
  if (isNaN(date.getTime())) return stamp;
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function loadProjects() {
  try {
    const data = await getJSON('/api/projects');
    state.projects = data.projects || [];
  } catch (err) {
    state.projects = [];
    toast(t('err.loadProjects', { e: err.message }));
  }
  renderProjects();
}

/* ---------------------------------------------------------------- 工作台 */

function currentDisk() {
  if (!state.project) return null;
  return state.project.disks.find((d) => d.id === state.disk) || state.project.disks[0] || null;
}

function diskLabel(disk) {
  return disk.lang === 'zh' ? t('disc.zh') : t('disc.en');
}

function renderBlocks() {
  const host = $('#bodyBlocks');
  host.innerHTML = '';
  let curSec = '';
  state.blocks.forEach((block) => {
    if (block.kind === 'section') {
      curSec = block.title || '';
      const section = document.createElement('section');
      section.setAttribute('data-sec', block.id);
      const heading = document.createElement('h2');
      heading.className = 'sec-h';
      heading.id = block.id;
      const cn = document.createElement('span');
      cn.className = 'sec-cn';
      cn.textContent = block.title;
      heading.appendChild(cn);
      if (block.title_en) {
        const en = document.createElement('span');
        en.className = 'sec-en';
        en.textContent = block.title_en;
        heading.appendChild(en);
      }
      section.appendChild(heading);
      host.appendChild(section);
    } else if (block.kind === 'subsection') {
      curSec = block.title || '';
      const heading = document.createElement('h3');
      heading.className = 'sub-h';
      heading.id = block.id;
      heading.textContent = block.title;
      host.appendChild(heading);
    } else if (block.kind === 'abstract') {
      // 段五：摘要归封面（封面摘要区可编辑），正文里不重复渲染。
    } else if (block.kind === 'ai_draft') {
      // 段六：AI 草稿块——独立成块，不混进正文；生来可编辑，也可删掉。
      const holder = document.createElement('div');
      holder.innerHTML = block.html || '';
      const node = holder.firstElementChild;
      if (node) {
        const wrap = document.createElement('div');
        wrap.className = 'ai-draft';
        wrap.id = block.id;
        wrap.dataset.file = block.file || '';
        wrap.dataset.kind = 'ai_draft';
        const badge = document.createElement('span');
        badge.className = 'ai-draft-badge';
        badge.textContent = t('draft.badge');
        const body = document.createElement('div');
        body.className = 'ai-draft-body';
        body.innerHTML = node.innerHTML || '';
        // 条目 43：正文永远直接可编辑——芯片由服务端烤进 html，没有「进入编辑」。
        body.dataset.blockId = block.id;
        body.dataset.file = block.file || '';
        body.setAttribute('contenteditable', 'true');
        body.setAttribute('spellcheck', 'false');
        if (block.sha) state.blockSha[block.id] = block.sha;
        state.blockTokens[block.id] = countProtTokens(block.html);
        const hint = document.createElement('div');
        hint.className = 'ai-draft-hint';
        hint.textContent = t('draft.hint');
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'ai-draft-del';
        del.textContent = '×';
        del.title = t('draft.badge');
        del.addEventListener('click', (ev) => {
          ev.stopPropagation();
          deleteAiDraft(block.file || '', block.id);
        });
        wrap.appendChild(badge);
        wrap.appendChild(body);
        wrap.appendChild(hint);
        wrap.appendChild(del);
        host.appendChild(wrap);
      }
    } else {
      const holder = document.createElement('div');
      holder.innerHTML = block.html || '';
      const node = holder.firstElementChild;
      if (node) {
        node.id = block.id;
        node.dataset.file = block.file || '';
        // 条目 37：块身份写进 DOM——保存时读回，与渲染闭包同源，杜绝错位。
        node.dataset.blockId = block.id;
        node.classList.add('editable-para');
        // 条目 43：生来可编辑——没有「单击进入编辑」这个动作，
        // 保护面芯片（data-token）由服务端烤进渲染 html。
        node.setAttribute('contenteditable', 'true');
        node.setAttribute('spellcheck', 'false');
        if (block.sha) state.blockSha[block.id] = block.sha;
        state.blockTokens[block.id] = countProtTokens(block.html);
        // 条目 37：块身份（文件＋章节）留一份，原地替换后据此重新绑定。
        state.blocksMeta[block.id] = { file: block.file || '', section: curSec };
        bindParaTools(node, (node.textContent || '').replace(/\s+/g, ' ').trim(), curSec, block.id, block.file || '');
        host.appendChild(node);
      }
    }
  });
  bindFactChips(host);
  bindChipCaret(host);
  renderTocList();
}

/* 段五：目录住进导航面板；章节管理并入目录——
   目录条目行内直接带 ↑↓/删除，末尾一行是「＋新建章节」。
   条目顺序＝装配顺序（main.tex 的 \input 链），调序后目录跟着走。 */
function renderTocList() {
  const toc = $('#tocList');
  if (!toc) return;
  toc.innerHTML = '';
  const assembly = state.assembly || [];
  const byFile = new Map();
  state.blocks.forEach((block) => {
    if (block.kind !== 'section' && block.kind !== 'subsection') return;
    const key = block.file || '';
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key).push(block);
  });
  const rows = [];
  const used = new Set();
  assembly.forEach((entry, index) => {
    const list = byFile.get(entry.rel) || [];
    list.forEach((block, position) => {
      rows.push({ block: block, ops: position === 0 ? { index: index, entry: entry } : null });
    });
    used.add(entry.rel);
  });
  byFile.forEach((list, file) => {
    if (used.has(file)) return;
    list.forEach((block) => rows.push({ block: block, ops: null }));
  });
  if (!rows.length) {
    const empty = document.createElement('li');
    empty.className = 'toc-empty';
    empty.textContent = t('np.tocEmpty');
    toc.appendChild(empty);
  }
  rows.forEach((row) => {
    const block = row.block;
    const li = document.createElement('li');
    li.className = 'toc-item' + ((block.level || 1) > 1 ? ' sub' : '');
    const link = document.createElement('a');
    link.href = '#' + block.id;
    // 条目 44：条目槽按语言与数据择一，永不空槽——EN 态有英文标题走 .en 槽，
    // 其余走 .cn 槽（EN 盘的标题本就是英文，走 .cn 槽照常显示）。
    const enTitle = block.title_en || '';
    link.innerHTML = (state.lang === 'en' && enTitle)
      ? '<span class="en">' + esc(enTitle) + '</span>'
      : '<span class="cn">' + esc(block.title || block.file || '') + '</span>';
    li.appendChild(link);
    // 目录行上的动作：调序/删除是**按文件**的（一个文件一节），改名是**按这一节**的
    // （一个文件里可能有好几节，改的是这一节自己的标题命令）——所以改名钮每行都有。
    const last = row.ops ? row.ops.index === assembly.length - 1 : false;
    const ops = document.createElement('span');
    ops.className = 'tm-ops';
    let opsHtml = '';
    if (row.ops) {
      opsHtml = `
        <button type="button" class="tm-btn" data-move="up" data-rel="${esc(block.file || '')}" title="${esc(t('toc.up'))}" ${row.ops.index === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="tm-btn" data-move="down" data-rel="${esc(block.file || '')}" title="${esc(t('toc.down'))}" ${last ? 'disabled' : ''}>↓</button>
        <button type="button" class="tm-btn tm-del" data-del="${esc(block.file || '')}" title="${esc(t('toc.del'))}">🗑</button>`;
    }
    opsHtml += `<button type="button" class="tm-btn" data-rename="1" data-block="${esc(block.id || '')}" data-rel="${esc(block.file || '')}" data-sha="${esc(block.sha || '')}" title="${esc(t('toc.rename'))}">✎</button>`;
    ops.innerHTML = opsHtml;
    li.appendChild(ops);
    toc.appendChild(li);
  });
  // 末尾：新建章节（行内入口，不是独立长条）
  const add = document.createElement('li');
  add.className = 'toc-add';
  add.innerHTML = `<button type="button" id="tocNew">${esc(t('toc.new'))}</button>`;
  toc.appendChild(add);

  $$('#tocList a').forEach((a) => {
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      const target = document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  $$('#tocList [data-move]').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      moveSection(btn.dataset.rel, btn.dataset.move);
    });
  });
  $$('#tocList [data-del]').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      deleteSection(btn.dataset.del);
    });
  });
  $$('#tocList [data-rename]').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openRenameSection(btn);
    });
  });
  const newBtn = $('#tocNew');
  if (newBtn) newBtn.addEventListener('click', openNewSection);
}

function renderCover() {
  const disk = currentDisk();
  if (!disk) return;
  // 标题分盘取：各盘自己的 main.tex \title（中文盘显示中文标题）。
  // 服务端 meta 是权威（meta.name 就是这个盘自己 main.tex 的 \title）；
  // 绝不退回项目级标题——那是另一盘（可能是另一种语言）的题。
  const diskTitle = (state.meta && state.meta.name) || disk.name || '';
  $('#coverTitle').textContent = diskTitle || disk.id;
  // 副标题＝这个盘自己 \title{…} 里 `\\` 之后那半句（各盘各的）。
  const diskSub = (state.meta && state.meta.subtitle) || '';
  $('#coverSub').textContent = diskSub || t('cover.sub', { disk: disk.id });
  $('#coverSt').textContent = t('cover.st', {
    n: state.meta ? state.meta.facts : disk.facts,
    m: state.meta ? state.meta.sections : disk.sections,
  });
  const langLine = disk.lang === 'zh' ? t('disc.zh') : t('disc.en');
  $('#coverMeta').innerHTML = `${esc(t('card.disks'))}: <b>${esc(disk.id)}</b> · ${esc(langLine)} · ${esc(disk.path)}`;
}

/* 改论文标题：写的是这个盘自己入口文件里的标题命令（封面读的就是那一条）。
   指纹闸：客户端报它所基于的那条标题命令的指纹，对不上就拒写。 */
function openTitleModal() {
  const meta = state.meta || {};
  $('#dtTitle').value = meta.name || '';
  $('#dtSub').value = meta.subtitle || '';
  $('#modalTitle').hidden = false;
  $('#dtTitle').focus();
  $('#dtTitle').select();
}

async function saveDiskTitle() {
  const project = state.project;
  const disk = currentDisk();
  if (!project || !disk) return;
  const title = $('#dtTitle').value.trim();
  if (!title) { toast(t('title.main')); return; }
  const subtitle = $('#dtSub').value.trim();
  $('#modalTitle').hidden = true;
  try {
    await postJSON(`/api/disk/${encodeURIComponent(project.id)}/${encodeURIComponent(disk.id)}/title`, {
      title: title,
      subtitle: subtitle,
      expect_sha: (state.meta && state.meta.title_sha) || '',
    });
    toast(t('title.saved'));
    // 封面读的就是这条命令——重读一遍状态行，封面跟着走。
    try {
      state.meta = await getJSON(`/api/disk/${encodeURIComponent(project.id)}/${encodeURIComponent(disk.id)}/meta`);
    } catch (err) {
      state.meta = null;
    }
    renderCover();
  } catch (err) {
    toast(t('err.saveFailed', { e: (err && err.message) || String(err) }));
  }
}

/* ---------------------------------------------------------------- 封面摘要（段五） */

const ABSTRACT_BLOCK = 'cover-abstract';

async function loadAbstract() {
  const project = state.project;
  const disk = currentDisk();
  const box = $('#coverAbstract');
  if (!box) return;
  if (!project || !disk) { state.abstract = null; box.hidden = true; return; }
  try {
    const data = await getJSON(`/api/disk/${encodeURIComponent(project.id)}/${encodeURIComponent(disk.id)}/block/${ABSTRACT_BLOCK}`);
    if (!data || data.ok === false) { state.abstract = null; box.hidden = true; return; }
    state.abstract = data;
  } catch (err) {
    state.abstract = null;
    box.hidden = true;
    return;
  }
  renderAbstract();
}

function renderAbstract() {
  const box = $('#coverAbstract');
  const body = $('#coverAbstractBody');
  const label = $('#coverAbstractLabel');
  if (!box || !body) return;
  const model = state.abstract;
  if (!model) { box.hidden = true; return; }
  box.hidden = false;
  if (label) label.textContent = t('ab.label');
  // 条目 43：保护面芯片由服务端烤进 html（模型应答的 html 字段），整段挂上。
  body.innerHTML = model.html || '';
  body.classList.add('editable-para');
  body.title = t('ab.edit');
  body.dataset.blockId = ABSTRACT_BLOCK;
  body.dataset.file = model.file || '';
  body.setAttribute('contenteditable', 'true');
  body.setAttribute('spellcheck', 'false');
  if (model.sha) state.blockSha[ABSTRACT_BLOCK] = model.sha;
  state.blockTokens[ABSTRACT_BLOCK] = countProtTokens(model.html);
  bindFactChips(body);
  bindChipCaret(body);
}

/* ---------------------------------------------------------------- 证据卡（段五） */

/* v5：点保护面芯片不夺走编辑意图——光标落到芯片旁边的正文位置。
   正文任何位置单击即可改字；事实芯片另外弹证据卡，二者不冲突。 */
function caretBesideChip(chip) {
  const block = chip.closest('[contenteditable="true"]');
  if (!block) return;
  try {
    const range = document.createRange();
    range.setStartAfter(chip);
    range.collapse(true);
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (err) {
    /* 落不进去就算了——不影响看证据 */
  }
}

/* v5：所有保护面芯片（数字／标签／引用／事实）点击后都把光标放回正文，
   免得「点了正文却没进编辑」——那是芯片把点击吃掉了。 */
function bindChipCaret(root) {
  $$('.prot-chip', root || document).forEach((chip) => {
    if (chip.dataset.caretBound === '1') return;
    chip.dataset.caretBound = '1';
    chip.addEventListener('click', () => { caretBesideChip(chip); });
  });
}

function bindFactChips(root) {
  $$('.fc[data-fact]', root || document).forEach((chip) => {
    if (chip.dataset.bound === '1') return;
    chip.dataset.bound = '1';
    chip.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openFactCard(chip.dataset.fact || '', chip);
    });
  });
}

function factRow(key, value, mono) {
  return `<div class="fc-row"><span class="k">${esc(t(key))}</span><span class="fc-v${mono ? ' mono' : ''}">${esc(value || '—')}</span></div>`;
}

function openFactCard(id, anchor) {
  const card = $('#factCard');
  const body = $('#fcBody');
  const foot = $('#fcFoot');
  const idEl = $('#fcId');
  if (!card || !body) return;
  idEl.textContent = id || '—';
  const groups = machineGroups();
  const rows = (groups && groups.ledger && Array.isArray(groups.ledger.rows)) ? groups.ledger.rows : [];
  const row = rows.find((r) => String(r.id) === String(id));
  if (!row) {
    body.innerHTML = `<div class="fc-empty">${esc(t('fc.nofact'))}</div>`;
    foot.innerHTML = '';
  } else {
    body.innerHTML = factRow('fc.claim', row.claim) +
      factRow('fc.value', row.value) +
      factRow('fc.source', row.source_file || row.source_path) +
      factRow('fc.locator', row.locator) +
      factRow('fc.conf', row.confidence) +
      factRow('fc.fp', row.fp_short, true);
    foot.innerHTML = row.source_path
      ? `<span title="${esc(row.source_path)}">${esc(row.source_path)}</span>`
      : '';
  }
  card.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const width = card.offsetWidth || 320;
  const height = card.offsetHeight || 200;
  let left = rect.left - width - 10;
  if (left < 8) left = Math.min(rect.right + 10, window.innerWidth - width - 8);
  let top = rect.top - 8;
  if (top + height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - height - 8);
  card.style.left = Math.max(8, left) + 'px';
  card.style.top = top + 'px';
}

function closeFactCard() {
  const card = $('#factCard');
  if (card) card.hidden = true;
}

function renderStatus() {
  const facts = state.meta ? state.meta.facts : 0;
  const sections = state.meta ? state.meta.sections : 0;
  const setText = (sel, text) => {
    const el = $(sel);
    if (el) el.textContent = text;
  };
  setText('#stFacts', t('hc.facts', { n: facts }));
  setText('#stSections', t('hc.sections', { m: sections }));
  setText('#stNote', t('hc.note'));
  // 段四：AI 面板的说明条走 data-i18n（#seg4Note），不在这里覆盖。
  // 段三：体检 / 发现 / 四步链 / 机器视图。
  renderReport();
  renderMachine();
}

async function openProject(projectId, diskId) {
  const project = state.projects.find((p) => p.id === projectId);
  if (!project) return;
  state.project = project;
  // P0-5：没有指定盘就回到上次打开的那个盘（项目数据里的 last_disk）；
  // 记不住（或盘没了）才回落英文盘 → 第一个盘。
  const disk = diskId
    ? project.disks.find((d) => d.id === diskId)
    : (project.disks.find((d) => d.id === project.last_disk) ||
       project.disks.find((d) => d.lang === 'en') || project.disks[0]);
  if (!disk) return;
  state.disk = disk.id;
  state.lang = disk.lang === 'zh' ? 'zh' : 'en';
  // 段四：换盘＝换一篇稿子，对话上下文跟着重置。
  clearAiConversation();
  // 条目 33：走 setView，左栏头部的常用功能组才会跟着渲染出来。
  setView('workbench');
  applyI18n();
  await loadDisk();
  await loadAssembly();
  // 记「最近打开」（写进项目配置的 [workbench].last_opened）
  try {
    await postJSON('/api/project/opened', { project: project.id, disk: disk.id });
    const fresh = await getJSON('/api/projects');
    state.projects = fresh.projects || [];
  } catch (err) { /* 记不上不影响使用 */ }
  toast(t('toast.opened', { name: project.name }));
}

async function loadDisk() {
  const project = state.project;
  const disk = currentDisk();
  if (!project || !disk) return;
  try {
    const data = await getJSON(`/api/disk/${encodeURIComponent(project.id)}/${encodeURIComponent(disk.id)}/sections`);
    state.blocks = data.blocks || [];
  } catch (err) {
    state.blocks = [];
    toast(t('err.loadSections', { e: err.message }));
  }
  // 条目 43：换一篇稿子，块指纹跟着换（保存闸的 expect_sha 按当前盘算）。
  state.blockSha = {};
  state.blockTokens = {};
  try {
    state.meta = await getJSON(`/api/disk/${encodeURIComponent(project.id)}/${encodeURIComponent(disk.id)}/meta`);
  } catch (err) {
    state.meta = null;
  }
  renderCover();
  renderBlocks();
  // v2：待确认提议单跟着当前盘走（进哪篇管哪篇）。
  await loadProposals();
  // 段五：封面摘要（可编辑；写回走段二同一保护通道）。
  await loadAbstract();
  // 段六：版式配置跟着当前盘走（截稿徽标立刻可显示）。
  loadVenue();
  // 引用与图片也跟着当前盘走（旧节级前端那两页搬过来的）。
  state.cites.data = null;
  state.assets.data = null;
  loadCitations();
  loadAssets();
  // 段三：检查报告与机器视图跟着当前盘走（进哪篇管哪篇）。
  resetReportState();
  state.rerun = null;
  state.reportLoading = true;
  renderStatus();
  await loadReport();
  state.reportLoading = false;
  renderStatus();
}

/* ---------------------------------------------------------------- 段三：检查报告 / 机器视图 */

const CHAIN_KEYS = ['declare', 'bind', 'reconcile', 'certify'];
const CHAIN_STATE_KEY = { ok: 'rp.stepOk', partial: 'rp.stepPartial', missing: 'rp.stepMissing' };

/* 段三的三个接口都跟着当前盘走（进哪篇管哪篇）。 */
function diskApiPath(suffix) {
  const project = state.project;
  const disk = currentDisk();
  if (!project || !disk) return null;
  return `/api/disk/${encodeURIComponent(project.id)}/${encodeURIComponent(disk.id)}/${suffix}`;
}

function reportIdle() {
  return !(state.project && currentDisk());
}

/* 短指纹：正文只显 8 位，完整 sha256 只进 title 属性，绝不当文本渲染。 */
function fpShort(shortValue, fullValue) {
  const s = String(shortValue || '');
  if (s) return s.slice(0, 8);
  const f = String(fullValue || '');
  return f ? f.slice(0, 8) : '';
}

function listJoin(items) {
  const arr = (items || []).map((x) => String(x)).filter((x) => x !== '');
  if (!arr.length) return t('mv.none');
  return arr.join(state.lang === 'en' ? ', ' : '、');
}

function numPair(a, b) {
  return Number(a || 0) + ' / ' + Number(b || 0);
}

function kvRow(key, value, title, mono) {
  const cls = mono ? 'kv-v mono' : 'kv-v';
  const ttl = title ? ` title="${esc(title)}"` : '';
  return `<div class="kv-row"><span class="kv-k">${esc(key)}</span><span class="${cls}"${ttl}>${esc(value)}</span></div>`;
}

function sevClass(sev) {
  if (sev === 'red') return 'red';
  if (sev === 'yellow') return 'yellow';
  return 'info';
}

function sevLabel(sev) {
  if (sev === 'red') return t('rp.sevRed');
  if (sev === 'yellow') return t('rp.sevYellow');
  return t('rp.sevInfo');
}

function pdfStatusText(pdf) {
  if (!pdf || !pdf.checked) return t('rp.pdfNone');
  return pdf.stale ? t('rp.pdfStale') : t('rp.pdfOk');
}

function errorText(payload, fallbackCode) {
  if (!payload) return fallbackCode || '';
  const code = payload.code || fallbackCode || 'ERROR';
  const msg = payload.error || payload.message || '';
  return msg ? code + ' · ' + msg : code;
}

function reportHealth() {
  const report = state.report;
  if (!report || report.ok === false) return null;
  return report.health || {};
}

function reportFindings() {
  const report = state.report;
  if (!report || !Array.isArray(report.findings)) return [];
  return report.findings;
}

/* 换盘时先清干净：别让上一篇的体检数字挂在这一篇上。 */
function resetReportState() {
  state.report = null;
  state.machine = null;
  state.reportError = '';
  state.machineError = '';
}

/* 读检查报告与机器视图：两个 GET 并发，谁失败都不拖垮另一个。 */
async function loadReport() {
  // 下面要给 reportPath 追加 lang 参数 → 必须 let（const += 会抛
  // TypeError: Assignment to constant variable，整条 openProject 链当场断掉）。
  let reportPath = diskApiPath('report');
  const machinePath = diskApiPath('machine');
  // lang 跟着界面语言走：后端直接出这一语言的文案（目录里没有的回落原文）。
  if (reportPath) {
    reportPath += (reportPath.indexOf('?') >= 0 ? '&' : '?') + 'lang='
      + (state.lang === 'en' ? 'en' : 'zh');
  }
  if (!reportPath || !machinePath) return;
  resetReportState();
  const [rep, mach] = await Promise.allSettled([getJSON(reportPath), getJSON(machinePath)]);
  if (rep.status === 'fulfilled') {
    state.report = rep.value || null;
    state.reportError = (state.report && state.report.ok === false)
      ? errorText(state.report, 'REPORT_FAILED') : '';
  } else {
    state.report = null;
    state.reportError = (rep.reason && rep.reason.message) || String(rep.reason);
  }
  if (mach.status === 'fulfilled') {
    state.machine = mach.value || null;
    state.machineError = (state.machine && state.machine.ok === false)
      ? errorText(state.machine, 'MACHINE_FAILED') : '';
  } else {
    state.machine = null;
    state.machineError = (mach.reason && mach.reason.message) || String(mach.reason);
  }
}

/* ---------------------------------------------------------------- 检查报告（pane-report） */

function findingRowHtml(f) {
  return `<div class="fp-item">
    <div class="fp-h"><span class="fp-sev ${sevClass(f.severity)}">${esc(sevLabel(f.severity))}</span><span class="fp-code">${esc(f.code || '')}</span></div>
    <div class="fp-msg">${esc(findingMsg(f))}</div>
    ${f.location ? `<div class="fp-loc">${esc(f.location)}</div>` : ''}
  </div>`;
}

function findingDetailHtml(f) {
  return `<div class="fd-item">
    <div class="fd-h"><span class="fp-sev ${sevClass(f.severity)}">${esc(sevLabel(f.severity))}</span><span class="fp-code">${esc(f.code || '')}</span></div>
    <div class="fd-msg">${esc(findingMsg(f))}</div>
    <div class="fd-kv"><span class="fd-k">location</span><span class="fd-v">${esc(f.location || '—')}</span></div>
    <div class="fd-kv"><span class="fd-k">token</span><span class="fd-v">${esc(f.token || '—')}</span></div>
    <div class="fd-kv"><span class="fd-k">context</span><span class="fd-v fd-pre">${esc(f.context || '—')}</span></div>
  </div>`;
}

function chainStepHtml(step, index) {
  const st = (step && step.state) || (step && step.ok ? 'ok' : 'partial');
  const cls = st === 'ok' ? 'done' : (st === 'partial' ? 'partial' : 'missing');
  const badgeCls = st === 'ok' ? 'done' : (st === 'partial' ? 'todo' : '');
  // P0-4：标签与说明一律走 i18n——后端给结构化 key（label_key / detail_key）；
  // 老字段（label / detail）留着兜底，别让读数空掉。
  const label = (step && step.label_key)
    ? t(step.label_key)
    : ((step && (step.label || step.key)) || '');
  const val = t('rp.chainVal', { v: Number((step && step.value) || 0), t: Number((step && step.total) || 0) });
  const detail = (step && step.detail_key)
    ? ' · ' + t(step.detail_key)
    : ((step && step.detail) ? ' · ' + step.detail : '');
  return `<div class="rstep ${cls}">
    <div class="rstep-h"><span class="rstep-no">${index + 1}</span><span>${esc(label)}</span><span class="badge ${badgeCls}">${esc(t(CHAIN_STATE_KEY[st] || 'rp.stepPartial'))}</span></div>
    <div class="rstep-c">${esc(val)}${esc(detail)}</div>
  </div>`;
}

function renderReport() {
  const report = state.report;
  const health = reportHealth();
  const findings = reportFindings();
  const idle = reportIdle();

  /* —— 体检卡 —— */
  const badge = $('#badgeHealth');
  if (badge) {
    if (health) {
      const red = Number(health.red || 0);
      const yellow = Number(health.yellow || 0);
      badge.textContent = t('rp.ry', { r: red, y: yellow });
      badge.className = 'fold-badge ' + (red > 0 ? 'red' : (yellow > 0 ? 'warn' : 'ok'));
    } else {
      badge.textContent = '—';
      badge.className = 'fold-badge';
    }
  }
  const factsEl = $('#stFacts');
  if (factsEl) {
    const n = health ? Number(health.facts || 0) : Number((state.meta && state.meta.facts) || 0);
    factsEl.textContent = t('hc.facts', { n: n });
    factsEl.className = 'st ' + (n > 0 ? 'ok' : 'warn');
  }
  const secEl = $('#stSections');
  if (secEl) {
    const n = health ? Number(health.sections || 0) : Number((state.meta && state.meta.sections) || 0);
    secEl.textContent = t('hc.sections', { m: n });
    secEl.className = 'st ' + (n > 0 ? 'ok' : 'warn');
  }
  const kv = $('#stHealthKv');
  if (kv) {
    if (!health) {
      kv.innerHTML = '';
    } else {
      const nums = health.numbers || {};
      const cites = health.citations || {};
      const pdf = health.pdf || {};
      const rows = [];
      // 账本指纹：正文只显 8 位短码；完整 sha256 只在 title 里。
      rows.push(kvRow(t('rp.digest'), fpShort(health.digest_short, health.digest), health.digest, true));
      rows.push(kvRow(t('rp.numbers'), numPair(nums.numbers_matched, nums.numbers_total)));
      rows.push(kvRow(t('rp.cites'), numPair(cites.cites_unique, cites.bib_entries)));
      if (pdf && pdf.checked) rows.push(kvRow(t('rp.pdf'), pdfStatusText(pdf)));
      kv.innerHTML = rows.join('');
    }
  }
  const noteEl = $('#stNote');
  if (noteEl) {
    if (state.reportError) {
      noteEl.textContent = t('rp.loadErr', { e: state.reportError });
    } else {
      const gen = (report && report.generated_at) || '';
      noteEl.textContent = gen ? t('rp.generated', { t: gen }) + ' · ' + t('hc.note') : t('hc.note');
    }
  }
  const errEl = $('#stRerunErr');
  if (errEl) {
    const rr = state.rerun;
    if (rr && rr.ok === false) {
      errEl.hidden = false;
      errEl.textContent = t('rp.rerunErr', { code: rr.code || 'RERUN_FAILED', msg: rr.error || '' });
    } else {
      errEl.hidden = true;
      errEl.textContent = '';
    }
  }

  /* —— 发现卡 —— */
  const fbadge = $('#badgeFindings');
  if (fbadge) {
    fbadge.textContent = t('rp.n', { n: findings.length });
    const hasRed = findings.some((f) => f.severity === 'red');
    fbadge.className = 'fold-badge ' + (!findings.length ? 'ok' : (hasRed ? 'red' : 'warn'));
  }
  const fbody = $('#bodyFindings');
  if (fbody) {
    let html = '';
    if (idle) {
      html = `<div class="ff-empty">${esc(t('rp.idle'))}</div>`;
    } else if (state.reportLoading) {
      html = `<div class="ff-empty">${esc(t('rp.loading'))}</div>`;
    } else if (state.reportError) {
      html = `<div class="ff-empty">${esc(t('rp.loadErr', { e: state.reportError }))}</div>`;
    } else if (!findings.length) {
      html = `<div class="ff-empty">${esc(t('rp.findingsEmpty'))}</div>`;
    } else {
      html = '<div class="fp-list">' + findings.map(findingRowHtml).join('') + '</div>';
    }
    if (report && report.ok !== false) {
      html += `<button type="button" class="rp-detail-btn" data-rp-details>${esc(t('rp.details'))}</button>`;
    }
    fbody.innerHTML = html;
    const more = fbody.querySelector('[data-rp-details]');
    if (more) more.addEventListener('click', openFindingsModal);
  }

  /* —— 四步链卡 —— */
  const chain = (report && Array.isArray(report.chain)) ? report.chain.slice() : [];
  chain.sort((a, b) => {
    const ia = CHAIN_KEYS.indexOf(a.key);
    const ib = CHAIN_KEYS.indexOf(b.key);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const cbadge = $('#badgeChain');
  if (cbadge) {
    const okCount = chain.filter((s) => s.state === 'ok').length;
    cbadge.textContent = okCount + '/' + CHAIN_KEYS.length;
    cbadge.className = 'fold-badge ' + (chain.length && okCount === CHAIN_KEYS.length ? 'ok' : 'warn');
  }
  const cbody = $('#bodyChainSteps');
  if (cbody) {
    if (idle) {
      cbody.innerHTML = `<div class="ff-empty">${esc(t('rp.idle'))}</div>`;
    } else if (state.reportLoading) {
      cbody.innerHTML = `<div class="ff-empty">${esc(t('rp.loading'))}</div>`;
    } else if (!chain.length) {
      cbody.innerHTML = `<div class="ff-empty">${esc(state.reportError ? t('rp.loadErr', { e: state.reportError }) : t('rp.chainEmpty'))}</div>`;
    } else {
      cbody.innerHTML = chain.map(chainStepHtml).join('');
    }
  }

  /* —— 附加只读闸卡（文风闸 / 双语对账）—— */
  renderGateCards();
  /* —— 证据锁卡（独立只读卡）—— */
  renderEvidenceLockCard();
}


/* ---------------------------------------------------------------- 附加只读闸（文风闸 / 双语对账）
   P0-1：这两道闸在 CLI 里本来就是只读命令（factscribe style / mirror-check），
   这里当只读读数并进检查报告：主红黄计数仍只认 audit ＋ 清单门那两道闸，
   不改判定面，也不触发任何改写。 */

function reportGates() {
  const report = state.report;
  if (!report || report.ok === false) return null;
  const gates = report.gates;
  return (gates && typeof gates === 'object') ? gates : null;
}

function gateNoteHtml() {
  return `<div class="st-sub">${esc(t('rp.gateNote'))}</div>`;
}

function mirrorDriftHtml(d) {
  const a = d.disk_a || {};
  const b = d.disk_b || {};
  const field = d.field ? ' · ' + esc(d.field) : '';
  const aVal = (a.present && a.value) ? a.value : '—';
  const bVal = (b.present && b.value) ? b.value : '—';
  return `<div class="fp-item">
    <div class="fp-h"><span class="fp-sev red">${esc(t('rp.mirrorDriftOne'))}</span><span class="fp-code">${esc(d.code || '')}</span></div>
    <div class="fp-msg">${esc(d.target || '')} · ${esc(d.id || '')}${field}</div>
    <div class="fp-loc">${esc(t('rp.mirrorA'))}: ${esc(aVal)} ｜ ${esc(t('rp.mirrorB'))}: ${esc(bVal)}</div>
  </div>`;
}

/* —— 证据锁卡（独立只读卡）——
   读数随检查报告一起来（报告载荷里的 evidence_lock），页面**不多调一次**
   端点；数据与 MCP 的 fs_get_evidence_status 同源（引擎那边同一个读数函数）。
   四步链「出证」那一步的读数与判定一个字没动——这里是参考读数，不是判定。 */
function reportEvidenceLock() {
  const report = state.report;
  if (!report || report.ok === false) return null;
  const lock = report.evidence_lock;
  return (lock && typeof lock === 'object') ? lock : null;
}

function renderEvidenceLockCard() {
  const lock = reportEvidenceLock();
  const idle = reportIdle();
  const loading = state.reportLoading;
  const badge = $('#badgeEvidence');
  const body = $('#bodyEvidence');
  if (badge) {
    if (!lock) { badge.textContent = '—'; badge.className = 'fold-badge'; }
    else if (lock.ok === false) { badge.textContent = '—'; badge.className = 'fold-badge warn'; }
    else if (lock.frozen) { badge.textContent = t('rp.evLockFrozen'); badge.className = 'fold-badge ok'; }
    else { badge.textContent = t('rp.evLockNotFrozen'); badge.className = 'fold-badge warn'; }
  }
  if (!body) return;
  if (idle) { body.innerHTML = `<div class="ff-empty">${esc(t('rp.idle'))}</div>`; return; }
  if (loading) { body.innerHTML = `<div class="ff-empty">${esc(t('rp.loading'))}</div>`; return; }
  if (!lock) { body.innerHTML = `<div class="ff-empty">${esc(t('rp.evLockNone'))}</div>`; return; }
  if (lock.ok === false) {
    body.innerHTML = `<div class="ff-empty">${esc(t('rp.evLockErr', { e: lock.error || '' }))}</div>`;
    return;
  }
  const rows = [];
  rows.push(kvRow(t('rp.evLockEntries'), String(lock.entries || 0)));
  rows.push(kvRow(t('rp.evLockSha'), fpShort(lock.sha256_short, lock.sha256),
                 lock.sha256 || '', true));
  rows.push(kvRow(t('rp.evLockCurrent'), fpShort(lock.current_sha256_short, lock.current_sha256),
                 lock.current_sha256 || '', true));
  const mismatch = lock.mismatch;
  rows.push(kvRow(mismatch ? t('rp.evLockMismatch') : t('rp.evLockSame'),
                 mismatch ? t('rp.evLockMismatch') : (lock.frozen ? t('rp.evLockFrozen') : t('rp.evLockNotFrozen'))));
  const last = lock.last_log || {};
  if (last && last.action) {
    const at = last.at ? (' · ' + last.at) : '';
    rows.push(kvRow(t('rp.evLockLastLog'), String(last.action) + at + (last.reason ? (' · ' + last.reason) : '')));
  }
  body.innerHTML = `<div class="kv">${rows.join('')}</div>`
    + `<div class="st-sub">${esc(t('rp.evLockNote'))}</div>`;
}

function renderGateCards() {
  const gates = reportGates();
  const idle = reportIdle();
  const loading = state.reportLoading;

  /* —— 文风闸 —— */
  const style = gates ? gates.style : null;
  const sBadge = $('#badgeStyle');
  const sBody = $('#bodyStyle');
  if (sBadge) {
    if (!style) { sBadge.textContent = '—'; sBadge.className = 'fold-badge'; }
    else if (style.status === 'ok') { sBadge.textContent = t('rp.styleOk'); sBadge.className = 'fold-badge ok'; }
    else if (style.status === 'red') { sBadge.textContent = t('rp.styleRed', { n: style.red || 0 }); sBadge.className = 'fold-badge red'; }
    else if (style.status === 'yellow') { sBadge.textContent = t('rp.styleYellow', { n: style.yellow || 0 }); sBadge.className = 'fold-badge warn'; }
    else { sBadge.textContent = '—'; sBadge.className = 'fold-badge warn'; }
  }
  if (sBody) {
    if (idle) sBody.innerHTML = `<div class="ff-empty">${esc(t('rp.idle'))}</div>`;
    else if (loading) sBody.innerHTML = `<div class="ff-empty">${esc(t('rp.loading'))}</div>`;
    else if (!style) sBody.innerHTML = `<div class="ff-empty">${esc(t('rp.styleNone'))}</div>`;
    else if (style.status === 'error') sBody.innerHTML = `<div class="ff-empty">${esc(t('rp.styleErr', { e: style.error || '' }))}</div>`;
    else if (style.status === 'ok') sBody.innerHTML = `<div class="ff-empty">${esc(t('rp.styleOk'))}</div>` + gateNoteHtml();
    else sBody.innerHTML = `<div class="fp-list">${((style.findings || []).map(findingRowHtml).join(''))}</div>` + gateNoteHtml();
  }

  /* —— 双语对账 —— */
  const mirror = gates ? gates.mirror : null;
  const mBadge = $('#badgeMirror');
  const mBody = $('#bodyMirror');
  if (mBadge) {
    if (!mirror) { mBadge.textContent = '—'; mBadge.className = 'fold-badge'; }
    else if (mirror.status === 'ok') { mBadge.textContent = t('rp.mirrorOk'); mBadge.className = 'fold-badge ok'; }
    else if (mirror.status === 'drift') { mBadge.textContent = t('rp.mirrorDrift', { n: mirror.count || 0 }); mBadge.className = 'fold-badge red'; }
    else if (mirror.status === 'na') { mBadge.textContent = t('rp.mirrorNa'); mBadge.className = 'fold-badge'; }
    else { mBadge.textContent = '—'; mBadge.className = 'fold-badge warn'; }
  }
  if (mBody) {
    if (idle) mBody.innerHTML = `<div class="ff-empty">${esc(t('rp.idle'))}</div>`;
    else if (loading) mBody.innerHTML = `<div class="ff-empty">${esc(t('rp.loading'))}</div>`;
    else if (!mirror) mBody.innerHTML = `<div class="ff-empty">${esc(t('rp.mirrorNone'))}</div>`;
    else if (mirror.status === 'error') mBody.innerHTML = `<div class="ff-empty">${esc(t('rp.mirrorErr', { e: mirror.error || '' }))}</div>`;
    else if (mirror.status === 'na') mBody.innerHTML = `<div class="ff-empty">${esc(t('rp.mirrorNa'))}</div>`;
    else if (mirror.status === 'ok') mBody.innerHTML = `<div class="ff-empty">${esc(t('rp.mirrorOk'))}</div>` + gateNoteHtml();
    else mBody.innerHTML = `<div class="fp-list">${((mirror.drift || []).map(mirrorDriftHtml).join(''))}</div>` + gateNoteHtml();
  }
}

function openFindingsModal() {
  const findings = reportFindings();
  const body = $('#modalFindingsBody');
  if (body) {
    body.innerHTML = findings.length
      ? findings.map(findingDetailHtml).join('')
      : `<div class="ff-empty">${esc(t('rp.findingsEmpty'))}</div>`;
  }
  const modal = $('#modalFindings');
  if (modal) modal.hidden = false;
}

/* ---------------------------------------------------------------- 机器视图（pane-machine） */

function machineGroups() {
  const machine = state.machine;
  if (!machine || machine.ok === false || !machine.groups) return null;
  return machine.groups;
}

function machineIdleText() {
  if (reportIdle()) return t('rp.idle');
  if (state.reportLoading) return t('rp.loading');
  if (state.machineError) return t('rp.loadErrM', { e: state.machineError });
  return t('rp.idle');
}

function renderMachine() {
  const groups = machineGroups();
  renderLedgerGroup(groups ? groups.ledger : null);
  renderScanGroup(groups ? groups.scan : null);
  renderEvidenceGroup(groups ? groups.chain : null);
  renderExportGroup(groups ? groups.export : null);
}

/* 账本表：指纹列只显 8 位短码，完整 sha256 只在 title；出处只显文件名，路径在 title。 */
function renderLedgerGroup(ledger) {
  const badge = $('#badgeLedger');
  const body = $('#bodyLedger');
  const rows = (ledger && Array.isArray(ledger.rows)) ? ledger.rows : [];
  const total = (ledger && ledger.total !== undefined) ? Number(ledger.total) : rows.length;
  if (badge) {
    badge.textContent = t('mv.rows', { n: total });
    badge.className = 'acc-badge ' + (total > 0 ? 'ok' : 'warn');
  }
  if (!body) return;
  if (!ledger) {
    body.innerHTML = `<div class="ff-empty">${esc(machineIdleText())}</div>`;
    return;
  }
  const digest = fpShort(ledger.digest_short, '');
  const head = `<div class="kv">${kvRow(t('rp.digest'), digest || '—', '', true)}</div>`;
  if (!rows.length) {
    body.innerHTML = head + `<div class="ff-empty">${esc(t('mv.none'))}</div>`;
    return;
  }
  const trs = rows.map((r) => `<tr>
      <td><code>${esc(r.id || '')}</code></td>
      <td>${esc(r.claim || '')}</td>
      <td><code>${esc(r.value || '')}</code></td>
      <td>${esc(r.confidence || '')}</td>
      <td title="${esc(r.source_path || r.source_file || '')}"><code>${esc(r.source_file || '')}</code></td>
      <td title="${esc(r.fp || '')}"><code>${esc(fpShort(r.fp_short, r.fp))}</code></td>
    </tr>`).join('');
  body.innerHTML = head + `<table class="mt mv-table">
      <thead><tr><th>${esc(t('mv.colId'))}</th><th>${esc(t('mv.colClaim'))}</th><th>${esc(t('mv.colValue'))}</th><th>${esc(t('mv.colConf'))}</th><th>${esc(t('mv.colFile'))}</th><th>${esc(t('mv.colFp'))}</th></tr></thead>
      <tbody>${trs}</tbody></table>`;
}

/* 正文扫描：章节数、数字回账、覆盖率、未绑定/未回账、扫描文件与字节数。 */
function renderScanGroup(scan) {
  const badge = $('#badgeScan');
  const body = $('#bodyScan');
  const pct = scan ? Number(scan.coverage_percent || 0) : 0;
  if (badge) {
    badge.textContent = t('mv.cov', { n: pct });
    badge.className = 'acc-badge ' + (pct >= 100 ? 'ok' : 'warn');
  }
  if (!body) return;
  if (!scan) {
    body.innerHTML = `<div class="ff-empty">${esc(machineIdleText())}</div>`;
    return;
  }
  const rows = [];
  rows.push(kvRow(t('mv.sections'), String(Number(scan.sections || 0))));
  rows.push(kvRow(t('mv.num'), numPair(scan.numbers_matched, scan.numbers_total)));
  rows.push(kvRow(t('mv.coverage'), pct + '%'));
  rows.push(kvRow(t('mv.unbound'), String(Number(scan.numbers_unbound || 0))));
  rows.push(kvRow(t('mv.unmatched'), String(Number(scan.numbers_unmatched || 0))));
  rows.push(kvRow(t('mv.skipped'), String(Number(scan.annotations_skipped || 0))));
  let html = `<div class="kv">${rows.join('')}</div>`;
  const files = Array.isArray(scan.rows) ? scan.rows : [];
  if (files.length) {
    const trs = files.map((f) => `<tr><td><code>${esc(f.name || f.file || '')}</code></td><td class="mv-num">${esc(t('mv.bytes', { n: Number(f.bytes || 0) }))}</td></tr>`).join('');
    html += `<div class="mv-sub-t">${esc(t('mv.files'))}</div><table class="mt mv-table"><tbody>${trs}</tbody></table>`;
  }
  body.innerHTML = html;
}

/* 文献与证据链：引用、文献条目/文件/未用键、证据冻结状态与指纹、证据日志、PDF 状态。 */
function renderEvidenceGroup(chain) {
  const badge = $('#badgeEvidence');
  const body = $('#bodyEvidence');
  const frozen = chain ? !!chain.frozen : false;
  if (badge) {
    badge.textContent = frozen ? t('mv.frozen') : t('mv.unfrozen');
    badge.className = 'acc-badge ' + (frozen ? 'ok' : 'warn');
  }
  if (!body) return;
  if (!chain) {
    body.innerHTML = `<div class="ff-empty">${esc(machineIdleText())}</div>`;
    return;
  }
  const pdf = chain.pdf || {};
  const rows = [];
  rows.push(kvRow(t('mv.cites'), numPair(chain.cites_unique, chain.cites_total)));
  rows.push(kvRow(t('mv.bibEntries'), String(Number(chain.bib_entries || 0))));
  rows.push(kvRow(t('mv.bibFiles'), listJoin(chain.bib_files)));
  rows.push(kvRow(t('mv.bibUnused'), listJoin(chain.bib_unused)));
  rows.push(kvRow(t('mv.freezeState'), frozen ? t('mv.frozen') : t('mv.unfrozen')));
  rows.push(kvRow(t('mv.entries'), String(Number(chain.evidence_entries || 0))));
  // 证据指纹：正文只显 8 位短码；完整 sha256 只在 title。
  rows.push(kvRow(t('mv.evFp'), fpShort(chain.evidence_sha256_short, chain.evidence_sha256), chain.evidence_sha256, true));
  if (pdf && pdf.checked) rows.push(kvRow(t('rp.pdf'), pdfStatusText(pdf)));
  let html = `<div class="kv">${rows.join('')}</div>`;
  const log = Array.isArray(chain.evidence_log) ? chain.evidence_log : [];
  if (log.length) {
    const trs = log.map((e) => `<tr><td>${esc(e.action || '')}</td><td><code>${esc(fpShort(e.hash, ''))}</code></td><td class="mv-num">${esc(String(Number(e.entries || 0)))}</td><td>${esc(e.reason || '')}</td></tr>`).join('');
    html += `<div class="mv-sub-t">${esc(t('mv.log'))}</div><table class="mt mv-table"><thead><tr><th>action</th><th>hash</th><th>entries</th><th>reason</th></tr></thead><tbody>${trs}</tbody></table>`;
  }
  body.innerHTML = html;
}

/* 导出与命令：只列命令与说明，不执行。 */
function renderExportGroup(ex) {
  const badge = $('#badgeExport');
  const body = $('#bodyExport');
  const commands = (ex && Array.isArray(ex.commands)) ? ex.commands : [];
  if (badge) {
    badge.textContent = t('mv.cmdCount', { n: commands.length });
    badge.className = 'acc-badge' + (commands.length ? ' ok' : '');
  }
  if (!body) return;
  if (!ex) {
    body.innerHTML = `<div class="ff-empty">${esc(machineIdleText())}</div>`;
    return;
  }
  // 命令标签与说明是后端生成的文案：给 key ＋ params，按界面语言翻。
  const catalog = (state.machine && state.machine.i18n) || {};
  let html = '';
  if (commands.length) {
    html = commands.map((c) => `<div class="cmd-row"><span class="cmd-l">${esc(catalogMsg(catalog, c.label_key, c.params || {}, c.label || ''))}</span><code class="cmd-c">${esc(c.cmd || '')}</code></div>`).join('');
  } else {
    html = `<div class="ff-empty">${esc(t('mv.none'))}</div>`;
  }
  const note = catalogMsg(catalog, ex.note_key, ex.note_params || {}, ex.note || '');
  if (note) html += `<div class="acc-note">${esc(note)}</div>`;
  body.innerHTML = html;
}

/* ---------------------------------------------------------------- 段三：重跑检查（只读） */

function setRerunNote(text, kind) {
  const el = $('#rpRerunNote');
  if (!el) return;
  el.textContent = text || '';
  el.hidden = !text;
  el.className = 'rp-tools-note' + (kind === 'bad' ? ' bad' : (kind === 'ok' ? ' ok' : ''));
}

function readonlyText(ro) {
  if (!ro) return '';
  if (ro.identical) return t('rp.roOk');
  const files = [].concat(ro.changed || [], ro.touched || []);
  return t('rp.roChanged', { files: listJoin(files) });
}

async function rerunCheck() {
  const path = diskApiPath('report/rerun');
  if (!path) return;
  const btn = $('#rpRerun');
  if (btn) btn.disabled = true;
  setRerunNote(t('rp.rerunning'), 'busy');
  const cardErr = $('#stRerunErr');
  if (cardErr) { cardErr.hidden = true; cardErr.textContent = ''; }
  let data = null;
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({}),
    });
    try { data = await res.json(); } catch (err) { data = null; }
    if (!data) data = { ok: false, code: 'HTTP_' + res.status, error: 'HTTP ' + res.status };
  } catch (err) {
    data = { ok: false, code: 'RERUN_FAILED', error: (err && err.message) || String(err) };
  }
  state.rerun = data;
  if (btn) btn.disabled = false;
  if (data.ok) {
    const summary = data.summary || {};
    const red = Number(summary.red || 0);
    const yellow = Number(summary.yellow || 0);
    toast(t('rp.rerunOk', { r: red, y: yellow, ms: Number(data.duration_ms || 0) }));
    setRerunNote(readonlyText(data.readonly), (data.readonly && data.readonly.identical) ? 'ok' : 'bad');
    // 重跑完刷新体检与机器视图（仍然只读）。
    await loadReport();
    renderStatus();
  } else {
    const code = data.code || 'RERUN_FAILED';
    const msg = data.error || data.message || '';
    toast(t('rp.rerunErr', { code: code, msg: msg }));
    setRerunNote(t('rp.rerunErr', { code: code, msg: msg }), 'bad');
    renderReport();
  }
}

/* ---------------------------------------------------------------- 就地编辑（条目 43：页面即编辑器）

正文段落生来 contenteditable——没有「进入编辑」这个动作，也没有渲染态↔编辑态
两个状态。保护面芯片由服务端烤进渲染 html（data-token），失焦即保存：
容器级 focusout 委托 → 120ms 守卫（焦点还在块内就不存）→ saveBlockNode 收
「散文＋token」POST /edit（带 expect_sha 指纹闸）。保存成功用应答的 blocks
刷新同文件其他块（杜绝兄弟段 token 过期）；409 BLOCK_STALE 原地重载新文。 */

/* 条目 44：IME 组合感知。组合期间（拼音还在候选框里）任何对编辑宿主的改动都会
   打断组合、把光标甩进插入的节点里；而此刻 DOM 里躺着的是候选中的拼音，
   直接收去保存会写进正文。所以组合期间只记账，不动 DOM、不收正文。 */
const imeState = {
  active: false,        // 组合进行中
  blockId: '',         // 正在组合的那一块
  pendingSave: null,   // 组合期间被拦下的保存（结束后补跑）
  pendingBadge: null,  // 组合期间被拦下的「已保存」角标
  pendingHtml: null,   // 组合期间被拦下的整块替换（结束后补做）
  stuckTimer: 0,       // 组合迟迟不结束的兜底
};

/* 条目 44：段内光标偏移的取/还——整块替换 DOM 后按偏移把光标放回原处，
   而不是让它跳回块首。 */
function caretTextOffset(host) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!range.startContainer || !host.contains(range.startContainer)) return null;
  const pre = range.cloneRange();
  pre.selectNodeContents(host);
  try { pre.setEnd(range.startContainer, range.startOffset); } catch (err) { return null; }
  return pre.toString().length;
}

function restoreCaretOffset(host, offset) {
  if (offset === null || offset === undefined) return false;
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let left = offset;
  while (node) {
    const len = node.nodeValue.length;
    if (left <= len) {
      const range = document.createRange();
      range.setStart(node, left);
      range.collapse(true);
      const sel = window.getSelection();
      if (!sel) return false;
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    }
    left -= len;
    node = walker.nextNode();
  }
  return false;
}

/* 条目 44：组合结束后统一补做——芯片重绑、欠下的整块替换、角标、欠下的保存。 */
function flushAfterComposition(blockId) {
  const node = blockId ? blockNodeById(blockId) : null;
  if (node) {
    const host = blockContentHost(node);
    bindFactChips(host);
    bindChipCaret(host);
  }
  const pending = imeState.pendingHtml;
  if (pending && (!blockId || pending.blockId === blockId)) {
    imeState.pendingHtml = null;
    applyBlockHtml(pending.blockId, pending.html, pending.sha);
  }
  if (imeState.pendingBadge) {
    const bid = imeState.pendingBadge;
    imeState.pendingBadge = null;
    showSavedBadge(bid);
  }
  if (imeState.pendingSave && imeState.pendingSave.isConnected) {
    const n = imeState.pendingSave;
    imeState.pendingSave = null;
    saveBlockNode(n);
  }
}

/* 条目 44：组合迟迟不结束的兜底——超过 5s 就撤掉「组合中」的标记，
   免得整页从此收不了正文；但不主动去收（那会把候选中的拼音写进 .tex）。 */
function clearStuckComposition() {
  imeState.stuckTimer = 0;
  if (!imeState.active) return;
  imeState.active = false;
  imeState.blockId = '';
  imeState.pendingSave = null;
}

function collectPlain(host) {
  /* 把块里的内容还原成「散文 + 占位符」的串（占位符＝保护面芯片自带 data-token）。 */
  let out = '';
  host.childNodes.forEach((node) => {
    if (node.nodeType === 3) { out += node.nodeValue; return; }
    if (node.nodeType !== 1) return;
    if (node.dataset && node.dataset.token) { out += node.dataset.token; return; }
    if (node.dataset && node.dataset.badge) { return; }   // 「已保存」角标不是正文
    out += collectPlain(node);
  });
  return out;
}

/* 渲染 html 里的保护面芯片数＝这份 DOM 是哪一版**结构**渲染出来的。
   块指纹（sha）管「哪一版内容」，芯片数管「哪一版结构」：账本变了（新事实的
   value 出现在正文里 → 同一段原文多出绑定数字令牌），同一段原文的保护面数量
   会变，占位符序号整体错位。客户端把它跟着一块儿报给服务端，对不上就拒写。 */
function countProtTokens(html) {
  if (!html) return 0;
  const hits = String(html).match(/data-token="/g);
  return hits ? hits.length : 0;
}

/* 块的 DOM 节点：优先按 id，再按块身份（data-block-id）。 */
function blockNodeById(blockId) {
  if (!blockId) return null;
  const byId = document.getElementById(blockId);
  if (byId && byId.dataset && byId.dataset.blockId) return byId;
  let probe = blockId;
  try { if (window.CSS && CSS.escape) probe = CSS.escape(blockId); } catch (err) { /* 原样查 */ }
  return document.querySelector('[data-block-id="' + probe + '"]');
}

/* 块的内容宿主：AI 草稿块的可编辑面是 .ai-draft-body，其余就是块本身。 */
function blockContentHost(node) {
  if (node && node.classList && node.classList.contains('ai-draft')) {
    return (node.querySelector('.ai-draft-body') || node);
  }
  return node;
}

/* 条目 43：把一个块的新鲜 html 原地换进内容宿主（外壳、id、身份属性不动，
   可编辑性跟内容一起恢复；芯片绑定重新挂）。 */
function applyBlockHtml(blockId, html, sha) {
  if (!html) return false;
  const node = blockNodeById(blockId);
  if (!node) return false;
  // 条目 44：组合进行中不动这一块——换了内容，候选里的拼音就断了。
  if (imeState.active && (!imeState.blockId || imeState.blockId === blockId)) {
    imeState.pendingHtml = { blockId: blockId, html: html, sha: sha || '' };
    return false;
  }
  const host = blockContentHost(node);
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const fresh = holder.firstElementChild;
  if (!fresh) return false;
  // 换成了服务端的新鲜内容 → 这一块不再有「未保存的编辑」。
  delete node.dataset.dirty;
  // 条目 44：整块替换前记下段内光标偏移，换完按偏移放回去（不甩回块首）。
  const caret = caretTextOffset(host);
  host.innerHTML = fresh.innerHTML;
  host.setAttribute('contenteditable', 'true');
  host.setAttribute('spellcheck', 'false');
  delete node.dataset.stale;
  bindFactChips(host);
  bindChipCaret(host);
  restoreCaretOffset(host, caret);
  // 块指纹＝「这份 DOM 是哪一版文件渲染出来的」。内容换成了服务端的新文，
  // 指纹这时才推进——推进了就等于告诉服务端「我这份 DOM 对得上当前文件」。
  if (sha) state.blockSha[blockId] = sha;
  state.blockTokens[blockId] = countProtTokens(html);
  return true;
}

/* 条目 43：保存一个块。node＝带 data-block-id 的可编辑块。 */
async function saveBlockNode(node) {
  if (!node || !node.isConnected) return;
  // 只有**真编辑过**的块才保存（脏标记由 input 事件打上）。
  // 刷新页面、打开盘、引擎自己写盘（last_opened 之类）都不是编辑——不碰盘。
  if (node.dataset.dirty !== '1') return;
  // 条目 44：组合进行中不收正文——此刻 DOM 里是候选中的拼音，收下去会写进 .tex。
  if (imeState.active) {
    imeState.pendingSave = node;
    return;
  }
  if (node.dataset.saving === '1') {
    // 在飞期间的再失焦：记一笔，本轮落定后补一轮保存（不丢字）。
    node.dataset.resave = '1';
    return;
  }
  const project = state.project;
  const disk = currentDisk();
  if (!project || !disk) return;
  const blockId = (node.dataset && node.dataset.blockId) || node.id || '';
  const file = (node.dataset && node.dataset.file) || '';
  if (!blockId) return;
  const sent = collectPlain(node);
  const body = { file: file, block: blockId, text: sent };
  const expect = state.blockSha[blockId] || '';
  if (expect) body.expect_sha = expect;
  // 结构闸：这份 DOM 是哪一版**结构**渲染出来的（几枚保护面芯片）。
  // 账本变了（新事实的 value 出现在正文里）→ 同一段原文的保护面数量变、
  // 占位符序号整体错位 → 服务端按旧序号重建就会改掉用户没打过的字。
  const expectTokens = state.blockTokens[blockId];
  if (expectTokens) body.expect_tokens = String(expectTokens);
  node.dataset.saving = '1';
  try {
    const res = await fetch(`/api/disk/${encodeURIComponent(project.id)}/${encodeURIComponent(disk.id)}/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch (err) { data = null; }
    if (res.status === 409 || (data && data.code === 'BLOCK_STALE')) {
      // 条目 43：这段在别处已被改动——未保存的字会丢，原地换上服务器的新文。
      toast(t('edit.stale'));
      await reloadBlocks();
      return;
    }
    if (!res.ok || !data || data.ok === false) {
      toast(t('err.saveFailed', { e: (data && data.error) || ('HTTP ' + res.status) }));
      return;
    }
    (data.warnings || []).forEach((w) => toast(w));
    toast(t('edit.saved'));
    // 存的是刚才那份正文：DOM 里若还是同一份，就撤掉「脏」标记
    //（用户在这轮保存期间又打了字 → 留着标记，下一轮失焦继续存）。
    const currentText = collectPlain(node);
    if (currentText === sent) delete node.dataset.dirty;
    // 自己先换成服务端重建的新文（被删的芯片按原文补回来了，DOM 要对齐）；
    // 用户在这轮保存期间又点回来打字 → 先不动，记 stale，等下一轮失焦保存。
    //
    // 块指纹（state.blockSha）只在**内容真的换成服务端新文**时才推进：
    // 指纹＝「这份 DOM 是哪一版文件渲染出来的」。用户还在这一块里打字时，
    // 整块重绘会吞掉新字，DOM 里留着的是**旧版**的保护面序号；这时若照样
    // 推进指纹，等于告诉服务端「我这份 DOM 对得上当前文件」，下一轮保存就
    // 会带着过期序号混过指纹闸，服务端按旧序号重建——用户没打过的字就此
    // 被改掉（实测：正文里的 0/3 被换成 \fact{E5}，凭空多出 0/2）。
    // 不推进 → 下一轮保存撞上指纹闸（409 BLOCK_STALE）→ 原地重载新文，
    // 不改内容。这正是这段代码注释里写明的安全网。
    const selfNode = blockNodeById(blockId);
    const activeNow = document.activeElement;
    const focused = !!(selfNode && activeNow && selfNode.contains(activeNow));
    if (focused && currentText !== sent && !imeState.active) {
      selfNode.dataset.stale = '1';
    } else {
      // 组合进行中：重绘会打断候选框里的拼音，applyBlockHtml 会把它延后到
      // 组合结束；指纹跟着这次延后的重绘一起推进（内容换了，指纹才换）。
      applyBlockHtml(blockId, (data.blocks && data.blocks[blockId]) || data.html,
                     data.sha);
    }
    // 条目 43：同文件其他块的新鲜 html 原地换；正被聚焦的块跳过，记 stale，
    // 它失焦保存若遇 BLOCK_STALE 走 reloadBlocks 对齐。
    const blocks = data.blocks || {};
    Object.keys(blocks).forEach((id) => {
      if (id === blockId) return;
      const live = blockNodeById(id);
      if (!live) return;
      const active = document.activeElement;
      if (active && live.contains(active)) { live.dataset.stale = '1'; return; }
      applyBlockHtml(id, blocks[id]);
    });
    showSavedBadge(blockId);
  } catch (err) {
    toast(t('err.saveFailed', { e: (err && err.message) || String(err) }));
  } finally {
    delete node.dataset.saving;
    if (node.dataset.resave === '1') {
      delete node.dataset.resave;
      if (node.isConnected) saveBlockNode(node);   // 补上在飞期间欠的那一轮
    }
  }
}

/* 条目 43：BLOCK_STALE 之后的原地重载——GET /sections 换回全盘新文（含 sha）。 */
async function reloadBlocks() {
  const project = state.project;
  const disk = currentDisk();
  if (!project || !disk) return;
  let data = null;
  try {
    data = await getJSON(`/api/disk/${encodeURIComponent(project.id)}/${encodeURIComponent(disk.id)}/sections`);
  } catch (err) {
    return;
  }
  const active = document.activeElement;
  (data.blocks || []).forEach((block) => {
    if (!block.id) return;
    const live = blockNodeById(block.id);
    if (live && active && live.contains(active)) {
      // 聚焦中的块不重绘 → 它那份 DOM 还是旧版本渲染的，块指纹**不能**推进
      // （推进了就等于让过期的保护面序号混过指纹闸，服务端按旧序号重建，
      // 用户没打过的字会被改掉）。留旧指纹：下一轮失焦保存撞指纹闸
      // （409 BLOCK_STALE）→ 原地重载对齐。
      live.dataset.stale = '1';
      return;
    }
    if (block.html) applyBlockHtml(block.id, block.html, block.sha);
    else if (block.sha) state.blockSha[block.id] = block.sha;
  });
  // 摘要走模型端点对齐（html＋sha 同源）；正在打字就不动它。
  const abBody = document.getElementById('coverAbstractBody');
  if (!(abBody && active && abBody.contains(active))) await loadAbstract();
}

/* 条目 43：段落菜单的「编辑」＝把光标落进那一块（页面本就是编辑器）。 */
function focusBlockNode(blockId) {
  const node = blockNodeById(blockId);
  if (!node) return;
  const host = blockContentHost(node);
  const editable = host.getAttribute('contenteditable') === 'true'
    ? host
    : (host.querySelector('[contenteditable="true"]') || host);
  editable.focus();
  const range = document.createRange();
  range.selectNodeContents(editable);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

/* 条目 36：把一个新块插到锚点之后（AI 草稿插入用）；插进来就能直接改。 */
function insertBlockAfter(anchorId, blockId, html, file) {
  const anchor = document.getElementById(anchorId);
  if (!anchor || !html) return false;
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const node = holder.firstElementChild;
  if (!node) return false;
  node.id = blockId;
  node.dataset.blockId = blockId;
  node.dataset.file = file || '';
  const editable = node.matches('p') ? node : (node.querySelector('p') || node);
  editable.classList.add('editable-para');
  editable.setAttribute('contenteditable', 'true');
  editable.setAttribute('spellcheck', 'false');
  anchor.after(node);
  bindFactChips(node);
  return true;
}

/* 条目 36：原地删掉一个块（AI 草稿删除用）。 */
function removeBlockNode(blockId) {
  const node = blockNodeById(blockId) || document.getElementById(blockId);
  if (!node) return false;
  const wrap = node.closest('.ai-draft') || node;
  wrap.remove();
  return true;
}

/* 条目 44：「已保存」角标改成挂在正文之外的浮层——原来插进编辑宿主内部，
   会把正文文本流顶出 "Saved" 三个字；组合进行中还会把光标甩进角标里
   （实测：下一次组合落到角标文本节点 offset 1）。 */
function showSavedBadge(blockId) {
  const node = blockNodeById(blockId);
  if (!node) return;
  // 组合进行中：先记账，组合结束后再挂（挂的动作要动编辑宿主附近的 DOM）。
  if (imeState.active && (!imeState.blockId || imeState.blockId === blockId)) {
    imeState.pendingBadge = blockId;
    return;
  }
  const host = blockContentHost(node);
  const badge = document.createElement('span');
  badge.className = 'save-badge';
  badge.dataset.badge = '1';
  badge.setAttribute('contenteditable', 'false');
  badge.textContent = t('edit.savedBadge');
  badge.style.visibility = 'hidden';
  document.body.appendChild(badge);
  let left = 0;
  let top = 0;
  try {
    const rect = host.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(host);
    range.collapse(false);
    const end = range.getBoundingClientRect();
    const endRight = end && (end.width || end.height) ? end.right : rect.right;
    const endTop = end && end.height ? end.top : rect.top;
    const endBottom = end && end.height ? end.bottom : rect.bottom;
    left = endRight + 6;
    top = endTop;
    // 末行顶到正文列右缘时，改塞进末行下方的空档——不出界、不压字。
    if (left + badge.offsetWidth > rect.right - 4) {
      left = Math.max(rect.left + 4, rect.right - badge.offsetWidth - 4);
      top = endBottom + 2;
    }
  } catch (err) {
    const rect = host.getBoundingClientRect();
    left = rect.left + 8;
    top = rect.top;
  }
  badge.style.left = Math.round(left + window.scrollX) + 'px';
  badge.style.top = Math.round(top + window.scrollY) + 'px';
  badge.style.visibility = '';
  setTimeout(() => { if (badge.parentNode) badge.remove(); }, 1500);
}

/* ---------------------------------------------------------------- 章节管理 */

async function loadAssembly() {
  const project = state.project;
  const disk = currentDisk();
  if (!project || !disk) { state.assembly = []; return; }
  try {
    const data = await getJSON(`/api/disk/${encodeURIComponent(project.id)}/${encodeURIComponent(disk.id)}/assembly`);
    state.assembly = data.entries || [];
  } catch (err) {
    state.assembly = [];
  }
  renderTocList();
}

async function tocAction(path, body, message) {
  const project = state.project;
  const disk = currentDisk();
  if (!project || !disk) return null;
  try {
    const result = await postJSON(`/api/disk/${encodeURIComponent(project.id)}/${encodeURIComponent(disk.id)}/${path}`, body);
    toast(message || t('toc.done'));
    await loadAssembly();
    await loadDisk();
    return result;
  } catch (err) {
    toast(t('err.tocFailed', { e: err.message }));
    return null;
  }
}

/* 改章节名：只动这一节的标题命令（\\section{…} 里那一段），别的字一个不改。
   指纹闸：客户端报它所基于的那一节的指纹，对不上就拒写（别覆盖别处的改动）。 */
function openRenameSection(btn) {
  state.renameTarget = {
    file: btn.dataset.rel || '',
    block: btn.dataset.block || '',
    sha: btn.dataset.sha || '',
  };
  const title = btn.closest('.toc-item');
  const nameEl = title ? title.querySelector('.cn, .en') : null;
  $('#rnTitle').value = nameEl ? nameEl.textContent : '';
  $('#modalRename').hidden = false;
  $('#rnTitle').focus();
  $('#rnTitle').select();
}

async function saveRenameSection() {
  const title = $('#rnTitle').value.trim();
  if (!title) { toast(t('toc.newTitle')); return; }
  const target = state.renameTarget;
  if (!target) return;
  $('#modalRename').hidden = true;
  state.renameTarget = null;
  await tocAction('toc/rename', {
    file: target.file, block: target.block, title: title,
    expect_sha: target.sha,
  }, t('toc.renameDone'));
}

function moveSection(rel, direction) {
  return tocAction('toc/move', { file: rel, direction: direction });
}

function deleteSection(rel) {
  if (!window.confirm(t('toc.delAsk'))) return;
  return tocAction('toc/delete', { file: rel });
}

function openNewSection() {
  $('#newSecTitle').value = '';
  $('#newSecSlug').value = '';
  $('#modalNew').hidden = false;
  $('#newSecTitle').focus();
}

async function createSection() {
  const title = $('#newSecTitle').value.trim();
  if (!title) { toast(t('toc.newTitle')); return; }
  const slug = $('#newSecSlug').value.trim();
  $('#modalNew').hidden = true;
  await tocAction('toc/create', { title: title, slug: slug });
}

/* ---------------------------------------------------------------- 插入事实

   保护面命令（\\fact{…}／\\cite{…}）手写很苦：正文里新写的这类命令会被服务端
   剥掉（不许凭空造账本绑定）。这里给一条省事的路：**从事实账里挑一条**，
   数字只能用账上的 value（服务端另有一道 value 硬闸把着），标记插在正文里
   那个数字后面。挑完即落盘（这一段是正文编辑，同正文一条通道）。 */

async function openFactInsert(target) {
  state.factInsert = {
    file: target.file || '',
    block: target.id || '',
    sha: state.blockSha[target.id] || '',
  };
  state.factRows = [];
  const search = $('#fiSearch');
  if (search) search.value = '';
  const list = $('#fiList');
  if (list) list.innerHTML = '<div class="ff-empty">' + esc(t('fact.insLoading')) + '</div>';
  $('#modalFactIns').hidden = false;
  const project = state.project;
  const disk = currentDisk();
  if (!project || !disk) return;
  try {
    const data = await getJSON(`/api/disk/${encodeURIComponent(project.id)}/${encodeURIComponent(disk.id)}/facts`);
    state.factRows = (data && data.rows) || [];
    renderFactInsertList();
  } catch (err) {
    if (list) list.innerHTML = '<div class="ff-empty">' + esc(t('fact.insFail', { e: err.message })) + '</div>';
  }
}

function renderFactInsertList() {
  const box = $('#fiList');
  if (!box) return;
  const search = $('#fiSearch');
  const q = ((search && search.value) || '').trim().toLowerCase();
  const rows = state.factRows.filter((r) => {
    if (!q) return true;
    const hay = ((r.id || '') + ' ' + (r.claim || '') + ' ' + (r.value || '')).toLowerCase();
    return hay.indexOf(q) >= 0;
  });
  if (!rows.length) {
    box.innerHTML = '<div class="ff-empty">' + esc(t('fact.insEmpty')) + '</div>';
    return;
  }
  box.innerHTML = rows.map((r) => `
    <button type="button" class="fi-row" data-fact="${esc(r.id || '')}">
      <span class="fi-id"><code>${esc(r.id || '')}</code></span>
      <span class="fi-claim">${esc(r.claim || '')}</span>
      <span class="fi-value"><code>${esc(r.value || '')}</code></span>
      <span class="fi-src" title="${esc(r.source_path || r.source_file || '')}">${esc(r.source_file || '')}</span>
    </button>`).join('');
  $$('#fiList [data-fact]').forEach((btn) => {
    btn.addEventListener('click', () => insertFactBinding(btn.dataset.fact));
  });
}

async function insertFactBinding(factId) {
  const target = state.factInsert;
  const project = state.project;
  const disk = currentDisk();
  if (!target || !project || !disk) return;
  try {
    const res = await postJSON(`/api/disk/${encodeURIComponent(project.id)}/${encodeURIComponent(disk.id)}/fact/insert`, {
      file: target.file,
      block: target.block,
      fact: factId,
      expect_sha: target.sha,
    });
    $('#modalFactIns').hidden = true;
    toast(t('fact.insDone'));
    // 插进去的事实标记是**新的保护面**：同文件的新鲜渲染原地换（芯片重绑）。
    const blocks = res.blocks || {};
    const shas = res.shas || {};
    Object.keys(blocks).forEach((id) => {
      applyBlockHtml(id, blocks[id], shas[id]);
    });
  } catch (err) {
    toast(t('fact.insFail', { e: (err && err.message) || String(err) }));
  }
}

/* ---------------------------------------------------------------- 项目表单 */

function openForm(mode, projectId) {
  const form = { mode: mode, project: projectId || '', disk: '' };
  state.form = form;
  $('#fvTitle').textContent = mode === 'edit' ? t('pf.editTitle') : t('pf.newTitle');
  $('#fvSub').textContent = mode === 'edit' ? t('pf.editSub') : t('pf.newSub');
  $('#pfTitle').value = '';
  $('#pfSlug').value = '';
  $('#pfJournal').value = '';
  $('#pfTemplate').value = '';
  $('#pfQuestion').value = '';
  $('#pfMsg').textContent = '';
  if (mode === 'edit') {
    const project = state.projects.find((p) => p.id === projectId);
    const disk = project && project.disks[0];
    if (!project || !disk) { toast(t('lang.none')); return; }
    form.disk = disk.id;
    $('#pfTitle').value = project.name || '';
    $('#pfSlug').value = disk.id;
    $('#pfSlug').disabled = true;
    $('#pfLang').value = disk.lang === 'zh' ? 'zh' : 'en';
    $('#pfLang').disabled = true;
    $('#pfDir').value = disk.project_dir || disk.id;
    $('#pfDir').readOnly = true;
    $('#pfDirHint').hidden = false;
    const reports = disk.reports_dir || ((disk.project_dir || disk.id) + '/reports');
    $('#pfReports').value = reports;
    $('#pfReports').readOnly = true;
    $('#pfReportsUnlock').hidden = false;
    $('#pfReportsReset').hidden = true;
  } else {
    $('#pfSlug').disabled = false;
    $('#pfLang').disabled = false;
    $('#pfLang').value = 'en';
    $('#pfDir').value = '';
    $('#pfDir').readOnly = false;
    $('#pfReports').value = '';
    $('#pfReports').readOnly = true;
    $('#pfReportsUnlock').hidden = false;
    $('#pfReportsReset').hidden = true;
  }
  setView('form');
}

function syncReportsDefault() {
  const dir = $('#pfDir').value.trim() || $('#pfSlug').value.trim();
  $('#pfReports').value = dir ? dir + '/reports' : '';
}

async function submitForm(event) {
  event.preventDefault();
  const title = $('#pfTitle').value.trim();
  const msg = $('#pfMsg');
  if (!title) { msg.textContent = t('pf.title'); return; }
  const body = {
    title: title,
    langs: [$('#pfLang').value === 'zh' ? 'zh' : 'en'],
    slug: $('#pfSlug').value.trim(),
    project_dir: $('#pfDir').value.trim(),
    reports_dir: $('#pfReports').value.trim(),
    journal: $('#pfJournal').value.trim(),
    template: $('#pfTemplate').value.trim(),
    question: $('#pfQuestion').value.trim(),
  };
  if ($('#pfLang').value === 'both') body.langs = ['en', 'zh'];
  try {
    if (state.form && state.form.mode === 'edit') {
      await postJSON('/api/project/update', {
        project: state.form.project,
        disk: state.form.disk,
        title: title,
        journal: body.journal,
        template: body.template,
        question: body.question,
        reports_dir: body.reports_dir,
      });
    } else {
      await postJSON('/api/project/new', body);
    }
    await loadProjects();
    setView('projects');
    toast(t('pf.created', { n: title }));
  } catch (err) {
    msg.textContent = err.message;
  }
}

/* =====================================================================
   段四：AI 对话（接真后端 /api/chat）＋ 实验报告导入（走真文件）
   ===================================================================== */

/* 后端约定的 fallback 标记：模拟回答的第一行必须是这一句。 */
const AI_FALLBACK_MARK = '模拟回答（未接模型）';

/* 这条接口永远 200；ok=false 表示「模型没接上」，不是请求失败。
   所以不能走 postJSON（它见 ok===false 就抛），要自己接。 */
/* v3：宿主 Agent 通道走 SSE（text/event-stream）——delta 增量、done 收尾；
   老后端（浏览器模式／workbench.toml 配的端点）照旧回 JSON，两种都吃。 */
async function postChat(body, onDelta) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: JSON.stringify(body || {}),
  });
  const kind = String(res.headers.get('content-type') || '');
  if (kind.indexOf('text/event-stream') >= 0) return readChatStream(res, onDelta);
  let data = null;
  try { data = await res.json(); } catch (err) { data = null; }
  if (!data) throw new Error('HTTP ' + res.status);
  return data;
}

/* 读 SSE：逐帧解 data: 行；delta 推给页面，done／error 收尾。 */
async function readChatStream(res, onDelta) {
  const reader = res.body && res.body.getReader ? res.body.getReader() : null;
  if (!reader) throw new Error('这个浏览器读不了流式回复');
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let final = null;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let cut = buffer.indexOf('\n\n');
    while (cut >= 0) {
      const frame = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      cut = buffer.indexOf('\n\n');
      const line = frame.split('\n')
        .filter((row) => row.indexOf('data:') === 0)
        .map((row) => row.slice(5).trim()).join('');
      if (!line) continue;
      let evt = null;
      try { evt = JSON.parse(line); } catch (err) { continue; }
      const type = String((evt && evt.type) || '');
      if (type === 'delta') {
        if (typeof onDelta === 'function') onDelta(String(evt.text || ''));
      } else if (type === 'done') {
        final = evt;
      } else if (type === 'error') {
        final = { ok: false, fallback: true, code: 'AGENT_ERROR', error: String(evt.message || '') };
      }
    }
  }
  if (!final) throw new Error('对话流中断了');
  return final;
}

/* ---------------------------------------------------------------- AI 对话 */

function aiCtxHtml() {
  const quote = state.ai.quote;
  if (!quote) return '';
  const head = quote.section ? t('ai.ctxHead', { sec: quote.section }) : t('ai.ctxHeadNone');
  return `<div class="ctx-h">${esc(head)}</div><div class="ctx-q">「${esc(quote.text || '')}」</div>`;
}

function renderAiCtx() {
  const el = $('#aiCtx');
  if (!el) return;
  el.innerHTML = aiCtxHtml();
  el.classList.toggle('on', !!state.ai.quote);
}

/* 追加一条气泡。fallback 的回复必须一眼看得出是模拟的。 */
function pushAiMsg(role, text, opts) {
  const host = $('#aiMsgs');
  if (!host) return null;
  const options = opts || {};
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + (role === 'user' ? 'me' : 'ai') + ' msg-js';
  if (options.fallback) wrap.classList.add('fb');
  if (options.waiting) wrap.classList.add('waiting');
  const who = document.createElement('div');
  who.className = 'who';
  who.textContent = role === 'user' ? t('ai.you') : 'AI';
  if (options.fallback) {
    const chip = document.createElement('span');
    chip.className = 'fb-chip';
    chip.textContent = t('ai.fbChip');
    who.appendChild(chip);
  }
  const bub = document.createElement('div');
  bub.className = 'bub';
  bub.textContent = text || '';
  wrap.appendChild(who);
  wrap.appendChild(bub);
  if (options.note) {
    const note = document.createElement('div');
    note.className = 'msg-note';
    note.textContent = options.note;
    wrap.appendChild(note);
  }
  /* 段六：回复卡带动作钮（复制／写进稿）。 */
  if (options.actions && options.actions.length) {
    const acts = document.createElement('div');
    acts.className = 'msg-acts';
    options.actions.forEach((act) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mact' + (act.kind ? ' ' + act.kind : '');
      btn.textContent = t(act.label);
      btn.addEventListener('click', () => {
        if (typeof act.onClick === 'function') act.onClick(text || '', btn);
      });
      acts.appendChild(btn);
    });
    wrap.appendChild(acts);
  }
  host.appendChild(wrap);
  host.scrollTop = host.scrollHeight;
  return wrap;
}

function clearAiConversation() {
  state.ai.messages = [];
  state.ai.quote = null;
  state.ai.seq += 1;      // 作废在途的请求回复
  state.ai.sessionId = ''; // v3：宿主 Agent 会话也从头开
  renderAiCtx();
  const host = $('#aiMsgs');
  if (!host) return;
  $$('.msg-js', host).forEach((el) => el.remove());
}

function setAiBusy(busy) {
  const send = $('#aiSend');
  if (send) {
    send.disabled = !!busy;
    send.textContent = busy ? t('ai.sending') : t('ai.send');
  }
  $$('#aiPane .aq').forEach((btn) => { btn.disabled = !!busy; });
}

function aiFallbackNote(data) {
  const code = (data && data.code) || '';
  const msg = (data && data.error) || '';
  const detail = [code, msg].filter(Boolean).join(' · ');
  return t('ai.fbNote', { d: detail ? ' · ' + detail : '' });
}

/* 两条都认：后端给的 fallback 标记，或回复第一行就是约定的那句标记。 */
function isFallbackReply(data, reply) {
  if (data && data.fallback) return true;
  const text = String(reply || '').replace(/^\s+/, '');
  return text.indexOf(AI_FALLBACK_MARK) === 0;
}

/* v3/v4：面板顶上标出这轮是谁答的（宿主 Agent＝MCode 模型／自定义模型／本地后端），
   后面跟上实际用的模型与思考等级。
   v5：徽标搬到面板顶上（.np-pane-h），不再挤在模型选择行前面像个看不懂的字段；
   还没答过时它不占位（页面开着别多一根「后端：—」）。 */
function setAiSource(kind, label) {
  state.ai.source = kind === 'agent' ? 'agent' : (kind === 'custom' ? 'custom' : 'engine');
  state.ai.sourceLabel = label || '';
  renderAiSource();
}

/* v5：渲染「这一轮是谁答的」徽标。切语言后要重画，所以单独成函数。 */
function renderAiSource() {
  const el = $('#aiSrc');
  if (!el) return;
  if (!state.ai.source) { el.hidden = true; el.textContent = ''; return; }
  const base = t(state.ai.source === 'agent' ? 'ai.srcAgent'
    : state.ai.source === 'custom' ? 'ai.srcCustom' : 'ai.srcEngine');
  const label = state.ai.sourceLabel || '';
  el.textContent = label ? base + ' · ' + label : base;
  el.className = 'ai-src ' + state.ai.source;
  el.hidden = false;
}

async function aiSend(question, mode, action) {
  if (state.ai.waiting) return;
  const q = String(question || '').trim();
  if (!q) return;
  if (!state.project) { toast(t('ai.noProject')); return; }
  pushAiMsg('user', q);
  state.ai.messages.push({ role: 'user', content: q });
  const wait = pushAiMsg('ai', t('ai.waiting'), { waiting: true });
  state.ai.waiting = true;
  setAiBusy(true);
  const seq = state.ai.seq;
  const useMode = mode === 'explain' ? 'explain' : (mode || state.ai.mode || 'paper');
  const useAction = action || 'ask';
  const quote = useMode === 'explain' ? null : (state.ai.quote || null);
  const payload = {
    project: state.project.id,
    disk: state.disk || '',
    messages: state.ai.messages.map((m) => ({ role: m.role, content: m.content })),
    quote: quote,
    mode: useMode,
    action: useAction,
    lang: state.lang === 'en' ? 'en' : 'zh',
  };
  // v3：宿主 Agent 通道——接着上一轮同一个会话（模型记得上文）。
  if (state.ai.sessionId) payload.sessionId = state.ai.sessionId;
  // v4：模型选择——宿主模型带思考等级；自定义模型走薄壳的 OpenAI 兼容通道；
  // 引擎本地后端仍走老的 model 字段（那边认的是模型名）。
  const entry = currentModelEntry();
  if (entry) {
    payload.modelSelection = { id: entry.id, effort: state.ai.effort || '' };
    if (entry.kind === 'engine' && entry.model) payload.model = entry.model;
  }
  try {
    const data = await postChat(payload, (chunk) => {
      // 增量：把「模型正在想…」那个气泡换成正在写的文本。
      if (!wait) return;
      const bub = wait.querySelector('.bub');
      if (!bub) return;
      wait.__text = (wait.__text || '') + chunk;
      bub.textContent = wait.__text;
      wait.classList.remove('waiting');
    });
    if (seq !== state.ai.seq) return;      // 期间清空过：这次回复作废
    if (wait && wait.parentNode) wait.parentNode.removeChild(wait);
    const reply = data && data.reply ? String(data.reply) : '';
    if (!reply) {
      pushAiMsg('ai', t('ai.empty'), { fallback: true, note: aiFallbackNote(data) });
      return;
    }
    const fallback = isFallbackReply(data, reply);
    // v3：记下这轮是谁答的——宿主 Agent（MCode 模型）还是本地后端。
    const source = String((data && data.source) || '');
    const isAgent = source === 'mcode-agent';
    const isCustom = source === 'custom-model';
    if (isAgent) state.ai.sessionId = String((data && data.sessionId) || '');
    // v4：徽标带上这一轮实际用的模型与思考等级（宿主说用哪个就显示哪个）。
    const usedModel = String((data && data.model) || '');
    const usedEffort = String((data && data.effort) || '');
    const usedLabel = usedModel
      ? usedModel + (usedEffort ? ' · ' + effortLabel(usedEffort) : '')
      : '';
    setAiSource(isAgent ? 'agent' : (isCustom ? 'custom' : 'engine'), usedLabel);
    const notes = Array.isArray(data && data.notes) ? data.notes : [];
    const denied = notes.filter((row) => String(row).indexOf('tools_denied:') === 0);
    /* 段六：段落三动作的回复带「复制」「写进稿」两枚钮。 */
    const actions = (useAction !== 'ask' && quote && quote.file)
      ? [
        { label: 'ai.copy', onClick: (text) => copyReply(text) },
        { label: 'ai.writeIn', kind: 'primary', onClick: (text) => writeIntoDraft(text) },
      ]
      : [];
    pushAiMsg('ai', reply, {
      fallback: fallback,
      note: fallback ? aiFallbackNote(data) : (denied.length ? t('ai.toolsDenied') : ''),
      actions: actions,
    });
    state.ai.messages.push({ role: 'assistant', content: reply });
  } catch (err) {
    if (seq !== state.ai.seq) return;
    if (wait && wait.parentNode) wait.parentNode.removeChild(wait);
    pushAiMsg('ai', t('ai.err', { e: (err && err.message) || String(err) }), { fallback: true });
  } finally {
    if (seq === state.ai.seq) {
      state.ai.waiting = false;
      setAiBusy(false);
    }
  }
}

/* 段六：复制回复（剪贴板不可用时明说，不假装复制过）。 */
async function copyReply(text) {
  const value = String(text || '');
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(value);
      toast(t('ai.copied'));
      return;
    }
  } catch (err) {
    toast(t('ai.copyFail', { e: (err && err.message) || String(err) }));
    return;
  }
  toast(t('ai.copyFail', { e: 'clipboard unavailable' }));
}

/* 段六 → v2：写进稿改道——不再直写稿，改成「建一张 ai_draft 提议单」。
   AI 面板从此没有直接改正文的口子：回复先落成待确认单，人到左栏徽标
   打开差异卡点「采纳写回」才写进正文（写回仍走后端那条保护链）。 */
async function writeIntoDraft(text) {
  const quote = state.ai.quote;
  if (!quote || !quote.file || !quote.id) {
    toast(t('ai.writeNoTarget'));
    return;
  }
  const body = String(text || '').trim();
  if (!body) { toast(t('ai.writeNoTarget')); return; }
  const path = proposalPath('');
  if (!path) { toast(t('ai.writeNoTarget')); return; }
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        kind: 'ai_draft',
        file: quote.file,
        block: quote.id,
        text: body,
        source: 'page',
      }),
    });
    let data = null;
    try { data = await res.json(); } catch (err) { data = null; }
    if (!res.ok || !data || data.ok === false) {
      toast(t('proposal.queueFail', { e: (data && data.error) || ('HTTP ' + res.status) }));
      return;
    }
    // 只建单，不碰正文：徽标数字跟着长起来。
    toast(t('proposal.queued'));
    await loadProposals();
  } catch (err) {
    toast(t('proposal.queueFail', { e: (err && err.message) || String(err) }));
  }
}

/* 段六：删掉一个 AI 草稿块。 */
async function deleteAiDraft(file, blockId) {
  const project = state.project;
  const disk = currentDisk();
  if (!project || !disk) return;
  const url = `/api/disk/${encodeURIComponent(project.id)}/${encodeURIComponent(disk.id)}/draft/delete`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ file: file, block: blockId }),
    });
    const data = await res.json();
    if (!res.ok || !data || data.ok === false) {
      toast(t('draft.delFail', { e: (data && data.error) || ('HTTP ' + res.status) }));
      return;
    }
    toast(t('draft.deleted'));
    // 条目 36：草稿块原地消失，不整篇重载。
    if (removeBlockNode(data.block || blockId)) return;
    await loadDisk();
  } catch (err) {
    toast(t('draft.delFail', { e: (err && err.message) || String(err) }));
  }
}

/* 段六：模式切换（聊想法／写论文）——两档的系统提示不同。 */
function setAiMode(mode) {
  const name = (mode === 'idea') ? 'idea' : 'paper';
  state.ai.mode = name;
  $$('#aiModes .ai-mode').forEach((btn) => {
    btn.classList.toggle('on', btn.dataset.mode === name);
  });
}

/* 「问 AI」带引用：切到 AI 页、带上下文、预填问题（人再按发送）。 */
function askAiAbout(text, section, id, file) {
  state.ai.quote = { text: String(text || ''), section: String(section || ''),
                     id: String(id || ''), file: String(file || '') };
  renderAiCtx();
  switchNavPane('ai');
  const input = $('#aiText');
  if (input) {
    input.value = t('ai.askPara');
    input.focus();
  }
}

/* 段落的悬浮工具条（原型同款）：不占正文排版，悬停段落才浮出来。 */
let paraAskTarget = null;
let paraToolsTimer = null;

function showParaTools(node) {
  const bar = $('#ptools');
  const page = $('#diskBody');
  if (!bar || !page) return;
  const r = node.getBoundingClientRect();
  const pr = page.getBoundingClientRect();
  bar.classList.add('on');
  const width = bar.offsetWidth || 64;
  let left = (r.right - pr.left) - width - 6;
  if (left > pr.width - width - 8) left = pr.width - width - 8;
  if (left < 4) left = 4;
  bar.style.left = left + 'px';
  bar.style.top = (r.top - pr.top + 2) + 'px';
}

function hideParaTools() {
  clearTimeout(paraToolsTimer);
  paraToolsTimer = setTimeout(() => {
    const bar = $('#ptools');
    if (bar) bar.classList.remove('on');
  }, 160);
}

/* 段落 → 悬浮工具条的绑定（原型同款：悬停段落才浮出「问 AI」）。 */
function bindParaTools(node, text, section, id, file) {
  node.addEventListener('mouseenter', () => {
    paraAskTarget = { text: text, section: section, id: id, file: file || '',
                      rect: node.getBoundingClientRect() };
    showParaTools(node);
  });
  node.addEventListener('mouseleave', hideParaTools);
}

/* 段六：段落 ⋯ 菜单（编辑 ＋ 续写／改写／提问）。 */
function closeParaMenu() {
  const menu = $('#paraMenu');
  if (menu) menu.hidden = true;
}

function openParaMenu() {
  const target = paraAskTarget;
  if (!target) return;
  const menu = $('#paraMenu');
  const page = $('#diskBody');
  if (!menu || !page) return;
  menu.hidden = false;
  const pr = page.getBoundingClientRect();
  const mr = menu.getBoundingClientRect();
  let left = 12;
  let top = 12;
  if (target.rect) {
    left = Math.min(Math.max(8, target.rect.left - pr.left), pr.width - mr.width - 8);
    top = Math.min(Math.max(8, target.rect.top - pr.top), pr.height - mr.height - 8);
  }
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
}

/* 段六：段落三动作——都走 /api/chat（带段落引用上下文，action 字段区分）。 */
async function paraAction(action) {
  const target = paraAskTarget;
  closeParaMenu();
  if (!target) return;
  const label = action === 'continue' ? t('ai.continueQ')
    : (action === 'rewrite' ? t('ai.rewriteQ') : t('ai.askQ'));
  state.ai.quote = { text: String(target.text || ''), section: String(target.section || ''),
                     id: String(target.id || ''), file: String(target.file || '') };
  renderAiCtx();
  switchNavPane('ai');
  await aiSend(label, state.ai.mode || 'paper', action);
}

/* ---------------------------------------------------------------- 实验报告 */

function reportsApiPath(suffix) {
  const project = state.project;
  if (!project) return null;
  return `/api/project/${encodeURIComponent(project.id)}/reports${suffix || ''}`;
}

function reportStatusLabel(report) {
  if (report && report.status_label) return String(report.status_label);
  const status = (report && report.status) || '';
  return status ? t('rp.st.' + status) : '—';
}

function reportFromLabel(report) {
  const from = (report && report.from) || '';
  if (from === 'import') return t('rp.from.import');
  return from ? String(from) : t('rp.from.unknown');
}

const REPORT_STATUS_CLS = {
  pending_check: 'rp-pending_check',
  signed: 'rp-signed',
  confirmed: 'rp-confirmed',
};

/* 段五：实验报告列表住进导航面板——只导入与删除，不在工作台里编辑报告内容。 */
function reportRowHtml(report) {
  const name = report.name || report.file || report.id || '';
  const file = report.file || '';
  const bound = Number(report.bound || 0);
  const cls = REPORT_STATUS_CLS[report.status || ''] || 'rp-pending_check';
  return `<div class="np-rp-row" data-rp="${esc(report.id || '')}">
    <div class="np-rp-main">
      <div class="np-rp-name" title="${esc(file)}">${esc(name)}</div>
      <div class="np-rp-meta">
        <span class="np-rp-chip ${cls}">${esc(reportStatusLabel(report))}</span>
        <span>${esc(t('rp.card.bound', { n: bound }))}</span>
        <span>${esc(report.time || '')}</span>
      </div>
    </div>
    <div class="np-rp-acts">
      <button type="button" class="np-rp-act" data-detail="${esc(report.id || '')}">${esc(t('rp.actDetail'))}</button>
      <button type="button" class="np-rp-del" data-del="${esc(report.id || '')}" title="${esc(t('rp.delAsk'))}">${esc(t('rp.card.del'))}</button>
    </div>
  </div>`;
}

function renderReports() {
  const list = $('#npReportsList');
  if (!list) return;
  if (!state.project) {
    list.innerHTML = `<div class="ff-empty">${esc(t('rp.noProject'))}</div>`;
    return;
  }
  if (state.reports.loading) {
    list.innerHTML = `<div class="ff-empty">${esc(t('rp.loadingReports'))}</div>`;
    return;
  }
  if (state.reports.error) {
    list.innerHTML = `<div class="ff-empty">${esc(t('rp.loadErrReports', { e: state.reports.error }))}</div>`;
    return;
  }
  const items = state.reports.list || [];
  if (!items.length) {
    list.innerHTML = `<div class="ff-empty">${esc(t('rp.reportsEmpty'))}</div>`;
    return;
  }
  list.innerHTML = items.map(reportRowHtml).join('');
  $$('#npReportsList [data-del]').forEach((btn) => {
    btn.addEventListener('click', (ev) => { ev.stopPropagation(); deleteReport(btn.dataset.del); });
  });
  $$('#npReportsList [data-detail]').forEach((btn) => {
    btn.addEventListener('click', (ev) => { ev.stopPropagation(); openReportDetail(btn.dataset.detail); });
  });
  $$('#npReportsList .np-rp-row').forEach((row) => {
    row.addEventListener('click', () => openReportDetail(row.dataset.rp || ''));
  });
}

/* 条目 35：实验报告详情模态（报告名＋状态＋来源文件/sha256＋绑定清单）。 */
async function openReportDetail(id) {
  if (!id) return;
  const modal = $('#modalRp');
  const title = $('#rpModalTitle');
  const body = $('#rpModalBody');
  if (!modal || !title || !body) return;
  const url = reportsApiPath('/detail') + '?name=' + encodeURIComponent(id);
  try {
    const data = await getJSON(url);
    title.textContent = data.name || id;
    const meta = [
      `<div class="kbd-kv"><span>${esc(t('rp.card.file'))}</span><span>${esc(data.report || data.file || '')}</span></div>`,
      `<div class="kbd-kv"><span>${esc(t('kb.sha'))}</span><code>${esc(data.report_sha256 || '—')}</code></div>`,
      `<div class="kbd-kv"><span>${esc(t('rp.card.time'))}</span><span>${esc(data.time || '')}</span></div>`,
    ];
    const rows = (data.facts || []).map((f) => `<tr>`
      + `<td class="rp-b-id">${esc(f.id || '')}</td>`
      + `<td class="rp-b-claim">${esc(f.claim || '')}</td>`
      + `<td class="rp-b-value">${esc(f.value || '')}</td></tr>`).join('');
    const table = rows
      ? `<table class="rp-b-table"><thead><tr><th>${esc(t('rp.id'))}</th><th>${esc(t('rp.claim'))}</th><th>${esc(t('rp.value'))}</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<p class="kbd-note">${esc(t('rp.detailEmpty'))}</p>`;
    body.innerHTML = `<div class="rp-d-status"><span class="np-rp-chip rp-pending_check">${esc(t('rp.st.pending_check'))}</span></div>`
      + meta.join('')
      + `<div class="kbd-title">${esc(t('rp.boundList'))}</div>` + table;
  } catch (err) {
    title.textContent = id;
    body.innerHTML = `<div class="kbd-note err">${esc((err && err.message) || String(err))}</div>`;
  }
  modal.dataset.report = id;
  modal.hidden = false;
}

async function loadReports() {
  const path = reportsApiPath('');
  if (!path) return;
  state.reports.loading = true;
  renderReports();
  try {
    const data = await getJSON(path);
    if (data && data.ok === false) throw new Error(data.error || 'REPORTS_FAILED');
    state.reports.list = (data && Array.isArray(data.reports)) ? data.reports : [];
    state.reports.error = '';
  } catch (err) {
    state.reports.list = [];
    state.reports.error = (err && err.message) || String(err);
  }
  state.reports.loading = false;
  renderReports();
}

/* 删除导入记录（草稿）：先确认，再走服务端；报告源文件不动。 */
async function deleteReport(id) {
  if (!id) return;
  const ok = await askConfirm({ title: t('rp.delConfirmTitle'),
                                body: t('rp.delConfirmBody'), okLabel: t('confirm.ok') });
  if (!ok) return;
  const path = reportsApiPath('/delete');
  if (!path) return;
  try {
    const result = await postJSON(path, { name: id });
    toast(t('rp.deleted'));
    if (result && result.source_file) {
      toast(t('rp.deletedFile', { f: result.source_file }));
    }
    await loadReports();
  } catch (err) {
    toast(t('rp.noDelete', { e: (err && err.message) || String(err) }));
  }
}

/* 条目 35：通用确认模态（删除前问一句；Esc/遮罩/取消都算「不删」）。 */
let confirmResolver = null;

function askConfirm(opts) {
  const modal = $('#modalConfirm');
  const title = $('#cfTitle');
  const body = $('#cfBody');
  const ok = $('#cfOk');
  if (!modal || !title || !body || !ok) return Promise.resolve(false);
  const conf = opts || {};
  title.textContent = conf.title || '';
  body.textContent = conf.body || '';
  ok.textContent = conf.okLabel || t('confirm.ok');
  modal.hidden = false;
  return new Promise((resolve) => { confirmResolver = resolve; });
}

function closeConfirm(result) {
  const modal = $('#modalConfirm');
  if (modal) modal.hidden = true;
  const fn = confirmResolver;
  confirmResolver = null;
  if (typeof fn === 'function') fn(!!result);
}

/* ---------------------------------------------------------------- 导入向导 */

function wzDraftName(file) {
  const name = String(file || '');
  return name.replace(/\.[^.]+$/, '') + '.draft.toml';
}

async function openWizard() {
  if (!state.project) { toast(t('rp.idle')); return; }
  state.wz = {
    step: 1, file: '', fileSize: 0, files: [], rows: [], failed: [],
    suggested: [], sha: '', busy: false, parseError: '',
  };
  const modal = $('#wizardModal');
  if (modal) modal.hidden = false;
  renderWz();
  await loadWzDir();
}

function closeWizard() {
  const modal = $('#wizardModal');
  if (modal) modal.hidden = true;
}

async function loadWzDir() {
  const path = reportsApiPath('/dir');
  if (!path) return;
  try {
    const data = await getJSON(path);
    if (data && data.ok === false) throw new Error(data.error || 'REPORTS_DIR_FAILED');
    state.wz.files = (data && Array.isArray(data.files)) ? data.files : [];
  } catch (err) {
    state.wz.files = [];
    toast(t('wz.s1.upErr', { e: (err && err.message) || String(err) }));
  }
  // 刚上传的文件可能还没进目录列表：自己补一条，别把选中状态弄丢。
  if (state.wz.file && !state.wz.files.some((f) => f.name === state.wz.file)) {
    state.wz.files = [{ name: state.wz.file, size: state.wz.fileSize || 0, mtime: '' }].concat(state.wz.files);
  }
  renderWz();
}

function renderWz() {
  const step = state.wz.step;
  $$('.wstep').forEach((s) => {
    const n = Number(s.getAttribute('data-ws'));
    s.classList.toggle('on', n === step);
    s.classList.toggle('done', n < step);
  });
  ['#wpane1', '#wpane2', '#wpane3'].forEach((sel, i) => {
    const pane = $(sel);
    if (pane) pane.classList.toggle('on', i === step - 1);
  });
  const back = $('#wzBack');
  if (back) back.disabled = step === 1;
  const next = $('#wzNext');
  if (next) {
    next.textContent = step === 3 ? t('wz.confirm') : t('wz.next');
    next.disabled = (step === 1 && !state.wz.file) || (step === 2 && !state.wz.rows.length);
  }
  if (step === 1) renderWzFiles();
  if (step === 2) renderWzRows();
  if (step === 3) renderWzSummary();
}

function renderWzFiles() {
  const host = $('#wzFiles');
  if (!host) return;
  const files = state.wz.files || [];
  if (!files.length) {
    host.innerHTML = `<div class="ff-empty">${esc(t('wz.s1.empty'))}</div>`;
    return;
  }
  host.innerHTML = files.map((f) => {
    const checked = f.name === state.wz.file ? ' checked' : '';
    const meta = t('wz.s1.meta', { size: Number(f.size || 0), mtime: f.mtime || '—' });
    return `<label class="wz-file"><input type="radio" name="wzf" value="${esc(f.name)}"${checked}>` +
      `<span class="rf-n">${esc(f.name)}</span><span class="rf-s">${esc(meta)}</span></label>`;
  }).join('');
}

function renderWzRows() {
  const failedBox = $('#wzFailed');
  const failed = state.wz.failed || [];
  if (failedBox) {
    if (failed.length) {
      failedBox.hidden = false;
      failedBox.innerHTML = `<div class="wz-failed-h">${esc(t('wz.failed'))}</div>` + failed.map((f) => {
        const line = (f && f.line !== undefined && f.line !== null) ? String(f.line) : '';
        return `<div class="wz-failed-row"><span class="wz-f-line">${esc(line)}</span>` +
          `<span class="wz-f-raw">${esc(String((f && f.raw) || ''))}</span>` +
          `<span class="wz-f-err">${esc(String((f && f.error) || ''))}</span></div>`;
      }).join('');
    } else {
      failedBox.hidden = true;
      failedBox.innerHTML = '';
    }
  }
  const status = $('#wzStatus');
  const body = $('#wzRows');
  const table = $('#wzMapTable');
  if (!body || !table) return;
  const rows = state.wz.rows || [];
  if (!rows.length) {
    table.hidden = true;
    if (status) status.innerHTML = `<div class="ff-empty">${esc(state.wz.parseError || t('wz.s2.empty'))}</div>`;
    return;
  }
  table.hidden = false;
  if (status) status.innerHTML = '';
  const targets = [];
  (state.wz.suggested || []).forEach((s) => {
    const tgt = (s && s.target) ? String(s.target) : '';
    if (tgt && targets.indexOf(tgt) < 0) targets.push(tgt);
  });
  body.innerHTML = rows.map((row, i) => {
    const opts = [`<option value="">${esc(t('wz.skip'))}</option>`].concat(
      targets.map((tgt) => `<option value="${esc(tgt)}"${tgt === row.target ? ' selected' : ''}>${esc(tgt)}</option>`)
    ).join('');
    return `<tr>
      <td><input class="wz-in" type="text" data-row="${i}" data-f="id" value="${esc(row.id)}"></td>
      <td><input class="wz-in" type="text" data-row="${i}" data-f="claim" value="${esc(row.claim)}"></td>
      <td><input class="wz-in" type="text" data-row="${i}" data-f="value" value="${esc(row.value)}"></td>
      <td><select class="wzsel" data-row="${i}" data-f="target">${opts}</select></td>
    </tr>`;
  }).join('');
}

function renderWzSummary() {
  const host = $('#wzSummary');
  if (!host) return;
  const rows = state.wz.rows || [];
  const mapped = rows.filter((r) => r.target).length;
  const skipped = rows.length - mapped;
  const disk = currentDisk();
  const lines = [];
  lines.push(`${esc(t('wz.sum.file'))} <code>${esc(state.wz.file || '')}</code>`);
  if (state.wz.sha) lines.push(`${esc(t('wz.sum.sha'))} <code>${esc(state.wz.sha)}</code>`);
  lines.push(`${esc(t('wz.sum.mapped'))} ${mapped} / ${rows.length}`);
  lines.push(`${esc(t('wz.sum.skip'))} ${skipped}`);
  lines.push(`${esc(t('wz.sum.disk'))} <code>${esc(disk ? disk.id : '—')}</code>`);
  lines.push(`${esc(t('wz.sum.project'))} <code>${esc(state.project ? state.project.id : '')}</code>`);
  lines.push(`<b>${esc(t('wz.draftNote', { path: 'facts/draft/' + wzDraftName(state.wz.file) }))}</b>`);
  host.innerHTML = lines.join('<br>');
}

async function parseReport() {
  const path = reportsApiPath('/parse');
  if (!path) return;
  const status = $('#wzStatus');
  const body = $('#wzRows');
  const table = $('#wzMapTable');
  if (table) table.hidden = true;
  if (status) status.innerHTML = `<div class="ff-empty">${esc(t('wz.s2.loading'))}</div>`;
  if (body) body.innerHTML = '';
  try {
    const data = await postJSON(path, { name: state.wz.file });
    const suggested = (data && Array.isArray(data.suggested)) ? data.suggested : [];
    const targets = {};
    suggested.forEach((s) => { if (s && s.id) targets[String(s.id)] = s.target ? String(s.target) : ''; });
    const rows = (data && Array.isArray(data.rows)) ? data.rows : [];
    state.wz.rows = rows.map((r) => {
      const id = (r && r.id !== undefined && r.id !== null) ? String(r.id) : '';
      return {
        id: id,
        claim: (r && r.claim !== undefined && r.claim !== null) ? String(r.claim) : '',
        value: (r && r.value !== undefined && r.value !== null) ? String(r.value) : '',
        source: (r && r.source) ? String(r.source) : '',
        line: (r && r.line !== undefined) ? r.line : null,
        target: targets[id] || '',
      };
    });
    state.wz.failed = (data && Array.isArray(data.failed)) ? data.failed : [];
    state.wz.suggested = suggested;
    state.wz.sha = (data && data.sha256) ? String(data.sha256) : '';
    state.wz.parseError = '';
  } catch (err) {
    state.wz.rows = [];
    state.wz.failed = [];
    state.wz.parseError = t('wz.s2.err', { e: (err && err.message) || String(err) });
  }
  renderWz();
}

async function confirmImport() {
  const path = reportsApiPath('/confirm');
  if (!path) return;
  const source = state.wz.rows || [];
  const rows = source.map((r) => ({
    id: r.id, claim: r.claim, value: r.value, source: r.source, line: r.line,
  }));
  const mapping = {};
  source.forEach((r) => { mapping[r.id] = r.target || ''; });
  const name = state.wz.file;
  try {
    const data = await postJSON(path, {
      name: name,
      report_name: name.replace(/\.[^.]+$/, ''),
      rows: rows,
      mapping: mapping,
    });
    closeWizard();
    toast(t('wz.done', { n: Number((data && data.count) || rows.length), path: (data && data.draft_path) || '' }));
    await loadReports();
  } catch (err) {
    toast(t('wz.fail', { e: (err && err.message) || String(err) }));
  }
}

async function onWzUpload(ev) {
  const input = ev.target;
  const file = input.files && input.files[0];
  if (!file) return;
  const path = reportsApiPath('/upload');
  if (!path) return;
  const nameEl = $('#wzUpName');
  if (nameEl) nameEl.textContent = t('wz.s1.uploading');
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await fetch(path, { method: 'POST', body: fd, headers: { 'Accept': 'application/json' } });
    let data = null;
    try { data = await res.json(); } catch (err) { data = null; }
    if (!data || data.ok === false) throw new Error((data && data.error) || ('HTTP ' + res.status));
    state.wz.file = data.name ? String(data.name) : file.name;
    state.wz.fileSize = Number(data.size || file.size || 0);
    if (nameEl) nameEl.textContent = state.wz.file;
    await loadWzDir();
  } catch (err) {
    if (nameEl) nameEl.textContent = t('wz.s1.upErr', { e: (err && err.message) || String(err) });
  } finally {
    input.value = '';
  }
}

function onWzRowEdit(ev) {
  const el = ev.target;
  if (!el || el.dataset.row === undefined || !el.dataset.f) return;
  const row = (state.wz.rows || [])[Number(el.dataset.row)];
  if (!row) return;
  row[el.dataset.f] = el.value;
}

/* ---------------------------------------------------------------- 追加事实表单 */

/* 两步表单：① 挑产物——只列本盘真实存在的文件（人签清单里的那组、没进清单
   的另一组），没有手打 source 路径的入口，hash 由工具现算；② 说清这条数字
   并落到哪本账。
   走提议单通道：这里只建单，落盘由人在差异卡上点「采纳写回」。 */

const AF_ROW_LIMIT = 120;

function afApiPath(suffix) {
  const project = state.project;
  const disk = currentDisk();
  if (!project || !disk) return null;
  return '/api/disk/' + encodeURIComponent(project.id) + '/'
    + encodeURIComponent(disk.id) + '/fact-form' + (suffix || '');
}

async function openFactForm() {
  if (!state.project) { toast(t('rp.idle')); return; }
  state.af = {
    step: 1, data: null, catalog: {}, signed: [], unsigned: [], ledgers: [],
    selected: '', query: '', ledger: '',
  };
  const modal = $('#modalFact');
  if (modal) modal.hidden = false;
  ['#afId', '#afClaim', '#afValue', '#afLocator', '#afNote'].forEach((sel) => {
    const el = $(sel);
    if (el) el.value = '';
  });
  const conf = $('#afConfidence');
  if (conf) conf.value = 'med';
  const newInput = $('#afNewLedger');
  if (newInput) newInput.value = '';
  renderFactForm();
  await loadFactForm();
}

function closeFactForm() {
  const modal = $('#modalFact');
  if (modal) modal.hidden = true;
}

async function loadFactForm() {
  const path = afApiPath('');
  if (!path) return;
  try {
    const data = await getJSON(path);
    state.af.data = data || {};
    state.af.catalog = (data && data.i18n) || {};
    state.af.signed = (data && Array.isArray(data.signed)) ? data.signed : [];
    state.af.unsigned = (data && Array.isArray(data.unsigned)) ? data.unsigned : [];
    state.af.ledgers = (data && Array.isArray(data.ledgers)) ? data.ledgers : [];
  } catch (err) {
    toast(t('ff.loadFail', { e: (err && err.message) || String(err) }));
  }
  renderFactForm();
}

function afMatches(path) {
  const q = (state.af.query || '').trim().toLowerCase();
  if (!q) return true;
  return String(path || '').toLowerCase().indexOf(q) >= 0;
}

function renderFactForm() {
  if (!state.af) return;
  const step = state.af.step;
  $$('.wstep[data-fs]').forEach((s) => {
    const n = Number(s.getAttribute('data-fs'));
    s.classList.toggle('on', n === step);
    s.classList.toggle('done', n < step);
  });
  const p1 = $('#fpane1');
  const p2 = $('#fpane2');
  if (p1) p1.classList.toggle('on', step === 1);
  if (p2) p2.classList.toggle('on', step === 2);
  const back = $('#afBack');
  if (back) back.disabled = step === 1;
  const next = $('#afNext');
  if (next) {
    next.textContent = step === 1 ? t('ff.next') : t('ff.create');
    next.disabled = step === 1 ? !state.af.selected : !state.af.ledger;
  }
  if (step === 1) renderAfSources();
  if (step === 2) renderAfDetail();
}

function renderAfSources() {
  const data = state.af.data || {};
  const notes = $('#afNotes');
  if (notes) {
    const text = renderParts(data.notes || [], state.af.catalog, data.notes_text || '');
    notes.innerHTML = text
      ? '<div class="af-note">' + esc(text).split('\n').join('<br>') + '</div>'
      : '';
  }
  const signedHost = $('#afSigned');
  const unsignedHost = $('#afUnsigned');
  const signedRows = state.af.signed.filter((row) => afMatches(row.path));
  const unsignedRows = state.af.unsigned.filter((row) => afMatches(row));
  if (signedHost) signedHost.innerHTML = afRowsHtml(signedRows, afSignedRowHtml);
  // 未签产物默认**折叠**（「搜索未签产物」区域）：没打开就不渲染那几百上千条。
  const fold = $('#afUnsignedFold');
  const open = fold ? fold.open : true;
  if (unsignedHost) {
    unsignedHost.innerHTML = open
      ? afRowsHtml(unsignedRows, afUnsignedRowHtml)
      : '';
  }
}

function afRowsHtml(rows, render) {
  if (!rows.length) return '<div class="ff-empty">' + esc(t('ff.g.empty')) + '</div>';
  const shown = rows.slice(0, AF_ROW_LIMIT);
  let html = shown.map(render).join('');
  if (rows.length > shown.length) {
    html += '<div class="af-more">'
      + esc(t('ff.more', { n: rows.length, shown: shown.length })) + '</div>';
  }
  return html;
}

function afSignedRowHtml(row) {
  const path = String(row.path || '');
  const picked = path === state.af.selected;
  let badge = t('ff.badge.signed');
  let bcls = 'af-badge ok';
  if (row.missing) { badge = t('ff.badge.missing'); bcls = 'af-badge err'; }
  else if (row.drift) { badge = t('ff.badge.drift'); bcls = 'af-badge warn'; }
  const want = String(row.sha256 || '');
  const live = String(row.live_sha256 || '');
  const sha = (live || want).slice(0, 12);
  // 清单里的 sha256 与现算的 sha256 都摆出来（漂了要说清是哪两个）。
  const title = want
    ? t('ff.sha.manifest') + ': ' + want + '\n' + t('ff.sha.live') + ': ' + (live || '—')
    : '';
  return '<label class="af-row' + (picked ? ' on' : '') + '">'
    + '<input type="radio" name="afs" value="' + esc(path) + '"' + (picked ? ' checked' : '') + '>'
    + '<span class="af-path" title="' + esc(path) + '">' + esc(path) + '</span>'
    + (sha ? '<code class="af-sha" title="' + esc(title) + '">' + esc(sha) + '</code>' : '')
    + '<span class="' + bcls + '">' + esc(badge) + '</span></label>';
}

function afUnsignedRowHtml(path) {
  const p = String(path || '');
  const picked = p === state.af.selected;
  return '<label class="af-row' + (picked ? ' on' : '') + '">'
    + '<input type="radio" name="afs" value="' + esc(p) + '"' + (picked ? ' checked' : '') + '>'
    + '<span class="af-path" title="' + esc(p) + '">' + esc(p) + '</span>'
    + '<span class="af-badge">' + esc(t('ff.badge.unsigned')) + '</span></label>';
}

function afStyleLabel() {
  const style = String((state.af.data || {}).ledger_style || '');
  if (style === 'letter_topic') return t('ff.style.letter_topic');
  if (style === 'index_topic') return t('ff.style.index_topic');
  return t('ff.style.unknown');
}

function renderAfDetail() {
  const data = state.af.data || {};
  const src = $('#afSrc');
  if (src) {
    src.innerHTML = state.af.selected
      ? '<span>' + esc(t('ff.src')) + '</span> <code>' + esc(state.af.selected) + '</code>'
      : '';
  }
  const hint = $('#afLedgerHint');
  if (hint) hint.textContent = t('ff.ledger.style', { style: afStyleLabel() });
  const host = $('#afLedgers');
  if (host) {
    const rows = state.af.ledgers.map((row) => {
      const path = String(row.path || '');
      const picked = path === state.af.ledger;
      return '<label class="af-row' + (picked ? ' on' : '') + '">'
        + '<input type="radio" name="aflg" value="' + esc(path) + '"' + (picked ? ' checked' : '') + '>'
        + '<span class="af-path" title="' + esc(path) + '">' + esc(path) + '</span>'
        + '<span class="af-sha">' + esc(t('ff.ledger.facts', { n: Number(row.facts || 0) })) + '</span>'
        + '</label>';
    });
    rows.push('<label class="af-row">'
      + '<input type="radio" name="aflg" value="__new__"'
      + (state.af.ledger === '__new__' ? ' checked' : '') + '>'
      + '<span class="af-path">' + esc(t('ff.ledger.new')) + '</span></label>');
    host.innerHTML = rows.join('');
  }
  const newInput = $('#afNewLedger');
  if (newInput) {
    const isNew = state.af.ledger === '__new__';
    newInput.hidden = !isNew;
    newInput.placeholder = t('ff.ledger.newPh', { name: String(data.ledger_style_example || '') });
  }
}

function onAfSourcePick(ev) {
  const input = ev.target;
  if (!input || input.name !== 'afs') return;
  state.af.selected = String(input.value || '');
  $$('#afSigned .af-row, #afUnsigned .af-row').forEach((row) => {
    const radio = row.querySelector('input[name="afs"]');
    row.classList.toggle('on', !!radio && radio.checked);
  });
  const next = $('#afNext');
  if (next) next.disabled = !state.af.selected;
}

function onAfLedgerPick(ev) {
  const input = ev.target;
  if (!input || input.name !== 'aflg') return;
  state.af.ledger = String(input.value || '');
  // 别整段重画账本列表：正在点的那个 radio 会被换掉，
  // 界面就回读不到自己的选中态了（写操作变成「不知道落没落」）。
  // 只切高亮与新建输入框的显隐。
  $$('#afLedgers .af-row').forEach((row) => {
    const radio = row.querySelector('input[name="aflg"]');
    row.classList.toggle('on', !!radio && radio.checked);
  });
  const data = state.af.data || {};
  const newInput = $('#afNewLedger');
  if (newInput) {
    const isNew = state.af.ledger === '__new__';
    newInput.hidden = !isNew;
    newInput.placeholder = t('ff.ledger.newPh', { name: String(data.ledger_style_example || '') });
  }
  const next = $('#afNext');
  if (next) next.disabled = !state.af.ledger;
}

/* facts 的 glob 里第一个通配符之前的目录（"facts/*.toml" → facts）。 */
function afGlobDir(glob) {
  const g = String(glob || '');
  const i = g.indexOf('*');
  let dir = i >= 0 ? g.slice(0, i) : g;
  while (dir.endsWith('/')) dir = dir.slice(0, dir.length - 1);
  return dir;
}

/* 新建账本文件：名字由人给，但样式与前缀得守本盘的规矩——
   规矩（正则、已用前缀）由服务端随表单一起下发，页面先照它校验一遍，
   服务端仍然是唯一权威（它会再拒一次）。 */
function afResolveNewLedger() {
  const data = state.af.data || {};
  const input = $('#afNewLedger');
  const raw = String((input && input.value) || '').trim();
  if (!raw) return { ok: false, reason: 'empty' };
  const lower = raw.toLowerCase();
  const hasExt = lower.endsWith('.toml');
  const name = hasExt ? raw : (raw + '.toml');
  const stem = hasExt ? raw.slice(0, raw.length - 5) : raw;
  const pattern = String(data.ledger_style_pattern || '');
  let rx = null;
  try { if (pattern) rx = new RegExp(pattern); } catch (err) { rx = null; }
  if (rx) {
    const m = rx.exec(stem);
    if (!m) return { ok: false, reason: 'style' };
    const used = (data.ledger_used_prefixes || []).map(String);
    if (used.indexOf(String(m[1])) >= 0) return { ok: false, reason: 'prefix' };
  }
  const dir = afGlobDir(data.ledger_glob);
  return { ok: true, path: (dir ? dir + '/' : '') + name };
}

/* 服务端错因：先按目录翻语言（EN 不留中文），翻不出来才回落到原话。 */
function afErrorText(data) {
  const code = (data && data.err_code) ? String(data.err_code) : '';
  if (code) {
    const entry = (state.af.catalog || {})['wb.form.fact.err.' + code];
    if (entry) {
      const text = entry[state.lang] || entry.zh;
      // 槽位（value／产物／没找到的数字／定位）由服务端带过来，按语言填。
      if (text) return fillParts(text, (data && data.err_params) || {});
    }
  }
  return String((data && data.error) || 'HTTP error');
}

async function submitFactProposal() {
  const id = String(($('#afId') || {}).value || '').trim();
  const claim = String(($('#afClaim') || {}).value || '').trim();
  const value = String(($('#afValue') || {}).value || '').trim();
  const locator = String(($('#afLocator') || {}).value || '').trim();
  const note = String(($('#afNote') || {}).value || '').trim();
  const confidence = String(($('#afConfidence') || {}).value || 'med');
  if (!id || !claim || !value) { toast(t('ff.needFields')); return; }
  if (!state.af.selected) { toast(t('ff.needSource')); return; }
  if (!state.af.ledger) { toast(t('ff.needLedger')); return; }
  let ledger = state.af.ledger;
  if (ledger === '__new__') {
    const resolved = afResolveNewLedger();
    if (!resolved.ok) {
      toast(t(resolved.reason === 'prefix' ? 'ff.prefixBad' : 'ff.nameBad'));
      return;
    }
    ledger = resolved.path;
  }
  const path = proposalPath('');
  if (!path) { toast(t('ff.needLedger')); return; }
  const body = {
    kind: 'add_fact',
    source: 'page',
    fact: {
      id: id, claim: claim, value: value,
      source: state.af.selected,
      locator: locator, confidence: confidence, note: note,
      ledger: ledger,
    },
  };
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch (err) { data = null; }
    if (!res.ok || !data || data.ok === false) {
      toast(t('ff.fail', { e: afErrorText(data) }));
      return;
    }
    closeFactForm();
    toast(t('ff.created'));
    await loadProposals();
  } catch (err) {
    toast(t('ff.fail', { e: (err && err.message) || String(err) }));
  }
}

async function onFactNext() {
  if (!state.af) return;
  if (state.af.step === 1) {
    if (!state.af.selected) { toast(t('ff.needSource')); return; }
    state.af.step = 2;
    renderFactForm();
    return;
  }
  await submitFactProposal();
}


/* ---------------------------------------------------------------- 交互 */

function setView(view) {
  document.body.setAttribute('data-view', view);
  if (view === 'projects') {
    $('#tocList').innerHTML = '';
    $('#bodyBlocks').innerHTML = '';
    state.assembly = [];
  }
  // 段落悬浮工具条只在正文里用。
  const bar = $('#ptools');
  if (bar) bar.classList.remove('on');
  // 条目 33：左栏头部的常用功能组（PDF/全检/导出/开目录/待确认）
  // 只在 workbench 视图渲染；项目列表/新建视图整组不渲染。
  // 中/EN 不在这组里——它是界面语言开关，常显（见 #lhLang）。
  const tools = $('#lhTools');
  if (tools) tools.hidden = (view !== 'workbench');
  scheduleHeaderWidthSync();
  applyLangToggle();
}

/* 中/EN 切换常显——它同时是界面语言开关（workbench 里顺带切盘）。
   它独立在 #lhLang 里，不属于 #lhTools，所以项目列表视图里也照样能切界面语言。 */
function applyLangToggle() {
  const seg = $('#langSeg');
  if (!seg) return;
  $$('#langSeg button').forEach((btn) => {
    btn.classList.toggle('on', btn.dataset.lang === state.lang);
  });
}

/* 段五返修八（条目 34）：右栏工具条＝三枚切换钮（目录／智能助手／更多）。
   三面互斥；智能助手＝侧栏里的嵌入式对话面板（不再是浮层）。
   已激活再点「智能助手」＝无操作（收起整个侧栏用最左的图标收起钮）。 */
function switchNavPane(name) {
  if (name === 'ai' && state.nav.pane === 'ai') return;
  state.nav.pane = name;
  $('#paneToc').classList.toggle('on', name === 'toc');
  $('#paneAi').classList.toggle('on', name === 'ai');
  $('#paneMore').classList.toggle('on', name === 'more');
  $('#npToc').classList.toggle('on', name === 'toc');
  $('#npAi').classList.toggle('on', name === 'ai');
  $('#npMore').classList.toggle('on', name === 'more');
  if (name === 'ai') renderAiFace();
  // 条目 33：实验报告／知识库／版式都并进「更多」这一面，切过去就把三段都拉起来。
  if (name === 'more') {
    loadReports();
    loadKb();
    loadVenue();
    loadCitations();
    loadAssets();
  }
}

/* 面板里的智能助手面：条目 34 起助手就在侧栏面板里，这里只刷引用上下文。
   条目 42：顺带把模型下拉按当前 project+disk 刷一遍（同一组只拉一次）。 */
function renderAiFace() {
  renderAiCtx();
  refreshAiModels();
}

/* v4：思考等级的中英文说法；认不出来的档位原样显示（不编）。 */
const AI_EFFORT_KEYS = {
  default: 'ai.effortLevelDefault',
  off: 'ai.effortOff', none: 'ai.effortNone', minimal: 'ai.effortMinimal', low: 'ai.effortLow',
  medium: 'ai.effortMedium', high: 'ai.effortHigh', xhigh: 'ai.effortXhigh', max: 'ai.effortMax',
};

function effortLabel(level) {
  const text = String(level || '');
  const key = AI_EFFORT_KEYS[text];
  return key ? t(key) : text;
}

/* v4：清单条目归一。后端两种形状都吃：薄壳给的是对象
   （{id,kind,label,efforts,…}），引擎本地后端给的是模型名字符串。 */
function normalizeModelEntry(raw) {
  if (typeof raw === 'string') {
    const name = raw.trim();
    if (!name) return null;
    return { id: 'engine:' + name, kind: 'engine', label: name, model: name, efforts: [], defaultEffort: '' };
  }
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  if (!id) return null;
  const efforts = Array.isArray(raw.efforts)
    ? raw.efforts.map((e) => String(e || '').trim()).filter(Boolean) : [];
  return {
    id: id,
    kind: String(raw.kind || 'engine'),
    label: String(raw.label || raw.model || raw.modelId || id),
    model: String(raw.model || raw.modelId || ''),
    modelId: String(raw.modelId || ''),
    providerId: String(raw.providerId || ''),
    // 「宿主默认」是显式档位（薄壳用 isDefault 标出来；老引擎没这个字段
    // 时按 id 兜底）。只影响**呈现**（下拉里单列一组），语义不变。
    isDefault: Boolean(raw.isDefault),
    alsoVia: Array.isArray(raw.alsoVia) ? raw.alsoVia.map((p) => String(p || '')).filter(Boolean) : [],
    efforts: efforts,
    defaultEffort: String(raw.defaultEffort || ''),
  };
}

/* 条目 42／v4：模型选择——拉 /api/ai/models 填下拉；同一 project+disk 只拉一次，
   已选模型不在列表里就回退缺省。拉不到就保持现状，不瞎填。 */
async function refreshAiModels(force) {
  if (!state.project) return;
  const key = state.project.id + '/' + (state.disk || '');
  if (!force && state.ai.modelsKey === key && (state.ai.models || []).length) {
    renderAiModelSelect();
    return;
  }
  let data = null;
  try {
    data = await getJSON('/api/ai/models?project=' + encodeURIComponent(state.project.id)
      + '&disk=' + encodeURIComponent(state.disk || ''));
  } catch (err) {
    return;
  }
  const models = (data && Array.isArray(data.models))
    ? data.models.map(normalizeModelEntry).filter(Boolean) : [];
  if (!models.length) return;
  state.ai.models = models;
  state.ai.modelsKey = key;
  const ids = models.map((m) => m.id);
  const fallback = data && data.model ? String(data.model) : ids[0];
  if (!state.ai.model || ids.indexOf(state.ai.model) < 0) {
    state.ai.model = ids.indexOf(fallback) >= 0 ? fallback : ids[0];
  }
  renderAiModelSelect();
  await probeCustomModels();
}

/* 当前选中的模型条目。 */
function currentModelEntry() {
  const list = state.ai.models || [];
  for (const item of list) {
    if (item.id === state.ai.model) return item;
  }
  return list.length ? list[0] : null;
}

/* v5：模型下拉——按来源分组（宿主模型／自定义模型／本地后端），
   不再在每项后面挂「· 宿主」后缀（分组标题已经说清了）；
   同一个模型只留一条（去重规则见 dedupeModelEntries）。 */
function renderAiModelSelect() {
  const sel = $('#aiModel');
  if (!sel) return;
  sel.innerHTML = '';
  const items = dedupeModelEntries(state.ai.models || []);
  // 「宿主默认」是一个**显式档位**：单列一组，不混在宿主模型里。
  // 只是呈现——选中的 id 与请求载荷一个字没变。
  const isDefault = (item) => item.isDefault || item.id === 'host:default';
  const defaults = items.filter(isDefault);
  const rest = items.filter((item) => !isDefault(item));
  const groups = [];
  if (defaults.length) {
    groups.push({ label: t('ai.kindHostDefault'), list: defaults });
  }
  ['host', 'custom', 'engine'].forEach((kind) => {
    const list = rest.filter((item) => item.kind === kind);
    if (!list.length) return;
    groups.push({ label: kind === 'host' ? t('ai.kindHost')
      : (kind === 'custom' ? t('ai.kindCustom') : t('ai.kindEngine')),
      list: list });
  });
  groups.forEach((group) => {
    const og = document.createElement('optgroup');
    og.label = group.label;
    group.list.forEach((item) => {
      const opt = document.createElement('option');
      opt.value = item.id;
      // 「宿主默认」那一项由界面本地化（薄壳给的是中文标签，切英文时不该留中文）。
      opt.textContent = isDefault(item) ? t('ai.modelHostDefault') : item.label;
      og.appendChild(opt);
    });
    sel.appendChild(og);
  });
  if (!items.length) return;
  if (state.ai.model && items.some((m) => m.id === state.ai.model)) {
    sel.value = state.ai.model;
  } else {
    state.ai.model = items[0].id;
    sel.value = state.ai.model;
  }
  renderAiEffort();
}

/* v5：同一个模型在宿主目录里可能挂多条通道（官方通道＋自建通道），
   下拉里逐条列就成了重复内容。只留一条：宿主目录里第一条；
   被折叠的通道记进 alsoVia（API 仍如实给出，页面不重复列）。 */
function dedupeModelEntries(list) {
  const out = [];
  const seen = new Map();
  (list || []).forEach((item) => {
    if (!item) return;
    const key = (item.kind === 'host' && item.modelId) ? String(item.modelId).toLowerCase() : '';
    if (!key) { out.push(item); return; }
    const at = seen.get(key);
    if (at === undefined) { seen.set(key, out.length); out.push(item); return; }
    const kept = out[at];
    kept.alsoVia = (kept.alsoVia || []).concat([item.providerId || item.id]);
  });
  return out;
}

/* v4：思考等级下拉——只有选中的模型真支持这些档时才显；第一档是「模型默认」。 */
function renderAiEffort() {
  const sel = $('#aiEffort');
  const label = $('#aiEffortLabel');
  if (!sel || !label) return;
  const entry = currentModelEntry();
  const efforts = entry && entry.kind === 'host' ? (entry.efforts || []) : [];
  label.hidden = !efforts.length;
  sel.hidden = !efforts.length;
  const del = $('#aiDelModel');
  if (del) del.hidden = !(entry && entry.kind === 'custom');
  if (!efforts.length) {
    sel.innerHTML = '';
    state.ai.effort = '';
    return;
  }
  sel.innerHTML = '';
  const def = document.createElement('option');
  def.value = '';
  def.textContent = entry.defaultEffort
    ? t('ai.effortDefault', { level: effortLabel(entry.defaultEffort) })
    : t('ai.effortDefaultPlain');
  sel.appendChild(def);
  efforts.forEach((level) => {
    const opt = document.createElement('option');
    opt.value = level;
    opt.textContent = effortLabel(level);
    sel.appendChild(opt);
  });
  if (state.ai.effort && efforts.indexOf(state.ai.effort) < 0) state.ai.effort = '';
  sel.value = state.ai.effort;
}

/* v4：自定义模型只在 MiniApp 薄壳里有（凭据存插件私有目录）。
   浏览器直连引擎时这个接口不存在——那就别显示入口。 */
async function probeCustomModels() {
  let data = null;
  try {
    data = await getJSON('/api/ai/custom-models');
  } catch (err) {
    state.ai.custom = false;
    const add = $('#aiAddModel');
    if (add) add.hidden = true;
    return;
  }
  state.ai.custom = Boolean(data && Array.isArray(data.models));
  state.ai.customModels = state.ai.custom ? data.models : [];
  const add = $('#aiAddModel');
  if (add) add.hidden = !state.ai.custom;
}

/* v4：添加自定义模型（OpenAI 兼容端点）。 */
function openCustomModelForm() {
  const modal = $('#modalCustomModel');
  if (!modal) return;
  ['#cmLabel', '#cmBaseUrl', '#cmModel', '#cmKey'].forEach((sel) => {
    const el = $(sel);
    if (el) el.value = '';
  });
  const err = $('#cmErr');
  if (err) { err.hidden = true; err.textContent = ''; }
  modal.hidden = false;
  const first = $('#cmLabel');
  if (first) first.focus();
}

async function saveCustomModel() {
  const body = {
    label: String(($('#cmLabel') || {}).value || '').trim(),
    baseUrl: String(($('#cmBaseUrl') || {}).value || '').trim(),
    model: String(($('#cmModel') || {}).value || '').trim(),
    apiKey: String(($('#cmKey') || {}).value || '').trim(),
  };
  const err = $('#cmErr');
  try {
    const res = await fetch('/api/ai/custom-models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.ok) {
      if (err) {
        err.hidden = false;
        err.textContent = String((data && data.error) || ('HTTP ' + res.status));
      }
      return;
    }
    state.ai.custom = true;
    state.ai.customModels = Array.isArray(data.models) ? data.models : [];
    const modal = $('#modalCustomModel');
    if (modal) modal.hidden = true;
    await refreshAiModels(true);
    toast(t('ai.cmSaved'));
  } catch (e) {
    if (err) {
      err.hidden = false;
      err.textContent = String((e && e.message) || e);
    }
  }
}

async function deleteCustomModel() {
  const entry = currentModelEntry();
  if (!entry || entry.kind !== 'custom') return;
  const id = String(entry.id || '').replace(/^custom:/, '');
  try {
    const res = await fetch('/api/ai/custom-models/' + encodeURIComponent(id), {
      method: 'DELETE',
      headers: { 'Accept': 'application/json' },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.ok) {
      toast(String((data && data.error) || ('HTTP ' + res.status)));
      return;
    }
    state.ai.customModels = Array.isArray(data.models) ? data.models : [];
    state.ai.model = '';
    await refreshAiModels(true);
    toast(t('ai.cmDeleted'));
  } catch (e) {
    toast(String((e && e.message) || e));
  }
}

/* 条目 34：半透明浮层整条拆除——助手＝侧栏里的一枚互斥面板钮。 */
/* 条目 40：把「视口右缘 → 左区右缘」的距离写进 --side-w。
   固定头部与进度条据此收窄——恒止于侧栏左缘之前，不压侧栏。
   （侧栏总宽＝面板 320＋间距 16；项目另有钮列时由实测自动带上。） */
function syncFixedHeaderWidth() {
  const col = $('#leftCol');
  if (!col) return;
  const rect = col.getBoundingClientRect();
  if (!rect || !rect.width) return;
  const gap = Math.max(0, Math.round(window.innerWidth - rect.right));
  document.documentElement.style.setProperty('--side-w', gap + 'px');
}

/* 收起/展开会改左区宽度（padding-right 有过渡）——过渡前后各同步一次。 */
function scheduleHeaderWidthSync() {
  syncFixedHeaderWidth();
  setTimeout(syncFixedHeaderWidth, 260);
}

function setNavCollapsed(collapsed) {
  document.body.classList.toggle('nav-collapsed', !!collapsed);
  scheduleHeaderWidthSync();
}

/* ---------------------------------------------------------------- 段六：知识库 */

function kbApiPath(suffix) {
  const project = state.project;
  if (!project) return null;
  return `/api/project/${encodeURIComponent(project.id)}/knowledge${suffix || ''}`;
}

function kbStatusLabel(file) {
  if (!file) return '';
  if (file.status === 'pending') return t('kb.pending');
  return t('kb.ready');
}

function renderKb() {
  const list = $('#kbFiles');
  if (!list) return;
  list.innerHTML = '';
  if (state.kb.loading) {
    const li = document.createElement('li');
    li.className = 'kb-empty';
    li.textContent = t('kb.loading');
    list.appendChild(li);
    return;
  }
  if (state.kb.error) {
    const li = document.createElement('li');
    li.className = 'kb-empty';
    li.textContent = state.kb.error;
    list.appendChild(li);
    return;
  }
  if (!state.kb.files.length) {
    const li = document.createElement('li');
    li.className = 'kb-empty';
    li.textContent = t('kb.empty');
    list.appendChild(li);
    return;
  }
  state.kb.files.forEach((file) => {
    const li = document.createElement('li');
    li.className = 'kb-file' + (state.kb.current === file.path ? ' on' : '');
    li.dataset.path = file.path;
    const head = document.createElement('div');
    head.className = 'kbf-head';
    const name = document.createElement('span');
    name.className = 'kbf-name';
    name.textContent = file.name;
    const meta = document.createElement('span');
    meta.className = 'kbf-meta';
    meta.textContent = `${file.size_label} · ${kbStatusLabel(file)}`;
    head.appendChild(name);
    head.appendChild(meta);
    li.appendChild(head);
    /* 条目 35：行动作收口——人人有「预览」；「删除」只给 knowledge/ 里的
       文本文件（项目源文件由章节管理管，PDF 只登记不删）。 */
    const acts = document.createElement('div');
    acts.className = 'kbf-acts';
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'kbf-act';
    prev.textContent = t('kb.actPreview');
    prev.addEventListener('click', (ev) => { ev.stopPropagation(); previewKbFile(file.path); });
    acts.appendChild(prev);
    if (file.in_knowledge && file.status !== 'pending') {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'kbf-act kbf-act-del';
      del.textContent = t('kb.actDelete');
      del.addEventListener('click', (ev) => { ev.stopPropagation(); askDeleteKbFile(file); });
      acts.appendChild(del);
    }
    li.appendChild(acts);
    if (!file.in_knowledge) {
      const note = document.createElement('div');
      note.className = 'kbf-note';
      note.textContent = t('kb.sourceNote');
      li.appendChild(note);
    }
    li.addEventListener('click', () => previewKbFile(file.path));
    list.appendChild(li);
  });
}

/* 条目 35：知识库预览改模态框（不再是侧栏内嵌框）。 */
function openKbModal(data) {
  const modal = $('#modalKb');
  const title = $('#kbModalTitle');
  const body = $('#kbModalBody');
  if (!modal || !title || !body) return;
  const info = data || {};
  title.textContent = info.name || '';
  const meta = [
    `<div class="kbd-kv"><span>${esc(t('kb.path'))}</span><code>${esc(info.path || '')}</code></div>`,
    `<div class="kbd-kv"><span>${esc(t('kb.size'))}</span><span>${esc(info.size_label || '—')}</span></div>`,
    `<div class="kbd-kv"><span>${esc(t('kb.sha'))}</span><code>${esc(info.sha256 || '—')}</code></div>`,
    `<div class="kbd-kv"><span>${esc(t('kb.status'))}</span><span>${esc(info.status === 'pending' ? t('kb.pending') : t('kb.ready'))}</span></div>`,
  ];
  let content = '';
  if (info.error) {
    content = `<div class="kbd-note err">${esc(info.error)}</div>`;
  } else if (info.status === 'pending') {
    content = `<div class="kbd-note">${esc(t('kb.pdfNote'))}</div>`;
  } else {
    const lines = String(info.text || '').split('\n');
    const cut = lines.slice(0, 200);
    const more = lines.length > 200 || info.truncated;
    content = `<div class="kbd-title">${esc(t('kb.preview'))}</div>`
      + `<pre class="kbd-text">${esc(cut.join('\n'))}</pre>`
      + (more ? `<div class="kbd-note">${esc(t('kb.fullNote'))}</div>` : '');
  }
  body.innerHTML = meta.join('') + content;
  modal.hidden = false;
}

async function loadKb() {
  const url = kbApiPath('');
  if (!url) return;
  state.kb.loading = true;
  state.kb.error = '';
  renderKb();
  try {
    const data = await getJSON(url);
    state.kb.files = (data && data.files) || [];
    state.kb.error = '';
  } catch (err) {
    state.kb.files = [];
    state.kb.error = t('kb.loadErr', { e: (err && err.message) || String(err) });
  } finally {
    state.kb.loading = false;
    renderKb();
  }
}

async function previewKbFile(path) {
  state.kb.current = path;
  const url = kbApiPath('/preview') + '?path=' + encodeURIComponent(path);
  renderKb();
  try {
    const data = await getJSON(url);
    state.kb.detail = data;
    openKbModal(data);
  } catch (err) {
    openKbModal({ name: path, path: path, text: '', size_label: '—',
                  error: (err && err.message) || String(err) });
  }
}

/* 条目 35：删除知识库文件（只许 knowledge/ 里的）——先确认，再走服务端写闸。 */
async function deleteKbFile(path) {
  const url = kbApiPath('/delete');
  if (!url) return;
  try {
    await postJSON(url, { path: path });
    toast(t('kb.deleted'));
    if (state.kb.current === path) state.kb.current = '';
    await loadKb();
  } catch (err) {
    toast(t('kb.delFail', { e: (err && err.message) || String(err) }));
  }
}

function askDeleteKbFile(file) {
  askConfirm({ title: t('kb.delTitle'), body: t('kb.delAsk'), okLabel: t('confirm.ok') })
    .then((ok) => { if (ok) deleteKbFile(file.path); });
}

async function uploadKbFile(event) {
  const input = event.target;
  if (!input || !input.files || !input.files.length) {
    toast(t('kb.noFile'));
    return;
  }
  const file = input.files[0];
  const form = new FormData();
  form.append('file', file, file.name);
  const url = kbApiPath('/upload');
  try {
    const res = await fetch(url, { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok || !data || data.ok === false) {
      toast(t('kb.uploadErr', { e: (data && data.error) || ('HTTP ' + res.status) }));
      return;
    }
    toast(t('kb.uploadOk', { name: data.name || file.name }));
    state.kb.current = '';
    state.kb.detail = null;
    await loadKb();
  } catch (err) {
    toast(t('kb.uploadErr', { e: (err && err.message) || String(err) }));
  } finally {
    input.value = '';
  }
}

/* ---------------------------------------------------------------- 段六：版式 */

function venueApiPath(suffix) {
  const project = state.project;
  if (!project) return null;
  return `/api/project/${encodeURIComponent(project.id)}/venue${suffix || ''}`;
}

function renderVenue() {
  const data = state.venue.data;
  const venueInput = $('#vnVenue');
  const deadlineInput = $('#vnDeadline');
  const lock = $('#vnLock');
  const info = $('#vnDeadlineInfo');
  const tpl = $('#vnTemplates');
  const msg = $('#vnMsg');
  if (msg) msg.textContent = state.venue.msg || '';
  if (!data) {
    if (venueInput) venueInput.value = '';
    if (deadlineInput) deadlineInput.value = '';
    if (lock) lock.innerHTML = '';
    if (info) info.innerHTML = '';
    if (tpl) tpl.innerHTML = '';
    return;
  }
  if (venueInput && document.activeElement !== venueInput) venueInput.value = data.venue || '';
  if (deadlineInput && document.activeElement !== deadlineInput) deadlineInput.value = data.deadline || '';
  if (lock) {
    const lockData = data.lang_lock || {};
    const note = lockData.note_key ? t(lockData.note_key) : (lockData.note || '');
    lock.innerHTML = `<span class="vn-lock-tag">${esc(t('vn.lockTag'))}</span><span>${esc(note)}</span>`;
    lock.classList.toggle('locked', !!(data.lang_lock && data.lang_lock.locked));
  }
  if (info) {
    const days = data.days_left;
    let text = '';
    if (days === null || days === undefined) {
      text = '';
    } else if (data.overdue) {
      text = t('vn.overdue', { d: Math.abs(days) });
    } else if (data.due_soon) {
      text = t('vn.dueSoon', { d: days });
    } else {
      text = t('vn.dueNormal', { d: days });
    }
    info.innerHTML = text ? `<span>${esc(text)}</span>` : '';
    info.classList.toggle('soon', !!(data.due_soon && !data.overdue));
    info.classList.toggle('late', !!data.overdue);
  }
  if (tpl) {
    const items = data.templates || [];
    tpl.innerHTML = items.map((item) => `
      <div class="vn-tpl-row">
        <span class="vn-tpl-name">${esc(item.name_key ? t(item.name_key) : (item.name || item.id || ''))}</span>
        <span class="vn-tpl-note">${esc(item.note_key ? t(item.note_key) : (item.note || ''))}</span>
      </div>`).join('');
  }
}

async function loadVenue() {
  const url = venueApiPath('');
  if (!url) return;
  state.venue.loading = true;
  try {
    const data = await getJSON(url);
    state.venue.data = data;
    state.venue.error = '';
  } catch (err) {
    state.venue.data = null;
    state.venue.error = t('vn.saveErr', { e: (err && err.message) || String(err) });
  } finally {
    state.venue.loading = false;
    renderVenue();
    updateDeadlineBadge();
  }
}

async function saveVenueConfig() {
  const url = venueApiPath('');
  if (!url) return;
  const venue = ($('#vnVenue') || {}).value || '';
  const deadline = ($('#vnDeadline') || {}).value || '';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ venue: venue.trim(), deadline: deadline.trim() }),
    });
    const data = await res.json();
    if (!res.ok || !data || data.ok === false) {
      state.venue.msg = t('vn.saveErr', { e: (data && data.error) || ('HTTP ' + res.status) });
      renderVenue();
      return;
    }
    state.venue.data = data;
    state.venue.msg = t('vn.saved');
    renderVenue();
    updateDeadlineBadge();
  } catch (err) {
    state.venue.msg = t('vn.saveErr', { e: (err && err.message) || String(err) });
    renderVenue();
  }
}

/* 段六：截稿提醒徽标（到期前 7 天，导航钮上带提醒）。
   条目 33：版式已并进「更多」面板，徽标改挂在「更多」钮上（钮面无文字，只有徽标）。 */
function updateDeadlineBadge() {
  const btn = $('#npMore');
  if (!btn) return;
  let badge = btn.querySelector('.dl-badge');
  const data = state.venue.data;
  const soon = !!(data && (data.due_soon || data.overdue));
  if (!soon) {
    if (badge) badge.remove();
    btn.classList.remove('has-due');
    return;
  }
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'dl-badge';
    btn.appendChild(badge);
  }
  badge.textContent = data.overdue ? '!' : String(data.days_left);
  btn.classList.add('has-due');
}

/* ------------------------------------------------- 引用增删（旧节级前端那页搬过来的） */

/* 引用与图片都跟着当前盘走（进哪篇管哪篇）。 */
function diskCitePath(suffix) {
  const project = state.project;
  const disk = currentDisk();
  if (!project || !disk) return null;
  return `/api/disk/${encodeURIComponent(project.id)}/${encodeURIComponent(disk.id)}${suffix || ''}`;
}

function renderCitations() {
  const list = $('#citeList');
  const sum = $('#citeSum');
  if (!list) return;
  const data = state.cites.data;
  if (!data) {
    list.innerHTML = '';
    if (sum) sum.textContent = state.cites.error || '';
    return;
  }
  if (sum) {
    sum.textContent = t('cite.sum', {
      total: data.total || 0, used: data.used || 0, unused: data.unused || 0,
    });
  }
  const entries = data.entries || [];
  list.innerHTML = entries.map((row) => {
    const status = String(row.status || 'ok');
    const meta = [row.author, row.year, row.doi || row.arxiv].filter(Boolean).join(' · ');
    return `<li class="cite-row s-${esc(status)}">
      <div class="cite-line1">
        <span class="cite-key">${esc(row.key || '')}</span>
        <span class="cite-status">${esc(t('cite.st.' + status))}</span>
        <button type="button" class="cite-del" data-key="${esc(row.key || '')}" title="${esc(t('cite.delT'))}">✕</button>
      </div>
      <div class="cite-title">${esc(row.title || '')}</div>
      ${meta ? `<div class="cite-meta">${esc(meta)}</div>` : ''}
    </li>`;
  }).join('');
}

async function loadCitations() {
  const url = diskCitePath('/citations');
  if (!url) { state.cites.data = null; renderCitations(); return; }
  state.cites.loading = true;
  try {
    const data = await getJSON(url);
    state.cites.data = data;
    state.cites.error = '';
  } catch (err) {
    state.cites.data = null;
    state.cites.error = t('cite.loadErr', { e: (err && err.message) || String(err) });
  } finally {
    state.cites.loading = false;
    renderCitations();
  }
}

function openCiteForm() {
  const modal = $('#modalCite');
  if (!modal) return;
  ['ctKey', 'ctTitle', 'ctAuthor', 'ctYear', 'ctDoi', 'ctArxiv'].forEach((id) => {
    const el = $('#' + id);
    if (el) el.value = '';
  });
  modal.hidden = false;
}

function closeCiteForm() {
  const modal = $('#modalCite');
  if (modal) modal.hidden = true;
}

async function addCitation() {
  const url = diskCitePath('/citations/add');
  if (!url) return;
  const key = (($('#ctKey') || {}).value || '').trim();
  if (!key) { toast(t('cite.needKey')); return; }
  const body = {
    key: key,
    title: (($('#ctTitle') || {}).value || '').trim(),
    author: (($('#ctAuthor') || {}).value || '').trim(),
    year: (($('#ctYear') || {}).value || '').trim(),
    doi: (($('#ctDoi') || {}).value || '').trim(),
    arxiv: (($('#ctArxiv') || {}).value || '').trim(),
  };
  try {
    await postJSON(url, body);
    closeCiteForm();
    toast(t('cite.addOk', { key: key }));
    await loadCitations();
  } catch (err) {
    toast(t('cite.addErr', { e: (err && err.message) || String(err) }));
  }
}

async function deleteCitation(key) {
  const url = diskCitePath('/citations/delete');
  if (!url || !key) return;
  const ok = await askConfirm({
    title: t('cite.delTitle'),
    body: t('cite.delBody'),
    okLabel: t('confirm.ok'),
  });
  if (!ok) return;
  try {
    await postJSON(url, { key: key });
    toast(t('cite.delOk', { key: key }));
    await loadCitations();
  } catch (err) {
    toast(t('cite.delErr', { e: (err && err.message) || String(err) }));
  }
}

/* 首页预览：走现有的渲染 PDF 链路（真渲染，出预览）。 */
/* ------------------------------------------------- 图片预览（旧节级前端那条只读通道搬过来的） */

function assetUrl(rel) {
  const base = diskCitePath('/asset');
  if (!base) return '';
  return base + '?path=' + encodeURIComponent(String(rel || ''));
}

function renderAssets() {
  const grid = $('#assetGrid');
  if (!grid) return;
  const data = state.assets.data;
  if (!data) {
    grid.innerHTML = '';
    return;
  }
  const items = data.assets || [];
  if (!items.length) {
    grid.innerHTML = '<p class="asset-empty">' + esc(t('asset.empty')) + '</p>';
    return;
  }
  const cells = items.map((item) => {
    const rel = String(item.path || '');
    return '<button type="button" class="asset-cell" data-path="' + esc(rel) + '" title="' + esc(rel) + '">' +
      '<img loading="lazy" src="' + esc(assetUrl(rel)) + '" alt="' + esc(item.name || '') + '">' +
      '<span class="asset-name">' + esc(item.name || '') + '</span></button>';
  }).join('');
  const more = data.truncated
    ? '<p class="asset-more">' + esc(t('asset.more', { n: items.length })) + '</p>'
    : '';
  grid.innerHTML = cells + more;
}

async function loadAssets() {
  const url = diskCitePath('/assets');
  if (!url) { state.assets.data = null; renderAssets(); return; }
  state.assets.loading = true;
  try {
    const data = await getJSON(url);
    state.assets.data = data;
    state.assets.error = '';
  } catch (err) {
    state.assets.data = null;
    state.assets.error = t('asset.loadErr', { e: (err && err.message) || String(err) });
  } finally {
    state.assets.loading = false;
    renderAssets();
  }
}

function openAsset(rel) {
  const modal = $('#modalAsset');
  const body = $('#asBody');
  const title = $('#asTitle');
  if (!modal || !body) return;
  if (title) title.textContent = String(rel || '');
  body.innerHTML = '<img class="asset-full" src="' + esc(assetUrl(rel)) + '" alt="' + esc(rel || '') + '">';
  modal.hidden = false;
}

/* ------------------------------------------------- 内置示例（装到工作根下面） */

async function installSample() {
  const btn = $('#goSample');
  if (btn) btn.disabled = true;
  try {
    const data = await postJSON('/api/samples/guide', { reset: false });
    toast(t('tb.sampleOk', { p: data.path || '' }));
    await loadProjects();
  } catch (err) {
    toast(t('tb.sampleErr', { e: (err && err.message) || String(err) }));
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ---------------------------------------------------------------- 段六：选刊指南 */

const VENUE_GUIDE_KEYS = [
  ['guide.h1', 'guide.p1'],
  ['guide.h2', 'guide.p2'],
  ['guide.h3', 'guide.p3'],
  ['guide.h4', 'guide.p4'],
];

function renderGuide() {
  const body = $('#guideBody');
  if (!body) return;
  const parts = [];
  VENUE_GUIDE_KEYS.forEach((pair) => {
    parts.push(`<h3 class="guide-h">${esc(t(pair[0]))}</h3>`);
    parts.push(`<p class="guide-p">${esc(t(pair[1]))}</p>`);
  });
  parts.push(`<p class="guide-foot">${esc(t('guide.foot'))}</p>`);
  body.innerHTML = parts.join('');
}

function openVenueGuide() {
  renderGuide();
  const modal = $('#modalGuide');
  if (modal) modal.hidden = false;
}

function closeVenueGuide() {
  const modal = $('#modalGuide');
  if (modal) modal.hidden = true;
}

/* ---------------------------------------------------------------- 段五：常用功能 */

/* 动作接口永远 200；ok=false 表示「这件事没做成」，不是路由错。
   所以不走 postJSON（它见 ok===false 就抛），自己接，把原因原样呈现。 */
async function postAction(action) {
  const project = state.project;
  const disk = currentDisk();
  if (!project || !disk) throw new Error(t('rp.noProject'));
  const url = `/api/disk/${encodeURIComponent(project.id)}/${encodeURIComponent(disk.id)}/action`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ action: action }),
  });
  let data = null;
  try { data = await res.json(); } catch (err) { data = null; }
  if (!data) throw new Error('HTTP ' + res.status);
  return data;
}

function openActionModal(title, html) {
  const modal = $('#modalAction');
  const titleEl = $('#actTitle');
  const body = $('#actBody');
  if (titleEl) titleEl.textContent = title;
  if (body) body.innerHTML = html;
  if (modal) modal.hidden = false;
}

function pdfUrl() {
  const project = state.project;
  const disk = currentDisk();
  if (!project || !disk) return '';
  return `/api/disk/${encodeURIComponent(project.id)}/${encodeURIComponent(disk.id)}/pdf`;
}

/* 条目 39：导出 PDF＝真编译 ＋ 直接给下载链接（不再弹 PDF 预览模态）。 */
async function runPdfAction() {
  toast(t('act.pdfCompiling'));
  let data = null;
  try {
    data = await postAction('pdf');
  } catch (err) {
    toast(t('act.pdfFail'));
    return;
  }
  if (!data.ok) {
    toast(t('act.pdfFail'));
    return;
  }
  const url = pdfUrl();
  toast(t('act.pdfDone', { p: data.pdf_path || '' }),
        { url: url, label: t('act.pdfDownload') });
}

/* 清单门读数（预览与导出结果共用同一份渲染）。 */
function bundleGateRows(gate) {
  return (gate || []).map((item) => {
    const status = item.status || '';
    return `<div class="act-kv"><span>${esc(item.code || '')} ${esc(item.name || '')}</span>` +
      `<span class="act-gate ${esc(status)}">${esc(status)}</span></div>`;
  }).join('');
}

/* 导出前的**可选**预览一步（只读）：将要收什么、清单门过不过。
   返回 Promise<boolean>：true＝继续导出，false＝取消。
   预览读不到／用户点跳过 → 都走原来的导出流程（清单门判定一字没改）。 */
function openBundlePreview(data) {
  return new Promise((resolve) => {
    const files = data.files || [];
    const shown = files.slice(0, 40);
    const rows = shown.map((f) => `<div class="act-kv"><span>${esc(f.path || '')}</span>` +
      `<span class="act-gate">${esc(fpShort('', f.sha256))} · ${esc(String(f.bytes || 0))} B</span></div>`).join('');
    const gateRows = bundleGateRows(data.gate);
    const fail = Number(data.failed || 0) > 0;
    const html = (fail ? `<div class="act-fail">${esc(t('act.bundlePreviewGateFail'))}</div>` : '') +
      `<div class="act-kv"><span>${esc(t('act.bundlePreviewFiles', { n: Number(data.file_count || 0) }))}</span></div>` +
      `<div class="act-kv"><span>${esc(t('act.bundleGate', { p: Number(data.passed || 0), f: Number(data.failed || 0), w: Number(data.waived || 0) }))}</span></div>` +
      (shown.length ? rows : `<div class="ff-empty">${esc(t('act.bundlePreviewNone'))}</div>`) +
      gateRows +
      `<div class="st-sub">${esc(t('act.bundlePreviewNote'))}</div>` +
      `<div class="modal-acts">` +
      `<button type="button" class="btn" id="bundlePreviewGo">${esc(t('act.bundlePreviewGo'))}</button>` +
      `<button type="button" class="btn-ghost" id="bundlePreviewSkip">${esc(t('act.bundlePreviewSkip'))}</button>` +
      `</div>`;
    openActionModal(t('act.bundlePreview'), html);
    const go = $('#bundlePreviewGo');
    const skip = $('#bundlePreviewSkip');
    const done = (answer) => {
      const modal = $('#modalAction');
      if (modal) modal.hidden = true;
      if (go) go.onclick = null;
      if (skip) skip.onclick = null;
      resolve(answer);
    };
    if (go) go.onclick = () => done(true);
    if (skip) skip.onclick = () => done(true);
    const close = $('#actClose');
    if (close) close.onclick = () => done(false);
  });
}

async function runBundleAction() {
  // ① 可选的预览一步（只读）。预览读不到就当没有这一步——原流程照走。
  try {
    const url = diskApiPath('bundle-preview');
    if (url) {
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      const data = await res.json();
      if (data && data.ok && Array.isArray(data.files)) {
        const go = await openBundlePreview(data);
        if (!go) return;
      }
    }
  } catch (err) {
    /* 预览是可选的：读不到就直接走原流程。 */
  }
  openActionModal(t('act.bundleTitle'), `<div class="ff-empty">${esc(t('rp.rerunning'))}</div>`);
  let data = null;
  try {
    data = await postAction('bundle');
  } catch (err) {
    openActionModal(t('act.bundleTitle'),
      `<div class="rp-card-err">${esc((err && err.message) || String(err))}</div>`);
    return;
  }
  const gateRows = bundleGateRows(data.gate);
  if (!data.ok) {
    openActionModal(t('act.bundleTitle'),
      `<div class="act-fail">${esc(t('act.bundleFail'))}</div>` +
      `<div class="rp-card-err">${esc(data.error || data.failure_reason || '')}</div>` + gateRows);
    return;
  }
  openActionModal(t('act.bundleTitle'),
    `<div class="act-ok">${esc(t('act.bundleOk'))}</div>` +
    `<div class="act-kv"><span>${esc(t('act.bundlePath'))}</span><code>${esc(data.bundle_dir || '')}</code></div>` +
    `<div class="act-kv"><span>${esc(t('act.bundleFiles', { n: Number(data.file_count || 0) }))}</span></div>` +
    `<div class="act-kv"><span>${esc(t('act.bundleGate', { p: Number(data.passed || 0), f: Number(data.failed || 0), w: Number(data.waived || 0) }))}</span></div>` +
    gateRows);
}

async function runOpenDirAction() {
  let data = null;
  try {
    data = await postAction('open_dir');
  } catch (err) {
    toast((err && err.message) || String(err));
    return;
  }
  if (data.ok && data.opened) {
    toast(data.message || t('act.openOk'));
    return;
  }
  // 非 macOS（或 open 失败）：退回「展示路径」，不假装打开过。
  openActionModal(t('act.openTitle'),
    `<div class="act-fail">${esc(data.error || t('act.openUnsupported'))}</div>` +
    `<div class="act-kv"><span>${esc(t('act.pdfPath'))}</span><code>${esc(data.path || '')}</code></div>`);
}

/* ---------------------------------------------------------------- 提议单（v2）：差异卡
   AI／助手的改稿提议落成一张待确认单；人点「采纳写回」才真写正文。
   页面这一侧只做四件事：列单（徽标数）、画差异卡（左现状／右采纳后）、
   采纳、拒绝。落盘由后端那条保护链做（指纹闸 → 重建 → 原子写），
   页面不自己拼正文。

   过期（409 BLOCK_STALE）一律拒写：后端把单子判成 stale，页面只提示
   「这段在别处已被改动」，并把该块的新鲜内容换回正文。 */

/* 提议单接口路径：/api/disk/<project>/<disk>/proposal[...]. */
function proposalPath(suffix) {
  const project = state.project;
  const disk = currentDisk();
  if (!project || !disk) return null;
  return `/api/disk/${encodeURIComponent(project.id)}/${encodeURIComponent(disk.id)}/proposal${suffix || ''}`;
}

/* 徽标：待确认数 > 0 才亮（没有待确认提议时整枚按钮藏起来）。 */
function updateProposalBadge(count) {
  const n = Number(count || 0);
  const badge = $('#proposalCount');
  const btn = $('#btnProposals');
  if (badge) {
    badge.textContent = String(n);
    badge.hidden = n <= 0;
  }
  if (btn) {
    btn.hidden = n <= 0;
    btn.disabled = n <= 0;
  }
}

/* 列单：GET /proposal → 徽标数字 → 差异卡。 */
async function loadProposals() {
  const path = proposalPath('');
  if (!path) { updateProposalBadge(0); return []; }
  let data = null;
  try {
    data = await getJSON(path);
  } catch (err) {
    updateProposalBadge(0);
    toast(t('proposal.loadFail', { e: (err && err.message) || String(err) }));
    return [];
  }
  const rows = (data && data.proposals) || [];
  state.proposals = rows;
  // 展示层文案的双语目录随列表到（EN 界面按 lang 翻，缺模板回落到原话）。
  state.proposalCatalog = (data && data.i18n) || {};
  const count = Number((data && data.count !== undefined && data.count !== null) ? data.count : rows.length);
  updateProposalBadge(count);
  renderProposals(mergeProposalRows(rows));
  return rows;
}

/* 本地判过期的单（409 之后）仍留在列表里说清原因，只是不给采纳。 */
function mergeProposalRows(rows) {
  const list = (rows || []).slice();
  const stale = state.staleProposals || {};
  Object.keys(stale).forEach((id) => {
    if (list.some((row) => row && row.id === id)) return;
    list.push(stale[id]);
  });
  return list;
}

/* 画差异卡：每条提议一张卡（左＝现状，右＝采纳后，逐行标增删）。 */
function renderProposals(list) {
  const box = $('#proposalList');
  if (!box) return;
  const rows = (Array.isArray(list) ? list : []).filter((row) => row && row.id);
  box.innerHTML = '';
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'prop-empty';
    empty.textContent = t('proposal.empty');
    box.appendChild(empty);
    return;
  }
  rows.forEach((row) => box.appendChild(proposalCard(row)));
}

/* 一张差异卡。 */
function proposalCard(row) {
  const card = document.createElement('article');
  card.className = 'proposal-card';
  card.dataset.id = row.id;
  const stale = String(row.status || 'pending') !== 'pending';
  if (stale) card.classList.add('prop-stale');

  const head = document.createElement('div');
  head.className = 'prop-head';
  const src = document.createElement('span');
  src.className = 'prop-src';
  src.textContent = proposalSourceLabel(row);
  const kind = document.createElement('span');
  kind.className = 'prop-kind';
  kind.textContent = proposalKindLabel(row);
  const time = document.createElement('span');
  time.className = 'prop-time';
  time.textContent = t('proposal.created', { time: formatTime(row.created_at) });
  head.appendChild(src);
  head.appendChild(kind);
  head.appendChild(time);
  card.appendChild(head);

  // 差异对比用的是**渲染后的**文本（EN 界面比的是英文版，不是中文原话）。
  const catalog = state.proposalCatalog || {};
  const display = row.display || {};
  const beforeText = renderParts(display.before, catalog, row.before_text);
  const afterText = renderParts(display.after, catalog, row.after_text);
  const rows = diffRows(beforeText, afterText);
  const cols = document.createElement('div');
  cols.className = 'prop-cols';
  // 追加事实那张卡的右栏是账本条目（TOML）——给它上语法高亮（只是呈现）。
  const hl = String(row.kind || '') === 'add_fact' ? 'toml' : '';
  cols.appendChild(propColumn(t('proposal.before'), 'prop-before', rows, 'left'));
  cols.appendChild(propColumn(t('proposal.after'), 'prop-after', rows, 'right', hl));
  card.appendChild(cols);

  const warns = proposalWarnings(row);
  if (warns.length) {
    const warn = document.createElement('div');
    warn.className = 'prop-warn';
    warn.textContent = t('proposal.warnings', { text: warns.join('; ') });
    card.appendChild(warn);
  }
  if (stale) {
    const note = document.createElement('div');
    note.className = 'prop-stale-note';
    note.textContent = t('proposal.stale');
    card.appendChild(note);
  }

  const acts = document.createElement('div');
  acts.className = 'prop-acts';
  const adopt = document.createElement('button');
  adopt.type = 'button';
  adopt.className = 'btn-primary prop-adopt';
  adopt.setAttribute('data-confirm', row.id);
  adopt.textContent = t('proposal.adopt');
  if (stale) adopt.disabled = true;
  const reject = document.createElement('button');
  reject.type = 'button';
  reject.className = 'btn-ghost prop-reject';
  reject.setAttribute('data-reject', row.id);
  reject.textContent = t('proposal.reject');
  acts.appendChild(adopt);
  acts.appendChild(reject);
  card.appendChild(acts);
  return card;
}

/* 告警文案：展示层（key ＋ params）优先；目录缺哪条就回落到中文原话。 */
function proposalWarnings(row) {
  const catalog = state.proposalCatalog || {};
  const display = row.display || {};
  const parts = Array.isArray(display.warnings) ? display.warnings : [];
  if (parts.length) {
    const out = [];
    for (const item of parts) {
      const text = renderParts([item], catalog, '');
      if (!text) return (row.warnings || []).map(String);
      out.push(text);
    }
    return out;
  }
  return (row.warnings || []).map(String);
}

/* 类型标签：改稿／插入草稿／冻结证据／解冻证据／追加事实／导出投稿包。 */
function proposalKindLabel(row) {
  const kind = String((row && row.kind) || '');
  const keys = {
    ai_draft: 'proposal.kindDraft',
    evidence_freeze: 'proposal.kindEvidenceFreeze',
    evidence_unfreeze: 'proposal.kindEvidenceUnfreeze',
    add_fact: 'proposal.kindAddFact',
    export_bundle: 'proposal.kindExportBundle',
  };
  return t(keys[kind] || 'proposal.kindEdit');
}

/* 来源标签：mcp（助手）还是页面自己发的。 */
function proposalSourceLabel(row) {
  const source = String((row && row.source) || '').toLowerCase();
  if (source === 'mcp') return t('proposal.fromMcp');
  if (source === 'page') return t('proposal.fromPage');
  return t('proposal.fromUnknown');
}

/* TOML 语法高亮（差异卡里的账条目）：表头 / 键名 / 字符串 / 数字 / 布尔 / 注释。
   纯展示层——高亮的是同一份文本，落盘内容一个字不变。 */
function tomlHighlightHtml(text) {
  const raw = String(text === null || text === undefined ? '' : text);
  if (!raw.trim()) return esc(raw);
  if (/^\s*#/.test(raw)) return '<span class="toml-comment">' + esc(raw) + '</span>';
  if (/^\s*\[\[?[^\]]*\]\]?\s*$/.test(raw)) {
    return '<span class="toml-table">' + esc(raw) + '</span>';
  }
  const m = /^(\s*)([A-Za-z0-9_\-]+)(\s*=\s*)(.*)$/.exec(raw);
  if (!m) return esc(raw);
  const value = m[4];
  let valueHtml;
  if (/^"(?:[^"\\]|\\.)*"$/.test(value) || /^'[^']*'$/.test(value)) {
    valueHtml = '<span class="toml-string">' + esc(value) + '</span>';
  } else if (/^[+-]?[0-9][0-9_]*(\.[0-9_]+)?([eE][+-]?[0-9]+)?$/.test(value)) {
    valueHtml = '<span class="toml-number">' + esc(value) + '</span>';
  } else if (/^(true|false)$/.test(value)) {
    valueHtml = '<span class="toml-bool">' + esc(value) + '</span>';
  } else if (/^\[.*\]$/.test(value)) {
    valueHtml = '<span class="toml-array">' + esc(value) + '</span>';
  } else {
    valueHtml = esc(value);
  }
  return esc(m[1]) + '<span class="toml-key">' + esc(m[2]) + '</span>'
    + '<span class="toml-eq">' + esc(m[3]) + '</span>' + valueHtml;
}

/* 左右两栏里的一栏（side: left / right）。 */
function propColumn(title, cls, rows, side, highlight) {
  const col = document.createElement('div');
  col.className = 'prop-col';
  const head = document.createElement('div');
  head.className = 'prop-col-h';
  head.textContent = title;
  col.appendChild(head);
  const body = document.createElement('div');
  body.className = 'prop-body ' + cls;
  rows.forEach((row) => {
    const line = document.createElement('div');
    const text = (side === 'left') ? row.left : row.right;
    if (text === null || text === undefined) {
      line.className = 'prop-line prop-gap';
    } else {
      const mark = (side === 'left') ? row.leftKind : row.rightKind;
      line.className = 'prop-line' + (mark ? ' ' + mark : '');
      if (highlight === 'toml') line.innerHTML = tomlHighlightHtml(text);
      else line.textContent = text;
    }
    body.appendChild(line);
  });
  col.appendChild(body);
  return col;
}

/* 行级差异：LCS 对照；行数太多就退化成「整块替换」。 */
function diffLines(before, after) {
  const a = String(before === null || before === undefined ? '' : before).split('\n');
  const b = String(after === null || after === undefined ? '' : after).split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tailA = a.length, tailB = b.length;
  while (tailA > head && tailB > head && a[tailA - 1] === b[tailB - 1]) { tailA -= 1; tailB -= 1; }
  const midA = a.slice(head, tailA);
  const midB = b.slice(head, tailB);
  const ops = [];
  a.slice(0, head).forEach((line) => ops.push({ type: 'same', text: line }));
  if (midA.length && midB.length && midA.length * midB.length > 40000) {
    midA.forEach((line) => ops.push({ type: 'del', text: line }));
    midB.forEach((line) => ops.push({ type: 'add', text: line }));
  } else {
    lcsOps(midA, midB).forEach((op) => ops.push(op));
  }
  a.slice(tailA).forEach((line) => ops.push({ type: 'same', text: line }));
  return ops;
}

/* 最长公共子序列 → 一串 same / del / add 操作。 */
function lcsOps(a, b) {
  const n = a.length, m = b.length;
  const dp = [];
  for (let i = 0; i <= n; i += 1) dp.push(new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = (a[i] === b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ type: 'same', text: a[i] }); i += 1; j += 1; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: 'del', text: a[i] }); i += 1; }
    else { ops.push({ type: 'add', text: b[j] }); j += 1; }
  }
  while (i < n) { ops.push({ type: 'del', text: a[i] }); i += 1; }
  while (j < m) { ops.push({ type: 'add', text: b[j] }); j += 1; }
  return ops;
}

/* 差异排成左右对齐的行：改过的行左删右增，空缺的一侧留白。 */
function diffRows(before, after) {
  const ops = diffLines(before, after);
  const rows = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === 'same') {
      rows.push({ left: ops[i].text, right: ops[i].text, leftKind: '', rightKind: '' });
      i += 1;
      continue;
    }
    const dels = [];
    const adds = [];
    while (i < ops.length && ops[i].type !== 'same') {
      if (ops[i].type === 'del') dels.push(ops[i].text); else adds.push(ops[i].text);
      i += 1;
    }
    const span = Math.max(dels.length, adds.length);
    for (let k = 0; k < span; k += 1) {
      const hasDel = k < dels.length;
      const hasAdd = k < adds.length;
      rows.push({
        left: hasDel ? dels[k] : null,
        right: hasAdd ? adds[k] : null,
        leftKind: hasDel ? 'prop-del' : '',
        rightKind: hasAdd ? 'prop-add' : '',
      });
    }
  }
  return rows;
}

/* 采纳：POST /proposal/<id>/confirm —— 后端落盘（走保护链），页面刷新正文。 */
async function confirmProposal(id) {
  const pid = String(id || '');
  if (!pid) return;
  const path = proposalPath('/' + encodeURIComponent(pid) + '/confirm');
  if (!path) return;
  let res = null;
  let data = null;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({}),
    });
  } catch (err) {
    toast(t('proposal.confirmFail', { e: (err && err.message) || String(err) }));
    return;
  }
  try { data = await res.json(); } catch (err) { data = null; }
  if (res.status === 409 || (data && data.code === 'BLOCK_STALE')) {
    // 这段在别处已被改动：后端已拒写并把单子判成 stale，页面只提示＋刷新。
    markProposalStale(pid);
    toast(t('proposal.stale'));
    await reloadBlocks();
    await loadProposals();
    return;
  }
  if (!res.ok || !data || data.ok === false) {
    toast(t('proposal.confirmFail', { e: (data && data.error) || ('HTTP ' + res.status) }));
    await loadProposals();
    return;
  }
  (data.warnings || []).forEach((w) => toast(w));
  toast(t('proposal.adopted'));
  await applyProposalResult(data);
  await rerunCheck();
  await loadProposals();
}

/* 409 之后：这张单服务端已判 stale，留在列表里说清原因（不给采纳）。 */
function markProposalStale(pid) {
  const known = (state.proposals || []).find((row) => row && row.id === pid);
  if (!known) return;
  state.staleProposals[pid] = Object.assign({}, known, { status: 'stale' });
}

/* 采纳之后：把新鲜内容换回正文（这一块 ＋ 同文件其它块）；草稿块插到锚段之后。 */
async function applyProposalResult(response) {
  const applied = response.applied || {};
  const proposal = response.proposal || {};
  const kind = String(proposal.kind || '');
  // 摊平一层：after（锚段）／block（落笔的那块）／html（这一块的新鲜渲染）。
  const data = Object.assign({}, applied, { html: response.html, blocks: response.blocks || {} });
  // 锚段上下文（跟 AI 面板里的 quote 同义：被引用的那一段）。
  const quote = { id: String(proposal.block || ''), file: String(applied.file || proposal.file || '') };
  if (applied.sha && data.block) state.blockSha[data.block] = applied.sha;
  if (data.block) state.blockTokens[data.block] = countProtTokens(data.html);
  if (kind === 'ai_draft' && data.block) {
    // 新草稿块：正文里还没有这一块，插到锚段之后。
    if (quote.id && data.html && insertBlockAfter(data.after, data.block, data.html, quote.file)) {
      applyFreshBlocks(data.blocks, data.block);
      return;
    }
    await loadDisk();
    return;
  }
  if (kind === 'evidence_freeze' || kind === 'evidence_unfreeze'
      || kind === 'add_fact' || kind === 'export_bundle') {
    // 账与证据面：不碰正文。追加事实后正文里的事实芯片要跟着账走，
    // 所以重载一次盘；读数面板由 confirmProposal 里的 rerunCheck 刷新。
    await loadDisk();
    return;
  }
  applyFreshBlocks(data.blocks, data.block, (data.blocks[data.block] || data.html));
}

/* 用服务端回的新鲜 html 原地换正文（与 saveBlockNode 的成功分支同一手法）。 */
function applyFreshBlocks(blocks, skipId, html) {
  const map = blocks || {};
  if (html && skipId) applyBlockHtml(skipId, html);
  Object.keys(map).forEach((id) => {
    if (id === skipId) return;
    const live = blockNodeById(id);
    if (!live) return;
    const active = document.activeElement;
    if (active && live.contains(active)) { live.dataset.stale = '1'; return; }
    applyBlockHtml(id, map[id]);
  });
}

/* 拒绝：POST /proposal/<id>/reject —— 丢弃这张单，正文一个字不动。 */
async function rejectProposal(id) {
  const pid = String(id || '');
  if (!pid) return;
  // 本地判过期的单服务端已经结掉了：直接把它从列表里拿掉，不去打扰服务端。
  if (state.staleProposals[pid]) {
    delete state.staleProposals[pid];
    toast(t('proposal.rejected'));
    renderProposals(mergeProposalRows(state.proposals));
    return;
  }
  const path = proposalPath('/' + encodeURIComponent(pid) + '/reject');
  if (!path) return;
  try {
    await postJSON(path, {});
    delete state.staleProposals[pid];
    toast(t('proposal.rejected'));
  } catch (err) {
    toast(t('proposal.rejectFail', { e: (err && err.message) || String(err) }));
  }
  await loadProposals();
}

/* 打开差异卡模态：列当前盘待确认的提议。 */
async function openProposals() {
  const modal = $('#modalProposal');
  if (modal) modal.hidden = false;
  await loadProposals();
}

/* ---------------------------------------------------------------- 全检模态（段五） */

function openCheckModal() {
  const modal = $('#modalCheck');
  if (modal) modal.hidden = false;
}

function switchCheckTab(name) {
  $$('.mt-tab').forEach((btn) => btn.classList.toggle('on', btn.dataset.mt === name));
  const report = $('#mtReport');
  const machine = $('#mtMachine');
  if (report) report.classList.toggle('on', name === 'report');
  if (machine) machine.classList.toggle('on', name === 'machine');
  if (name === 'report') renderReport();
  if (name === 'machine') renderMachine();
}

async function runFullCheck() {
  openCheckModal();
  switchCheckTab('report');
  await rerunCheck();
}

function bind() {
  $('#goProjects').addEventListener('click', () => { setView('projects'); loadProjects(); });
  // 条目 33：字标可点，与 [Projects] 同去项目管理视图。
  $('#goBrand').addEventListener('click', () => { setView('projects'); loadProjects(); });
  $('#pjSearch').addEventListener('input', (ev) => {
    state.filter = ev.target.value || '';
    renderProjects();
  });
  $('#langSeg').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-lang]');
    if (!btn) return;
    const lang = btn.dataset.lang;
    // 条目 41：界面语言永远切；workbench 下有对应盘就照旧切盘，
    // 没有对应盘就停留在当前盘只切界面语言（不再 toast 硬 return）。
    state.lang = lang;
    applyI18n();
    if (state.project && document.body.getAttribute('data-view') === 'workbench') {
      const disk = state.project.disks.find((d) => d.lang === lang);
      if (disk) openProject(state.project.id, disk.id);
      else renderTocList();   // 条目 44：只切界面语言时，目录条目槽跟着刷
      return;
    }
    renderProjects();
  });
  // 段五返修七（条目 33）：右栏工具条＝纯图标收起钮 ＋ 三枚切换钮（互斥）
  $('#npCollapse').addEventListener('click', () => {
    setNavCollapsed(!document.body.classList.contains('nav-collapsed'));
  });
  $('#navOpen').addEventListener('click', () => { setNavCollapsed(false); });
  $('#npToc').addEventListener('click', () => { switchNavPane('toc'); });
  $('#npAi').addEventListener('click', () => { switchNavPane('ai'); });
  // 条目 33：实验报告／知识库／版式三段合并进「更多」面板，工具条只剩一枚钮。
  $('#npMore').addEventListener('click', () => { switchNavPane('more'); });
  // 段五：常用功能（弹模态框操作）
  $('#actPdf').addEventListener('click', runPdfAction);
  $('#actCheck').addEventListener('click', runFullCheck);
  $('#actBundle').addEventListener('click', runBundleAction);
  $('#actOpenDir').addEventListener('click', runOpenDirAction);
  // v2：待确认提议单——左栏徽标打开差异卡模态，卡上的两枚钮就地处理。
  $('#btnProposals').addEventListener('click', openProposals);
  $('#proposalClose').addEventListener('click', () => { $('#modalProposal').hidden = true; });
  $('#modalProposal').addEventListener('click', (ev) => {
    if (ev.target.id === 'modalProposal') $('#modalProposal').hidden = true;
  });
  $('#proposalList').addEventListener('click', (ev) => {
    const target = ev.target;
    if (!target || !target.closest) return;
    const adopt = target.closest('[data-confirm]');
    if (adopt) { confirmProposal(adopt.getAttribute('data-confirm')); return; }
    const reject = target.closest('[data-reject]');
    if (reject) { rejectProposal(reject.getAttribute('data-reject')); return; }
  });
  $('#actClose').addEventListener('click', () => { $('#modalAction').hidden = true; });
  $('#modalAction').addEventListener('click', (ev) => {
    if (ev.target.id === 'modalAction') $('#modalAction').hidden = true;
  });
  $('#modalCheckClose').addEventListener('click', () => { $('#modalCheck').hidden = true; });
  $('#modalCheck').addEventListener('click', (ev) => {
    if (ev.target.id === 'modalCheck') $('#modalCheck').hidden = true;
  });
  $$('.mt-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchCheckTab(btn.dataset.mt));
  });
  // 段五：证据卡
  $('#fcClose').addEventListener('click', closeFactCard);
  // 段四：AI 对话（真后端；浮层）
  // 条目 42：模型下拉——选中记进 state，下一轮提问带上。
  $('#aiModel').addEventListener('change', (ev) => {
    state.ai.model = String(ev.target.value || '').trim();
    state.ai.effort = '';
    renderAiEffort();
  });
  // v4：思考等级与自定义模型入口
  $('#aiEffort').addEventListener('change', (ev) => {
    state.ai.effort = String(ev.target.value || '').trim();
  });
  $('#aiAddModel').addEventListener('click', () => { openCustomModelForm(); });
  $('#aiDelModel').addEventListener('click', () => { deleteCustomModel(); });
  $('#cmSave').addEventListener('click', () => { saveCustomModel(); });
  $('#cmCancel').addEventListener('click', () => {
    const modal = $('#modalCustomModel');
    if (modal) modal.hidden = true;
  });
  $('#modalCustomModel').addEventListener('click', (ev) => {
    if (ev.target.id === 'modalCustomModel') $('#modalCustomModel').hidden = true;
  });
  $('#aiSend').addEventListener('click', () => {
    const input = $('#aiText');
    const text = input ? input.value.trim() : '';
    if (!text) return;
    if (input) input.value = '';
    aiSend(text, 'ask');
  });
  $('#aiText').addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' || ev.shiftKey) return;
    ev.preventDefault();
    $('#aiSend').click();
  });
  $$('#aiPane .aq').forEach((btn) => {
    btn.addEventListener('click', () => aiSend(t('ai.q' + btn.dataset.q + '.text'), 'ask'));
  });
  $('#aiFab').addEventListener('click', clearAiConversation);
  // 段六：模式切换（聊想法／写论文）
  $('#aiModes').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-mode]');
    if (!btn) return;
    setAiMode(btn.dataset.mode);
  });
  $('#askReportRead').addEventListener('click', () => {
    switchNavPane('ai');
    aiSend(t('ai.reportQ'), 'explain');
  });
  $('#ptAsk').addEventListener('click', () => {
    const target = paraAskTarget;
    if (!target) return;
    askAiAbout(target.text, target.section, target.id, target.file);
  });
  // 段六：段落 ⋯ 菜单（编辑 ＋ 续写／改写／提问）
  $('#ptMore').addEventListener('click', (ev) => {
    ev.stopPropagation();
    openParaMenu();
  });
  $('#miEdit').addEventListener('click', () => {
    // 条目 43：页面本就是编辑器——「编辑」＝把光标落进那一块。
    const target = paraAskTarget;
    closeParaMenu();
    if (!target) return;
    focusBlockNode(target.id);
  });
  $('#miContinue').addEventListener('click', () => paraAction('continue'));
  $('#miRewrite').addEventListener('click', () => paraAction('rewrite'));
  $('#miAsk').addEventListener('click', () => paraAction('ask'));
  // 插入事实：数字只能来自事实账（不许凭空造）。
  $('#miFact').addEventListener('click', () => {
    const target = paraAskTarget;
    closeParaMenu();
    if (!target) return;
    openFactInsert(target);
  });
  // 改章节名
  $('#rnOk').addEventListener('click', saveRenameSection);
  $('#rnCancel').addEventListener('click', () => {
    $('#modalRename').hidden = true;
    state.renameTarget = null;
  });
  $('#rnTitle').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); saveRenameSection(); }
  });
  // 改论文标题
  $('#btnEditTitle').addEventListener('click', openTitleModal);
  $('#dtOk').addEventListener('click', saveDiskTitle);
  $('#dtCancel').addEventListener('click', () => { $('#modalTitle').hidden = true; });
  $('#dtTitle').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); saveDiskTitle(); }
  });
  // 插入事实面板
  $('#fiSearch').addEventListener('input', renderFactInsertList);
  $('#fiCancel').addEventListener('click', () => { $('#modalFactIns').hidden = true; });
  $('#paraMenu').addEventListener('click', (ev) => ev.stopPropagation());
  $('#ptools').addEventListener('mouseenter', () => clearTimeout(paraToolsTimer));
  $('#ptools').addEventListener('mouseleave', hideParaTools);
  // 段六：知识库上传
  $('#npKbUploadBtn').addEventListener('click', () => $('#npKbUpload').click());
  $('#npKbUpload').addEventListener('change', uploadKbFile);
  // 引用增删（旧节级前端那页搬过来的）
  $('#npCiteAddBtn').addEventListener('click', openCiteForm);
  $('#ctCancel').addEventListener('click', closeCiteForm);
  $('#ctOk').addEventListener('click', addCitation);
  $('#citeList').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-key]');
    if (!btn) return;
    deleteCitation(btn.dataset.key);
  });
  // 图片预览
  $('#assetGrid').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-path]');
    if (!btn) return;
    openAsset(btn.dataset.path);
  });
  $('#asClose').addEventListener('click', () => { $('#modalAsset').hidden = true; });
  // 内置示例：装到工作根下面
  $('#goSample').addEventListener('click', installSample);
  // 段六：版式（存配置 ＋ 首页预览 ＋ 选刊指南）
  $('#vnSave').addEventListener('click', saveVenueConfig);
  $('#npVenueGuideBtn').addEventListener('click', openVenueGuide);
  $('#guideClose').addEventListener('click', closeVenueGuide);
  $('#guideGo').addEventListener('click', () => {
    // 条目 39：选刊指南只落版式，不再渲染首页预览。
    closeVenueGuide();
    switchNavPane('more');
  });
  $('#modalGuide').addEventListener('click', (ev) => {
    if (ev.target.id === 'modalGuide') closeVenueGuide();
  });
  // 段五：实验报告列表（导航面板里）
  $('#npImportBtn').addEventListener('click', openWizard);
  // 条目 35：知识库预览模态 ＋ 报告详情模态 ＋ 通用确认模态
  $('#kbModalClose').addEventListener('click', () => { $('#modalKb').hidden = true; });
  $('#modalKb').addEventListener('click', (ev) => {
    if (ev.target.id === 'modalKb') $('#modalKb').hidden = true;
  });
  $('#rpModalClose').addEventListener('click', () => { $('#modalRp').hidden = true; });
  $('#modalRp').addEventListener('click', (ev) => {
    if (ev.target.id === 'modalRp') $('#modalRp').hidden = true;
  });
  $('#rpModalDel').addEventListener('click', () => {
    const id = $('#modalRp').dataset.report || '';
    $('#modalRp').hidden = true;
    deleteReport(id);
  });
  $('#cfOk').addEventListener('click', () => closeConfirm(true));
  $('#cfCancel').addEventListener('click', () => closeConfirm(false));
  $('#modalConfirm').addEventListener('click', (ev) => {
    if (ev.target.id === 'modalConfirm') closeConfirm(false);
  });
  // 追加事实表单（两步：挑产物 → 说清这条数字 ＋ 落哪本账）
  $('#npAddFactBtn').addEventListener('click', openFactForm);
  $('#afCancel').addEventListener('click', closeFactForm);
  $('#afBack').addEventListener('click', () => {
    if (state.af && state.af.step > 1) { state.af.step -= 1; renderFactForm(); }
  });
  $('#afNext').addEventListener('click', onFactNext);
  $('#modalFact').addEventListener('click', (ev) => {
    if (ev.target.id === 'modalFact') closeFactForm();
  });
  $('#afSigned').addEventListener('change', onAfSourcePick);
  $('#afUnsigned').addEventListener('change', onAfSourcePick);
  // 未签产物默认折叠；展开时才渲染那几百上千条。
  $('#afUnsignedFold').addEventListener('toggle', () => { renderAfSources(); });
  $('#afSearch').addEventListener('input', (ev) => {
    if (!state.af) return;
    state.af.query = ev.target.value || '';
    renderAfSources();
  });
  $('#afLedgers').addEventListener('change', onAfLedgerPick);
  // 段四：导入向导（选文件 → 字段映射 → 确认绑定）
  $('#wzFiles').addEventListener('change', (ev) => {
    const input = ev.target;
    if (!input || input.name !== 'wzf') return;
    state.wz.file = input.value;
    renderWz();
  });
  $('#wzUpload').addEventListener('change', onWzUpload);
  $('#wzRows').addEventListener('input', onWzRowEdit);
  $('#wzRows').addEventListener('change', onWzRowEdit);
  $('#wzBack').addEventListener('click', () => {
    if (state.wz.step > 1) { state.wz.step -= 1; renderWz(); }
  });
  $('#wzNext').addEventListener('click', async () => {
    const step = state.wz.step;
    if (step === 1) {
      if (!state.wz.file) { toast(t('wz.nofile')); return; }
      state.wz.step = 2;
      renderWz();
      await parseReport();
      return;
    }
    if (step === 2) {
      if (!state.wz.rows.length) { toast(t('wz.norows')); return; }
      state.wz.step = 3;
      renderWz();
      return;
    }
    await confirmImport();
  });
  $('#wzCancel').addEventListener('click', closeWizard);
  $('#wizardModal').addEventListener('click', (ev) => {
    if (ev.target.id === 'wizardModal') closeWizard();
  });
  // 段二：新建/编辑项目
  $('#goNew').addEventListener('click', () => openForm('new'));
  $('#projectForm').addEventListener('submit', submitForm);
  $('#pfCancel').addEventListener('click', () => setView('projects'));
  $('#pfDir').addEventListener('input', syncReportsDefault);
  $('#pfSlug').addEventListener('input', syncReportsDefault);
  $('#pfReportsUnlock').addEventListener('click', () => {
    $('#pfReports').readOnly = false;
    $('#pfReportsUnlock').hidden = true;
    $('#pfReportsReset').hidden = false;
  });
  $('#pfReportsReset').addEventListener('click', () => {
    syncReportsDefault();
    $('#pfReports').readOnly = true;
    $('#pfReportsUnlock').hidden = false;
    $('#pfReportsReset').hidden = true;
  });
  // 段二：章节管理（目录行内入口）
  $('#newSecOk').addEventListener('click', createSection);
  $('#newSecCancel').addEventListener('click', () => { $('#modalNew').hidden = true; });
  $('#modalNew').addEventListener('click', (ev) => {
    if (ev.target.id === 'modalNew') $('#modalNew').hidden = true;
  });
  // 段三：检查报告折叠卡（默认全收起）与机器视图手风琴
  $$('.rc-fold-h').forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.rcard.fold');
      if (card) card.classList.toggle('open');
    });
  });
  $$('.acc-h').forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.acc-card');
      if (card) card.classList.toggle('on');
    });
  });
  // 段三：重跑检查（只读）+ 发现明细模态框
  $('#rpRerun').addEventListener('click', rerunCheck);
  $('#modalFindingsClose').addEventListener('click', () => { $('#modalFindings').hidden = true; });
  $('#modalFindings').addEventListener('click', (ev) => {
    if (ev.target.id === 'modalFindings') $('#modalFindings').hidden = true;
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    const modal = $('#modalFindings');
    if (modal && !modal.hidden) modal.hidden = true;
    // 条目 35：知识库预览／报告详情／确认框都吃 Esc
    const kbModal = $('#modalKb');
    if (kbModal && !kbModal.hidden) kbModal.hidden = true;
    const rpModal = $('#modalRp');
    if (rpModal && !rpModal.hidden) rpModal.hidden = true;
    const cfModal = $('#modalConfirm');
    if (cfModal && !cfModal.hidden) closeConfirm(false);
    const check = $('#modalCheck');
    if (check && !check.hidden) check.hidden = true;
    const action = $('#modalAction');
    if (action && !action.hidden) action.hidden = true;
    const wizard = $('#wizardModal');
    if (wizard && !wizard.hidden) closeWizard();
    const afModal = $('#modalFact');
    if (afModal && !afModal.hidden) closeFactForm();
    const guide = $('#modalGuide');
    if (guide && !guide.hidden) closeVenueGuide();
    closeFactCard();
    closeParaMenu();
  });
  // 条目 44：IME 组合感知——组合期间不保存、不改编辑宿主、不挂角标；
  // 组合结束后统一补做（芯片重绑、欠下的整块替换、角标、欠下的保存）。
  document.addEventListener('compositionstart', (ev) => {
    const target = ev.target;
    const node = target && target.closest ? target.closest('[data-block-id]') : null;
    imeState.active = true;
    imeState.blockId = node ? (node.dataset.blockId || '') : '';
    if (imeState.stuckTimer) { clearTimeout(imeState.stuckTimer); imeState.stuckTimer = 0; }
    imeState.stuckTimer = setTimeout(clearStuckComposition, 5000);
  }, true);
  document.addEventListener('compositionend', () => {
    if (imeState.stuckTimer) { clearTimeout(imeState.stuckTimer); imeState.stuckTimer = 0; }
    const blockId = imeState.blockId;
    imeState.active = false;
    imeState.blockId = '';
    flushAfterComposition(blockId);
  }, true);
  // 「脏」标记：只有**用户真的动过**这一块才打上（input 事件）。
  // 刷新页面、打开盘、引擎自己写盘（last_opened 之类）都不算编辑——
  // 它们不碰正文，也就不该触发保存（这一条堵住了「刷新就存一次」）。
  document.addEventListener('input', (ev) => {
    const target = ev.target;
    if (!target || !target.closest) return;
    const node = target.closest('[data-block-id]');
    if (!node || !node.isConnected) return;
    node.dataset.dirty = '1';
  }, true);
  // 条目 43：失焦即保存（容器级委托，会冒泡；120ms 守卫焦点去向——
  // 点块内的芯片不算离开）。没有「进入编辑」，也就没有「取消编辑」。
  document.addEventListener('focusout', (ev) => {
    const target = ev.target;
    if (!target || !target.closest) return;
    const node = target.closest('[data-block-id]');
    if (!node || !node.isConnected) return;
    if (node.dataset.saving === '1') return;
    setTimeout(() => {
      if (!node.isConnected) return;
      const active = document.activeElement;
      if (active && node.contains(active)) return;
      if (node.dataset.dirty !== '1') return;   // 没编辑过 → 不保存
      saveBlockNode(node);
    }, 120);
  });
  // 有未保存的编辑时，刷新/关页先问一句——**不代替保存**：刷新本身不写盘。
  window.addEventListener('beforeunload', (ev) => {
    if (!document.querySelector('[data-block-id][data-dirty="1"]')) return;
    ev.preventDefault();
    ev.returnValue = '';
  });
  // 条目 43：Esc＝主动失焦 → 走保存；没有「取消编辑」的概念。
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    const active = document.activeElement;
    if (active && active.closest && active.closest('[data-block-id]')) {
      ev.preventDefault();
      active.blur();
    }
  });
  window.addEventListener('scroll', () => {
    const doc = document.documentElement;
    const total = doc.scrollHeight - doc.clientHeight;
    const pct = total > 0 ? (doc.scrollTop / total) * 100 : 0;
    const bar = $('#prog');
    if (bar) bar.style.width = Math.min(100, pct) + '%';
  });
}

/* ---------------------------------------------------------------- 右栏宽度（可拖）

   侧栏宽度是**这台机器的界面偏好**，跟项目数据无关——记在 localStorage，
   刷新还在（与「中/EN」那枚开关同一套做法）。

   宽度有上下限：正文不能被拖没，右栏也不能窄到没法用。拖动时左右两栏
   实时变；松手才记进 localStorage（拖的过程不写盘）。 */

const NAVW_KEY = 'factscribe.navw';
const NAVW_DEFAULT = 320;
const NAVW_MIN = 240;
const NAVW_MAX = 640;
/** 正文至少留这么宽（再窄就没法读了）——上限跟着它算。 */
const NAVW_BODY_MIN = 420;

function navWidthMax() {
  const limit = Math.max(NAVW_MIN, Math.floor(window.innerWidth - NAVW_BODY_MIN));
  return Math.min(NAVW_MAX, limit);
}

function navWidth() {
  let raw = 0;
  try { raw = parseInt(localStorage.getItem(NAVW_KEY) || '', 10) || 0; } catch (err) { raw = 0; }
  if (!raw) return NAVW_DEFAULT;
  return Math.min(Math.max(raw, NAVW_MIN), navWidthMax());
}

/*: 当前生效的宽度（拖动中实时变；松手时记进 localStorage 的就是这个值，
   不是「回头去读旧值」——那会把刚拖出来的宽度又弹回去）。 */
let currentNavWidth = NAVW_DEFAULT;

function applyNavWidth(px) {
  const w = Math.min(Math.max(Math.round(px), NAVW_MIN), navWidthMax());
  currentNavWidth = w;
  document.documentElement.style.setProperty('--nav-w', w + 'px');
  return w;
}

function initNavSplitter() {
  const bar = $('#navSplitter');
  if (!bar) return;
  applyNavWidth(navWidth());
  let dragging = false;
  bar.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    dragging = true;
    document.body.classList.add('nav-dragging');
    if (bar.setPointerCapture) {
      try { bar.setPointerCapture(ev.pointerId); } catch (err) { /* 忽略 */ }
    }
  });
  bar.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    ev.preventDefault();
    applyNavWidth(window.innerWidth - ev.clientX);
    syncFixedHeaderWidth();
  });
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('nav-dragging');
    // 记的是**刚拖出来**的那个宽度（本轮生效值），不是存储里的旧值。
    const w = currentNavWidth;
    applyNavWidth(w);
    try { localStorage.setItem(NAVW_KEY, String(w)); } catch (err) { /* 无痕模式等：存不下就算了 */ }
    scheduleHeaderWidthSync();
  };
  bar.addEventListener('pointerup', stop);
  bar.addEventListener('pointercancel', stop);
  // 双击分隔条＝回到默认宽度。
  bar.addEventListener('dblclick', () => {
    applyNavWidth(NAVW_DEFAULT);
    try { localStorage.setItem(NAVW_KEY, String(NAVW_DEFAULT)); } catch (err) { /* 忽略 */ }
    scheduleHeaderWidthSync();
  });
  window.addEventListener('resize', () => {
    applyNavWidth(navWidth());
    scheduleHeaderWidthSync();
  });
}

async function main() {
  bind();
  applyI18n();
  initNavSplitter();
  switchNavPane('toc');
  await loadProjects();
  // v2：页面初始化时刷一次待确认提议单（还没开项目时徽标是空的）。
  await loadProposals();
  setView('projects');
  // 条目 40：固定头部宽度随左区实测（首屏布局落定后同步一次）。
  scheduleHeaderWidthSync();
  window.addEventListener('resize', scheduleHeaderWidthSync);
}

document.addEventListener('DOMContentLoaded', main);
