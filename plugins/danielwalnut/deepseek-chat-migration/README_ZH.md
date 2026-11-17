# DeepSeek 会话迁移

[English](README.md) | 简体中文

DeepSeek 会话迁移专门处理 DeepSeek 网页版的官方导出包。它会在本机还原对话标题、时间、分支、思考过程、搜索来源和附件，再把选中的长对话提炼成一份方便在 MiniMax Code 里接着工作的交接文档。

## 从 DeepSeek 导出

1. 打开 `chat.deepseek.com`。
2. 进入「设置 → 数据 → 导出」，下载官方 ZIP。
3. 不用解压，也不用改文件名，直接把 ZIP 交给应用即可。

当前官方包里有 `manifest.json`（`export_format_version: 3`）、`user.json`、
`chat_session_index.json`、`chat_sessions/<id>.json`，附件则放在
`chat_sessions/<id>_files/`。应用不会登录 DeepSeek，不读取浏览器会话，也不会抓取网页。

## 安装与使用

1. 下载整个 `deepseek-chat-migration` 目录。
2. 在 MiniMax Code 里让 Agent 安装这个 Mini App。
3. 打开 **DeepSeek Chat Migration**，选择刚才下载的 DeepSeek ZIP。
4. 先预览恢复结果，再勾选真正想保留的对话。
5. 点 **Create handoffs** 生成交接文档；也可以点 **Export DeepSeek archive**，下载每段对话各一份 Markdown、总索引、离线全文搜索页，以及导出包里确实存在的附件。
6. 在交接文档里点 **Add to current chat draft**，检查写入当前输入框的内容，确认无误后再发送。

有索引文件时，列表顺序和标题以 `chat_session_index.json` 为准。对话分支按
`parent_id` 和 `current_message_id` 还原，重新生成过的回答会保留成候选版本；`THINK`
会单独折叠显示，搜索内容会列成来源。应用用会话 ID 和稳定内容哈希识别已经导入过的记录，再次打开同一份导出不会生成副本。

## 交接文档包含什么

超长对话会按段落切块。MiniMax Code 当前可用的模型先分别整理每一块，再把多份小结合并成一份：

- 聊过什么
- 已确定的要求
- 排除过的方案
- 未完成事项
- 关键事实与偏好

完整的 DeepSeek 原文仍保存在应用私有数据里；你主动下载档案时也会保留。交接文档只是方便继续工作的稳定前缀，不会取代原始记录。

## Tested environment

- MiniMax Code 3.1.11，Windows 11
- Node.js 22，Linux（解析器与单元测试）

应用声明了 Agent 会话权限和独立窗口，因此需要 MiniMax Code 3.1.2 或更高版本。

## Data & access

- **读取文件：** 只读你亲自选择的 DeepSeek 官方 ZIP，或兼容的 DeepSeek JSON，并且全程在本机解析。不会读取浏览器登录状态，不会抓取 `chat.deepseek.com`，不会上传导出包，也不会碰宿主的其他文件。
- **写入文件：** 选中的规范化原文和交接文档会原子写入宿主管理的私有 `context.dataDir/state.json`；这个目录的位置对应用不透明。只有你点击导出时，才会下载档案 ZIP；所选会话在原包里有附件的话，也会一起放进新档案。
- **模型访问：** 只有你勾选的对话文本会通过 MiniMax Code 的 Agent API 交给模型做提炼。长对话会运行多轮。即使你关闭 `session.run` 权限，应用也会继续运行并给出明确提示。
- **现有对话：** 不读取 MiniMax Code 里的历史会话。把交接内容加入当前输入框时，会先出现宿主确认；内容只进入未发送的草稿，不会替你发送。
- **网络：** 应用不直接联网，也不访问任何外部域名。
- **其他能力：** 不启动子进程，不调用 MCP 或 Connector 工具，不使用麦克风、摄像头、系统通知或宿主导航信息。

## 目前做不到的两件事

现有 Mini App API 还不能新建一个普通、可见并且预先写好内容的用户会话，也不能直接修改项目的 memory 或 rules 文件。因此，DeepSeek 会话迁移提供的是「确认后加入当前草稿」和 Markdown 交接／档案。请先打开目标项目和对话，再加入交接文档，检查后发送。如果某条偏好需要长期写进项目规则，可以在那段对话里让 Agent 从交接文档中挑出对应内容并保存。

## 原型限制

- 主要支持 DeepSeek 官方 version 3 ZIP；另外保留两种旧 DeepSeek JSON 结构的兼容解析。
- ZIP 支持 STORE、DEFLATE 和使用 data descriptor 的条目。
- 附件在原始导出包中存在时会进入新档案；原包只有元数据时，应用只能保留引用。
- 规范化后单次保存超过 32 MiB 时，请分批选择。
