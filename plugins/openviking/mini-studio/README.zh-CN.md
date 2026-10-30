# OpenViking Mini Studio（`mini-studio`）

[English](README.md) | 简体中文

在 MiniMax Code 中只读浏览你的 [OpenViking](https://github.com/volcengine/OpenViking) 上下文：
以树形视图浏览 `viking://`，搜索（语义 find、grep、glob），按 L0 / L1 / L2 层级预览
Markdown / JSON / JSONL，并把选中的 URI 或文件内容加入当前 MiniMax Code 对话。

界面基于 [OpenViking Studio](https://github.com/volcengine/OpenViking/tree/main/web-studio) 的组件与设计
token（base-ui + Tailwind、OpenViking 文字标、Noto Sans），导航功能与内容渲染来自
[Atlas](https://github.com/ZaynJarvis/atlas-fs)，已预编译到 `miniapp/client`，不使用任何 CDN。主题跟随
MiniMax Code 的浅色 / 深色外观（`prefers-color-scheme`），也可在工具栏或设置中固定为浅色或深色。宽度小于
720 px（侧边栏）时，树在上、预览在下，中间可拖动分隔条。本包不包含 hooks、
Skills 或 MCP 服务器。会话写入与召回应通过配置为 MiniMax Code 模型提供方的 OpenViking Context
Gateway 完成；本 Mini App 不采集任何对话。

## 安装与打开

把整个目录（包括 `.minimax-plugin/`）复制到 MiniMax Code 插件目录，命名为
`mini-studio/`，重启 MiniMax Code，然后说"Open OpenViking Mini Studio"。

首次打开且尚未保存连接时，会弹窗要求填写服务器 URL 和 API key。之后可点击齿轮图标修改服务器 URL、API key（只显示"key saved"）、account、user 和你自己部署的
Studio URL。**Test connection** 用当前填写的值（未填新 key 时使用已保存的 key）检查 `GET /health`
和根目录列表，不会保存；**Save** 才会保存。

- **URI**（链接图标）：把选中文件或目录的 `OpenViking context: viking://...` 加入输入框。
- **Content**（文件加号图标）：读取选中文件，用 `<context uri="...">` 包裹后加入输入框（超过 90,000 字符截断）。
- 每次加入 MiniMax Code 都会弹出确认；在你按发送前不会发出任何内容。
- **Open full Studio**（设置中，仅在保存了 Studio URL 时显示）请求客户端在新窗口打开该 URL，页面内不嵌入。

## 测试环境

- MiniMax Code 3.1.2 包规范（未使用更高最低版本的功能）。
- Linux 上的 Node.js 22：`npm test`（模拟 OpenViking 服务器），以及通过 `npm run dev` 连接真实 OpenViking 服务器的无头 Chromium 渲染（浅色、深色、420 px、首次启动）。
- 尚未在 MiniMax Code 客户端中验证：`message.append` 确认框与 **Open full Studio** 新窗口行为。

## 数据与访问

- **读取文件**：仅本包的 `miniapp/client` 与 `miniapp/node`。
- **写入文件**：仅插件数据目录（`context.dataDir`）下的 `connection.json`，保存服务器 URL、API
  key、account、user 和 Studio URL；原子写入，权限 `0600`。不写其他任何位置。
- **浏览器存储**：只有界面偏好（主题、排序、是否显示隐藏文件、树 / 预览分隔位置），不含凭据或 OpenViking 内容。
- **网络**：Node 进程只连接你配置的 OpenViking 服务器，且只允许以下只读路由：`GET /health`、
  `GET /api/v1/fs/{ls,tree,stat}`、`GET /api/v1/content/{read,abstract,overview}`、
  `POST /api/v1/search/{find,grep,glob}`。其他方法、路径或查询参数一律拒绝且不发起上游请求；
  `uri` / `target_uri` 必须是 `viking://`；拒绝重定向。API key 以 `Authorization: Bearer` 和
  `X-API-Key` 发送。页面只访问 Mini App 自己的回环端口。点击 **Open full Studio** 时客户端打开你填写的 Studio URL。
- **凭据**：由你在设置中填写，只存于 `connection.json`，不会返回给页面、写入日志或出现在错误响应中。
  不回退到 root key，也不读取 `~/.openviking` 配置文件。
- **进程**：不启动任何子进程。
- **Agent**：不运行 Agent，未声明 `agentAccess`。页面只在点击后请求 Host 把文本追加到未发送的草稿
  （`window.mcode.miniapp.message.append`）。

## 开发

```sh
npm test          # 包内测试：代理白名单、密钥处理、连接测试、静态文件
npm run dev       # 预览 http://127.0.0.1:4317/context（仅绑定 127.0.0.1）
npm install --include=dev && npm run build   # 用 Vite 从 src/ 重新生成 miniapp/client
```

## 许可证

[AGPL-3.0](./LICENSE)。第三方代码见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
