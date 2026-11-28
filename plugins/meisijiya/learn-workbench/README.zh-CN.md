# 学习工作台

给 MiniMax Code 用的 teach 方法学习工作台。你选一个学习目录；工作台在这里维护使命、课纲、课程、速查、学习记录与笔记，并给每节课一个独立的分支会话。

## 它能做什么

- **前置配置**：配置会话采访你，把 `MISSION.md`、`RESOURCES.md`、`GLOSSARY.md`、`NOTES.md` 写进你选的目录。
- **课纲**：主会话写 3–6 个模块的课纲到 `.workbench/curriculum.json`，同时写人类可读的 `CURRICULUM.md`。重新生成会保留已有课程标题、已认领文件与状态。
- **课程**：每节课有自己的分支会话，写出一份自包含的 HTML 到 `lessons/`。每节课都要求能单独阅读；需要前置知识时，用一两句话回顾并链接回那一课。
- **批注与笔记**：在课程里划词添加批注；提炼会话把选中的课程与批注整理成 `notes/` 下的 Markdown。
- **代码链接**：课程里的文件链接（`main.py:608`、`main.py:46–48`）会在应用内弹出代码面板并定位到对应行。
- **工作台管理**：新建/导入学习目录、逐课重新生成、清理产物、切换模型。

## 安装

- **从 Git 导入（MiniMax Code 3.1.11 起）**：插件市场 →「创建」→「Mini App」→「从 Git 仓库导入」，填 `https://github.com/meisijiya/learn-workbench-miniapp`。
- **手动复制**：把本目录复制到 `~/.minimax/plugins/learn-workbench/`（Windows 为 `%USERPROFILE%\.minimax\plugins\learn-workbench\`），重启 MiniMax Code，确认插件已启用。

包声明了 `agentAccess`、`agentConcurrency` 与 `surface.window`，最低客户端为 MiniMax Code 3.1.2。

## 使用

1. 从插件列表打开「学习工作台」。
2. 选择或新建一个学习目录。
3. 完成配置会话，再从主会话生成课纲。
4. 打开一节课，让它的分支会话写课、改课。
5. 划词批注，需要时提炼笔记。

## 测试环境

- MiniMax Code 3.1.19，Windows 11（10.0.26200），使用应用自带的 Node 运行时。
- 已验证：配置；课纲生成与重新生成；课程生成、整节重写、清理后重新生成；批注与高亮；笔记提炼；代码链接面板；工作台新建、导入与移除。
- 未验证：macOS、Linux、3.1.19 之前的客户端、超长会话。

## 数据与访问

- **读写文件**：只读写你选择的学习目录。应用会创建/修改 `MISSION.md`、`RESOURCES.md`、`GLOSSARY.md`、`NOTES.md`、`CURRICULUM.md`、`lessons/*.html`、`reference/*.html`、`learning-records/*.md`、`notes/*.md`、`assets/course.css`，以及 `.workbench/` 状态目录（`workspace.json`、`curriculum.json`、`curriculum.backup.json`、`sessions.json`、`annotations.json`、`notes.json`、`rules/teach.md`、`context/`）。
- **状态存放**：上述学习目录，以及宿主提供的 `context.dataDir` 里的工作台注册表（`registry.json`）。
- **网络**：Mini App 不发起外部网络请求；页面只访问宿主分配端口上的本地 Node 服务。它启动的 Agent 轮次可能按宿主权限使用宿主自己的工具与网络。
- **Agent 轮次**：会为配置、主会话（课纲）、每节课的分支、笔记提炼启动 Agent 会话；只读写所选目录里自己的会话记录，不读取其他对话。
- **工具**：没有 MCP endpoint；声明 `agentAccess: ["session.run"]`。
- **进程**：除宿主启动自己的 Node 入口外，不额外启动进程。
- **麦克风、摄像头、通知**：不使用。
- **读取宿主页面**：不读取你当前在 MiniMax Code 的哪个页面。
- **代码文件**：点击课程里的文件链接时，读取学习目录内的文本/代码文件（禁止 `..`，上限 512 KB）并在面板里显示。

## 许可证

MIT，见 `LICENSE`。
