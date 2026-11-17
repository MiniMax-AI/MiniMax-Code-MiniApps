# DeepSeek 会话迁移

[English](README.md) | 简体中文

DeepSeek 会话迁移专门处理 DeepSeek 网页版的官方导出包。它会在本机还原标题、时间、分支、思考过程、搜索来源和附件，再用自带的导入脚本把选中的对话导入成 MiniMax Code 原生会话，不需要另装插件。

## 从 DeepSeek 导出

1. 打开 `chat.deepseek.com`。
2. 进入「设置 → 数据 → 导出」，下载官方 ZIP。
3. 不用解压，也不用改文件名，直接把 ZIP 交给应用即可。

当前官方包里有 `manifest.json`（`export_format_version: 3`）、`user.json`、
`chat_session_index.json`、`chat_sessions/<id>.json`，附件则放在
`chat_sessions/<id>_files/`。应用不会登录 DeepSeek，不读取浏览器会话，也不会抓取网页。

## 安装与使用

1. 下载整个 `deepseek-chat-migration` 目录。电脑上要有 Python 3.9 或更新版本（macOS/Linux 用 `python3`，Windows 用 `python`），导入脚本只用标准库。
2. 在 MiniMax Code 里让 Agent 安装这个 Mini App。
3. 打开 **DeepSeek Chat Migration**，选择刚才下载的 DeepSeek ZIP。
4. 预览恢复结果，勾选要迁移的会话。列表顶部的「全选」复选框可以一次勾上或清空所有还没导入的对话。
5. 会话固定导入到 `~/.minimax` 下的 `mavis` agent，统一归到侧栏的 `DeepSeek` 项目（对应 `~/DeepSeek`，不存在时自动建一个空文件夹），不需要额外配置。
6. 点 **导入为 MCode 会话**。生成计划时按钮会显示「生成预览中…」，看完计划再点 **Confirm import**。
7. 导入过程中，弹窗和底栏都会显示进度条和「导入中 12/50」这样的进度，每一批写完，对应的行马上变成 imported。结束后逐条标出已导入、之前导入过（跳过）或失败。
8. 点 **打开 DeepSeek 项目** 直接去看导入的会话。MiniMax Code 3.1.11 及以上会由宿主打开一个刚导入的会话，它就在侧栏的 `DeepSeek` 项目里；版本更旧或宿主打不开时，会改为在访达、资源管理器或 Linux 文件管理器里打开 `~/DeepSeek` 文件夹。

### 导入后的会话里有什么

- 标题变成 `[From DeepSeek] 原标题`，会话和每条消息的时间都保留。
- 只取 DeepSeek 最后显示的那条分支（从开头到 `current_message_id`）展示，也只有这条分支进入后续对话的上下文。重新生成或改写掉的分支不进对话，单独存在会话目录的来源存档里。
- 深度思考（`THINK`）只在界面显示，不会再发给模型。
- 联网搜索变成只读的「历史工具记录」，保留搜索词和结果。
- 上传的文件只保留引用（文件名、大小、导出包里的路径），不复制文件本身。
- 超时或中断的回答后面会附一条历史错误说明。

每次导入在第一次写入前，先给 `runtime-state.sqlite` 做一次在线备份并校验；之后每 10 个会话一批，每批一个事务，提交后马上回读核对。某个会话导入失败只影响它自己。目标会话按 DeepSeek 账号 ID（哈希后使用）和会话 ID 计算，同一份导出重新下载、重新上传后再导入，已经导入过的会直接跳过。

有索引文件时，列表顺序和标题以 `chat_session_index.json` 为准。对话分支按
`parent_id` 和 `current_message_id` 还原，重新生成过的回答会保留成候选版本；`THINK`
会单独折叠显示，搜索内容会列成来源。应用用会话 ID 和稳定内容哈希识别已经导入过的记录，再次打开同一份导出不会生成副本。

Markdown 档案导出仍然保留，方便额外备份；主要入口是原生会话导入。

## Tested environment

- MiniMax Code 3.1.11，Windows 11
- Node.js 22，Linux（解析器与单元测试）

应用声明了独立窗口，因此需要 MiniMax Code 3.1.2 或更高版本。从 Mini App 直接打开导入的会话需要 3.1.11 或更高版本，更旧的版本会改为在文件管理器里打开 `~/DeepSeek`。

## Data & access

- **读取文件：** 只读你亲自选择的 DeepSeek 官方 ZIP，或兼容的 DeepSeek JSON，并且全程在本机解析。不会读取浏览器登录状态，不会抓取 `chat.deepseek.com`，不会上传导出包，也不会碰宿主的其他文件。
- **写入文件：** 选中的 ZIP 会流式写入宿主管理的私有 `context.dataDir` 临时目录；再次上传时会替换，运行时停止时会删除。成功导入的哈希会原子写入 `context.dataDir/state.json`。只有你确认迁移计划后，导入脚本才会向目标 MCode 数据目录写入原生会话。
- **启动进程：** 先后运行 Mini App 自带的 `python3 miniapp/python/import_deepseek.py plan` 和 `apply`，两步用同一份报告。参数用数组传递，不经过 shell；包含临时 ZIP、所选会话 ID、临时报告、`--data-dir ~/.minimax`、`--agent mavis`、`--workspace ~/DeepSeek` 和 `--restore-projects`（DeepSeek 项目被从侧栏移除过时，导入会让它重新显示），`apply` 另加 `--batch-size 10`。进度条读的是脚本写到 stderr 的进度行。每次导入的那一份备份和各批次报告都在 `~/.minimax/zcode-migration/`。
- **打开文件夹（仅作兜底）：** 宿主打不开导入的会话时，点 **打开 DeepSeek 项目** 会在 macOS 上运行 `open ~/DeepSeek`，Windows 上运行 `explorer.exe ~/DeepSeek`，Linux 上运行 `xdg-open ~/DeepSeek`。参数用数组传递，不经过 shell，文件夹不存在时不会执行。
- **Agent 与现有对话：** Mini App 不运行 Agent 回合，不读取 MiniMax Code 历史会话，也不调用 `message.append`。原生会话由自带的导入脚本创建。
- **网络：** 应用不直接联网，也不访问任何外部域名。
- **宿主导航：** 只有你点 **打开 DeepSeek 项目** 时，才会用 `{ id: 'session', sessionId, source: 'local' }` 调用 `window.mcode.miniapp.host.navigation.open`，打开这次刚导入的会话。应用没有声明 `hostAccess`，也不读取你当前在哪个页面。
- **其他能力：** 除了上面列出的进程，不调用 MCP 或 Connector 工具，也不使用麦克风、摄像头或系统通知。

## 原型限制

- 主要支持 DeepSeek 官方 version 3 ZIP；另外保留两种旧 DeepSeek JSON 结构的兼容解析。
- ZIP 支持 STORE、DEFLATE 和使用 data descriptor 的条目。
- 附件在原始导出包中存在时会进入新档案；原包只有元数据时，应用只能保留引用。
- 附件本身不会复制进 MiniMax Code，导入的会话只保留文件引用。
- 导入目标固定为 `~/.minimax` 数据目录和 `mavis` agent。

## 致谢

`miniapp/python/` 里的导入脚本改编自 MiniMax Code 团队的 `agent-session-migration` 插件（作者 Insider）：沿用它的存储核心（写锁、备份、事务、读回校验、历史初始化）和可断点续跑的导入流程，只保留 DeepSeek 来源。目标会话 ID 和标记文件与该插件的 DeepSeek 来源一致，用哪个工具导入过，另一个都能认出来。
