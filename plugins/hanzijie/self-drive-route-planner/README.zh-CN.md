# 自驾规划 (`self-drive-route-planner`)

一个用于 MiniMax Code 的自驾规划 MiniApp。它支持地点搜索、起点/终点/途经点编排、候选路线计算、Agent 与页面实时同步，以及导出 3:4 小红书行程图片。

应用支持**演示模式**，无需凭据即可体验；真实地点搜索和驾车路线需要用户自行提供高德 Web 服务 Key。

## 安装与打开

将包含隐藏目录 `.minimax-plugin/` 的完整插件目录复制到 Host 提供的插件目录：

```text
<dataDir>/plugins/self-drive-route-planner/
```

`dataDir` 由 MiniMax Code 管理，具体文件系统路径是有意保持不透明的。重启 MiniMax Code 后，让 Agent 打开“自驾规划”，或发送以下请求：

- `规划一条自驾路线并在地图中显示。`
- `优化当前行程的途经点顺序。`
- `把当前行程导出为小红书 3:4 图片。`

在 MiniApp 的“设置”中选择演示模式，或粘贴自己的高德 Key。没有 Key 时也可以使用本地演示数据。

## 功能

- 搜索并选择起点、终点和途经点。
- 使用高德计算并比较驾车路线，或使用明确标注的本地演示数据。
- 编辑途经点顺序、备注、出发时间和路线偏好。
- 通过本地 `route-planner` MCP 端点同步 Agent 对行程的修改。
- 导出 PDF 行程手册，或通过内置 `xhs-route-cards` Skill 准备小红书 3:4 图片请求。

## Tested environment

- 已在 Node.js 26.0.0 上运行 `npm run check`（仓库 CI 使用 Node.js 22）。
- 已用兼容 MiniMax Code 的上下文启动本地运行时，检查健康状态、配置和静态文件路由，并验证 `dispose()` 会关闭服务与数据库。
- MiniApp 契约以 MiniMax Code 3.0.73 为目标版本；本次发布未重新执行桌面端 UI 验证。

## Data & access

- **读取文件：**读取 `miniapp/client/` 下的随包文件；Node 运行时只读写自己的 `context.dataDir`。
- **写入文件：**`<dataDir>/config.json` 保存用户提供的高德 Key 和地图模式，并设置受限权限；`<dataDir>/trips.sqlite` 保存行程和操作审计日志。不读取或修改 Host 文件。
- **网络：**启用真实高德数据时访问 `https://restapi.amap.com/v5/place/text` 和 `https://restapi.amap.com/v5/direction/driving`。可选的 `amap-apikey` Skill 会打开 `https://console.amap.com/`，并通过 `https://restapi.amap.com/v3/geocode/geo` 验证 Key。可选的小红书 Skill 首次使用时从 `github.com` 下载固定版本，失败时使用 `gh-proxy.com` 和 `ghfast.top`，随后与本机 `http://localhost:18060` 服务以及其笔记链接指向的小红书站点（`www.xiaohongshu.com`）通信。
- **进程：**MiniApp Node 入口只启动一个本地 HTTP 服务和 SQLite 数据库。可选的小红书 Skill 会运行 `skills/route-planning/scripts/start-xhs-mcp.sh`；该脚本是 macOS ARM64 启动器，会在 MiniApp 进程之外下载并启动固定版本的 `xiaohongshu-mcp` 二进制。该服务可能在 MiniApp 关闭后继续运行，停止命令见 Skill 说明。它把 cookie、日志和登录二维码保存在 Skill 使用的 `~/.xhs-mcp/` 数据目录；本次未在 Windows 上测试该启动器。
- **凭据：**包内不包含 API Key、Token、Cookie 或其他凭据。高德凭据由用户在运行时输入，保存在私有数据目录，不写入 HTML、客户端 JavaScript、日志或 MCP 返回值。

## 许可证

[MIT](./LICENSE)
