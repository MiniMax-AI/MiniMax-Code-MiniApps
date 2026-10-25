# MiniMax Cut for MiniMax Code

[English](README.md)

本地视频剪辑器，保留上游 19 个 Agent 工具，另增加一个工程目录导入工具。插件内直接包含固定版本 FableCut 1.16.0 源码，无需单独安装 FableCut 或拉取 Git 子模块。可以手动操作时间线，也可以在聊天里让 Agent 导入素材、剪辑、添加字幕与动效、处理音频和导出。

MiniMax Cut 是面向 MiniMax Code 的 [FableCut](https://github.com/ronak-create/FableCut) 社区改编版，不是 FableCut 官方版本，也未获上游项目背书。

## 安装与打开

在 MiniMax Code 中将本目录作为本地 Plugin 安装，保留隐藏的 `.minimax-plugin` 目录。随后从 Mini App 入口选择 MiniMax Cut，或让 Agent 打开它。服务由 Host 管理，无需手动启动服务器或访问固定端口。

媒体分析、代理文件、音频处理和视频编码需要运行环境的 PATH 中存在 `ffmpeg` 和 `ffprobe`。插件不捆绑这些程序；请安装适合操作系统的版本，修改 PATH 后重启应用。

附带的 `minimax-cut` Skill 说明各项编辑操作及其对应的工具调用。

## 功能范围

MiniMax Cut 处理的是媒体：导入视频、音频与图片，铺到时间线上，再渲染成片。

内置媒体生成不在本插件范围内：没有图片、视频、语音或音乐的生成步骤，插件也不配置供应商密钥。新素材与其他素材一样以导入文件的方式进入时间线——通过 `fablecut_import_media` 或工程目录导入。

## 工具名称

20 个面向 Agent 的工具保留上游名称：`fablecut_status`、`fablecut_get_project`、`fablecut_import_media`、`fablecut_export` 等。插件、Mini App 与 Skill 使用 MiniMax Cut 品牌，但工具本身是上游工具并沿用上游名称，这样以后同步上游更新时无需重命名公开工具接口。MCP 服务本身注册为 `minimax-cut`，接口路径为 `/mcp/minimax-cut`。

## 使用方式

- 打开 Mini App，调用 `fablecut_status` 确认当前工程。
- 按需读取 `fablecut_docs` 的具体章节，通过 `fablecut_get_project {compact:true}` 查看时间线。
- 用 `fablecut_import_media` 导入本地文件，再用返回的媒体 ID 创建片段。
- 优先用 `fablecut_patch_project` 局部编辑。依赖已读版本的修改带上 `baseRevision`，遇到冲突重新读取当前工程。
- 用 `fablecut_versions` 管理版本，用 `fablecut_projects` 管理工程。
- `fablecut_import_project {folder}` 会复制已有工程的媒体，保存当前工程版本后替换当前时间线，原件不变。缺失或越界媒体会使导入被拒绝，支持源媒体子目录。页面中的纯 JSON 导入不会自动带入外部媒体。
- 合成画面抽帧、示波器、跟踪和导出需要编辑器页面保持打开。长任务使用 `wait:false` 后按 job ID 查询。

服务在多个会话之间共享，上游工程管理沿用一个全局当前工程。切换工程会影响其他打开的页面；编辑前应核对当前工程并协调切换。

## 导出限制

当前移植版使用原有编辑器页面中的合成器。外部无头 Chrome 无法访问 Host 认证保护的页面，因此不作为兜底方案。渲染时请保持编辑器打开。长片或高分辨率导出可能受到浏览器资源限制；短片导出成功不代表长片稳定性已经通过。插件未提供独立的通用 FFmpeg 时间线渲染器。

编辑器保留 FableCut 的时间线与效果模型。Skill 说明工具如何使用，不规定创作流程。无论素材由何而来，边界都是导入的媒体文件，时间线格式不变。

## Tested environment

- 目标客户端：MiniMax Code 3.1.2 或更高版本（托管运行时及独立窗口）。
- 开发环境：Windows 11 x64、Node.js 26.10.0、FFmpeg／FFprobe 8.1.1。
- 历史记录（记录于原 `fablecut` 插件标识下）：2026-10-24 本地 Host publish／inspect／open 成功。页面实测包括合成视频导入、视频与关联音轨落位、标题创建、播放控件、重载持久化，以及 4 秒 1280×720／30 fps 导出；编辑器报告导出检查通过，控制台及失败请求检查为空。这是短片冒烟检查，不代表长片稳定性已通过。
- 历史记录（记录于原 `fablecut` 插件标识下）：2026-10-25 新会话已收到 Host 注入的 MCP 工具，并成功调用 `fablecut_status`、`fablecut_get_project` 和 `fablecut_docs`。真实 Host 写入调用与 macOS 仍未验证。本地集成测试检查了托管 HTTP 协议、20 个工具的发现，以及代表性编辑和导入调用。
- MiniMax Cut 这一标识本身尚未在 Host 中安装，也未做浏览器实测。本次改名涉及插件 ID、包路径、Skill ID、MCP 服务标识与接口路径以及界面品牌，编辑相关的代码路径未变。
- 本包自身的测试通过：70 项，含改名后的清单、Skill 与页面标题断言。包校验对本包无错误、无警告。
- 仓库总检查仍有两项原有的 Windows 符号链接夹具 EPERM 失败（其余 67 项根目录测试通过）；其他插件的原有警告保持。

仓库根目录执行 `npm test --prefix plugins/klarkxy/minimax-cut` 运行插件集成测试，执行 `npm run check` 运行仓库检查。完整插件目录安装时不需要额外构建或安装 npm 依赖。

## Data & access

- **状态存储：** 工程、媒体副本、版本、分析缓存、代理、素材库和导出文件放在 Host 提供的私有 `context.dataDir` 中，不依赖其物理位置，不写入插件源码目录。
- **读取文件：** 插件自带资源、用户选择或明确传给工具的媒体文件、工程数据和分析产物。导入本地素材会复制文件，不修改原件。
- **写入文件：** 在私有数据目录中写入工程、版本记录、媒体、分析结果、代理和导出文件。工程管理与删除由具体工具或页面操作触发。
- **网络：** 页面和 MCP 使用 Host 分配的本机监听端口。HTTPS 素材导入访问传入 URL 的主机及允许的重定向目标，本地剪辑不依赖固定外部主机。上游可选的 Google 字体加载访问 `fonts.googleapis.com`、`fonts.gstatic.com`；可选背景移除从 `cdn.jsdelivr.net` 加载 MediaPipe 资源。这些继承功能本轮未实测。
- **进程：** Node 运行时调用本机 `ffmpeg`、`ffprobe`；不启动额外编辑器服务器或外部无头浏览器。上述程序需另行安装。
- **Agent 回合：** Mini App 不主动发起 Agent 回合，不声明 `agentAccess`。用户现有聊天中的 Agent 调用 MCP。
- **Host 数据：** 不读取 Host 配置、凭据、私有日志或会话数据库；传输认证由 Host 管理。

## 上游与维护

来源：[ronak-create/FableCut](https://github.com/ronak-create/FableCut)，版本 1.16.0，commit `fd2af081d73ec94464b88df8c21f640adcc78985`。原始版权和 MIT 许可保留在 [LICENSE](LICENSE)，第三方素材许可随资源保留。

源码直接纳入插件。`upstream.json` 记录来源，`PATCHES.md` 记录必要的本地适配，包括本包所做的品牌改动。升级时对比上游、合并适配、执行测试，再检查安装后的编辑器和导出。安装或更新插件不会自动拉取上游或安装系统软件。
