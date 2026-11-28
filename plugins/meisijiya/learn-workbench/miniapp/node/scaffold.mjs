import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { writeText, writeTextOnce } from './fsx.mjs';
import { artifactPaths, boundaryLines, COURSE_CSS_REL, RULES_DIR, STATE_RELS, WORKBENCH_DIR } from './policy.mjs';

export const TEACH_RULES = `# 教学契约（学习工作台）

本工作区遵循 Matt Pocock 的 teach 方法（改编自 \`mattpocock-skills:teach\`）。任何在这个目录里工作的会话都必须遵守本文件。
这是「为什么这样教」的唯一依据：课程结构、练习形式、文档格式都以它为准。

## 目录约定

- \`MISSION.md\`：使命。为什么学、学成什么样。所有教学决策都要能回溯到这里。
- \`CURRICULUM.md\`：人类可读的课纲。机器可读版在 \`${STATE_RELS.curriculum}\`。
- \`${artifactPaths('lesson')[0]}/0001-<dash-case>.html\`：课程。一课一个自包含 HTML 文件，编号递增。
- \`${artifactPaths('assets')[0]}/\`：课程共享的组件与样式（\`course.css\` 是默认样式表）。复用优先，不要复制粘贴。
- \`${artifactPaths('reference')[0]}/*.html\`：速查文档。可打印、排版干净，供反复查阅。
- \`${artifactPaths('records')[0]}/0001-<slug>.md\`：学习记录。记录非显然的理解、先前知识、被纠正的误解。
- \`GLOSSARY.md\`：术语表。只收录用户已经理解的术语。
- \`RESOURCES.md\`：可信来源清单，分 Knowledge / Wisdom 两组，每条都要有用途说明。
- \`NOTES.md\`：教学偏好与临时笔记。
- \`${artifactPaths('notes')[0]}/*.md\`：从课程与批注提炼出的笔记（由提炼会话写入）。
- \`${WORKBENCH_DIR}/\`：学习工作台的机器状态，由应用维护；会话的写权限见「会话职责」。

## 会话职责（硬边界）

${boundaryLines()}

## 教学原则

学习需要三样东西：知识（来自高质量来源）、技能（通过有反馈的练习获得）、智慧（真实世界的交流）。
不要相信自己的记忆：所有事实性陈述都要能指向 RESOURCES.md 里的来源。

- **区分流畅度与存储强度**。看懂了不等于记住了。设计课程时用检索练习、间隔、交错，制造「合意的困难」。
- **最近发展区**。每节课只比用户当前水平难一点点；读学习记录判断当前水平。
- **知识先行，技能随后**。先用最少的知识把概念讲清，然后立刻用互动练习把它变成技能。
- **反馈回路要短**。练习要立即给出对错与原因，不要让用户自己猜。
- **一课一个收获**。工作记忆很小；宁可少讲，也要让用户拿到一个可以马上用出去的东西。
- **每节课自包含**。读者只读这一课也能听懂；不假设他记得上一课的讲解。需要前置知识时，课内用 1–2 句回顾并链接到那一课；拆不开的两课合并成一课，不要拆成必须连着读的两课。

## 课程（lesson）要求

1. 一个自包含 HTML 文件，直接打开就能读。默认引用 \`../${COURSE_CSS_REL}\` 获得排版，
   需要时再加少量内联样式。
2. 15–25 分钟内可完成。开头用一句话说清「这节课结束时你能做什么」。
3. 结构：知识（带来源链接）→ 示例/演示 → 检索练习（至少 2 个）→ 这一课的收获 → 可以继续追问。
4. 检索练习题：单选，四个选项长度尽量一致（不要用格式泄露答案），点选后立即出现对错与原因。
5. 每个事实性论断附近给出链接；结尾列出「主要来源」。
6. 用原生 HTML/CSS/JS。不要引用远程脚本或 CDN。
7. 课程之间用相对链接互链；首次出现的术语链接到 \`${artifactPaths('reference')[0]}/\` 或 \`GLOSSARY.md\`。
8. 结尾必须有一句提醒：可以在这个工作台的分支会话里继续追问。
9. 打印友好：\`@media print\` 下不要出现交互控件。
10. 内容自包含：不依赖上一课的讲解才能看懂；需要前置知识时，用 1–2 句在课内回顾，并链接到对应课程。拆不开的内容合并成一课。

## 文档格式

### MISSION.md

\`\`\`md
# Mission: {Topic}

## Why
{1-3 sentences. The concrete real-world goal.}

## Success looks like
- {A specific, observable thing the user will be able to do}

## Constraints
- {Time, budget, prior commitments, learning preferences}

## Out of scope
- {Adjacent topics deliberately not chased now}
\`\`\`

保持一屏以内。使命需要变化时，先和用户确认，再更新这份文件，并补一条 learning-record 说明为什么变——
不要自己悄悄改掉方向，也不要留一份过时的使命指挥后面的课。

### RESOURCES.md

\`\`\`md
# {Topic} Resources

## Knowledge

- [Book: _Title_ by Author](https://example.com)
  一句话说明它覆盖什么、什么时候该查它。

## Wisdom (Communities)

- [r/example](https://example.com)
  高信噪比社区，用来：方案点评、瓶颈排错。

## Gaps
- {还没有找到好来源的方向}
\`\`\`

只收高可信来源；每条都要有用途说明；宁可五个锋利的来源，不要三十个平庸的。

### ${artifactPaths('records')[0]}/0001-<slug>.md

\`\`\`md
# {Short title}

{1-3 sentences: 学到了什么（或确认了什么先前知识），为什么它会影响后面的课。}
\`\`\`

只在有**证据**时写：用户演示了真正的理解、说明了已知、纠正了误解、或使命发生变化。
单纯的「讲过」不算学习，不要写。

### GLOSSARY.md

\`\`\`md
# {Topic} Glossary

## Terms

**术语**:
一到两句话，定义它是什么（不是怎么用）。
_Avoid_: 同义的模糊说法
\`\`\`

术语只有等用户能正确使用之后才收录。定义里优先使用表里已有的术语。
`;

const MISSION_TEMPLATE = (topic) => `# Mission: ${topic}

## Why
_待主会话与你确认：一句话说清为什么学、想做成什么。_

## Success looks like
- _待填写：一个具体、可观察的结果_

## Constraints
- _待填写：时间、预算、已有基础、学习偏好_

## Out of scope
- _待填写：这次明确不追的相邻主题_
`;

const RESOURCES_TEMPLATE = (topic) => `# ${topic} Resources

## Knowledge

- _待主会话补充：可信来源，每条一句话说明用途_

## Wisdom (Communities)

- _待补充：可以验证技能的真实社区_

## Gaps
- _还没有找到好来源的方向_
`;

const GLOSSARY_TEMPLATE = (topic) => `# ${topic} Glossary

只在你能正确使用一个术语之后，它才应该出现在这里。

## Terms

`;

const NOTES_TEMPLATE = `# 教学笔记

这里记录教学偏好、临时想法、以及主会话需要注意的事。

- 界面语言：中文
`;

const CURRICULUM_TEMPLATE = `# 课纲

尚未生成。在学习工作台的「概览」里点「生成课纲」，主会话会按使命写出模块与课程。
`;

export const COURSE_CSS = `/* 学习工作台共享课程样式：所有课程页默认引用它。 */
:root {
  --ink: #1c1b19;
  --muted: #6b6a66;
  --line: #0a0a0a14;
  --paper: #fbfaf7;
  --surface: #ffffff;
  --accent: #0b6bcb;
  --ok: #0f7a3d;
  --bad: #b42318;
  --warn: #b45309;
  --code: #f2f0eb;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ink: #ece9e2;
    --muted: #a09d95;
    --line: #ffffff1f;
    --paper: #1e1d1b;
    --surface: #26251f;
    --accent: #7db4ff;
    --ok: #6ee7a8;
    --bad: #ff9a8f;
    --warn: #ffc46b;
    --code: #2b2a24;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: ui-serif, Georgia, "Songti SC", "Source Han Serif SC", "Noto Serif CJK SC", serif;
  font-size: 17.5px;
  line-height: 1.85;
}
.lesson {
  max-width: 680px;
  margin: 0 auto;
  padding: 48px 28px 96px;
}
.kicker {
  font-family: ui-sans-serif, -apple-system, system-ui, "PingFang SC", sans-serif;
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 1.6em;
}
h1, h2, h3 {
  font-family: ui-sans-serif, -apple-system, system-ui, "PingFang SC", sans-serif;
  line-height: 1.35;
  letter-spacing: -0.01em;
}
h1 { font-size: 30px; font-weight: 600; margin: 0 0 0.4em; }
h2 { font-size: 18px; font-weight: 600; margin: 2em 0 0.3em; }
h3 { font-size: 15px; font-weight: 600; margin: 1.4em 0 0.2em; }
p { margin: 0 0 1em; }
a { color: var(--accent); text-decoration: none; border-bottom: 1px solid currentColor; }
a:hover { opacity: 0.8; }
code {
  font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85em;
  background: var(--code);
  border-radius: 4px;
  padding: 0.1em 0.34em;
}
pre {
  background: var(--code);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 14px 16px;
  overflow: auto;
  font-size: 13px;
  line-height: 1.7;
}
pre code { background: none; padding: 0; font-size: inherit; }
blockquote {
  margin: 1.4em 0;
  padding: 2px 0 2px 16px;
  border-left: 2px solid var(--line);
  color: var(--muted);
  font-style: italic;
}
ul, ol { padding-left: 1.3em; margin: 0 0 1em; }
li + li { margin-top: 0.3em; }
mark { background: #b4530922; border-radius: 2px; padding: 0 2px; color: inherit; }
.lede { font-size: 1.05em; color: var(--muted); }
.note {
  border: 1px solid var(--line);
  border-left: 3px solid var(--warn);
  border-radius: 8px;
  background: var(--surface);
  padding: 12px 14px;
  margin: 1.4em 0;
  font-family: ui-sans-serif, system-ui, "PingFang SC", sans-serif;
  font-size: 14px;
  line-height: 1.7;
}
.quiz {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  padding: 16px 18px;
  margin: 1.8em 0;
  font-family: ui-sans-serif, system-ui, "PingFang SC", sans-serif;
  font-size: 14px;
  line-height: 1.65;
}
.quiz h3 { margin: 0 0 2px; font-size: 14px; }
.quiz .prompt { margin: 0 0 12px; color: var(--muted); font-size: 13px; }
.quiz button {
  display: flex;
  gap: 9px;
  width: 100%;
  text-align: left;
  align-items: flex-start;
  padding: 9px 11px;
  margin-bottom: 6px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.quiz button:hover { border-color: var(--muted); }
.quiz button b { width: 18px; flex: none; color: var(--muted); font-weight: 500; }
.quiz button.right { border-color: var(--ok); background: color-mix(in srgb, var(--ok) 10%, transparent); }
.quiz button.wrong { border-color: var(--bad); background: color-mix(in srgb, var(--bad) 8%, transparent); }
.quiz .feedback { color: var(--muted); font-size: 13px; margin-top: 8px; }
.quiz .feedback[hidden] { display: none; }
.takeaway {
  border-top: 1px solid var(--line);
  margin-top: 2.4em;
  padding-top: 16px;
}
.takeaway h2 { margin-top: 0; }
.sources {
  font-family: ui-sans-serif, system-ui, "PingFang SC", sans-serif;
  font-size: 13px;
  color: var(--muted);
  border-top: 1px solid var(--line);
  margin-top: 2.4em;
  padding-top: 12px;
}
.ask-teacher {
  font-family: ui-sans-serif, system-ui, "PingFang SC", sans-serif;
  font-size: 13px;
  color: var(--muted);
  background: var(--code);
  border-radius: 8px;
  padding: 10px 12px;
  margin-top: 1.6em;
}
mark.wb-hl {
  background: color-mix(in srgb, #f59e0b 26%, transparent);
  border-bottom: 1px solid color-mix(in srgb, #f59e0b 70%, transparent);
  cursor: pointer;
}
@media print {
  body { background: #fff; color: #000; font-size: 12pt; }
  .quiz button, .ask-teacher { display: none; }
  a { color: #000; }
}
`;

/**
 * The contract text is generated from the write policy, so it is refreshed in
 * place: a workspace created by an older build must not keep a stale boundary.
 */
export async function refreshRules(root) {
  const rel = STATE_RELS.rules;
  const abs = path.join(root, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeText(abs, TEACH_RULES);
  return rel;
}

/** Create the teach workspace structure. Existing files are never overwritten. */
export async function ensureScaffold(root, { topic }) {
  const dirs = [
    ...['lesson', 'reference', 'records', 'assets', 'notes'].map((id) => artifactPaths(id)[0]),
    RULES_DIR,
    STATE_RELS.context,
  ];
  for (const dir of dirs) {
    await mkdir(path.join(root, dir), { recursive: true });
  }

  const files = [
    ['MISSION.md', MISSION_TEMPLATE(topic)],
    ['RESOURCES.md', RESOURCES_TEMPLATE(topic)],
    ['GLOSSARY.md', GLOSSARY_TEMPLATE(topic)],
    ['NOTES.md', NOTES_TEMPLATE],
    ['CURRICULUM.md', CURRICULUM_TEMPLATE],
    [COURSE_CSS_REL, COURSE_CSS],
    [STATE_RELS.rules, TEACH_RULES],
  ];
  const created = [];
  for (const [rel, text] of files) {
    if (await writeTextOnce(path.join(root, rel), text)) created.push(rel);
  }
  return created;
}
