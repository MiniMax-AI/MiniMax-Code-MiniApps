# FactScribe 论文工作台（`factscribe`）

写论文的本地工作台，装在 MiniMax Code 里：打开你的稿盘，把检查报告、事实账本与知识库摆在
同一页，并给助手 17 个以只读为主的工具。助手给的每一条改稿建议都以**提议单**出现——
你在页面上点「采纳写回」之前，正文一个字节都不会动。

**人在回路**：助手没有任何直接改正文的接口，落笔只由你点确认。数字与引文始终钉在账本上——
账上没有的值，助手不许凭空写进正文。

## 它解决什么

论文里最容易坏掉的是三件事：数字与账本对不上、引文与原文对不上、中英文两稿说法不一致。
FactScribe 把它们变成可核对的读数：

- 正文里每个数字、每条引文都绑定到账本条目，带出处与定位；
- 指纹闸保证你看到的差异卡对应的文件没有被别处改过——改过就拒写；
- 双语稿逐条对账事实与参考文献，漂移会被报出来。

## 能力清单

**页面**（路由 `/workbench`）

- 项目与稿盘清单（一个项目可有多张语言盘，如 `paper` / `paper-zh`）；
- 章节渲染：`\fact{}`、`\cite{}` 与绑定数字显示为不可误碰的芯片；
- 检查报告（摘要＋发现）、文风闸读数、双语对账、证据锁、写作简报、版式；
- 事实账本查询、知识库检索；
- 助手面板跑宿主自己的模型，界面中/EN 可切。

**助手工具**（17 个，MCP）

只读 12 个：`fs_status`、`fs_get_outline`、`fs_read_section`、`fs_get_report`、
`fs_get_style`、`fs_mirror_check`、`fs_get_evidence_status`、`fs_get_brief`、`fs_get_venue`、
`fs_query_facts`、`fs_search_kb`、`fs_list_proposals`。

只提提议 5 个：`fs_propose_edit`、`fs_propose_evidence_freeze`、`fs_propose_evidence_unfreeze`、
`fs_propose_add_fact`、`fs_propose_export_bundle`。

## 安装

把本目录（含隐藏的 `.minimax-plugin/`）复制到 MiniMax Code 的插件目录，命名为 `factscribe/`
（默认 `~/.minimax/plugins/factscribe/`），重启 MiniMax Code，对助手说「打开 FactScribe 论文工作台」。

MiniMax Code 3.1.11 起也可以直接从 Git 仓库导入：贴仓库地址、选中包目录、核对预览即可。

首次打开会让你填**论文根目录**：含 `factscribe.toml` 的目录会被当作论文项目，之后可在设置页改。

## 测试环境

- MiniMax Code 3.1.16，macOS 26.6.2（arm64）。从本目录安装、经助手打开、页面渲染正常，
  17 个 MCP 工具在宿主 MCP 运行时上逐个实调通过。
- 同一台机器上的 Node 26.7 与 Python 3.14。Python 引擎已随包 vendor，不用装任何东西。
- 最低客户端版本：3.1.2。本包声明 `agentAccess: ["session.run"]`（该能力需要 3.1.2）；
  没有声明 `engines` 下限，所以 3.1.2 起的客户端都能装，只是客户端不提供模型目录时
  面板里少一个模型下拉。
- **未验证**：Windows 与 Linux 宿主。包内没有平台专属二进制、Node 入口只用内置模块，
  但没有在这两个平台上实跑过。

## 数据与访问

- **读取的文件**：你配置的论文根目录（及其下三层），用于发现项目、渲染章节、算检查报告、
  列知识库文件；以及本包自身的载荷目录（运行时只读）。
- **写入的文件**：插件私有 `dataDir`——`config.json`（论文根目录）、`proposals/`（提议单记录）、
  `custom-models.json`（你自己填的 API Key，权限 0600）。你的论文目录里只有你点了才写：
  `sections/*.tex`（原子写＋留 `.bak`，文件被别处改过就拒写）与 `facts/draft/`（草稿导入）。
  另外「打开」一个稿盘会在该盘的 `factscribe.toml` 里记 `last_opened`。
- **网络 host**：默认没有。Node 服务与 Python 引擎只绑回环（`127.0.0.1`）。若你在面板里
  自加自定义模型，Node 薄壳会把你填的 OpenAI 兼容端点当作目标；面板里的助手回合由宿主代跑，
  走你在 MiniMax Code 上的账号与额度。
- **拉起的进程**：`python3 -B -m factscribe workbench --root <你的根目录> --port 0 --json
  --no-browser`（引擎，MiniApp 停止时被杀）、`factscribe audit`（只读重跑检查报告）、
  `tectonic`（只用于可选的 PDF 渲染按钮）、macOS `open`（只用于「打开目录」按钮）。
- **Agent 回合**：面板通过 `agentAccess: ["session.run"]` 跑宿主 Agent 回合，用的是 MiniMax Code
  自己配的模型、宿主账号与额度；插件不读你的 API key、不读宿主配置。
- **读取的对话**：没有。本包不声明 `session.read`，因此不能列出、读取或观察你的任何对话；
  每个回合都跑在 MiniApp 自己起的会话里。
- **调用的工具**：没有。本包不声明 `toolAccess`，因此从不调用宿主 MCP 工具或 Connector；
  面板里模型若要调工具，一律回绝，并被告知只依据材料回答。
- **麦克风／摄像头／通知**：不使用。
- **宿主导航读取**：不使用。
- **状态存放**：宿主创建的插件私有数据目录（本机为
  `~/.minimax/v2/plugin-data/liveboards/factscribe/`）。这个位置请当作不透明：插件只读自己的
  `config.json`、`proposals/`、`custom-models.json`，此外不写该目录以外的任何地方，
  除了你自己的论文目录。

## MCP 工具与占位地址

本包在 `servers.mcp.json` 里声明了一个 MCP server `factscribe`，并在
`miniapp/miniapp.json` 里用 `mcpEndpoints` 指向它。`servers.mcp.json` 里的 URL
（`http://127.0.0.1:9/mcp/factscribe`）是 MiniMax Code 为「MiniApp 自带 MCP server」规定的
fail-closed 占位地址：端口 9 永远没人应答，宿主采纳这个 MiniApp 时会把它改写成当前运行实例的地址。
两处声明必须成对——宿主会校验 `mcpEndpoints.server` 必须在 `plugin.json.mcpServers` 里声明过。
包内没有声明任何第三方远程 MCP。

## 文件

```text
.minimax-plugin/plugin.json   插件清单
package.json                  MiniApp 声明
servers.mcp.json              由本 MiniApp 提供的 MCP server
icon.png                      插件图标
miniapp/miniapp.json          载荷根、Node 入口、页面路由、MCP 端点
miniapp/client/               页面：index.html、app.js、app.css
miniapp/node/server.mjs       Node 入口：start(context) -> { dispose }
miniapp/node/engine/          vendor 的 FactScribe 引擎（Python）
```

## 许可证

[MIT](./LICENSE)
