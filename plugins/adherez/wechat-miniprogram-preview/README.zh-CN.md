# 微信小程序与小游戏本地预览

[English](README.md) | 简体中文

在 MiniMax Code 的既有 Mini App 中直接预览原生微信工程：小程序使用 WXML/WXSS/JS/TS，
小游戏使用 Canvas2D/WebGL。预览器不是另造一份 HTML 业务应用，也不替代微信开发者工具。
界面只保留手机预览和「刷新预览」，工程选择、日志和恢复在聊天中完成。

## 功能

- 原生工程发现、JS/TS/CommonJS/ESM 和预构建 npm 依赖图；不自动执行项目构建脚本。
- glass-easel 组件层和自有 WXML/WXSS/Page/wx 兼容层；小游戏使用独立运行时。
- 最多 10 层页面栈，返回保留原页实例、组件、输入草稿、滚动位置和动画时间线。
- 文件监听与防抖重建、不可变构建资源、按工程持久化 Storage 及冲突恢复。
- 固定胶囊、刘海、横竖屏和 DPR；胶囊颜色遵循导航配置，省略时默认白色，不采样滚动背景。
  状态栏保留时间、Wi-Fi、电池，不显示蜂窝信号图标。

## 安装与使用

运行时依赖已打包，安装不需要 npm install 或 build。

1. 按仓库[安装说明](../../../README.zh-CN.md)把完整目录复制到
   `<dataDir>/plugins/wechat-miniprogram-preview/`，保留 `.minimax-plugin`；不要套作者目录。
   默认 dataDir 为 `~/.minimax`，如有自定义则使用实际目录。
2. 更新前保存或导出有价值的预览数据，不直接覆盖仍在运行的实例；按客户端说明启用插件。
3. 在工程会话里说：

   ```text
   用已安装的 wechat-miniprogram-preview 预览当前原生微信工程。
   不新建替代 HTML Mini App，不为打开预览修改业务代码。
   ```

Agent 按专属 Skill 执行 `preview_list`、`preview_open_project`，然后必须执行返回的
`hostOpenAction`（Host 的 `miniapp open`）。构建成功不等于面板打开。内部相对路径不是
普通浏览器 URL；无 previewId 时显示空态，不自动选其他会话的工程。正常显式工程路径
不需要插件额外的目录授权面板；已占用预览不自动抢占。

## Tested environment

- 开发期间使用 MiniMax Code **3.1.4**、macOS Apple Silicon、Node.js 22。
- 开发版已在桌面 Host 安装、启动，使用小程序和 Canvas2D/WebGL 示例验证过基础预览。
- 页面栈、胶囊默认颜色、刘海有定向 Node/jsdom 和隔离 Chromium 证据；最后移除蜂窝图标后
  按要求没有追加视觉验收，不能说这次又做了一轮完整 Host 验收。
- 尚未手工验证 Windows/Linux、真机、大型游戏引擎及这个公开贡献包的完整安装流程。

## Data & access

- **读文件**：显式指定工程的支持源码、配置、本地资源和依赖，以及插件自身文件和示例。
  有 canonical path、目录身份和数量/大小限制，拒绝系统/主目录/敏感配置目录及越界链接。
  不执行项目 Node 代码、不安装项目依赖、不读取宿主凭据和聊天数据库。目录检查不是按会话
  的文件权限沙箱，仅预览可信工程。
- **写文件**：只向 Host 提供的 `context.dataDir` 写预览记录、工程路径、Storage 和迁移元数据，
  把该目录位置视为不透明。运行时不修改业务工程。用户请求导出时由浏览器下载 JSON。
- **网络**：Node 无出站请求，只监听 Host 分配的 loopback 端口。预览允许业务工程指定的
  **任意 HTTPS 图片地址**，可能向这些图片主机发送普通网络元数据；没有固定域名白名单。
  `wx.request` 等网络 API 不支持，iframe 的 `connect-src` 为 `none`。没有遥测或上传服务。
- **进程**：插件不创建子进程，由 Host 启动 Node。构建/测试仅在开发者显式运行时发生。
- **Agent**：页面没有 `agentAccess`，不自行运行 Agent；聊天 Agent 可调用声明的 MCP 工具并
  读取构建诊断和日志，应用日志可能包含业务文本，不要在工程里记录密钥。恢复通道只传元数据，
  不把 Storage 内容发送到 Agent。
- **隔离**：业务 JS 在 opaque sandbox iframe 中运行，没有 Node 或 Host 凭据。解释器需要
  `unsafe-eval`，不是任意恶意代码安全容器；死循环仍可能卡住渲染，远程图片仍可发起请求。

## 页面栈、数据与恢复

前进隐藏但保留旧页，返回只卸载弹出页，重新调用原页 `onShow`，不重复首次加载。
业务自己的 `onShow` 刷新逻辑照常执行。手动刷新、源码重建、切设备和插件重启会替换 iframe，
不保留内存页面栈/未提交输入；只恢复已保存 Storage 和当前路由，不是 HMR。

Storage 按 canonical 工程目录隔离，每工程 1 MiB。同工程多个预览共享持久数据，通过 revision
CAS 防覆盖；最多 8 个预览记录、4 个活动工程、4 个连接页面。超限不会自动关闭其他窗口。
冲突、响应丢失、页面被占用时，通过 `preview_status` 和 `preview_recover` 处理；
`takeover`、`discard_local`、`close` 必须先确认影响，不手改私有数据或反复 create_new。
重启后用原 previewId 重新打开，持久 Storage 不等于页面内存备份。

## 能力边界

不支持微信登录、支付、云服务、扫码、真机预览、上传发布、Worker/WASM、开放数据域、游戏分包、
完整 WebAudio 或所有原生控件；复杂 WXS/CSS、自定义 tabBar、原生转场和 EventChannel 不保证一致。
胶囊是装饰，不能操作微信菜单/退出。Taro/uni-app 需先用自己的构建生成原生工程。

## 开发与许可证

构建、定向测试、打包命令见英文 README；第三方运行时 bundle 和许可证必须一并提交。
仓库根目录执行 `npm run check`。测试、源码和文档位于 runtime payload 外；不提交 node_modules、
个人工程、私有会话日志或凭据。

[实现说明](docs/architecture.md) · [MIT LICENSE](LICENSE)。未附带官方微信/WorkBuddy SDK、
可执行包或复制的 SVG 素材；第三方开源依赖的声明保留在两个 vendor 目录中。
