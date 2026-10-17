# AI 事务所 MiniApp

[English](README.md)。本目录是可以独立复制安装的完整 MiniApp，版本 0.5.10。作者：[最爱双皮奶](https://github.com/cristinamadureira353-svg)。

![使用模拟客户和员工状态的 AI 事务所画面](docs/preview.png)

截图来自隔离模拟局面，不包含真实客户对话或密钥。完整游戏源码与构建工具见 [v0.5.10 源码仓库](https://github.com/cristinamadureira353-svg/ai-office/tree/v0.5.10)。

五位真实模型员工的像素经营游戏。额度或余额耗尽、密钥失效或模型停用时，对应员工显示“脑袋宕机了”，冻结动作、停止接单和后续调用。尚未完成的客户回到等待队列。共享同一 MiniMax 密钥的 M3 和 Flash 在账户额度耗尽时一起暂停。普通限流、短暂断网不作为永久宕机。

充值、额度重置或修好 API 配置后，选中角色，点“额度恢复后 · 重启脑袋”。每次点击只发起一次短检测，不在后台轮询额度。

底部五张员工卡都提供“聊天”按钮，直接打开对应员工的对话窗口并聚焦输入框；可回车发送或点击“发送”。每名员工分别保留和显示自己的对话记录。点卡片其他位置选中员工，在右侧安排休息、回工位、开会或轮休。选择和指令有明确反馈；灰色派单按钮可点击查看不可派单的原因。客户详情的透明区域不会遮挡员工卡或场景点击。主界面采用更适合 MiniApp 窗口的 1120×720 布局，正文 16、辅助文字 14、标题 18，保持框内留白和滚动正文。

休息区的寻路点和坐垫接触点分别配置：Flash、LongCat 坐在沙发的两个坐垫，Step5 坐在单人椅中间。角色到达对应座位才坐下，离座时恢复行走定位。

场景中的五位员工不再显示头顶模型名称。模型身份由底部身份卡的头像和 M3、Flash、LongCat、Kimi、Step5 名称标识；聊天和详情中也显示对应模型。脑袋宕机等状态提示继续显示。

抢单冲突弹窗的四个选择会发送对应裁决；点击后显示提交状态，等待结果期间避免重复提交。成功后弹窗随订单状态刷新收起；连接或裁决失败时在弹窗内显示原因，可重新选择。

关闭时保存未完成冲突的争抢者和对话，重新打开后可继续裁决。兼容旧版只保存订单编号的存档：能从员工任务找回争抢者时恢复冲突；找不回时将该单退回等待，保留资金和其他已完成的交付。进度尚未读取或状态接口失败时，顶部显示连接提示。

工作过程中关闭或读档，已经生成的交付物保留为“待验收”；尚未生成的订单退回等待派单，并解除员工任务锁定。读档时结束上次未完成的会议，员工回工位，可以重新召集；不会自动重放旧会议的模型对话。正在处理的订单不能重复派给其他员工。验收时“打回”会结束该单并扣除相应声誉，不会自动重做。

存档弹窗置于员工卡和会议提示之上，打开期间阻止底层点击。会议室特写将五个座位全部纳入顶栏下方的可见区域；会议状态小窗保持在员工栏上方，五张身份卡和聊天入口都可见。普通会议就座后显示“会议进行中”，由玩家安排散会。

走位采用混合逻辑：后端本地规则安排接待、回工位、会议、休息与随机闲逛；Jev 通过 OpenRouter 的可选调度接口选择目的地，主循环每三秒检查一次。具体路径、速度、朝向、坐姿和键盘动作由本地脚本执行。五名员工各自的模型 API 用于聊天、任务输出和游戏对话，不直接控制逐格移动；移动和动画本身不消耗模型调用。

## Install

把完整的 `ai-office` 目录复制到 `~/.minimax/plugins/ai-office`，包含 `.minimax-plugin` 隐藏目录。MiniMax Code 正常重启后，让 Agent “打开 AI 事务所”。此包没有自动重启或前台抢焦点行为。

新玩家只需安装完整 MiniApp，不需要下载游戏源码或安装 Godot。第一次打开点“复制引导提示词”，发给 MiniMax Code 的 AI。AI 会先确认是否已有配置，再引导选择员工、申请或提供 API Key，并准备运行环境。没有 Key 时，按平台官方入口分步引导注册、登录和创建，等玩家完成再继续；至少配置一家员工模型即可，其他模型可以稍后添加。

通用引导正文在 [SETUP_PROMPT.md](SETUP_PROMPT.md)，对所有玩家一致，不包含开发者用户名、工程路径、固定端口或操作系统假设。页面会在正文之后附上本次运行的配置接口、安装目录和私有数据目录，供 AI 执行配置；这些值来自 Host，适配不同机器和安装位置。配置期间保持 MiniApp 页面打开。仅从仓库复制正文时，AI 会先引导打开 MiniApp 获取完整运行信息。

M3 和 Flash 共用 `MINIMAX_API_KEY`，另外使用 `LONGCAT_API_KEY`、`KIMI_API_KEY`、`STEPFUN_API_KEY`。首次启动页面同时列出可选的 Jev / OpenRouter，自主去向、自动抢单及会议发言顺序等决策使用普通 OpenRouter API Key，保存为 `OPENROUTER_API_KEY`。AI 会先检查已有配置，已有 Key 时复用；没有时询问启用还是跳过，选择启用后逐步引导前往 [OpenRouter 密钥管理](https://openrouter.ai/settings/keys) 注册或登录、创建并保存 Key。Jev 调用使用 OpenRouter 账户额度；跳过后游戏沿用本地规则，不阻止员工模型配置和启动。即使已有员工配置，通用提示词也会检查 Jev，补充时保留其他 Key 和进度。

包内提供空白 `miniapp/node/env.example` 和 `miniapp/node/requirements.txt`，不依赖开发者的 `.env` 或 Python 虚拟环境。新配置和运行环境保存在 MiniApp 私有目录；玩家明确提供的已有配置可以复用。Python 3.9 或以上版本不足时，AI 引导从 Python 官网安装对应系统版本。API Key 与套餐权限以各平台当前官方说明为准，AI 不替玩家购买套餐。

AI 检查依赖和路径后，向提示词中的 `/api/settings` 接口提交 `pythonPath`、`envFile` 和可选的 `initialSave`。接口检查 Python 能导入 Flask、requests、python-dotenv，成功后才原子保存配置。页面每两秒检查本地配置状态，保存后自动进入游戏，之后打开直接进入。复制功能受宿主限制时会选中提示词，支持手动复制；“检查配置”可手动重试。读取提示词和检查配置不会启动游戏后台或调用付费模型。

已有旧配置继续有效。MiniApp 不自动读取 MiniMax Code 的登录凭据。密钥只写入本地配置文件，不回显在 AI 回复、终端日志、网页或配置接口响应中；AI 完成首次配置时不调用付费模型验证。

原始存档只读继承一次。配置和新存档写入 Host 提供的私有 `context.dataDir`，后续启动继续最近一份有效私有存档。关闭 MiniApp 时先保存进度，再退出其子进程。

## Tested environment

记录的开发与宿主环境为 macOS 26.4、MiniMax Code 3.0.73、Python 3.9.6、Godot 4.4.1 单线程 Web 导出及 Node.js 22.23.2。

本游戏已由项目作者在真实 MiniMax Code 桌面宿主中安装、打开并手动游玩，作者于 2026-10-17 确认此前实测经历。已有宿主运行截图和试玩反馈记录了进入游戏，以及员工按钮、聊天入口、坐姿、冲突选项和 HUD 显示等交互与布局问题。本次补充这段实测记录，纠正此前投稿说明遗漏真实宿主试玩的表述。

提交的 0.5.10 安装包另外通过 34/34 项自动交互回归，使用临时 Host 上下文和 headless 浏览器，覆盖首次配置、进入游戏、换安装位置、无源码启动、只提供一家模型 Key、重开后复用配置及员工聊天等流程。自动回归使用模拟模型回复，不验证真实厂商计费；Windows/Linux 宿主、真实中文输入法交互和长期平衡不在现有测试覆盖范围内。手动试玩记录、自动验证命令和结果见 [验证记录](docs/VALIDATION.md)。

## Data & access

- 仅绑定 Host 指定的 `127.0.0.1` 地址和端口。网页只调用本包列出的 `/api/` 路由；不代理任意 URL 或任意文件。
- 读取用户配置的 `.env` 和首次继承的 JSON；不写回原项目。模型密钥只进入本地服务进程，不进入网页、安装包、日志或错误响应。
- 持久化目录：`context.dataDir/settings.json` 和 `context.dataDir/saves/`。配置原子写入并限制并发；存档沿用游戏持锁快照逻辑。
- 启动命令为配置的 Python 解释器，参数数组为 `-u`, `<pluginRoot>/miniapp/node/backend/server/miniapp_bridge.py`, `--data-dir`, `<dataDir>`, `--env-file`, `<configured env path>`，以及可选的 `--initial-save`, `<configured JSON path>`。不使用 shell。该子进程经内部 JSON 行协议提供原有游戏 API，不再监听桌面版 8850 端口。退出时关闭 HTTP 监听、流、定时器和子进程。
- 保存首次配置前，短暂运行相同解释器的 `-c`, `import flask, requests, dotenv` 来检查依赖；最多八秒，输出不进入网页或 Host 日志，退出 MiniApp 会终止尚未完成的检查。
- 玩游戏会依照现有配置调用 `api.minimaxi.com`、`api.longcat.chat`、`api.kimi.com`、`api.stepfun.com`。Jev 调度如配置了 `OPENROUTER_API_KEY`，还调用 `openrouter.ai`。模型输出仅用于原有游戏交付、聊天、冲突、闲聊和会议功能。
- 没有第三方 Node 运行时依赖。Python 运行时和 Flask、requests、python-dotenv 可以由现有环境提供，也可由 AI 依照随包依赖清单在私有目录准备。
- 中文使用随包的 Noto Sans CJK SC 字体，不依赖宿主系统字体。字体遵循 SIL Open Font License 1.1，许可附于 `LICENSE-NOTO.txt`。

## Build

在源码仓库根目录、已准备好的 Python 环境中执行 `python ai-model-party/tools/build_miniapp.py --output <fresh directory>`。Godot 从 PATH 或 `GODOT` 环境变量查找，也可传入 `--godot <执行文件>`。产物目录包含完整的 `ai-office` 插件和 ZIP，附带 MIT、字体及 Godot 的许可声明；输出已存在时拒绝覆盖。Godot 的大资源按 gzip 压缩，必要时分成多个小文件，由本地服务还原为浏览器请求的同一资源。

官方契约：[MiniMax-AI/MiniMax-Code-MiniApps](https://github.com/MiniMax-AI/MiniMax-Code-MiniApps)。
