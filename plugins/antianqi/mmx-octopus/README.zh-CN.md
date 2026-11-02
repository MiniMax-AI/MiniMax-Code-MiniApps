# MMX 章鱼娘

*住在你桌面上的小章鱼：她跟着 Agent 的状态走，也能被 Agent 指挥着说话。*

English | [简体中文](README.zh-CN.md)

作者：[antianqi](https://github.com/antianqi) · 版本：`1.1.0` ·
插件 ID：`mmx-octopus` · 分类：`Productivity`

## 它做什么

- **她跟着 Agent 走。** 她订阅宿主的 Agent 轮次事件
  （`turn.started`、`message.committed`、`turn.finished`）并切换表情：
  轮次开始是 `thinking`，任务在跑是 `working`，这一轮真有产出是 `celebrate`。
- **她报这一轮的尾。** 一轮结束时她说一句关于结果的话 —— 有正文就摘要，
  没正文就用一句兜底话报出会话名。
- **她有自己的一间聊天室。** 面板里有聊天区。你给她发一句话，她就在**自己的
  会话里跑一轮 Agent**，然后用自己的语气回答你：短句，一句一条气泡地冒出来。
- **她写日记。** 面板里的日记本写的是她自己的独白，和聊天记录分开存，她自己写。
- **Agent 能指挥她。** 这个包自带一个 MCP 服务器，四个工具（见下），
  Agent 可以让她说话、换表情、挪位置、读她的状态。
- **她不挡路。** 浮窗无边框、透明、置顶、鼠标穿透，永远不挡住桌面。
  尺寸 220 × 460，可以拖到屏幕任意位置；Agent 也能把它停到四个固定位之一（三个角 + 屏幕中间）。

## 安装

把整个 `mmx-octopus` 目录（含隐藏目录 `.minimax-plugin`）复制进 MiniMax Code 的数据目录：

```text
仓库目录：mmx-octopus/
安装到：  <dataDir>/plugins/mmx-octopus/
清单文件：<dataDir>/plugins/mmx-octopus/.minimax-plugin/plugin.json
```

默认数据目录是 `~/.minimax`，所以通常装到 `~/.minimax/plugins/mmx-octopus/`。

重启 MiniMax Code，确认插件被识别并启用，然后从插件列表打开 **MMX 章鱼娘**。
浮窗会出现在桌面上；面板里有她的状态、聊天区和日记本。

不需要别的：没有 API key，没有账号，没有依赖要装。

## 使用

1. 从插件列表打开它，浮窗就出来了。
2. 把它拖到某个角，或者让 Agent 用 `mmx_move` 挪。
3. 照常跟 Agent 说话，看她的表情跟着走。
4. 打开面板跟她说话 —— 她在自己的会话里回答。

### Agent 的四个工具

这个包托管一个 Streamable HTTP MCP 服务器（`mmx`），由 `miniapp.json` 挂在
`/mcp/mmx` 上。宿主会改写它的地址，并像对待端口上其他东西那样给它做鉴权。

| 工具 | 作用 |
| --- | --- |
| `mmx_say` | 弹一个气泡说一两句话 —— 工具要求不超过 120 字，运行时会拒收超过 300 字的内容。适合用作任务完成通知。 |
| `mmx_mood` | 切表情：`idle`、`thinking`、`working`、`celebrate`。 |
| `mmx_move` | 把浮窗挪到四个固定位之一：`bottom-right`、`bottom-left`、`top-right`、`center`。 |
| `mmx_status` | 读她当前的表情、当前的气泡，以及 Agent 是否在跑。 |

## 她的身体是怎么动的

- **94 段带 alpha 通道的短片**放在 `miniapp/client/assets/webm/`，
  清单在 `miniapp/client/assets/webm/manifest.json`。它们是主力，不是兜底。
- 片子从**池**里取，池跟着**轨**走，两个 `<video>` 当**双缓冲**：前面那个在播，
  后面那个在装下一段，所以两段之间不会断。
- **兜底是真的在。** 池里没东西可播、连续三次装不出、或一段迟迟不来时，
  由 CSS 变换的 `pose` 轨接管（呼吸、点头、轻轻一跳）。片子还在加载的时候，
  你看到的就是它。
- **没有口型。** 片子是她的静态图，嘴不会跟着词动。这是取舍，不是 bug。

## 已验证环境

- MiniMax Code 3.1.7 on Windows 11 (x64)。
- 这个包**要求 MiniMax Code 3.1.5 或更高**：它声明了
  `agentAccess: ["session.read", "session.run"]`，比 3.1.5 老的客户端会直接拒装整个包，
  而不是只装一半。
- 需要支持 MiniApp 与 Agent 轮次的桌面客户端。
- 附带的自检脚本需要 Node 22 或更高。

## 数据与访问

- **读什么** —— 读这个包自己的文件，从 `context.pluginRoot` 读：
  `miniapp/node/identity/AGENTS.md` 和 `miniapp/node/identity/STORY.md`（她是谁），
  以及 `miniapp/client/` 下的页面素材。
- **外加宿主的一个文件** —— 为了让宿主 agent 列表里的名字跟着面板里设的名字走，
  运行时会读「跑这个 Mini App 的那个 agent」的 `agent.md`。它是这么找到的：
  从会话的工作区目录往上走（最多 6 级）；兜底再去宿主的 `agents` 目录下找那个
  含 `miniapps/<plugin-id>` 子目录的 agent 目录 —— 兜底这条**只在恰好命中一个**时才用。
  ⚠️ **这依赖宿主的磁盘布局，而它不是有文档的 API。**
- **写什么** —— `context.dataDir` 下四个 JSON 文件，也就是宿主给这个包建的私有目录：
  `context.dataDir/state.json`（她的表情、位置、气泡，以及 Agent 忙不忙）、
  `context.dataDir/chat.json`（你和她的聊天）、
  `context.dataDir/diary.json`（她的日记）、`context.dataDir/style.json`（她学到的语气）。
  每次落盘都是原子的 —— 先写同目录临时文件，再改名 —— 所以崩了也不会留下半个文件。
- **这个目录之外的两处写** ——
  - **她自己 Agent 会话工作区里的 `AGENTS.md`**：她把身份放在那儿。宿主每轮重读那个文件
    并拼进 system prompt，所以她的身份不会被上下文压缩掉。写法是原子的（同目录临时文件 +
    改名），且只在内容与包里这份模板不一致时才写 —— **所以你手改它，下一轮就被覆盖**。
    它属于这个 Mini App 自己的 agent 工作区。
  - **那个 agent 的 `agent.md` 里 frontmatter 的 `displayName:` 那一行** ——
    让宿主 agent 列表里的名字跟着面板里设的名字走。**只重写那一行**，文件其余内容逐字保留；
    文件没有 frontmatter 就什么都不写。只在名字变了才写；候选文件按顺序试，命中第一个能用的就停。
- **读哪些会话** —— 这个包声明了 `session.read`。它读一轮对话的标题、运行状态和最终回复，
  用来分辨 Agent 是在想还是做完了，也用来给这一轮做摘要。面板里的看板列出正在跑的会话，
  每 30 秒刷新一次。
- **会跑哪些 Agent 轮次** —— 它声明了 `session.run`，并且**你在聊天区给她发的每一句话，
  都在她自己的会话里跑一轮 Agent**。这一轮走宿主的 Agent，因此带着宿主给那个 agent 的权限；
  它会读一次宿主的 agent 列表，找有没有专属于这个 Mini App 的 agent，没有就退回默认 agent。
  它不会去跑你自己的会话。
- **会调用哪些工具** —— 只有它自己那四个 MCP 工具，走它自己的端口。
  不调用 connector、不调用任何厂商服务、不调用任何第三方服务。
- **进程** —— 不起。这个包不 spawn 任何子进程，也不跑任何外部二进制。
- **网络** —— 只有这个 Mini App 自己的 loopback 地址。页面通过宿主鉴权过的 loopback 端口
  和运行时说话，运行时也只通过同一个端口和宿主说话。没有任何指向别的 host 的出站请求，
  也不读、不存、不转发任何凭据。
- **麦克风** —— 从不。这个包没有声明 `deviceAccess`，也不申请任何浏览器权限。
- **状态放在哪** —— `context.dataDir`。把它当成不透明路径：版本之间可能变，别写死。

## 已知限制

- 界面只有中文。
- 没有语音：气泡就是文字。
- 身体动画只覆盖片子里有的那些瞬间；片子之间跑的是 `pose` 兜底。
- 她用宿主给她解析到的那个 agent 回答。

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
