---
name: openfilm
description: OpenFilm 装在 MiniMax Code 里了：面板里就是 OpenFilm 本体（桌面版的完整界面：编辑器 + 右边的聊天栏 + 本地 agent）。什么时候用：用户说「打开 OpenFilm」「在 OpenFilm 里看看」「切到某个项目」「这个项目的片子多长」「给我看看这条片子剪成什么样了」，或者要在 OpenFilm 项目里干活（改时间线、导片、跟 agent 讨论剪辑）时。这个 Skill 只讲怎么用这个面板与它的 OpenFilm，不负责剪辑决策，也不负责改 OpenFilm 的代码。
---

# OpenFilm 面板（Mini App）

OpenFilm 官方仓库的发布版（`openfilm@0.2.5`）被装成了一个 Mini App：面板里嵌的就是 OpenFilm 本体。

## 面板是什么

- **整个面板就是 OpenFilm 自己**（没有额外的顶栏/壳）。默认是**桌面版的界面**：Studio 的编辑器 + 右边那栏聊天（会话历史、输入框、agent 菜单、本地 agent 跑的回合）。
- 打开时进**最近那个项目**；之后换项目在 OpenFilm 里面做（它自己的「打开项目」），面板不重复做一套项目列表。
- 连的是正式版那套项目（`~/.openfilm` + `~/Movies/OpenFilm/Projects`）。

## 桌面版是怎么跑在面板里的（要知道，出问题才用得上）

MiniApp 只能是网页，Electron 的窗口整体塞不进面板。所以面板跑的是**桌面版的界面**（它本来就是网页：Studio 伺服的一页），缺的那套原生桥 `window.openfilmNative` 换成走 HTTP 的一份（`miniapp/client/bridge-web.js`）：

- 页面调 `POST /ipc/<频道>`，面板的 node 端按频道找 handler，把**桌面 app 主进程里那些 handler 原样拿来用**（`apps/desktop/src/chat-ipc.mjs`、`local-agents-ipc.mjs`、`skills-ipc.mjs` —— 它们是纯 Node 函数，只是拿了个 `ipcMain` 形状注册）。
- 页面订阅的推送走 `GET /ipc/events`（SSE）；Electron 的 `webContents.send()` 换成一个假的 sender。
- Studio 的 `/api/*` 由面板同源转发（页面在同一个源上，它用的是绝对路径）；Studio 的事件流是 WebSocket，也由面板转过去。影片页和素材走 `/p/*` 转发到 pages 服务：注入的 EDITOR 改写成面板源、Studio 返回的 folder 也改写到面板源，并且代理副本里放开了 bridge 的「同源不启动」—— 不然预览会一直停在「正在绘制第一帧」。
- **设置 → 智能体和聊天的 agent 菜单用的是 roster**（`agent-roster.mjs` + `agents.mjs`），不是 `localAgents` 那份；两个都要接，缺了 roster 就「你的智能体」一片空白。
- **鉴权由 Host 做**（MiniMax Code 3.1.2+ 的 loopback 凭据，覆盖进程里每个 node:http 服务，直连和 WebSocket 没凭据都 401）。这个包不自己造 token，页面里也不注入任何密钥。面板自己的接口在 `/miniapp/*`（Agent 走 Host 的 MCP 调它们时凭据由 Host 带）。
- **收尾**：dispose 会收本地 agent 会话、关 SSE 长连接、只关自己起的 Studio（reused 的不关）。

**桌面 app 的那些模块不在 npm 上**（`@openfilm/desktop` 没发布），只在仓库里 ⇒ 这一模式要指到仓库（`miniapp.config.json` 的 `openfilmRepo`），并且要先在仓库里构建一次桌面版的页面：

```sh
cd ~/Developer/openfilm && pnpm --filter @openfilm/desktop build:shell
```

`miniapp.config.json` 的 `desktopMode: false` 可以退回网页版（纯 Studio，没有聊天栏）。桌面模式起不来时面板也会自动回落到网页版。自己机器上的覆盖（比如你这台的 Dev 版路径、原来的 studioHome）写 `miniapp.config.local.json`，它会被合并进配置，不要提交。运行时状态默认放 Host 给的 `context.dataDir/openfilm-studio`。

## 怎么用

| 人要做的事 | 怎么做 |
|---|---|
| 看/剪某个项目 | 打开面板时进最近那个项目；要换，用 OpenFilm 自己的「打开项目」 |
| 跟 agent 说剪辑的事 | 右边那栏聊天（桌面版的那栏）：会话历史在顶上的两个按钮里，输入框在下面，agent 菜单在最下面 |
| 想知道片子多长、有几段 | `openfilm look`（在项目目录里跑）：出接触印像表 + 波形 + LUFS 响度报告，产物在 `<项目>/.film/cache/look/` |
| 要出片 | `openfilm render`（在项目目录里跑）：`<项目>/<项目名>.mp4` |
| 要改 OpenFilm 自己的代码 | 不在这个面板里干 —— 那是仓库的事，见 OpenFilm 仓库的 CONTRIBUTING |

## 命令行跟面板的关系

面板里的 OpenFilm 跟命令行是**同一份东西**：面板起的就是 `openfilm open`，命令行的 `openfilm look` / `render` 认的是同一个项目目录（看 `.film/` 与 `film.html`）。

所以：要看片子长什么样，可以点面板，也可以 `openfilm look` 出一张静态图（省得在面板里来回切）。

## 排障

| 症状 | 多半是 |
|---|---|
| 面板一直显示「正在起 OpenFilm…」 | 第一次起它慢（Node + 浏览器渲染）。看面板的 `/miniapp/health`：`studio.error` 有话就是它起不来，`bootLog` 是它的输出 |
| 面板里是白屏 | iframe 没加载出来。点右上角「在浏览器打开」；或看 `/miniapp/health` 的 `studio.origin`，自己访问那个地址 |
| 右边没有聊天栏 | 桌面模式没起来。看 `/miniapp/studio` 的 `desktop.error`（多半是仓库不在、或者还没构建 `build:shell`） |
| 打开时进的项目不对 | 面板只在打开时读一次项目列表（正式版那份，`~/.openfilm`），进最近那个；之后在 OpenFilm 里面换。要连 Dev 那份：改 `miniapps/openfilm/miniapp.config.json` 的 `"flavor": "dev"`，重开面板 |
| 面板里多了一个 OpenFilm 进程 | 面板自己起的那份（跟用户自己开的那份不是同一个）。关掉面板（`miniapp stop`）它会跟着走；**用户自己开的那份不会被动**（面板只关自己起的） |

## 规矩

- **不替人改片子。** 面板是给人用的；agent 要动片子，走 OpenFilm 自己的方式（在项目目录里改 `film.html`），不要从面板里点。
- **别把面板当 OpenFilm 的全部。** OpenFilm 还有命令行（`openfilm`）、还有桌面版；面板只是把它放到了手边。
