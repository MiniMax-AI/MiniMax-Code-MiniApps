# OpenFilm MiniApp

[English](README.md) | 简体中文

> **原作者：[openfilm/openfilm](https://github.com/openfilm/openfilm)。** OpenFilm 是原作者的开源作品。
> **本仓库只是把 OpenFilm 打包成 MiniMax Code 里的 MiniApp，方便使用** —— 不是 OpenFilm 官方仓库，不隶属于原作者团队，也不包含 OpenFilm 源代码。**本仓库的打包与公开分享已获得原作者本人授权（2026-10-24，由本仓库所有者确认）。**完整署名见 [NOTICE.md](NOTICE.md)。

把 **OpenFilm 装进 MiniMax Code** —— 跑的是**桌面版的界面**（Studio 编辑器 + 右边那栏聊天 + 本地 agent），不是只有网页版 Studio。

面板里那一页就是 OpenFilm 桌面 app 自己的页面。桌面 app 本来从 Electron 拿到的原生桥（`window.openfilmNative`）被换成走 HTTP 的一份；桌面 app 主进程里的那些 handler（聊天、本地 agent、技能、agent 名单）作为纯 Node 模块原样复用。所以聊天、agent 菜单、设置 → 智能体的行为跟桌面版一致 —— 因为它们就是桌面版的代码。

## 有什么

- 完整的 OpenFilm 编辑器：素材库、预览、检视器、时间线、导出。
- 桌面版那栏聊天：会话历史、输入框、agent 菜单、本地 agent 跑的回合。
- 设置 → 智能体是真正的名单（Codex、Claude Code、MiniMax Code、自有密钥……）。
- 打开时进你最近的 OpenFilm 项目；之后换项目在 OpenFilm 里面做（面板不加自己的顶栏）。
- 一个 Agent 可调用的接口（`POST /miniapp/open-desktop`）：叫起/激活你装着的 OpenFilm 桌面 app。
- 桌面模式用不了时，自动回落到纯网页版 Studio。

## 前提

- macOS 上的 MiniMax Code **3.1.2 或更新**（Host 的 loopback 凭据守着面板的端口）。
- Node.js 22+ 和 `npx`（面板用 `npx -y openfilm@0.2.5` 起 OpenFilm）。
- **只有桌面模式需要**：本地克隆 [openfilm/openfilm](https://github.com/openfilm/openfilm)，并构建一次桌面版页面。`@openfilm/desktop` 没发布到 npm，所以这些模块只能从仓库来。

```sh
git clone https://github.com/openfilm/openfilm.git ~/Developer/openfilm
cd ~/Developer/openfilm && pnpm install
pnpm --filter @openfilm/desktop build:shell
```

没有仓库也能用 —— 面板会回落到纯网页版 Studio（没有聊天栏）。

## 安装

把整个插件目录（包括隐藏的 `.minimax-plugin/`）复制到 MiniMax Code 的插件目录，例如 `~/.minimax/plugins/openfilm/`，重启 MiniMax Code，然后对 Agent 说「打开 OpenFilm 面板」。

manifest 最后要在：`~/.minimax/plugins/openfilm/.minimax-plugin/plugin.json`。

## 配置

改插件目录里的 `miniapp.config.json`。自己机器上的覆盖写 `miniapp.config.local.json`（已被 gitignore，不要提交）。

| 键 | 默认 | 含义 |
|---|---|---|
| `openfilmBin` / `openfilmArgs` | `npx -y openfilm@0.2.5`（固定） | 起哪个 OpenFilm（第一次会从 npm 下载）。 |
| `flavor` | `release` | 列哪套项目：`release`（`~/.openfilm`、`~/Movies/OpenFilm/Projects`）或 `dev`（`~/.openfilm-dev`）。 |
| `desktopMode` | `true` | 桌面版界面 + 聊天 + 本地 agent。`false` = 纯网页版。 |
| `openfilmRepo` | `~/Developer/openfilm` | OpenFilm 仓库在哪（也可用环境变量 `OPENFILM_REPO`）。桌面模式必须要。 |
| `shellDist` | `<仓库>/apps/desktop/shell/dist` | 构建出来的桌面版页面。 |
| `desktopApp` | 自动找（固定） | `POST /miniapp/open-desktop` 这个接口开哪个 app：先仓库里的 Dev 版，再 `/Applications/OpenFilm.app`。不可配置。 |
| `studioHome` / `studioPort` | `context.dataDir/openfilm-studio` / `4823` | 面板自己那份 Studio 的 home 和端口。`studioHome` 可为已有状态目录覆盖（文档写明的例外）；`studioPort` 用于隔离测试。 |

## 数据与访问

**这个包会启动的进程**

- `npx -y openfilm@0.2.5 open` —— 起 Studio（`openfilmBin`/`openfilmArgs` 已固定为这个；第一次跑会从 `registry.npmjs.org` 下载 OpenFilm）。
- `open -n <app>` / `open -a <app>`（macOS）—— 只开 `desktopCandidates()` 里那些固定位置（先 `<openfilmRepo>/apps/desktop/.dev/runtime` 下的 Dev 版，再 `/Applications/OpenFilm.app`、`~/Applications/OpenFilm.app`；Dev 候选依赖 `openfilmRepo` / `OPENFILM_REPO`）。
- `open -R <path>` —— 在访达里显示项目路径（只限项目文件夹）。
- `ps -ax -o command=` —— 看那个 app 是不是已经在跑。
- `pbcopy` —— 只用于聊天里的「复制诊断报告」。

**网络**

- `registry.npmjs.org`（第一次 `npx`）。
- 面板和 Studio 之间只有本机回环（`127.0.0.1`/`localhost`）。你调用的 agent 用它们自己的账号和网络。

**会读的文件**

- `~/.openfilm/studio.json`（`flavor` 为 `dev` 时是 `~/.openfilm-dev/studio.json`）：有哪些项目（只读）。
- 每个列出的项目的 `.film/id`（只读），用来定位项目。
- `<openfilmRepo>/apps/desktop/src/*.mjs` —— 桌面 handler，会被导入并运行（文档写明的桌面模式前提）。
- `<openfilmRepo>/apps/desktop/.dev/runtime/*` —— 找要叫起的 Dev 版 app。
- `<openfilmRepo>/apps/desktop/shell/dist/*` —— 伺服桌面版页面。
- agent 自己的配置/会话记录（通过 `<openfilmRepo>/apps/desktop/src` 里的桌面 handler）：
  - **MCP 配置**（`agent-skills.mjs` 的 `ownMcpServers`）：`~/.claude.json`（home 下的一个文件，只取其中的 `mcpServers` 字段）、项目 `.mcp.json`、`~/.codex/config.toml`（只取 `[mcp_servers.*]` 的 `command`/`url`）、`~/.config/opencode/opencode.json(c)`、`~/.qwen/settings.json`、`~/.copilot/mcp-config.json`。
  - **技能目录**（`ownSkills`）：`~/.claude/skills`、`~/.codex/skills`、`~/.agents/skills`、`~/.copilot/skills`，以及项目级的 `.claude/skills`、`.agents/skills`、`.codex/skills`、`.github/skills`、`.opencode/skill(s)`。
  - **会话记录**（`agent-records.mjs`）：`~/.claude/projects/**/<session>.jsonl`（含 `subagents/`）、`~/.codex/sessions/**`、`~/.codex/archived_sessions`、`~/.kimi-code/session_index.jsonl` 及其 session 目录、`~/.copilot/session-state/<id>/events.jsonl`。设置了 `CLAUDE_CONFIG_DIR`、`CODEX_HOME`、`COPILOT_HOME` 时按它们来。
  - `environment.mjs` 的 `loginShellVariables` 会跑用户的登录 shell（`$SHELL -l -i -c 'env -0'`）收集环境变量，传给本地 agent。

**从这些文件里实际读到什么**：配置文件里只读 MCP 服务器的名称和 `command`/`url`，记录目录里只读会话转录。不读任何凭据：`~/.claude/.credentials.json`、`~/.codex/auth.json`、系统钥匙串、MiniMax Code 自己的登录数据都不碰。具体会读哪些路径取决于 `openfilmRepo` 的上游版本（也就是你本地那个 checkout）。


**会写的文件**

- 只在 `context.dataDir`（`openfilm-studio/`）里：Studio home、偏好、缓存、日志、BYOK 主密钥和封存后的 BYOK 密钥。
- 项目数据通过 OpenFilm 自己的 API/handler 写入（`.film/` 下的聊天记录、项目目录里的 agent 会话），跟桌面 app 一样，不是面板自己写的。
- 旧的 `studioHome` 覆盖（`miniapp.config.local.json`）可以把 Studio home 指到别处（这台机器原来的 `~/.minimax/openfilm-studio`）。那是对已有状态目录的明确例外，不是一个任意可写路径。


## 安全

- **loopback 鉴权由 Host 做**（MiniMax Code 3.1.2+）：MiniApp 进程里的每个 `node:http` 服务都要每次运行一个凭据，包括本机直连和 WebSocket。这个包自己不造 token。
- **页面、客户端 JS、日志、错误响应里都不放密钥**。`/miniapp/studio` 不再返回 Studio 的 key，iframe 地址里不再有 `/open?key=`；网页版和桌面版编辑器都同源伺服，key 只在服务端带上。
- **代理有边界**。`/api/*` 只放编辑器用到的前缀（`/api/health`、`/api/projects`、`/api/files`、`/api/doctor`、`/api/library`、`/api/saved`、`/api/skills`、`/api/prefs`、`/api/examples`、`/api/fonts`、`/api/page-links`、`/api/exports`、`/api/look`），请求头只放 `accept`、`content-type`、`range`。`/p/*` 只读 GET/HEAD。WebSocket 只放 `/api/events` 和 `/api/projects/<id>/events`，只带握手头和 Studio key。
- **IPC 白名单 + 参数校验**（`server.mjs` 的 `IPC_RULES`）：安装、登录、`automatic` 一律不注册（403），其它频道逐个查参数。`desktop:reveal` 只限项目文件夹。和桌面版一样，页面也可以替你回答本地 agent 的权限提问（`desktop:local-agents:permission`）—— 聊天里的权限卡片就是这么工作的，而且这是你自己的界面。
- **进程启动固定**。`open-desktop` 只开自动发现的 OpenFilm app；`openfilmBin`/`openfilmArgs` 固定为 `npx -y openfilm@0.2.5`，环境变量只给 `PATH`、`HOME`、`LANG`、`TMPDIR`、`OPENFILM_*`。
- **状态放在 `context.dataDir`**（`openfilm-studio/`），插件目录里不写任何运行时数据。
- 在面板里保存的自有密钥（BYOK）用本机 `0600` 主密钥做 AES-256-GCM 封存（桌面 app 用的是系统钥匙串；两边不共享）。这只是对落盘文件的混淆，不是钥匙串级保护 —— 主密钥就在同一目录里，而且也兼容旧的 `raw:`（明文）值。


## 限制

- MiniApp 嵌不了 Electron 窗口本身；这里跑的是桌面版的**界面** + HTTP 原生桥。
- 面板里**不提供 agent 的安装、登录、`automatic` 流程**（这些请去桌面版做）。
- 原生文件/目录选择框和截屏返回 `null`（浏览器里没有原生对话框）。
- 桌面模式需要 OpenFilm 仓库 + 构建（见前提）。
- API 代理刻意排除了管理类路由（`/api/quit`、`/api/update`、`/api/open`、`/api/keys`），需要它们的操作在面板里不可用。
- 只在 macOS 测过；Windows/Linux 未测（有些地方用了 `open`、`pbcopy`、`ps`）。


## 测试环境

- macOS（Apple Silicon）上的 MiniMax Code 桌面版 3.1.2+，Node 22，OpenFilm 0.2.5。
- 桌面版页面带聊天栏和真实会话历史渲染正常，切项目正常。
- `chat:load` 返回真实会话；agent 名单 11 个；Codex ACP 探测能起会话；Claude Code 如实报未安装。
- 验收脚本 44 项：启动、项目列表、桌面 IPC、名单、SSE、网页降级、缺构建报错、并发只起一个 Studio、SSE 开着时 dispose 不挂、评审要求的安全断言（页面无 key、路由与 IPC 白名单、参数校验、reveal 限制），以及预览链路（影片页代理、EDITOR 改写、同源放开、素材可读）。

自己跑一遍验收：

```sh
node test/accept-miniapp.mjs        # 不想跑 Codex ACP 探测就 SKIP_PROBE=1
```

全部实例用临时 home 和端口（4900–4903），跑完自己收掉；不碰你正在用的面板，也不写你的项目。桌面模式的检查需要 OpenFilm 仓库 + 构建（见前提）。装好后也开一次面板，看看设置 → 智能体。

## 许可

MIT，见 [LICENSE](LICENSE)。

OpenFilm 是 [openfilm/openfilm](https://github.com/openfilm/openfilm) 的作品；这个包只在运行时驱动它，不包含 OpenFilm 的源代码。完整署名见 [NOTICE.md](NOTICE.md)。
