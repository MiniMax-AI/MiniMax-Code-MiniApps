# MiniMax Code MiniApps

[English](README.md) | 简体中文

**MiniMax Code 桌面端 MiniApp 官方社区仓库**。发现实用工具、有趣的小应用，也可以在这些作品的基础上制作自己的 MiniApp。

[产品理念](#产品理念) · [架构](#架构) · [浏览作品](#miniapps) · [开始使用](#开始使用) · [贡献作品](CONTRIBUTING.zh-CN.md) · [反馈问题](https://github.com/MiniMax-AI/MiniMax-Code-MiniApps/issues)

## 关于本仓库

本仓库面向开源社区开放：任何开发者都可以通过 Pull Request 贡献自己的 MiniApp 插件。MiniApp 是以 MiniMax Plugin 形式承载的交互式应用。本仓库收录开发者贡献的完整插件包，每个作品都包含独立使用所需的文件、源码和说明。

作品按作者存放在 `plugins/<github-username>/<plugin-id>/` 下。你可以下载后手动安装到 MiniMax Code，也可以参考源码开发自己的作品。

## 追求 Human in the Loop，迈向 Agent OS

我们相信，Agent 正在演进为下一代操作系统（OS）。在这一范式转移下，插件不再只是简单的功能扩展，插件即软件，插件即 App（MiniApp）。

与此同时，各行各业的真实生产力依然扎根于高度专业化的工作环境中。单纯的“对话式交互（Chat UI）”无法替代专业工具的精准控制与复杂视图。未来的专业工作流，不应是让用户离开工作台去迁就 AI，而是让专业工作环境与 AI 深度共生——将 AI 内化为像水电、计算、存储一样可随时调用的底层原子能力。通过构建生长在 Agent OS 之上的专业级 MiniApps，我们致力于连接垂直领域的专业交互界面与底层的 AI 原生算力，重塑各行各业的工作方式。

> *CadQuery Viewer 案例：一句话让 Agent 生成 MiniMax 小章鱼的 3D 模型，想改哪里就直接在模型上指出来。* Agent 先查官方形象作参考，再编写 CadQuery 参数化脚本、自己运行并修正问题，构建结果直接显示在右侧的 Viewer 里。要改的时候，在模型上点一下标出位置（比如嘴巴），写一句“嘴巴染成红色”发回对话——Agent 拿到准确的零件和坐标，改完后 Viewer 自动换成新版本。

![CadQuery Viewer 案例：Agent 生成 MiniMax 小章鱼模型，用户在模型上标注嘴巴并让 Agent 改成红色](plugins/hanzijie/cq-viewer/docs/case-study.gif)

**MiniApp 的产品立场：让人始终参与协作与决策（Human-in-the-Loop）。**

我们尊重每一个行业、每一种职业，也尊重每个人长期积累的专业能力。AI 应该成为你最聪明的执行者，放大你的能力，而不是替你假装拥有专业能力。MiniApp 想做的，就是把从打磨到交付这一被切碎的过程重新接起来。

所以，我们希望通过 MiniApp，为每个行业提供一个属于自己的**专业 IDE 框架**——一个既能让 AI 在其中工作，也能让人随时审核、修改、确认的地方。

**在这里，用户可以：**

- **接入能力：** 稳定接入并使用各类开源 MCP 和第一方插件，将数据与操作接入自己的专业工作流。
- **构建界面：** 构建自己的工作界面，让每个行业拥有真正适合自己的工作台。
- **随时协作：** 让 Agent 成为随时可用、值得信赖的工作助手。当然，你也可以让它做任何有意思的事情！

在我们设想的工作方式里，律师不会把 AI 写的诉状直接提交给法院；分析师不会直接依据 AI 生成的观点作出投资决策；运营人员也不会把 AI 生成的活动方案原封不动地上线。

但他们会让 AI 帮自己研究背景、整理材料、完成初稿、完善表达、发现遗漏，然后回到自己的专业工作台中，**审阅、修改、确认，再让 AI 继续推进。**

## 架构

MiniApp 运行在 MiniMax Code 桌面宿主中，由四个相互配合的层组成：

- **宿主管理层：** 宿主提供 Electron 页面承载、运行时服务、插件安装与发布、Node 进程生命周期、就绪与实例管理，以及权限与凭证管理。宿主控制贯穿各层，但业务逻辑仍由插件负责。
- **展示层（Chromium / Chrome 引擎）：** MiniApp 页面使用 HTML、CSS 和 JavaScript 实现筛选、表格、图表与交互式渲染；宿主凭证不会交给页面。
- **应用层（Node.js）：** Node 进程负责数据聚合、转换与深度加工、业务规则和持久化。页面接口与 Agent 工具复用同一套业务服务；Node 还可以为宿主 MCP 客户端提供受管理的 MCP 服务。
- **能力与数据接入层：** 插件可以使用现有的 Host Connector 能力、可选的插件子进程 CLI，以及规划中的统一工具入口，在获得授权后访问 Connector 或 MCP，连接外部业务服务、MCP 服务、本地工具与本地数据。

MiniMax Code Agent 通过宿主 MCP 客户端与 MiniApp 协作。业务请求与页面数据在展示层和应用层之间流转，Agent 的调用与结果由宿主进行中介和管理。这样既能让凭证与控制权留在宿主，也能让领域逻辑与持久化留在插件中。

![MiniApp 技术架构图](docs/architecture/miniapp-technical-architecture.png)

*中文版架构图：MiniMax Code 桌面宿主、展示层、应用层，以及能力与数据接入层。*

## MiniApps

| MiniApp | 功能 | 作者 |
| --- | --- | --- |
| [动态工作流控制台](plugins/stevenjj33/workflow-console/README.zh-CN.md) | 在一个页面里运行并盯住 MiniMax Code 动态工作流：实时状态、按阶段与依赖画出的流程图、节点输出、审核与控制、模板与报告导出 | [stevenjj33](https://github.com/stevenjj33) |
| [MiniMax Photo](plugins/webguhui/minimax-photo/) | 图层图片编辑、应用内 AI 助手、本地恢复与程序化编辑工具 | [WebGuHui](https://github.com/WebGuHui) |
| [MiniMax Video](plugins/webguhui/minimax-video/) | 本地视频剪辑、字幕、宿主 Agent 助手、可预览的时间线修改与 MP4/MP3 导出 | [WebGuHui](https://github.com/WebGuHui) |
| [AI 事务所](plugins/cristinamadureira353-svg/ai-office/README.zh-CN.md) | 五位真实模型员工的像素事务所：接单、聊天、休息和开会，额度耗尽时角色暂停；使用玩家自己的 API Key | [最爱双皮奶](https://github.com/cristinamadureira353-svg) |
| [Token 用量看板](plugins/amszuidas/mcode-token-usage-board/README.zh-CN.md) | 按时间、模型和会话查看本机 Token 用量，包含输入、输出和缓存用量 | [amszuidas](https://github.com/amszuidas) |
| [Token 用量看板](plugins/yanhy2000/mcode-usage-monitor/README.zh-CN.md) | 近实时查看本机 Token 用量、输出速度与缓存命中率，可按时间范围、模型和会话筛选 | [yanhy2000](https://github.com/yanhy2000) |
| [模型管理器](plugins/ocoomber/openrouter-model-manager/README.zh-CN.md) | 浏览、搜索并启用/停用 `~/.minimax/config.yaml` 中的模型，支持即时保存、批量操作、一键撤销和自动备份 | [ocoomber](https://github.com/ocoomber) |
| [自驾规划](plugins/hanzijie/self-drive-route-planner/README.zh-CN.md) | 【官方插件】规划自驾路线、地点搜索、候选算路与小红书 3:4 行程图；支持演示模式 | [HanZijie](https://github.com/HanZijie) |
| [Git 提交树](plugins/microbiosis/git-tree/README.zh-CN.md) | 查看本机 Git 仓库的提交历史：泳道提交图、分支/标签、提交详情与文件改动统计，支持筛选偏好持久化与可选自动刷新 | [Microbiosis](https://github.com/Microbiosis) |
| [番茄钟 · 久坐提醒](plugins/1602winxp/pomodoro-sit-timer/README.zh-CN.md) | 只计时的番茄钟：工作段结束在页面内弹出久坐提醒并响铃，不锁状态、不限制休息时长；提醒音支持单文件或文件夹、顺序/随机播放、单曲循环与响度匹配 | [1602WinXP](https://github.com/1602WinXP) |
| [灵签易占](plugins/weekbin/chinese-divination/README.zh-CN.md) | 梅花易数起卦与解卦：时间、数字、铜钱摇卦、每日一卦四法起卦，按体用生克断吉凶，另备六十四卦全文与干支历法 | [weekbin](https://github.com/weekbin) |
| [会话轨迹](plugins/avatasia/mmc-trajectory/README.zh-CN.md) | 按轮次浏览一段会话的模型轨迹：消息流、思考过程、工具调用与结果、token 用量与每轮耗时 | [avatasia](https://github.com/avatasia) |
| [CadQuery Viewer](plugins/hanzijie/cq-viewer/README.zh-CN.md) | 在对话里打开时列出对话所在文件夹里的 STL / STEP（保留装配零件名称、颜色和真实边线），按住哪里就绕哪里旋转；显示 CadQuery 脚本推送的模型，在模型上标注位置后一键发给 AI；再点一下，后台 Agent 用 MiniMax 图像生成把当前视角的白模渲染成成品图，可补充自己的描述；AI 可通过 MCP 工具添加模型文件夹、打开模型，并内置 CadQuery 参数化建模 skill | [HanZijie](https://github.com/HanZijie) · [flowful-ai](https://github.com/flowful-ai) |
| [MiniMax Bot](plugins/minimax-ai/minimax-bot/) | 【官方插件】把 MiniMax Code 变成常驻的 Bot 团队：总管 Bot 帮你组建团队，群聊里用 `@` 在成员之间交接工作，每个 Bot 有自己的记忆、定时任务和用量统计；需要 MiniMax Code 3.1.2 或更高版本（说明文档为英文） | [MiniMax-AI](https://github.com/MiniMax-AI) |
| [心屿](plugins/yujiachen-y/xinyu-daily/README.zh-CN.md) | 像独立小游戏的每日心情小岛：由你的回答决定的今日灵感卡、心情贴纸、小确幸罐子、纠结老虎机、答案之书，还有坏脾气螃蟹藏起来的 20 个秘密；可选开启小屿陪伴，借用你的模型每天写信、陪你聊天。需要 MiniMax Code 3.1.2 或更高版本 | [yujiachen-y](https://github.com/yujiachen-y) |
| [协作 · MoMo](plugins/amszuidas/momo-collab/README.zh-CN.md) | 项目管家 MoMo：把随手的想法、截图和链接攒成想法，写清后变成任务，派 Agent 会话带着完整背景去执行，按验收标准核对结果后交你审核，进展在看板上一眼可见。需要 MiniMax Code 3.1.2 或更高版本 | [amszuidas](https://github.com/amszuidas) |
| [Anatomy 画廊](plugins/zch0227/anatomy-gallery/README.zh-CN.md) | 集中展示 anatomy 技能做出的交互式等距图解：按自建展区挂墙，全屏查看明暗两版，保留全部历史版本；在画廊里让 Agent 新建或修改作品，每次运行都有过程记录。自带 anatomy 技能。需要 MiniMax Code 3.1.2 或更高版本 | [zch0227](https://github.com/zch0227) |
| [仓库透视](plugins/yujiachen-y/repo-xray/README.zh-CN.md) | 从 Git 历史看懂一个代码仓库：可逐层下钻的代码地图、热点与 Bug 磁铁、高风险文件、负责人与知识流失、提交节奏与救火记录、技术栈；支持 GitHub、GitLab 和本机仓库，全部在本机分析 | [yujiachen-y](https://github.com/yujiachen-y) |
| [磁盘透视](plugins/zch0227/disk-insight/README.zh-CN.md) | 查看 macOS 和 Windows 的磁盘空间去向：旭日图空间地图，按三档风险分类的垃圾文件，大文件和重复文件，代码仓库和 Git worktree 的占用；任何条目都可以问 Agent，选中的条目在确认框里逐一列出，确认后直接永久删除。需要 MiniMax Code 3.1.2 或更高版本 | [zch0227](https://github.com/zch0227) |
| [A/时差保安](plugins/liuchen19960902/timezone-guard/README.zh-CN.md) | 发消息前先看对方那边几点：按对方城市当地时间给出「现在可以聊 / 短聊就好 / 先睡，别发」三档判定。需要 MiniMax Code 3.1.2 或更高版本 | [FineCat](https://github.com/LiuChen19960902) |
| [AI 节点画布](plugins/antianqi/ai-node-canvas/README.zh-CN.md) | MiniMax Code 里的无限画布节点图：把文本、图片、视频、音频的生成接成一张图，结果顺着连线往下传，任何一张结果都能直接做二次处理 | [antianqi](https://github.com/antianqi) |

<details>
<summary>预览：Token 用量看板</summary>

![Token 用量看板，使用合成数据展示用量趋势](plugins/amszuidas/mcode-token-usage-board/docs/preview.png)

预览使用合成数据，应用界面目前为中文。数据访问范围、统计口径和兼容性说明见作品 [README](plugins/amszuidas/mcode-token-usage-board/README.zh-CN.md)。

</details>

<details>
<summary>预览：Token 用量看板（mcode-usage-monitor）</summary>

![Token 用量看板，使用合成数据展示用量趋势](plugins/yanhy2000/mcode-usage-monitor/docs/preview.png)

预览使用合成数据，应用界面目前为中文。数据访问范围、统计口径和兼容性说明见作品 [README](plugins/yanhy2000/mcode-usage-monitor/README.zh-CN.md)。

</details>

<details>
<summary>预览：Git 提交树</summary>

![Git 提交树，使用合成数据展示泳道提交图](plugins/microbiosis/git-tree/docs/preview.jpg)

预览使用合成数据，应用界面目前为中文。仓库发现规则、泳道算法来源与兼容性说明见作品 [README](plugins/microbiosis/git-tree/README.zh-CN.md)。

</details>

## 开始使用

### 使用要求

需要支持 MiniApp 的 MiniMax Code 桌面端版本。各作品的 README 会说明已验证的客户端版本、操作系统、所需配置和已知限制，兼容性以具体作品为准。使用较新能力（如运行 Agent 任务、在独立窗口中打开）的作品需要 MiniMax Code 3.1.2 或更高版本，旧版本无法安装。

### 1. 下载

点击仓库页面的 **Code → Download ZIP** 并解压，或 clone 仓库：

```sh
git clone https://github.com/MiniMax-AI/MiniMax-Code-MiniApps.git
```

在 `plugins/<github-username>/` 下找到想用的作品，阅读其 README，了解它会访问哪些本地文件或网络服务。

### 2. 安装

将**完整插件目录**复制到 `<dataDir>/plugins/`，保留 `.minimax-plugin` 隐藏目录。

`<dataDir>` 默认为用户主目录下的 `.minimax`，即 `~/.minimax`，因此默认安装目录为 `~/.minimax/plugins/`。如果你配置了其他数据目录，请使用实际配置的路径。

以 Token 用量看板为例：

```text
仓库中：plugins/amszuidas/mcode-token-usage-board/
安装到：<dataDir>/plugins/mcode-token-usage-board/
```

安装后的插件清单应位于：

```text
<dataDir>/plugins/mcode-token-usage-board/.minimax-plugin/plugin.json
```

作者目录（`amszuidas/`）只用于仓库归类。复制到客户端时，将插件目录直接放入 `plugins/`，不要多套一层作者目录。

这些插件包采用**手动安装**方式，客户端的 GitHub 插件导入功能目前不支持这类 MiniApp 包。

### 3. 打开

重新启动 MiniMax Code，确认插件已被识别并启用，再按作品 README 打开 MiniApp。例如，你可以请 Agent 打开“Token 用量看板”。

更新时先关闭 MiniApp 并退出客户端，再替换完整插件目录。备份放在 `plugins/` 之外，数据保留方式按作品说明处理。卸载时同样先关闭应用并退出客户端，再移除对应插件目录；单独保存的应用数据可能仍会保留。

## 贡献作品

欢迎分享工具、游戏、可视化应用和小实验。提交作品只需：

1. Fork 仓库，把 `examples/hello-miniapp/` 复制到 `plugins/<你的-github-username>/<plugin-id>/`，在此基础上开发。插件包规则见 [`docs/`](docs/package-contract.md)（英文）；AI 编码助手会自动读取 [`AGENTS.md`](AGENTS.md)。
2. 附上 README、许可证和运行所需文件，说明配置方式、数据访问范围与验证情况。
3. 在根目录的中英文 README 作品表格中增加一行，运行 `npm run check`，然后提交 Pull Request。

作者目录使用小写 GitHub username。插件目录名必须与 `.minimax-plugin/plugin.json` 中的 `name` 一致，且**插件 ID 在整个仓库中唯一**，因为安装路径不包含作者目录。

完整说明见[贡献指南](CONTRIBUTING.zh-CN.md)。

## 问题与建议

欢迎通过 [GitHub Issues](https://github.com/MiniMax-AI/MiniMax-Code-MiniApps/issues) 反馈问题、分享作品想法或提出改进建议。反馈插件问题时，请提供插件 ID 和版本、MiniMax Code 版本、操作系统、复现步骤，以及预期和实际结果。日志和截图请移除凭据及私人会话内容。

如果你希望 MiniApp 获得目前还不具备的运行时能力（例如新的 `context` API 或窗口行为），请直接在置顶的[能力愿望单](https://github.com/MiniMax-AI/MiniMax-Code-MiniApps/issues/9)下评论，不必另开 issue。

## 许可证

本仓库采用 [MIT License](LICENSE)。各 MiniApp 以其目录中附带的许可证为准。
