# DeepSeek 会话迁移

[English](README.md) | 简体中文

DeepSeek 会话迁移专门处理 DeepSeek 网页版的官方导出包。它在页面里还原标题、时间、分支、思考过程、搜索来源和附件，你挑好要接着聊的对话，它通过公开的 `message.append` 接口把内容放进当前 MiniMax Code 对话的输入框。MiniMax Code 会先弹窗让你确认，内容进了输入框以后由你自己检查、自己按发送。不需要另装插件。

这个 Mini App 不新建、不导入、也不修改 MiniMax Code 会话，从不读写 MiniMax Code 自己的数据库和会话文件。

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
3. 在想接着聊的那个对话里打开 **DeepSeek Chat Migration**，选择刚才下载的 DeepSeek ZIP，解析就在页面里完成。
4. 点一个对话就能预览：所有分支都在，思考过程、搜索来源和附件折叠显示。想一次带几个对话，就勾选它们（工具栏的「全选」可以一次勾上或清空）。一个都没勾时，用的是正在预览的那个。
5. 需要的话勾上 **包含思考过程** 和 **包含搜索来源**，底栏会显示这段文字有多长。
6. 点 **添加到对话输入框**。MiniMax Code 会弹出自己的确认框，写明是哪个插件、加到哪个对话、加什么内容。确认后文字追加到还没发送的草稿里，你按发送之前什么都不会发出去。每点一次都要单独确认。
7. **复制** 会把同样的文字放进剪贴板，方便贴到别的对话或在旧版客户端里用。**Export DeepSeek archive** 会下载 `deepseek-chat-archive.zip`（每个对话一份 Markdown、导出包里带的附件和一个离线搜索页），作为另一份备份。

### 加进输入框的内容

- 开头一句说明：下面是之前在 DeepSeek 的对话记录，只当背景参考。
- 每个对话先是 `## 标题（日期）`，然后是 DeepSeek 最后显示的那条分支（从开头到 `current_message_id`），按 `### User` / `### DeepSeek` 一轮轮列出。重新生成或改写掉的分支不放进去，在预览和存档里仍然能看到。
- 思考过程和搜索来源只在勾选后才加。附件只写文件名（`Attached in DeepSeek: …`），不加文件内容。
- `message.append` 一次最多 100,000 个字符。选的内容更长时，每个对话保留第一条用户消息和尽量多的最近几轮，中间省略的部分会注明省了几条；添加之前底栏就会提示。要完整内容请用存档。

## 测试环境

- 在 Linux 上用 Node.js 22 跑了解析、草稿生成和运行时测试（`node --test tests/*.test.mjs`）。
- 这一版还没有在 MiniMax Code 里实际跑过。需要客户端提供 `window.mcode.miniapp.message.append`；没有这个接口时 **添加到对话输入框** 不可用，**复制** 仍然可以用。因为声明了弹出窗口，需要 MiniMax Code 3.1.2 或更高版本。

## 数据与权限

- **读取的文件：** 只有你在页面里选的 DeepSeek ZIP 或 JSON，在页面里读取。不读任何宿主文件：不碰 MiniMax Code 的数据库、会话文件或项目文件夹。
- **写入的文件：** 没有。`context.dataDir` 和浏览器存储里都不存东西，解析结果只留在页面里，关闭或刷新就没了。**Export DeepSeek archive** 是普通的浏览器下载。
- **对话输入框：** 只有点 **添加到对话输入框** 时，才会用上面说的文字调用 `window.mcode.miniapp.message.append`。每次调用 MiniMax Code 都会让你确认，消息由你自己发送。Mini App 不能发消息、不能读聊天记录，也不能改已发送的消息。
- **剪贴板：** **复制** 会把同样的文字写进剪贴板，应用从不读取剪贴板。
- **进程：** Node 入口只负责提供页面和静态资源，不启动任何进程。
- **Agent 与会话：** 没有声明 `agentAccess`，不运行 Agent，也不读取 MiniMax Code 的对话。
- **网络：** 不发任何网络请求，没有外部主机。
- **其他能力：** 没有 `hostAccess`、`toolAccess`，不调用 MCP 或 Connector 工具，不用麦克风、摄像头和系统通知。

## 原型限制

- 主要支持 DeepSeek 官方第 3 版 ZIP 结构，另外兼容两种旧版 DeepSeek JSON。
- ZIP 支持 STORE 和 DEFLATE，包括使用 data descriptor 的条目。
- 对话是以上下文的形式在当前对话里接着聊。Mini App 没法新建带原始消息和时间的 MiniMax Code 原生会话，目前没有哪个 Mini App 接口提供这个能力。
- 太长的选择会按上面说的方式缩短，以适应输入框 100,000 字符的上限。
