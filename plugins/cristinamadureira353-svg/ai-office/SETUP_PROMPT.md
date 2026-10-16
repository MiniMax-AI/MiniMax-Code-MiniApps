我刚安装了「AI 事务所」MiniApp，请担任我的首次启动向导，带我完成配置并开始游戏。我不需要游戏源码，也可能没有 Python、API Key 或任何已有配置，请按新玩家的情况引导。

请按下面的顺序执行，每次只让我完成当前需要的一步：

1. 先读取文末配置接口，检查这个 MiniApp 是否已经配置。已有配置时保留原配置和进度，检查其中各家 Key 是否非空，不回显文件内容或 Key；即使已经配置员工，也要按第 3 步检查 Jev，不要直接跳过。尚未配置时，用简单的话说明：游戏员工由真实模型驱动，可以只启用一家模型，API Key 是让对应员工工作的凭据，游玩会使用我自己的模型额度。然后问我：“你已经有 API Key 吗？有的话告诉我是哪家平台；如果没有 Key，我可以带你申请。”

2. 如果我有 Key，先确认对应平台，以及我想启用的员工。如果我没有 Key、不了解 Key，或者不知道选哪家，先介绍下面的平台，由我选择一家开始。带我依次完成注册或登录、找到密钥管理、创建 API Key、把 Key 提供给你或存到本地文件。每一步都等待我完成或回答，再继续；不要只丢给我配置命令。套餐、价格、模型权限和入口以平台官网当前说明为准，购买或充值由我自己决定。

可以配置的模型与申请入口：
- MiniMax：MINIMAX_API_KEY，M3 和 Flash 共用一个 Key。官方获取说明：https://platform.minimax.cn/docs/guides/quickstart-preparation
- LongCat：LONGCAT_API_KEY。官方获取说明：https://longcat.chat/platform/docs/zh/
- Kimi：KIMI_API_KEY，当前游戏使用 Kimi Code 接口。通过官方说明中的 Kimi Code 控制台入口获取对应 Key：https://www.kimi.com/code/docs/
- StepFun：STEPFUN_API_KEY，当前游戏使用 Step Plan 接口。请引导获取对应服务的 Key：https://platform.stepfun.com/step-plan
- OpenRouter / Jev：OPENROUTER_API_KEY。Jev 负责员工的自主去向、自动抢单和会议发言顺序等决策，使用普通 OpenRouter API Key，不需要另一种专门的 Jev Key，也不占用五名员工模型的 Key。官方密钥管理入口：https://openrouter.ai/settings/keys；官方获取说明：https://openrouter.ai/docs/api_reference/authentication；Jev 说明：https://openrouter.ai/docs/guides/community/jev

3. 只配置我选择和提供的模型，至少启用一家员工模型即可，不要求一次填齐所有 Key。没有任何员工 Key 时继续保持引导并等待我提供，不要用占位值、虚构 Key 或只填路径来宣布配置完成。MiniMax Code 的登录状态不等于已经提供了游戏所需的 API Key。

单独引导 Jev：先检查已有配置文件中的 OPENROUTER_API_KEY。已有非空 Key 时保留并复用，说明 Jev 已配置，不要让我重复申请。没有时，说明：“Jev 是可选的自主决策功能，会使用 OpenRouter 账户额度；跳过后游戏仍按本地规则走位和运行。你想现在启用 Jev，还是暂时跳过？”如果我选择启用，先确认是否已有 OpenRouter Key；已有时只补上这一项，保留其他员工 Key 和存档。没有时，引导我打开官方密钥管理入口、注册或登录、创建并保存 API Key、按需设置额度限制，再把 Key 提供给你或存到本地配置文件。是否充值由我自己决定，以官方当前余额和权限说明为准。每一步等待我完成，收到真实 Key 后才写入 OPENROUTER_API_KEY；尚未收到时说明 Jev 待配置，不用员工 Key 代替。选择跳过时留空并明确说明 Jev 未启用，不阻止其他员工配置和游戏启动。

4. 使用文末 MiniApp 自动提供的安装目录、私有数据目录和配置接口，不假设我有开发项目或固定的电脑目录。读取安装目录中的 README.md、miniapp/node/env.example 和 miniapp/node/requirements.txt。配置文件默认新建在私有数据目录中，按空白模板保存我提供的 Key，并按系统支持的方式限制为当前用户读写；如果我明确提供了已有配置文件，可复用并保留其其他设置。Key 不要回显到回复、网页或终端日志，也不要写进源码、安装包或 GitHub；配置接口只提交文件路径。

5. 检查当前系统可用的 Python 3.9 或以上版本。在 MiniApp 私有数据目录创建独立虚拟环境，并安装随包 requirements.txt 中的依赖；已有可用环境可以复用。没有 Python 时，给我 https://www.python.org/downloads/ 中适合当前系统的安装指引，等待我安装后再继续。由你确定实际解释器路径并验证能导入 flask、requests、dotenv，不要求我手填技术路径。Windows 虚拟环境通常使用 Scripts/python.exe，macOS / Linux 通常使用 bin/python。

6. 至少收到一家员工模型的 Key、准备好本地文件和依赖后，向文末 configurationEndpoint 提交 POST application/json，字段为 pythonPath、envFile、initialSave，前两项使用实际文件绝对路径。initialSave 默认留空；只有我明确要求继承旧进度时才只读导入一份 JSON 存档。确认返回 ok 为 true，再 GET 同一接口确认 configured 为 true，页面随后自动进入游戏，以后直接启动。

7. 配置期间不调用付费模型来验证 Key，不替我购买套餐或读取宿主登录凭据。完成后简短告诉我哪些员工已配置、哪些未配置，以及 Jev 是已配置、已跳过还是等待 Key，说明本地配置已保存，实际模型可用性在游玩时体现。如果缺少权限、Python 或 Key，说明当前缺什么并继续引导；未完成时不要声称可以正常游玩。

如果没有附带本次运行信息，先让我打开 MiniApp 并复制页面上的完整引导提示词；如果本次接口已停止，让我重新打开后复制最新提示词。不要猜测端口、路径或替换别人的配置。
