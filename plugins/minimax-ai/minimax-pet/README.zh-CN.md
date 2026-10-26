# MiniMax Pet

[English](README.md) | 简体中文

作者：**MiniMax**。围绕主窗口可见会话提供轻量陪伴、任务状态与通知，界面提供“外观／任务／设置”三个页签。

## 使用

将仓库 `plugins/minimax-ai/minimax-pet/` 完整复制到 `<dataDir>/plugins/minimax-pet/`，包括隐藏的 `.minimax-plugin`；默认 `<dataDir>` 为 `~/.minimax`，自定义数据目录时采用实际配置。不要复制外层作者目录。重启 MiniMax Code、确认插件启用后，从 MiniApp 列表打开“MiniMax Pet”，或对 Agent 说“打开 MiniMax Pet”。点击“放到桌面”显示透明桌宠窗口。

外观页支持选择、互动、导入预览和删除已导入宠物；任务页显示提醒、全部可见任务和最近回复；设置页提供大小、提醒管理和重连。桌面通知最多预览五行，点击后可滚动读完整内容，桌宠保持可见。观察到 ask 时显示“需要你回答”。原属聊天草稿通过明确入口打开，经 Host 确认后追加到原聊天输入框，仍由用户发送。

旧的本地原型使用不同插件 ID。`minimax-pet` 会有独立的 Host 数据目录，安装本包不会自动搬迁旧插件的宠物和偏好；需要的素材先导出，保留旧安装和数据。

## 环境与兼容

本包支持 MiniMax Code **3.1.6 及以上版本**。2026-10-26 核对的[中国大陆](https://filecdn.minimax.chat/public/minimax-agent-prod/release/latest-mac.yml)与 [Global](https://file.cdn.minimax.io/public/minimax-agent-prod/release/latest-mac.yml) 正式更新清单均为 3.1.6，并已核对同版本发行实现包含所需接口。这确认了正式发布的 API 基线，不代表本插件已在该正式客户端完成 GUI 验收。

任务监控使用 `agent.sessions/session/observe/cancel`，需要 `session.read` 授权。保留运行时能力和权限检查，缺少接口或关闭授权时显示不可用。语音还需要 `deviceAccess: ["microphone"]`、`speech.transcribe`、插件麦克风开关、系统麦克风授权和 Host 转写服务可用；接口已支持不保证每个账号都能使用转写服务。

此前 UI 版本已在 macOS 开发版验收三页签、窄宽布局、真实任务与 ask、导入删除、草稿确认和桌面切换；当前开源修订运行 Node／DOM 测试与隔离 HTTP smoke。新原创图集和图标通过 PNG 解码、动画帧覆盖与确定性重建检查；此前原生 UI 验收早于本次素材替换。当前修订尚未验收 Windows GUI、正式客户端安装、3.1.6 正式版 GUI 或真实录音／ASR，自动化测试使用合成数据，不能证明这些路径。

## 数据与能力边界

只申请 `session.read`，读取 Host 对本插件可见的用户会话状态和所选会话最新回复，不直接读取 Host 数据库、日志、配置或凭据。状态和提醒只在页面内存中，关闭或静音不修改 Host 的任务或未读事实。

全局观察聚合可见任务，初始快照至多 50 条；本连接已观察到、Host 仍确认可见的任务会继续保留。另三个详细观察名额监听活跃会话的 ask，任务结束或移除后取消，等待旧订阅真正结束再补位。详细观察是 tail-only，不能补回订阅前或断线期间的问卷；超过三个活跃任务时，只覆盖其中三个的详细事件。没有观察到 ask 不等于没有待答问卷。

偏好和用户导入素材写入独立的 `context.dataDir`；导入替换有中断恢复，删除限于本插件数据。不创建独立聊天、不逐会话点评、不自动调用模型、不发送或停止用户会话、不代答问卷，也不能跳转任意普通会话。

原属草稿调用 `message.append(text)`，选择其他任务不会改变草稿目标。语音只在用户进入草稿后明确开始；离开会取消录音或转写，音频仅在内存中交给 Host 的转写服务，该服务可能使用其配置的网络。插件本身没有硬编码的外部服务地址，只使用分配的 loopback 源，不启动额外子进程或 shell。

## Agent Skill

随包的 `minimax-pet` Skill 既能打开插件，也能指导当前 Agent 制作、校验和导入自定义宠物。格式文档列出 v1/v2 的精确尺寸、逐帧布局、透明背景、视线方向和 `pet.json`，并附带无外部依赖的 PNG 校验脚本。生成文件先放在用户工作区，再通过界面确认导入；MiniApp 不自行启动模型。

## 开发与许可

保留源码／分发双目录，构建与完整字节对比步骤见 [PROVENANCE.md](PROVENANCE.md)。原创代码、文档、默认宠物和图标均按 [MIT](LICENSE) 开源，作者为 MiniMax。默认图集和图标由可编辑的几何绘图代码生成，见[原创素材说明](ARTWORK.md)；当前包不含第三方宠物素材，用户自行导入的素材保留其各自许可。
