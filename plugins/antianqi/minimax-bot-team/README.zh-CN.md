# MiniMax Bot 团队

[English](README.md) | 简体中文

现在的 bot 像一个人轮流带着几个面具跟你聊天。MiniMax Bot Team 给你的是一支真正各有
能力、各有性格的团队，各自守着一个领域，也能围坐一起，从不同角度讨论同一个问题。

作者：[antianqi](https://github.com/antianqi) - 版本：`1.0.0`

## 它做什么

- **一个主 Bot 加一支队伍** - `create_bot` 建 Bot，`main: true` 标出接单并派活的那一个。
  每个 Bot 在自己的会话里回话，所以几个 Bot 可以同时干活而不打架。
- **每个 Bot 都带着自己的文件** - 每个 Bot 拥有一个 `.md` 文件夹，运行时每轮都把它们放进
  它的提示词：`AGENTS.md`（角色、工作方式、交付标准）、`IDENTITY.md`（名字、职责、语气）、
  `SOUL.md`（性格、原则、明确不做什么）。文件决定这个 Bot 有多好用，光有名册没有文件只是一行
  名单。
- **三个区，三个主人** - 自己的文件由 Bot 写；共用区（`ENV.md`、`USER.md`）与共享卡
  （`shared-*.md`）归用户，在设置页里改。卡片可以用 `<!-- audience: ... -->` 写明发给谁，
  事实只到该到的人手里。
- **群聊有一条硬规则** - 群里成员不能自己动手：读文件、跑脚本、出图会被当场拦下，这一回合什么
  都交不出来。交接工具在群里能用，而主 Bot @ 某人就是交接本身：那条消息会落进被 @ 的人的私聊，
  当成任务书。
- **定时任务与后台 helper** - 每天或一次性的任务按 Bot 自己的时间表跑成 Agent 回合，helper 可以
  在后台接下长活再回报。
- **一个说清「该写什么」的 Skill** - `skills/bot-team-setup/SKILL.md` 带着走完搭建：要几个 Bot、
  每个 Bot 的三个文件写什么、共用与共享文件放什么、什么时候需要群聊、第一单怎么派出去。工具是
  骨架，Skill 才是把它们变成团队的那一步。

## 如何安装与打开

1. 下载本仓库的 ZIP（**Code -> Download ZIP**）并解压，或者克隆：

   ```sh
   git clone https://github.com/MiniMax-AI/MiniMax-Code-MiniApps.git
   ```

2. 把整个目录 `plugins/antianqi/minimax-bot-team/`（**包含隐藏的 `.minimax-plugin` 目录**）
   复制到 `<dataDir>/plugins/minimax-bot-team/`。默认 `<dataDir>` 是 `~/.minimax`，所以装到
   `~/.minimax/plugins/minimax-bot-team/`。作者目录只是本仓库里的分组，别把它一起复制进
   `plugins/`。

   MiniMax Code 3.1.11 起可以直接导入：在插件页选 **Create**，Mini App 下选 **Import from a Git
   repository**，粘贴
   `https://github.com/MiniMax-AI/MiniMax-Code-MiniApps/tree/main/plugins/antianqi/minimax-bot-team`。

3. 重启 MiniMax Code，确认插件被识别并启用，然后打开面板。让 Agent 打开「MiniMax Bot」，或在
   插件列表里点开它。

不需要配置任何东西：没有 API key，没有账号，没有要注册的服务。Bot 跑在宿主已经在用的模型上。

## 测试环境

- MiniMax Code 3.1.2 及以上，macOS、Windows、Linux 均可。更早的版本装不了这个包，因为它声明了
  `agentAccess` 与 `surface.window`。
- 作者在 Windows 11（x64）上的 MiniMax Code 3.1.11 实测：面板能打开，Bot 能建，三个身份文件能
  写能读回，群能建，单能派出，答案能回到群里。macOS 与 Linux 未实测。包本身与平台无关：Node 服务
  只绑回环地址，页面是普通的 HTML、CSS 与 JavaScript。

## 数据与权限

- **Agent 回合**：每个 Bot 的回复、每个定时任务、每个后台 helper，都是通过 `context.agent`
  （`session.run`）跑的 Agent 回合，带 Agent 的完整能力：文件、shell、Skills 与 MCP，也包括本包
  自己的 MCP 工具。需要授权的工具调用会在页面或会话侧栏里出现，只有你点了**允许一次**才会执行，
  不会自动放行。
- **写入的文件**：只在 Mini App 的 `dataDir` 里：`state.json`、`messages/`（每个会话一个文件）、
  `usage.jsonl`（每个回合一行）、`memory/`（含日志与归档）、`shared/` 与 `common/`（口径卡与
  两份共用文件）、`agents/<bot-id>/`（各 Bot 的身份文件）、`uploads/`（你传的附件）、
  `avatars/`、以及 `memory-bridge/`（下面说的那个 helper）。聊天内容在落盘前会脱敏：看起来像密钥
  的值存成 `[REDACTED]`，磁盘上的历史不落秘密。
- **`dataDir` 之外读取的文件**：宿主的全局记忆文件（`~/.minimax/memories/scopes/global/`），只读，
  用来回答 Bot 的 `host_memory_search` 查询。宿主没有给这个能力的正式接口，所以它依赖宿主未承诺的
  目录结构，宿主改了布局就可能失效。那边一个字节都不写。
- **进程**：macOS 上会跑一次 `id -F`（1.5 秒超时）读你的账号全名当默认显示名。每次搜宿主记忆会起
  一个 helper 进程（`node <dataDir>/memory-bridge/search.mjs`），它的 stdout 把结果带回插件，跑完就
  退出。
- **网络**：Node 服务不发起任何对外请求，页面也不加载任何远程资源。HTML 预览会在隔离沙箱里加载被
  预览文档引用的 HTTP(S) 样式与资源。
- **环境变量**：读 `LC_ALL`、`LC_MESSAGES`、`LANG` 决定默认语言。
- **没有用到的**：麦克风、摄像头、系统通知，以及「你当前在 MiniMax Code 的哪个页面」，一律不读不
  申请——这个包一个都没声明。

## 已知限制

- 宿主的 Agent API 不能按会话过滤 MCP 目录，所以某个 Bot 可能在共享目录里看到一个它所在群不允许
  用的工具。服务端还是会拒掉这次调用。
- Bot 的身份文件只从它自己的文件夹读：子目录不读，文件名必须匹配 `[A-Za-z0-9_-]{1,48}.md`。
- 插件清单只显示一条描述字符串，这里中英文都写了，所以商店里会同时显示两种。

## 致谢

这个包建立在 MiniMax 发布的 MiniMax Bot Mini App 之上（MIT）。原始版权声明保留在 `LICENSE` 里，
本次发布的内容是上面那位作者的改动。

## 许可

[MIT](./LICENSE)
