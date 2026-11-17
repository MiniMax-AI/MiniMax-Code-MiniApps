# Context Ark

[English](README.md) | 简体中文

Context Ark 把官方导出的历史对话整理成可长期保存的本地档案，也能提炼成一份方便接着聊的交接文档。导入后可以先看标题、时间、轮数和大致字数；编辑、重新生成留下的分支不会丢；思考过程、联网搜索结果和附件引用也会单独收起，不和正文混在一起。

## 安装与使用

1. 下载整个 `context-ark` 目录。
2. 在 MiniMax Code 里让 Agent 安装这个 Mini App。
3. 打开 **Context Ark**，选择从来源服务的「设置 → 数据管理」下载的 ZIP 或 JSON。
4. 先预览恢复结果，再勾选真正想保留的对话。
5. 点 **Distill selected** 生成固定格式的交接文档；也可以点 **Export Markdown archive**，下载每段对话各一份 Markdown、总索引和可离线使用的全文搜索页。
6. 在交接文档里点 **Add to current chat draft**，检查写入当前输入框的内容，确认无误后再发送。

应用会用来源 ID 和稳定内容哈希识别已经导入过的记录。再次打开同一份导出时，旧记录会明确标记并自动跳过。

## 交接文档包含什么

超长对话会按段落切块。MiniMax Code 当前可用的模型先分别整理每一块，再把多份小结合并成一份：

- 聊过什么
- 已确定的要求
- 排除过的方案
- 未完成事项
- 关键事实与偏好

完整的规范化原文仍保存在应用私有数据里；你主动下载档案时也会保留。交接文档只是方便继续工作的稳定前缀，不会取代原始记录。

## 增加新的导出格式

适配器放在 `miniapp/client/adapters.js`，需要实现两个函数：

```js
{
  detect(value) { return trueOrFalse },
  parse(value) { return normalizedConversations }
}
```

把新适配器加入导出的 `adapters` 数组。每条消息要整理为按顺序排列的 `text`、`reasoning`、`search`、`attachment` 或 `notice` 块，并保留消息 `id`、`parentId`、角色和当前分支的叶节点。请在 `tests/` 里补一份纯合成样例，以及解析和分支测试。来源里不认识的字段直接忽略，不要送进模型提示词。

## Tested environment

- MiniMax Code 3.1.11，Windows 11
- Node.js 22，Linux（解析器与单元测试）

应用声明了 Agent 会话权限和独立窗口，因此需要 MiniMax Code 3.1.2 或更高版本。

## Data & access

- **读取文件：** 只读你在页面里亲自选择的 ZIP 或 JSON，并在本机解析。不会读取浏览器登录状态，不会抓取网页，也不会碰宿主的其他文件。
- **写入文件：** 选中的规范化原文和交接文档会原子写入宿主管理的私有 `context.dataDir/state.json`；这个目录的位置对应用不透明。只有你点击导出时，才会下载档案 ZIP。
- **模型访问：** 只有你勾选的对话文本会通过 MiniMax Code 的 Agent API 交给模型做提炼。长对话会运行多轮。即使你关闭 `session.run` 权限，应用也会继续运行并给出明确提示。
- **现有对话：** 不读取 MiniMax Code 里的历史会话。把交接内容加入当前输入框时，会先出现宿主确认；内容只进入未发送的草稿，不会替你发送。
- **网络：** 应用不直接联网，也不访问任何外部域名。
- **其他能力：** 不启动子进程，不调用 MCP 或 Connector 工具，不使用麦克风、摄像头、系统通知或宿主导航信息。

## 目前做不到的两件事

现有 Mini App API 还不能新建一个普通、可见并且预先写好内容的用户会话，也不能直接修改项目的 memory 或 rules 文件。因此，Context Ark 提供的是「确认后加入当前草稿」和 Markdown 交接／档案。请先打开目标项目和对话，再加入交接文档，检查后发送。如果某条偏好需要长期写进项目规则，可以在那段对话里让 Agent 从交接文档中挑出对应内容并保存。

## 原型限制

- 支持官方 version 3 ZIP 布局，以及合成测试覆盖的两种旧 JSON 结构。
- ZIP 支持 STORE 和普通 DEFLATE；暂不支持使用 data descriptor 的条目。
- 会保留附件元数据，但生成的新档案不会复制附件二进制。
- 规范化后单次保存超过 32 MiB 时，请分批选择。
