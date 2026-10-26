# Agent 协作透视（`agent-flow`）

插件通过正式 Hook 记录普通 MiniMax Code 会话中原生 `task` 调用和子 Agent 启停。用户在 MiniApp 内**手动选择插件生成的记录文件**，查看调用时间线。插件代码不打开宿主运行数据库或会话历史。

页面展示 `PreToolUse` 至 `PostToolUse` 的调用区间、工具回传字段是否存在，以及 `SubagentStart` 至 `SubagentStop` 的区间；已结束的 task 调用可以比较是否重叠。工具回传不表示父 Agent 已采纳结果。只有结构化 task 回传中的子会话 ID 与子 Agent 启停事件的会话 ID 一致，或 Hook 明确给出父会话 ID 时才建立关联。所选会话视图不展示其他会话及未关联的子 Agent；导入文件本身不会被修改。

## 安装与使用

需要 MiniMax Code 3.1.4 或更高版本，并且 Hook 进程的 `PATH` 中能够运行 `node`。

将整个插件目录（含 `.minimax-plugin/` 与 `hooks/`）安装为本地 `agent-flow` 插件，重启 MiniMax Code。照常在 Work 中使用原生 `task` 子 Agent；打开“Agent 协作透视”，选择插件 Hook 数据目录中的 `agent-flow-events.jsonl`。如有 `agent-flow-events-*.jsonl` 轮转文件，可以一起选择。

在已测试的 macOS 桌面版目录布局中，可在 Finder 使用“前往文件夹”打开 `~/.minimax/v2/plugin-data/hooks/agent-flow/`。这只是供人手动选文件的提示；插件代码不会依赖这个宿主路径，它也不是稳定格式承诺。若文件不存在，先确认插件已启用、安装后运行过新的原生 task，且桌面版 Hook 进程能找到 `node`。

文件新增事件后需要重新选择。导入内容只存在页面内存中，不自动轮询。Hook 安装前的历史无法恢复。会话 ID 只显示 SHA-256 散列值；选择器列出观察到 `task` 调用的会话，按带日期的最近事件排序。可手动选择，或点“查看最近记录”一键查看导入文件中最近的 task 会话。这个选择只是推断，可能不是打开插件的聊天；插件不会自动把它绑定为当前聊天。视图只展示与所选会话有明确关联的子 Agent。

## Tested environment

- MiniMax Code 3.1.4 / macOS：安装并重启后，新 Work 会话产生了两次 `task` 调用、两次工具回传和两个完整的子 Agent 生命周期。用户导入插件记录，确认两次调用都通过精确的子会话 ID 散列匹配到对应子 Agent，且两个运行区间重叠。启用结构化子会话 ID 提取之前的旧记录仍未关联。
- Node.js 24.21.0：使用合成事件和临时插件数据目录运行测试。Windows 尚未实测。

## Data & access

- `SessionStart`、`PreToolUse(task)`、`PostToolUse(task)`、`SubagentStart`、`SubagentStop` Hook 从标准输入读取宿主提供的事件 JSON。每次调用运行 `node "${PLUGIN_ROOT}/hooks/record.mjs"`；页面关闭后 Hook 仍可记录事件。
- 记录写入运行时提供的 `PLUGIN_DATA` 目录中的 `agent-flow-events.jsonl`，达到 8 MiB 后轮转。仅保存时间、关联 ID 的 SHA-256 散列（包括 task 结构化结果中可能提供的子会话 ID）、Agent 类型、最多 160 字符的任务描述/标题/名称，以及工具结果字段是否存在。**短任务标题可能包含用户输入，包括路径或敏感值。** 插件不单独收集工作区路径或凭据字段，也不保存完整指令、工具结果正文或子 Agent 最终回复。记录留在用户本机，直至用户自行删除。
- MiniApp Node 进程只提供自身页面资源。浏览器仅解析用户显式选择的文件，导入内容只留在内存；不上传、不持久化。不发起 MiniApp Agent 回合，不提供 MCP，不向外联网，也不读取宿主数据库或会话文件。只有 Hook 调用会启动 `node` 子进程。
- MiniApp 不声明 Agent 访问权限，无法识别打开页面的聊天，不列出或读取宿主会话，也不启动 Agent 回合。用户明确选择记录中的会话；选中不代表它就是当前聊天。
- 页面将导入文字作为纯文本显示。格式错误、不完整或过大的文件会报错，不拼接推测出的历史。

## 开发

在仓库根目录运行 `node --test plugins/huixin615/agent-flow/tests/*.test.mjs` 与 `npm run check`。测试不包含真实会话内容。

## License

[MIT](./LICENSE)
