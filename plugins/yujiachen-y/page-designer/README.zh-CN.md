# Page Designer（`page-designer`）

[English](README.md) | 简体中文

描述你想要的页面，Agent 把它写成一个独立的 HTML 文件。页面显示在对话旁边的实时沙箱预览里，每个版本都会保留，可以复制或下载 HTML。写页面的是你自己的 MiniMax Code Agent，用的是你选择的模型。

Page Designer 是 Vercel Labs 开源设计 Agent [fx0](https://github.com/vercel-labs/fx0) 在 MiniMax Code 上的移植版，详见[致谢](#致谢)。

![Page Designer](docs/preview.jpg)

## 能做什么

- **描述一个页面**：落地页、小工具、小游戏、交互讲解、简历都可以。Agent 会先自己定好合理的细节、直接做出来，之后你用大白话提修改。
- **选择起始风格**：内置六种为本插件原创的风格（安静极简、杂志编辑、柔和友好、大胆海报、夜间控制台、口袋游戏），也可以上传自己的 `design.md`。
- **选择模型**：MiniMax Code 里能用的模型都可以选，也能选思考档位；每个页面会记住自己的选择。
- **保留每个版本**：每次发布或修改都是一个新版本。可以从对话或版本菜单打开任意版本，复制或下载它的 HTML。
- **预览宽度**：桌面、平板、手机三档，支持重新载入。页面里的链接在预览之外打开。
- **权限和提问**：Agent 想使用某个工具时，页面会显示卡片，可以「允许一次」「拒绝」，或者去对话里决定。Agent 的提问在输入框上方的表单里回答，也可以跳过。
- **独立窗口**：侧边栏太窄时，可以把 Mini App 弹出到单独的窗口。
- 界面支持中英文，明暗主题跟随系统。

## 安装

需要 MiniMax Code 3.1.2 或更高版本，因为包里声明了 `agentAccess`、`agentConcurrency` 和 `surface.window`，更早的版本无法安装。

把这个目录（包括隐藏的 `.minimax-plugin/`）复制到 MiniMax Code 的插件目录，命名为 `page-designer/`（默认是 `~/.minimax/plugins/page-designer/`，见根目录 README 的安装说明）。重启 MiniMax Code，然后从右侧面板的 Mini App 入口打开「Page Designer」，或者让 Agent「打开 Page Designer」。

## 测试环境

- macOS 27.0 上的 MiniMax Code 3.1.4-preview.4694。这是桌面端的内部预览版，已包含 3.1.2 的 Mini App Agent API。通过 Host 发布流程安装，在右侧面板打开，也用链接（`/studio?p=<id>`）打开过。
- 真实 Agent 运行，在模型菜单里选了 MiniMax-M3.1-Flash，运行回报的也是这个模型：
  - 用中文描述加「柔和友好」风格新建页面，得到版本 1，标题由 Agent 设定；
  - 两次追加修改走 `edit_design`，得到版本 2 和 3，预览自动切换到新版本；
  - 用英文描述新建第二个页面；
  - 运行中点停止，显示「已停止。」，之后输入框恢复可用。

  这几次运行都没有触发权限请求。
- 真实页面里：版本标签和版本菜单、预览宽度、复制 HTML（剪贴板里是版本 3 的原始 HTML）、「查看对话」（调用成功返回）、点击预览里的 `https://` 链接会走到 `window.open`。没有控制台报错或失败请求。
- 在 Google Chrome 155（无头模式）里，用同一个 Node 入口配脚本化 Agent 测过：
  - 420 px 下的「对话 / 预览」Tab 布局、900 px 下的页面抽屉、明暗主题；
  - 权限卡片、问卷表单、关于对话框；
  - 下载（文件名和原始内容）；
  - 页面自己跳走后会被恢复；加载时卡住 1.5 秒的页面只加载一次，不会循环重载。
- `npm test`：18 个 `node:test` 用例，用脚本化 Agent 跑 Node 入口。覆盖 MCP 工具和校验、权限只转达用户的决定、问卷续答、会话丢失时重建一次、运行前和运行中的停止、本机与同源 JSON 校验（DNS 重绑定的域名在所有路由上都被拒绝），以及重启后的数据保留。
- 未验证：真实 Agent 运行触发的权限请求或问卷（只用脚本化 Agent 覆盖过）、弹出窗口、预览里点击的链接最终在哪里打开、MiniMax Code 内的下载、Windows。

## 数据与权限

- **状态**：所有数据都存放在 Host 提供的 `context.dataDir` 下，每个页面一个文件夹：
  - `projects/<id>/project.json`：标题、对话记录、运行记录、所选模型和风格、关联的会话 id；
  - `projects/<id>/v<n>.html`：每个版本，与发布时完全一致。

  在 Page Designer 里删除页面会删掉这个文件夹，关联的 Agent 对话仍保留在 MiniMax Code 里。浏览器 `localStorage` 里只保存模型选择和预览宽度。
- **读取 `dataDir` 以外的文件**：无。上传的 `design.md` 由页面读取，以文本形式发给 Node 进程，存进该页面的 `project.json`。
- **写入 `dataDir` 以外的文件**：Page Designer 本身不写。下载走浏览器的正常下载流程。
- **Agent 运行**（`agentAccess: ["session.run"]`）：
  - 每个页面用 `context.agent.create()` 创建一个隐藏会话，你发的每条消息是其中一轮。运行由 Node 发起，所以关掉面板也会继续。
  - 这些会话使用你的主 MiniMax Code Agent，它自己的设置和记忆都会生效，工作目录是这个 Mini App 自己的 Agent 目录。
  - 第一轮会带上设计指令（改编自 fx0）、所选风格和你的消息，之后每轮只带一段简短提醒和你的消息。
  - 指令要求 Agent 只通过 Page Designer 的 MCP 工具工作，不碰文件、shell 和子 Agent，允许用网页搜索和抓取找参考。
  - 你的消息会作为标记好的用户文本传入。Agent 的回复只作为文本显示，只有它交给 MCP 工具、并通过校验的 HTML 才会成为版本。
  - 如果关联的会话不见了，Page Designer 会新建一个会话并重新发送一次指令。
- **权限**：Page Designer 运行中的每个 `permission.requested` 都显示为卡片，提供「允许一次」「拒绝」和「去对话里决定」。Page Designer 不会自行答复任何请求：「允许一次」和「拒绝」只把你对这一个请求的点击转达过去。「去对话里决定」会在聊天侧栏打开这个会话，由 MiniMax Code 自己的卡片决定。
- **MCP**：包里声明了一个由 Mini App 自己在 `/mcp/page-designer` 提供的 MCP 服务器，包含 `publish_design`、`edit_design`、`read_design` 和 `list_designs`。Mini App 运行期间，普通对话里的 Agent 也能调用：
  - 不带 `project_id` 调用 `publish_design` 会新建页面；
  - 每次返回都带 `open_path`（`/studio?p=<id>`），也就是打开该页面的路由。
- **校验**：沿用 fx0 的规则。一个版本必须是不超过 512 KiB 的完整 HTML 文档，满足以下条件：
  - 脚本和样式内联，资源用 `data:` 嵌入，没有外部 `src`；
  - 没有 HTML 注释、表单、嵌套框架；
  - 链接只允许 `#片段` 或 `https://`。

  不合规的 HTML 会把原因返回给 Agent，任何地方都不会保存。
- **预览沙箱**：
  - 版本渲染在 `sandbox="allow-scripts"` 的 iframe 里，源是不透明的，无法访问 Mini App、它的存储或 `window.mcode` 桥。
  - 套用 fx0 的内容安全策略，屏蔽所有网络请求、表单、框架、worker 和外部资源。页面运行前会先关闭 WebRTC。
  - 页面自己跳走后会被恢复。点击的 `https://` 链接交给 Mini App 页面用 `window.open` 打开，具体在哪里打开由 MiniMax Code 决定。
  - 复制和下载用的原始 HTML 路由带 `sandbox` CSP，即使直接访问，也不会以 Mini App 的源运行页面。
- **只接受本机请求**：所有路由（包括 MCP 端点）都要求 Host 头是本机（`127.0.0.1`、`localhost`、`::1`），浏览器带的 Origin 必须是这个监听地址本身。所以即使某个网页把自己的域名解析到 127.0.0.1（DNS 重绑定），也访问不到。写请求还必须是 JSON（否则 415），且不能被浏览器标记为跨站。
- **网络**：Node 进程不发起任何外部请求。Agent 用到的网页搜索和抓取，在 Agent 自己的工具里运行。
- **进程**：不启动任何进程。

## 与 fx0 的不同

- Agent 是 MiniMax Code 的，不是 libfx；模型来自 MiniMax Code 的配置，不走 Vercel AI Gateway。没有登录、计费、免费试用和 BotID。
- 页面保存在本机 Mini App 的数据目录里，而不是 Redis 和 Neon。被重启打断的运行会标记为中断，不会续跑。
- Agent 通过 MCP 工具写页面，所以预览在发布或修改完成时更新，不会在 HTML 生成过程中实时滚动出现。
- Agent 工作时发的消息不会插入当前这一轮，需要先停止或等待它完成。不支持图片附件。
- fx0 自带的十个品牌风格 `design.md` 没有收录。内置的六种风格是原创的，你仍然可以上传任意 `design.md`。

## 致谢

Page Designer 的存在，要感谢 Vercel Labs 以 Apache License 2.0 开源了 [fx0](https://github.com/vercel-labs/fx0)。以下部分改编自 fx0 的提交 `e584782`，每个改编的文件开头都写明了来源和改动：

- `miniapp/node/artifact.mjs`：HTML 校验规则、预览内容安全策略和沙箱引导脚本（`lib/design-artifact.ts`），以及精确替换式修改（`lib/agent.ts`）。
- `miniapp/node/prompts.mjs`：设计指令（`lib/agent.ts` 中的 `DESIGN_INSTRUCTIONS`）。
- `miniapp/node/server.mjs`：页面工具的描述（`lib/tools.ts`）。

Mini App 运行时、页面、风格预设和图标是为本插件编写的。感谢 fx0 的作者们。Page Designer 是独立的社区项目，与 Vercel 没有隶属或背书关系，详见 [NOTICE](./NOTICE)。

## 许可证

[Apache License 2.0](./LICENSE)，与 fx0 相同。署名见 [NOTICE](./NOTICE)。
