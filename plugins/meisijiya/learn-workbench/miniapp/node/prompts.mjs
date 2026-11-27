import { allLessons } from './store.mjs';
import { artifactPaths, COURSE_CSS_REL, scopeLines, workbenchPaths } from './policy.mjs';

function clip(value, max) {
  const text = String(value ?? '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export function lessonFileName(lesson) {
  const no = String(lesson.no).padStart(4, '0');
  const slug =
    String(lesson.title)
      .normalize('NFKD')
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 50) || 'lesson';
  const dir = artifactPaths('lesson')[0];
  return `${dir}/${no}-${slug}.html`;
}

export function noteFileName(title, date = new Date()) {
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
  const clock = `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`;
  const slug =
    String(title)
      .normalize('NFKD')
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 36) || 'note';
  const dir = artifactPaths('notes')[0];
  return `${dir}/${stamp}-${slug}-${clock}.md`;
}

export function buildContextPacket({ workspace, curriculum, lesson, records, mainSession }) {
  const lessons = allLessons(curriculum);
  const outline = curriculum.modules
    .map((module) => {
      const items = module.lessons
        .map((item) => `${String(item.no).padStart(2, '0')} ${item.title}${item.status === 'done' ? '（已完成）' : item.status === 'active' ? '（进行中）' : ''}`)
        .join(' · ');
      return `${module.title}：${items}`;
    })
    .join('\n');

  const doneRecords = records
    .slice(0, 6)
    .map((record) => {
      const summary = clip(record.excerpt ?? '', 160).replace(/\s+/g, ' ');
      return `- ${record.title}${summary ? `：${summary}` : ''}`;
    })
    .join('\n');

  const decisions = (mainSession?.messages ?? [])
    .filter((message) => message.role === 'assistant')
    .slice(-2)
    .map((message) => `- ${clip(message.text, 360).replace(/\s+/g, ' ')}`)
    .join('\n');

  const position = `第 ${lesson.no} 课 / 共 ${lessons.length} 课`;

  return [
    `【工作台】${workspace.name}（${workspace.root}）`,
    `【本课位置】${position}`,
    `【使命】${clip(
      (workspace.mission ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/^#.*$/gm, '').trim(),
      700,
    )}`,
    `【课纲】\n${clip(outline, 1200)}`,
    doneRecords ? `【已完成课程的学习记录】\n${clip(doneRecords, 900)}` : '',
    decisions ? `【主会话最近结论】\n${clip(decisions, 700)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function setupPrompt({ workspace, rulesPath }) {
  return `你是这个学习工作台的配置会话。工作台目录：${workspace.root}

这一步只搭前置环境：确定学习者是谁、想从这个目录里学到什么、有哪些约束。不要产出课程，也不要写课纲。

先做三件事（都用绝对路径）：
1. 读 ${rulesPath}；
2. 读 ${workspace.root}\\MISSION.md（现在是模板）；
3. 看一眼这个目录：列出根目录，读 README、docs/ 里能说明它在做什么的文件，判断用户为什么把这个目录选来学习。

然后用 ask_user 采访用户：一次问完，最多 3 个问题，围绕「你想从这个项目/目录里学到什么、为什么现在要学、时间与已有基础」。每题给 3–4 个具体选项，选项要基于你在目录里看到的东西来设计，不要问空泛的问题。

拿到答案后：
- 把 ${workspace.root}\\MISSION.md 写完整（严格按契约里的模板；首行是 # Mission: <一句话主题>）。
- 更新 ${workspace.root}\\RESOURCES.md：挑 2–4 个可信来源，每条一句话说明用途。
- 在 ${workspace.root}\\NOTES.md 记下用户的偏好，以及你在目录里看到、后面设计课程会用到的结构（比如已有的 tasks/、docs/）。

边界（硬性）：这一轮只做前置配置，不生成课纲，也不写任何课程文件。
${scopeLines('setup')}

完成标准：MISSION.md 的 Why 和 Success looks like 都写实了，不是模板占位。
写完后回复不超过 100 字：一句话主题 + 你记下的关键约束 + 一句「前置环境已就绪，可以生成课纲」。
停在这里，不要继续生成课纲或课程。`;
}

export function mainSeedPrompt({ workspace, rulesPath, hasMission }) {
  return `你是这个学习工作台的主会话（teacher of record）。工作台根目录：${workspace.root}

先读这两个文件，再动手（所有文件操作都用绝对路径）：
1. ${rulesPath} —— 教学契约，必须遵守
2. ${workspace.root}\\MISSION.md —— 当前使命${hasMission ? '（已填写）' : '（还是模板）'}
如果 \`mattpocock-skills:teach\` 这个 Skill 可用，也读一遍；它与上面的契约冲突时，以契约里的会话边界为准。

你的职责：确定使命、维护 RESOURCES.md 与 GLOSSARY.md、生成和调整课纲、处理全局配置。
你不写具体课程内容：课程文件由每节课的分支会话负责。

流程：
- 如果使命仍未确定，用 ask_user 采访用户：一次问完，最多 3 个问题，围绕「为什么学、想做成什么、时间与已有基础」。每题给 3–4 个具体选项，不要开放式空问。
- 拿到答案后，把 ${workspace.root}\\MISSION.md 写完整（严格按契约里的模板），并在 NOTES.md 记下用户的偏好。
- 然后回复不超过 120 字的小结：一句话使命 + 建议的模块数量 + 下一步。
- 除非用户明确要求，这一轮不要生成课纲。`;
}

export function curriculumPrompt({ workspace, rulesPath }) {
  return `任务：为这个学习工作台生成课纲。

先读：${rulesPath}、${workspace.root}\\MISSION.md、${workspace.root}\\RESOURCES.md。

要求：
- 3–6 个模块，每模块 2–5 节课，总课数 6–18；顺序从用户当前水平推到使命终点（最近发展区）。
- 每节课单点、预算 15–25 分钟、有可验证的产出，直接服务使命。
- 每节课必须能单独阅读：不假设读者记得上一课；需要前置知识时，用课内回顾补上（在 objective 里点明），拆不开的两课合并成一课。
- 课程标题用中文、动词开头（例：「用 clap 建立子命令」），不要用「第一讲」这类编号标题。
- objective 用一句话说清这节课结束时用户能做什么（可观察）。
- **保留已有课程的原标题**：工作台按标题把每节课绑到它自己的分支会话；改标题等于换一门课。
- 这一轮只写课纲，不要创建课程文件，不要写 HTML。

写入 ${workbenchPaths(workspace.root).curriculum}，严格是下面这个结构（不要注释、不要多余字段）：
{"schemaVersion":1,"modules":[{"title":"模块名","goal":"这一模块解决什么","lessons":[{"title":"课程标题","objective":"结束时能做什么","minutes":20}]}]}

同时把人类可读版写入 ${workspace.root}\\CURRICULUM.md：每个模块一节，列出课号、标题、目标。

完成后只回复：模块数、课程数、一句「课纲已写入」。`;
}

const LESSON_WRITING_RULES = `写作要求：
- 一个自包含 HTML：用 <link rel="stylesheet" href="../${COURSE_CSS_REL}"> 复用共享样式，必要时少量内联样式。
- 只教一个点，用户 20 分钟内能读完并做完练习。
- 自包含：不假设读者读过上一课；需要前置知识时，用 1–2 句回顾并链接到对应课程。
- 先给知识（来源以 RESOURCES.md 为准，不够就用 web 搜索补，并保持可信），再给互动练习。
- 至少 2 个检索练习：单选、四个选项长度尽量一致、点选后立即显示对错与原因（原生 JS 即可）。
- 每个事实性论断附近给来源链接；结尾列「主要来源」。
- 结尾提醒：可以在这个分支会话里继续追问。
- 不要引用远程脚本或 CDN。`;

export function lessonSeedPrompt({ workspace, rulesPath, lesson, target, contextPacket }) {
  return `你是第 ${lesson.no} 课的课程分支会话。这节课的上下文已经由主会话打包给你，你只负责这一课。

工作台：${workspace.root}
规则（先读）：${rulesPath}
如果 \`mattpocock-skills:teach\` 这个 Skill 可用，也读一遍；与规则冲突时以规则里的会话边界为准。
本课：${lesson.title}
目标：${lesson.objective || '（课纲未写目标，按标题把握）'}
预算：${lesson.minutes} 分钟
本课文件（唯一要写的课程文件）：${workspace.root}\\${target}

本课文件是唯一要写的课程文件；越界写入会被拒绝或还原。
${scopeLines('lesson')}

— 继承的上下文 —
${contextPacket}
— 上下文结束 —

${LESSON_WRITING_RULES}

第一步（不要跳过）：先读规则、MISSION.md 与共享样式，然后回复 3 句——本课要拿到的一个具体成果、你打算怎么讲、需要用户准备什么。之后再写文件。
写完回复：文件路径 + 一句自检（是否包含练习与来源）。`;
}

export function lessonRewritePrompt({ workspace, rulesPath, lesson, target, contextPacket }) {
  return `这是第 ${lesson.no} 课的整节重做：用户看过现有课程，要求把这一课重新写一遍。

工作台：${workspace.root}
规则（先读）：${rulesPath}
本课：${lesson.title}
目标：${lesson.objective || '（课纲未写目标，按标题把握）'}
预算：${lesson.minutes} 分钟
本课文件（唯一要写的课程文件，整份覆盖）：${workspace.root}\\${target}

本课文件是唯一要写的课程文件；越界写入会被拒绝或还原。
${scopeLines('lesson')}

— 继承的上下文 —
${contextPacket}
— 上下文结束 —

这是重做，不是追问：
- 覆盖同一个文件，不要新建第二个课程文件，也不要改其他课程。
- 先读本课现有文件与 MISSION.md：保留值得留的部分，改进讲法、练习与来源。
- 标题、目标、预算以课纲为准，不要改课纲。
- 不要先复述计划，直接写。

${LESSON_WRITING_RULES}

写完回复：文件路径 + 一句自检（哪里比上一版好，是否包含练习与来源）。`;
}

export function notePrompt({ workspace, rulesPath, title, target, lessons, annotations }) {
  const lessonLines = lessons
    .map((lesson) => `- 第 ${lesson.no} 课《${lesson.title}》：${workspace.root}\\${lesson.file}`)
    .join('\n');
  const annotationLines = annotations.length
    ? annotations
        .map((item) => {
          const lesson = lessons.find((entry) => entry.id === item.lessonId);
          const label = lesson ? `第 ${lesson.no} 课` : '相关课程';
          const quote = item.quote ? `引用「${clip(item.quote, 120)}」→ ` : '';
          return `- [${label}] ${quote}${clip(item.note, 300)}`;
        })
        .join('\n')
    : '（这个范围内没有批注）';

  return `笔记提炼任务（独立会话，只读课程与批注）。

工作台：${workspace.root}
规则：${rulesPath}（先读，尤其是文档格式与「不要编造」）
笔记标题：${title}

范围课程：
${lessonLines}

用户批注（用户自己的想法，必须被吸收，保留他们的用词）：
${annotationLines}

要求：
- 读上面列出的课程 HTML，提炼而不是照抄。
- 写入 ${workspace.root}\\${target}，结构：一句话主旨 / 核心模型或步骤 / 我的批注要点（标注课次，引用用户原话）/ 易错点 / 下一步练习 / 来源。
- 课程与批注冲突时保留冲突并指出，不要自行调和。
- 只写这一个笔记文件，不改课程、不改其他文件。

完成后回复：文件路径 + 一句话摘要。`;
}
