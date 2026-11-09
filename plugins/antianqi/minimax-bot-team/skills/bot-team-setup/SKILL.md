---
name: bot-team-setup
description: Use this skill when the user wants to build or change a team of MiniMax Bots - decide how many Bots are needed and what each one does, create them with create_bot, write the identity files every Bot carries (AGENTS.md, IDENTITY.md, SOUL.md), keep the common and the shared files in shape, put the Bots into a group chat and hand the first task over. Read it before the first create_bot call of a session.
license: Apache-2.0
metadata:
  author: antianqi
  version: 1.0.0
---

# MiniMax Bot 团队搭建

这个插件把 MiniMax Code 变成一支常驻的 Bot 团队：一个主 Bot 接单与调度，若干成员 Bot 在私聊里干活，群聊里 @ 某人就是派活。每个 Bot 带着自己的身份文件、记忆和定时任务，这些文件每一轮都进它的提示词。

搭团队不是「建几个 Bot」就完了。真正决定团队好不好用的是**每个 Bot 的身份文件写没写、写的是什么**。下面这套顺序是照着能跑通的次序排的。

## 0. 先问清楚三件事

问一次，问完就动手，不要来回追问：

1. **要做成什么事** —— 一句能验收的目标，例如「每天早上汇总行业动态发给我」。
2. **要几个 Bot** —— 默认一个主 Bot 加两三个成员。活干不完、或者两个角色职责不同，才拆。
3. **要不要群聊** —— 需要交接、要一起讨论才建；各干各的不用。

## 1. 建 Bot

    create_bot(name, role, instructions, skin?, main?, model?, effort?)

- `name` 必填，最多 24 字，不能带 @ 或换行；`role` 必填，最多 60 字；`instructions` 必填，最多 4000 字。
- `main: true` 只给主 Bot（接单与派活的那一个），成员一律 `main: false`。团队里至少要有一个主 Bot。
- `skin` 给每个 Bot 换一个形象，别让它们长得一样。
- 建完**记下返回的 bot_id**，第 2 步的文件都要写给它。

参数要写实在：`role` 是「做什么的」，`instructions` 是「怎么干活、交付什么」。

## 2. 写每个 Bot 的身份文件（最关键的一步）

每个 Bot 有自己的文件夹，运行时把它里面的 `.md` 文件逐轮放进这个 Bot 的提示词。文件名限 `A-Za-z0-9_-` 加 `.md`，最长 48 字符，单文件不超过 64 KB。

| 文件 | 写什么 | 建议长度 |
| --- | --- | --- |
| `AGENTS.md` | 角色、工作方式、可用工具、交付标准、什么时候该停 | 400 到 1200 字 |
| `IDENTITY.md` | 名字、职责、语气、怎么称呼用户 | 150 到 400 字 |
| `SOUL.md` | 性格、原则、明确不做什么 | 150 到 400 字 |

写法：

- 写「怎么做事」，不写「公司简介」。每一条都要能改变这个 Bot 的输出。
- 交付格式写死在 `AGENTS.md` 里：结论先行，产出给绝对路径、字节数和 SHA256，要点超过三条就压缩。
- 工具边界写清楚：什么该自己查，什么时候交回主 Bot，什么必须先问用户。
- 想让它有长期记忆，就告诉它用记忆工具存结论，不存过程。

用 `write_agent_file(bot, name, text)` 写，用 `read_agent_file(bot, name)` 读回来校对。

## 3. 全队共用的两份（Bot 自己写不了）

`common/ENV.md` 和 `common/USER.md` 全队共读一份：

- `ENV.md`：路径在哪、产出放哪、工具怎么用、消歧规则。
- `USER.md`：你服务的人是谁、偏好什么、怎么称呼。

**这两个 Bot 自己写不了**，写入会被拒。要改就让用户在设置页的「共用」里改，别反复试：把要写的内容直接给用户。

## 4. 口径卡（同样由宿主侧维护）

共享区放 `shared-*.md`，名字必须以 `shared-` 开头：

| 卡片 | 放什么 |
| --- | --- |
| `shared-brand.md` | 不可改的事实：名称、数字、历史 |
| `shared-external.md` | 对外说法与措辞 |
| `shared-env.md` | 环境地图：东西在哪、找谁 |
| `shared-discipline.md` | 全员纪律 |
| `shared-spec-discipline.md` | 只给部分成员的纪律 |

每张卡可以在开头写 `<!-- audience: Bot名字 -->`，只发给写明的 Bot；不写就全队都能读。卡也由宿主侧维护，Bot 改不了，要改就把新措辞给用户。

## 5. 建群

    create_group(name, members[], admin?, notice?, reply_mode?)

- `members` 填 bot_id。`reply_mode` 默认 `admin`（只有管理员回话），要人人能回就填 `all`。
- 群里有一条硬规则：**成员在群里不能自己动手**。读文件、跑脚本、取数、出图这类调用会被当场拦下，这一回合什么都交不出来。
- 但交接工具在群里能用：`dispatch_tasks` 正式派单，`message_bot` 私聊某个 Bot，`post_group` 群里发言。
- **主 Bot 在群里 @ 某人就是派活**，那条消息会直接落进被 @ 的人的私聊，当成任务书。

## 6. 派第一单

    dispatch_tasks(request_id, tasks[{to, message, title?}])

- `request_id` 每次唯一；重试同一件事时用同一个 id。
- 任务书写全：目标、输入在哪、验收标准、产出格式、别做什么。成员看不到你脑子里的上下文。
- 派完等回话，别自己把活干了。

## 7. 收工检查

- [ ] 每个 Bot 都有 AGENTS.md、IDENTITY.md、SOUL.md，内容是「怎么做事」
- [ ] 用户要改的 ENV.md 和 USER.md 已经告诉他去设置页改
- [ ] 群建好了，成员齐了，reply_mode 选对了
- [ ] 先派一个最小任务验证链路（能回话、能落文件），再交真活
- [ ] 定时任务用 `create_schedule` 建，别让 Bot 自己给自己排活

## 工具清单

| 工具 | 用途 |
| --- | --- |
| `list_team` | 看现在有哪些 Bot 和群 |
| `create_bot` / `update_bot` / `delete_bot` | 建、改、删 Bot |
| `create_group` / `update_group` / `delete_group` | 建、改、删群 |
| `write_agent_file` / `read_agent_file` / `list_agent_files` | 读写某个 Bot 的身份文件 |
| `dispatch_tasks` | 正式派单 |
| `message_bot` | 私聊一个 Bot |
| `post_group` | 群里发言 |
| `create_schedule` / `list_schedules` / `delete_schedule` | 定时任务 |
| `start_helper` / `stop_helper` / `list_helpers` | 后台 helper |
| `host_memory_search` / `memory_pending` | 宿主记忆检索与待收条目 |

---

# Building a MiniMax Bot team (English)

This plugin turns MiniMax Code into an always-on team of Bots: one chief Bot takes the work and hands it to the members, every Bot carries its own identity files, memory and schedules, and an @-mention in a group chat is how the work is handed over.

Building the team is not "create a few Bots". What decides whether the team works is **whether each Bot's identity files exist and what they say**. Follow the order below.

## 0. Ask three things, once

1. What are we achieving? One goal that can be checked.
2. How many Bots? One chief Bot plus two or three members by default.
3. Is a group chat needed? Only when the Bots hand work to each other.

## 1. Create the Bots

`create_bot(name, role, instructions, skin?, main?, model?, effort?)` - `name`, `role` and `instructions` are required. `main: true` marks the chief Bot; the members stay `main: false`. Give every Bot a different `skin` and keep the returned bot_id.

## 2. Write the identity files - this is the part that matters

Every Bot owns a folder of `.md` files, and the runtime puts them into that Bot's prompt on every turn.

| File | What it holds |
| --- | --- |
| `AGENTS.md` | The role, the way of working, the tools, the delivery standard, when to stop |
| `IDENTITY.md` | The name, the duty, the tone, how to address the user |
| `SOUL.md` | The character, the principles, what it refuses to do |

Write decisions, not introductions. Pin the delivery format into `AGENTS.md`: the conclusion first, and the absolute path plus byte count and SHA256 of every artefact. Use `write_agent_file(bot, name, text)`.

## 3. The two files the whole team shares

`common/ENV.md` (paths, output layout, how the tools are used) and `common/USER.md` (who the team serves). A Bot cannot write them: the user edits them in the settings under the common option, so tell the user exactly what to change instead of trying again.

## 4. The shared cards

Cards live in `shared-*.md` and are maintained by the host side as well. A card can name its readers with `<!-- audience: Bot name -->` at the top; without it every Bot reads it. The usual cards hold the brand facts, the outward wording, the map of the environment, the discipline for everyone and the discipline for some members.

## 5. The group chat

`create_group(name, members[], admin?, notice?, reply_mode?)`. One hard rule: a member may not work with its own tools inside a group chat - a read, a script or an image call is cut off and the turn ends with nothing to show. The handover tools do work there: `dispatch_tasks`, `message_bot` and `post_group`. **The chief Bot @-mentioning someone in a group is the handover.**

## 6. Hand over the first task

`dispatch_tasks(request_id, tasks[{to, message, title?}])`. The request id is unique per task and is reused on a retry. Write the brief out in full: the goal, where the input is, what "done" looks like, the output format and what not to do.

## 7. Before you call it done

- Every Bot has its three files, and they say how to work.
- The user was told what to change in the common files.
- The group exists, the members are in it, and the reply mode is right.
- One small task went through the chain before the real work.
