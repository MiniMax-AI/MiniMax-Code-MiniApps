# DeepSeek 会话迁移

[English](README.md) | 简体中文

DeepSeek 会话迁移专门处理 DeepSeek 网页版的官方导出包。它会在本机还原标题、时间、分支、思考过程、搜索来源和附件，再通过独立的 `agent-session-migration` 插件，把选中的对话导入成 MiniMax Code 原生会话。

## 从 DeepSeek 导出

1. 打开 `chat.deepseek.com`。
2. 进入「设置 → 数据 → 导出」，下载官方 ZIP。
3. 不用解压，也不用改文件名，直接把 ZIP 交给应用即可。

当前官方包里有 `manifest.json`（`export_format_version: 3`）、`user.json`、
`chat_session_index.json`、`chat_sessions/<id>.json`，附件则放在
`chat_sessions/<id>_files/`。应用不会登录 DeepSeek，不读取浏览器会话，也不会抓取网页。

## 安装与使用

1. 下载整个 `deepseek-chat-migration` 目录。
2. 另行安装 `agent-session-migration` 插件；它需要带有 DeepSeek 来源适配器和 `scripts/migrate.py`。
3. 在 MiniMax Code 里让 Agent 安装这个 Mini App。
4. 打开 **DeepSeek Chat Migration**，选择刚才下载的 DeepSeek ZIP。
5. 预览恢复结果，勾选要迁移的会话。
6. 填写目标 MCode 数据目录和 Agent 名称。数据目录默认是 `~/.minimax`；目前 Mini App Host 不会直接提供这两个值。
7. 点 **导入为 MCode 会话**。先看迁移计划，确认后再执行；结果会逐条列出成功或失败。

有索引文件时，列表顺序和标题以 `chat_session_index.json` 为准。对话分支按
`parent_id` 和 `current_message_id` 还原，重新生成过的回答会保留成候选版本；`THINK`
会单独折叠显示，搜索内容会列成来源。应用用会话 ID 和稳定内容哈希识别已经导入过的记录，再次打开同一份导出不会生成副本。

Markdown 档案导出仍然保留，方便额外备份；主要入口是原生会话导入。

## Tested environment

- MiniMax Code 3.1.11，Windows 11
- Node.js 22，Linux（解析器与单元测试）

应用声明了独立窗口，因此需要 MiniMax Code 3.1.2 或更高版本。

## Data & access

- **读取文件：** 只读你亲自选择的 DeepSeek 官方 ZIP，或兼容的 DeepSeek JSON，并且全程在本机解析。不会读取浏览器登录状态，不会抓取 `chat.deepseek.com`，不会上传导出包，也不会碰宿主的其他文件。
- **写入文件：** 选中的 ZIP 会流式写入宿主管理的私有 `context.dataDir` 临时目录；再次上传时会替换，运行时停止时会删除。目标目录、Agent 名称和成功导入的哈希会原子写入 `context.dataDir/state.json`。只有你确认迁移计划后，迁移脚本才会向目标 MCode 数据目录写入原生会话。
- **启动进程：** 先后运行 `python3 <agent-session-migration>/scripts/migrate.py plan` 和 `apply`。参数用数组传递，不经过 shell；包含 `--source deepseek`、临时 ZIP、所选会话 ID、临时报告、目标数据目录和 Agent 名称。
- **Agent 与现有对话：** Mini App 不运行 Agent 回合，不读取 MiniMax Code 历史会话，也不调用 `message.append`。原生会话由迁移插件创建。
- **网络：** 应用不直接联网，也不访问任何外部域名。
- **其他能力：** 除了上面的 `python3` 进程，不调用 MCP 或 Connector 工具，也不使用麦克风、摄像头、系统通知或宿主导航信息。

## 原型限制

- 主要支持 DeepSeek 官方 version 3 ZIP；另外保留两种旧 DeepSeek JSON 结构的兼容解析。
- ZIP 支持 STORE、DEFLATE 和使用 data descriptor 的条目。
- 附件在原始导出包中存在时会进入新档案；原包只有元数据时，应用只能保留引用。
- 原生导入依赖已经安装、并带 DeepSeek 来源适配器的 `agent-session-migration`。
- Host 不会向 Mini App 暴露目标数据目录或当前 Agent 名称，所以页面默认填写 `~/.minimax`，Agent 名称需要用户确认。
