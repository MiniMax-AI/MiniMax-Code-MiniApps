# MiniMax Photo

[English](README.md)

运行在 MiniMax Code 中的图片编辑器。你可以手动编辑图层、选区和颜色，也可以直接在应用里的 AI 助手输入需求，让 Agent 读图、改图或调用宿主提供的生图工具。

编辑器基于开源 PhotoCraft 的 WebAssembly 版本，增加了示例引导、可拖动和收起的助手、作品恢复、图片回传，以及程序化组合调用。没有打包 Electron、模型权重或 API 密钥。这是社区作品，不是 Adobe 产品，也不是 MiniMax 官方应用。

![MiniMax Photo welcome page with generated example images](docs/preview.png)

附带 [图片编辑 Skill](skills/minimax-photo/SKILL.md)，指导 Agent 按需发现命令、组合批量编辑、检查预览和从失败处继续。策略不绑定特定题材，用户可以直接附图描述需求。

## 安装与使用

需要 MiniMax Code 3.1.2 或更新版本。退出客户端，将本目录完整复制到 `<dataDir>/plugins/minimax-photo/`，保留隐藏的 `.minimax-plugin` 目录；默认 `<dataDir>` 为 `~/.minimax`。不要多套一层 `webguhui` 目录。重启并启用插件，向 Agent 说“打开 MiniMax Photo”。无需安装 npm 依赖。客户端的 GitHub 插件导入不支持此类包，请按社区仓库的手动安装流程操作。

打开图片或示例后即可编辑。“更多 → 保存工程”保留图层，“导出 PNG”保存合并图片。AI 返回的图片会作为新作品打开。工程格式 `.pcraft` 来自 PhotoCraft。

开源版使用新插件 ID `minimax-photo`，与开发版 `retouch-lab` 分开安装，不自动迁移旧版的内部备份和 AI 对话。已有 `.pcraft` 和旧版 `.retouch.json` 文件仍可打开。升级前先保存工程、停止 AI 并退出客户端，再替换完整插件目录。

## 已验证环境

在 macOS Apple Silicon 的 MiniMax Code 中验收，初始客户端版本为 3.1.3-preview.4675。当前包 **0.2.31** 已于 2026-10-20 实际安装，97 个文件与发布包一致，运行 ZIP **14,260,491 字节**，不含 Electron 或模型权重。

- 应用内一句需求完成文生图、自动回传和新画布打开；语义改图也已有真实宿主成功记录。
- 旧版分层工程重开与自动保存恢复、四语言帮助、示例打开、草稿保留和助手收起已验证；不同项目与版本详见 [验收说明](docs/validation.md)。
- 4000×3000 画布完成 100 笔、单笔撤销和 PNG 导出。单次导出约 1.33 秒；绘制包含展示间隔，不作为纯渲染或竞品性能结论。
- 0.2.31 错误导出路径参数会在入队前被拒绝；正常导出返回可用 PNG 路径。打包、PTC、逐笔与社区 69 项检查通过。

仍存在一次历史打开失败后需重启恢复的记录，根因未确认。自然语言任务可能出现工具误用，不能保证每次都自主完成；附图素描单轮展示曾耗时 27 分 25 秒。Windows、稳定客户端、复杂 PSD 和全部编辑命令未全面验证，不声称完整兼容 Photoshop 或性能全面超过 PhotoCraft。

## 数据与权限

`editor_open_file` 读取明确提供的本机 PNG/JPEG/WebP/PSD/pcraft 文件（最多 32 MB），检查文件头后交给编辑器作为新文档打开。不扫描目录、不修改原文件。任务内容保存在插件数据目录，工具回复不含文件字节。

应用在宿主分配的本机端口运行，工程备份、草稿、回复、会话编号、图片和编辑任务存入宿主提供的 `context.dataDir`。不读取宿主配置、密钥或会话数据库。选择文件在页面中完成，保存使用下载对话框。图片回传 MCP 工具可读取 Agent 指定的 PNG 路径；不是任意文件下载接口。

发送需求会运行宿主 Agent，它可以按宿主权限使用文件、Shell 和 MCP；需求和参考图片可能交给用户配置的模型服务。应用不自带密钥，不自动批准权限。后台不直接请求外部服务，也不自行启动 Shell 子进程；Agent 工具可能执行这些操作。PTC 运行于独立 QuickJS 工作线程，仅暴露编辑 API。

自动备份只覆盖当前活动作品，存在几秒间隔；不要替代手动保存。不要同时在两个窗口修改同一 AI 会话，过期写入会被拒绝。本地备份和生成文件暂不自动清理；卸载插件后宿主私有数据可能仍然保留。

## 文档与许可

[用户手册](docs/user-guide.zh-CN.md) · [构建说明](docs/build.md) · [Agent 工具](docs/agent-tools.zh-CN.md)

新增 MiniApp 代码采用 MIT；PhotoCraft、字体、图标和 QuickJS 的原许可证保留在 `licenses/`。展示图片由 Codex 生图工具制作，是单层示例图片。没有包含修图派的专有源码或素材。

AI 编辑成功后会短暂回放画笔轨迹和范围框；其他修改显示画布高亮。可在“更多 → 显示 AI 操作轨迹”关闭。提示层不进入图片导出或撤销记录；这是操作完成后的回放，不是逐像素执行动画。

### 逐笔绘制

PTC 的 `await editor.draw({strokes, intervalMs:550})` 按顺序绘制 `paint.stroke` 参数数组（1–96 笔，间隔 100–600 ms）。每笔真实更新画布并单独撤销；失败时保留已完成笔触。`editor.edit` 仍是整批提交。素描构图和明暗指导见插件 Skill。

笔触支持 SVG 风格的绝对路径命令数组（`M`、`L`、`Q`、`C`、`Z`），由工具采样曲线，避免 Agent 反复编写插值算法。
