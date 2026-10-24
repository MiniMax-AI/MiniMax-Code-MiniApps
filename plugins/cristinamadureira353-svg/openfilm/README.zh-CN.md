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
| `openfilmBin` / `openfilmArgs` | `npx` / `["-y","openfilm@0.2.5"]` | 起哪个 OpenFilm。 |
| `flavor` | `release` | 列哪套项目：`release`（`~/.openfilm`、`~/Movies/OpenFilm/Projects`）或 `dev`（`~/.openfilm-dev`）。 |
| `desktopMode` | `true` | 桌面版界面 + 聊天 + 本地 agent。`false` = 纯网页版。 |
| `openfilmRepo` | `~/Developer/openfilm` | OpenFilm 仓库在哪（也可用环境变量 `OPENFILM_REPO`）。桌面模式必须要。 |
| `shellDist` | `<仓库>/apps/desktop/shell/dist` | 构建出来的桌面版页面。 |
| `desktopApp` | 自动找 | `POST /miniapp/open-desktop` 这个接口开哪个 app。`[{ "path": "…", "args": ["…"] }]`；自动找 `/Applications/OpenFilm.app` 和仓库里的 Dev 版。 |
| `studioHome` / `studioPort` | `context.dataDir/openfilm-studio` / `4823` | 面板自己那份 Studio 的 home 和端口，测试时改成临时值。 |

## 数据与访问

- 在 `127.0.0.1` 上用 `npx` 起 `openfilm open`，`OPENFILM_HOME` 是面板自己的（Host 给的 `context.dataDir` 下的 `openfilm-studio/`），不抢你桌面 app 的 Studio home。
- 状态（Studio home、偏好、缓存、日志、BYOK 主密钥）只放在那个 `context.dataDir` 目录里。
- 只读选中那套 OpenFilm home 里的 `studio.json` 和各项目的 `.film/id`，用来列项目。
- 项目数据通过 OpenFilm 自己的 API 和桌面 handler 读写（`.film/` 下的聊天记录、项目目录里的 agent 会话），跟桌面 app 一样。
- 网络：第一次跑 `npx` 会下载 OpenFilm；你调用的 agent 用它们自己的账号和网络。

## 安全

- **loopback 鉴权由 Host 做**。MiniMax Code 3.1.2 起，Host 在 MiniApp 进程里的每个 `node:http` 服务上都装了每次运行一个凭据的检查：没凭据的请求 —— 包括本机直连和 WebSocket —— 在到这个包之前就 401。所以这个包自己不造 token。
- **页面、客户端 JS、日志、错误响应里都不放密钥**。Studio 的 key 只留在 Node 进程里，只在转发 `/api/*` 时带上；伺服出去的 HTML 里不注入任何密钥。
- **状态放在 `context.dataDir`**（它下面的 `openfilm-studio/`），由 Host 所有；插件目录里不写任何运行时数据。
- 在面板里保存的自有密钥（BYOK）用本机 `0600` 主密钥做 AES-256-GCM 封存（桌面 app 用的是系统钥匙串；两边的密钥存储不共享）。

这个面板能在项目目录里驱动本地 agent —— 只在你信任它的情况下安装，Agent 要做什么也由你把关。

## 限制

- MiniApp 嵌不了 Electron 窗口本身；这里跑的是桌面版的**界面** + HTTP 原生桥。
- 原生文件/目录选择框和截屏返回 `null`（浏览器里没有原生对话框）。
- 桌面模式需要 OpenFilm 仓库 + 构建（见前提）。
- 只在 macOS 测过；Windows/Linux 未测（有些地方用了 `open`、`pbcopy`、`ps`）。

## 测试环境

- macOS（Apple Silicon）上的 MiniMax Code 桌面版 3.1.2+，Node 22，OpenFilm 0.2.5。
- 桌面版页面带聊天栏和真实会话历史渲染正常，切项目正常。
- `chat:load` 返回真实会话；agent 名单 11 个；Codex ACP 探测能起会话；Claude Code 如实报未安装。
- 验收脚本 37 项：启动、项目列表、桌面 IPC、名单、SSE、网页降级、缺构建报错、并发只起一个 Studio、SSE 开着时 dispose 不挂，以及预览链路（影片页代理、EDITOR 改写、同源放开、素材可读）。

自己跑一遍验收：

```sh
node test/accept-miniapp.mjs        # 不想跑 Codex ACP 探测就 SKIP_PROBE=1
```

全部实例用临时 home 和端口（4900–4903），跑完自己收掉；不碰你正在用的面板，也不写你的项目。桌面模式的检查需要 OpenFilm 仓库 + 构建（见前提）。装好后也开一次面板，看看设置 → 智能体。

## 许可

MIT，见 [LICENSE](LICENSE)。

OpenFilm 是 [openfilm/openfilm](https://github.com/openfilm/openfilm) 的作品；这个包只在运行时驱动它，不包含 OpenFilm 的源代码。完整署名见 [NOTICE.md](NOTICE.md)。
