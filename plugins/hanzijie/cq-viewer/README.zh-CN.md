# CadQuery Viewer

简体中文 | [English](README.md)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/cqviewer-lockup-dark.png">
  <img alt="CadQuery Viewer" src="docs/brand/cqviewer-lockup-light.png" width="420">
</picture>

MiniMax Code 里的本地 3D 模型查看器。在对话里打开时，列出这个对话所在文件夹里的所有 STL 和 STEP（STEP 装配保留零件名称、颜色和真实 CAD 边线），勾选哪个打开哪个；也能显示 CadQuery 脚本推送的模型。按住模型上任意一点拖动就绕那一点旋转，双指或右键平移，在模型上标出位置后一键发到对话里，让 AI 准确知道你说的是哪个面、哪个孔、哪条边。再点一下，就能把当前视角渲染成成品图：Viewer 截一张干净的白模，后台 Agent 用 MiniMax 图像生成把它渲染出来，并按你补充的描述调整。AI 可以通过 MCP 工具登记模型文件夹、在查看器里打开模型；包里还内置了 flowful-ai 的 CadQuery 参数化建模 skill。

作者：[HanZijie](https://github.com/HanZijie) · [flowful-ai](https://github.com/flowful-ai)（内置的 CadQuery skill） · 版本：`1.4.0`

![CadQuery Viewer：一个 STEP 装配，已标注三个位置，准备发送](docs/preview.jpg)

## 功能

| 模块 | 说明 |
| --- | --- |
| 查看 | 全窗口画布，正交相机，Z 轴向上（与 CadQuery 一致）。7 个预设视角、适配、边线、网格、X/Y/Z 剖切、坐标轴指示，跟随亮色/暗色主题。 |
| 视角操作 | 在模型上按下并拖动，就绕按下的那一点旋转（有一个圆环标出旋转中心），画面不会跳。触控板：双指滑动平移，双指捏合朝指针缩放。鼠标：滚轮朝光标缩放，右键或中键拖动平移。两种方式都可以 Shift + 拖动平移。工具栏的 **操作方式** 每次滚动自动判断是触控板还是鼠标，也可以手动固定，并列出所有手势。 |
| 会话文件夹 | 在对话里打开时，递归列出这个对话所在文件夹里的 `.stl`、`.step`、`.stp`（包括 `~/.mavis/workspace` 这类隐藏目录），勾选之前一个都不打开。不在对话里打开时什么都不列。可以给对话的列表添加额外的文件夹，也可以移除。文件在磁盘上变化时自动重新加载。 |
| STEP | 在本机转换成网格，保留装配结构：零件名称、位置、颜色和 B-rep 边线（隐藏缝合线）。「已打开」里显示文件包含几个零件。转换结果会缓存。 |
| CadQuery 推送 | `python/cqview.py` 的 `show(零件或装配, "名字")` 写入 `~/.cqview/scene/`，文件面板把这个文件夹和其他文件夹一样列出来（勾选即打开）。装配以 STEP 推送，名称和颜色都保留。 |
| 标注 | 选点模式（`P`）：先在表面上点几个位置并确认（`Enter`）。之后选点模式保持开启，每点一下就直接加入标注列表，并自动聚焦到它的备注框：点一个位置、写一句要求、再点下一个，想一步写一步。每个点记录所在零件、装配里的子零件、坐标和表面法向；每个点可写备注，再写一句想让 AI 做什么。 |
| 发给 AI | 一个按钮把整理好的消息发到对话（见[发送到对话](#发送到对话)）。标注按会话文件夹分开保存在 `~/.cqview/selections/<文件夹 ID>.json`；最近一次写入也在 `~/.cqview/selection.json`，方便脚本读取。 |
| 白模渲染 | 点 **渲染**，把当前角度下可见的模型截成一张裁到模型的白模图，后台 Agent 用 MiniMax 图像生成（图生图）渲染成照片级成品图。可选风格（影棚产品照、使用场景、设计效果图、3D 打印实物）、画幅、是否参考零件颜色，并补充自己的描述。进度、Agent 请求的授权和结果（与白模对比、复制、下载）都在面板里（见[白模渲染](#白模渲染)）。 |
| AI 工具（MCP） | `add_model_folder`、`add_model_file`、`list_model_folders`：AI 把它刚导出的模型打开在它自己这个对话的查看器里（把工作目录作为 `workspace` 传入）。查看器开着就立刻显示，没开就在下次打开时执行（见 [AI 工具](#ai-工具mcp)）。 |
| CadQuery skill | 来自 [flowful-ai/cad-skill](https://github.com/flowful-ai/cad-skill) 的 `parametric-3d-printing`：需求梳理 → 分阶段 CadQuery 建模 → 导出 STL/STEP → watertight 校验 → 多视角预览，另带一个经过测试的 Gridfinity 生成器（见[内置 CadQuery skill](#内置-cadquery-skill)）。 |

## 运行要求

- MiniMax Code 3.1.4 或更高版本：Viewer 需要读取自己是在哪个对话里打开的（Agent 权限 `session.read`）。宿主不提供这个信息时，只有用 `/viewer?root=<文件夹>` 打开才会列出文件夹。
- 白模渲染需要 MiniMax Code 3.1.2 或更高版本（Agent 权限），以及账号里可用的 `mcode-tools` MiniMax 图像生成工具。每次渲染调用一次图像生成，计费方式和你自己发起的生成一样。
- STL 不需要额外依赖。
- STEP 需要本机 Python 3 和 [CadQuery](https://github.com/CadQuery/cadquery)（`pip install cadquery`）。Viewer 依次查找 `$CQVIEW_PYTHON`、`python3`、`python`、`/usr/bin/python3`、`/opt/homebrew/bin/python3`、`/usr/local/bin/python3`，使用第一个能 `import cadquery` 的。
- 内置 skill 的脚本另外需要 `trimesh`、`pyrender`、`Pillow`、`numpy`、`lxml`（见 `skills/parametric-3d-printing/requirements.txt`）；`outline_from_scan.py` 还需要 `shapely`。

## 安装与使用

把本目录复制到当前 MiniMax Code 数据目录的 `plugins/` 下。`<dataDir>` 默认是 `~/.minimax`，默认安装路径为：

```text
<dataDir>/plugins/cq-viewer/
```

保留隐藏目录 `.minimax-plugin/`。重启 MiniMax Code 后，在对话里从插件列表打开「CadQuery Viewer」，或直接对助手说「打开 CadQuery Viewer 看一下这个项目里的模型」。MCP 工具和 skill 在安装之后新开的对话里可用。

1. **打开模型**：左侧文件夹图标里按文件夹分组列出这个对话的所有文件夹，每组可以折叠：先是会话文件夹，然后是你添加的文件夹，`~/.cqview/scene` 里有推送的模型时也列在后面。勾选要打开的模型（不会自动打开任何模型），或让助手调用 `add_model_file`。**+** 给这个对话添加别的文件夹（在用户目录下，不能是用户目录本身、`~/Library` 或顶层隐藏目录），文件夹上的 **−** 再移除。搜索框同时筛选所有文件夹。
2. **看模型**：在模型上按下拖动，绕那一点旋转；双指滑动（触控板）、右键或中键拖动（鼠标）、或 Shift + 拖动平移；捏合或滚轮缩放。底部工具条有视角、适配（`F`）、边线、网格、剖切和 **操作方式**。
3. **标注**：点 **选点**（`P`），在模型上点击位置，再点 **确认**（`Enter`）。标注面板打开后仍在选点模式：给一个点写备注，接着点下一个位置（它会立刻加入列表，光标跳到它的备注框），如此往复；「想让 AI 做什么」随时可以写。点 **完成** 或按 `Esc` 结束选点；之后再点 **选点**，会接着往同一个列表里加。
4. **发送**：点 **发送到对话**（在说明框里可按 `⌘/Ctrl + Enter`）。
5. **渲染**：把模型转到想要的角度，点 **渲染**，选风格，按需写材质或场景，点 **开始渲染**（在描述框里可按 `⌘/Ctrl + Enter`）。可以继续做别的，完成后会有提示。

| 快捷键 | 作用 |
| --- | --- |
| `P` | 进入 / 退出选点模式 |
| `Enter` | 确认第一批选中的点（之后的点不需要确认） |
| `Backspace` | 删除这次进入选点模式后最后加的一个点（输入文字时不生效） |
| `Esc` | 依次离开输入框、关闭弹层、退出选点、关闭面板 |
| `⌘/Ctrl + Z` | 撤销上一次增删标注（之后写的备注会保留） |
| `F` | 适配视图 |

### AI 工具（MCP）

Mini App 自己提供一个名为 `cq-viewer` 的 MCP 服务（Streamable HTTP，在自己的回环端口上 `POST /mcp/cq-viewer`）。工具被调用时 MiniMax Code 会启动这个 Mini App。

| 工具 | 作用 |
| --- | --- |
| `add_model_folder` | `{ path, select?, workspace? }` 添加一个文件夹。传 `workspace`（AI 的工作目录）时，它成为那个对话查看器里的额外文件夹；会话文件夹里面的子文件夹不用添加。会话文件夹之外的文件夹遵守 **+** 的规则：在用户目录下，不能是用户目录本身、`~/Library` 或顶层隐藏目录。返回文件夹 ID 和最多 200 个模型路径。`select`（默认 `true`）为真时查看器切到这个文件夹。 |
| `add_model_file` | `{ path, workspace? }` 原地打开一个 `.stl` / `.step` / `.stp`。传 `workspace` 时只有那个对话的查看器会打开：文件在会话文件夹里就从那里打开，否则把它所在的文件夹加为那个对话的额外文件夹（用户目录之外的文件需要 `copy_to_scene`）。不传 `workspace` 时，所有文件夹里包含这个文件的查看器都会打开它。查看器会勾选它、适配视图，文件重新导出时自动刷新。 |
| | `{ path, copy_to_scene: true, name?, color?, opacity?, workspace? }` 改为把文件复制到 `~/.cqview/scene/<name>.<扩展名>`（和 `cqview.show_file` 一样），适合 `/tmp` 等其他位置的文件。之后源文件的修改不会同步。 |
| `list_model_folders` | `{ folder? }` 列出已登记的文件夹和推送场景；传文件夹 ID 或路径（已登记的或会话文件夹）时，列出该文件夹里的模型（绝对路径，最多 200 个）。只读。 |

请求会在 `dataDir` 里保留 24 小时（最近 20 条），所以查看器关着时 AI 打开的模型，会在你下次在那个对话里打开查看器时出现。查看器只执行自己这个对话的请求，每条只执行一次；第一次打开时只执行对话开始之后的请求（宿主不提供对话信息时，只执行最近十分钟内的）。工具结果里的 `viewer_connected`：传了 `workspace` 时，表示那个会话文件夹有没有查看器在线。

### 会话文件夹

页面启动时调用 `window.mcode.miniapp.agent.session()`，在有 Agent 权限 `session.read` 时（MiniMax Code 3.1.4 及以上）返回 Viewer 所在的对话。只使用其中的 `workspaceDir` 和创建时间；同一个返回里的标题、模型、最后一条回复都不用，也从不调用列出所有对话的 `agent.sessions()`。随后页面把这个文件夹交给 Node 端登记（`POST /viewer/api/workspace`），Node 检查它是已存在的目录，且不是用户目录本身或磁盘根目录。宿主不提供对话时，页面有 `?root=<文件夹>` 就用它，否则什么都不显示。和对话同时出现的 `?root=` 会作为额外文件夹加到这个对话的列表里。

打开的模型、隐藏的零件和选中的文件夹只在页面打开期间有效，重新打开 Viewer 时从空白开始。

### 白模渲染

1. **截图（页面里）**：把可见的模型在屏幕外再画一遍：相机方向不变，裁到模型并留 10% 边距（不会超出窗口里能看到的范围）；除非勾选 **保留零件颜色**，否则统一换成中性的白模材质；浅灰背景，不画网格、坐标轴、标注点和方向指示。长边 1600 px；**自动** 画幅会在 1:1、4:3、3:4、16:9、9:16 里选最接近模型轮廓的一个。面板里的预览就是这张图。
2. **任务（Node）**：图片和选项提交到 `POST /viewer/api/renders`。Node 先校验（PNG/JPEG 文件头，最大 16 MB；风格和画幅合法；描述最多 800 字），再写入任务文件夹：截图和给图像工具用的 `args.json`。图像提示词由固定说明（保留几何、孔、圆角和构图）、所选风格、标注为用户要求的补充描述，以及可见模型的文件名（仅作参考）组成。
3. **后台 Agent**：每次渲染跑一轮 Agent，使用单独的会话（不出现在你的会话列表里）和默认模型，最多同时跑 2 个、进行中最多 3 个。给它的指令是：加载 `mcode-tools-master` skill，用 `mcode-tools upload_temp_url` 上传截图，把得到的 URL 填进 `args.json`，调用 `connector__matrix__generate_image`（2K），用 `mcode-tools get_asset_url` 和 `curl` 取回结果，存为任务文件夹里的 `cq-render-<id>.<扩展名>`（写不进去就存到它自己的工作目录），最后回复 `RENDER_DONE <路径>` 或 `RENDER_FAILED <原因>`。你的补充描述不会进入这段指令，只放在 `args.json` 里。
4. **授权**：Agent 执行命令需要授权时，渲染记录里会显示工具、命令和原因，以及 **拒绝** / **允许一次**。不会自动批准；在你决定、取消或 Viewer 停止之前，渲染会一直等着。**查看过程** 会在对话侧栏打开这个后台会话（需要 Viewer 是在对话里打开的）。
5. **结果**：只有名字是这个任务的文件名、大小合理、文件头是真实 JPEG / PNG / WebP 的图片才算结果，位置必须在任务文件夹里，或是 Agent 报告的路径（随后复制进来）。完成的渲染可以和白模对比查看、复制（PNG）、下载，也可以用同一张截图和设置重试，或删除。

保留最近 30 条渲染。Viewer 停止时还在进行的渲染，下次启动时会标记为中断；如果图片已经到了，就标记为完成。

### 内置 CadQuery skill

`skills/parametric-3d-printing/` 是 [flowful-ai/cad-skill](https://github.com/flowful-ai/cad-skill) 里的 `parametric-3d-printing` skill（commit `fe42159`），在 MiniMax Code 里显示为 `cq-viewer:parametric-3d-printing`。它引导 Agent 梳理需求、分阶段建模并随时给出预览、做可打印性检查、给出切片建议，自带 `run_cadquery_model.py`、`preview.py`、`gridfinity.py`、`stl_to_3mf.py`、`outline_from_scan.py`。`SKILL.md` 末尾追加了一节，让 Agent 用 `add_model_file` 打开每个导出的模型（把工作目录作为 `workspace` 传入）；其余内容没有改动，见 `skills/parametric-3d-printing/UPSTREAM.md`。

这个 skill 使用 [PolyForm Noncommercial License 1.0.0](skills/parametric-3d-printing/LICENSE)，不是 MIT：只能用于非商业用途。Required Notice: Copyright Nicolas Chourrout (https://github.com/nchourrout)。

### 从 CadQuery 推送模型

```python
import sys; sys.path.insert(0, "path/to/cq-viewer/python")
import cadquery as cq
from cqview import show, show_file, clear, selection

bracket = cq.Workplane("XY").box(80, 40, 6).edges("|Z").fillet(6)
show(bracket, "bracket")                     # STL，速度快
show(my_assembly, "mount")                   # cq.Assembly 以 STEP 推送，保留名称和颜色
show_file("scans/housing.stl", "scan", opacity=0.35, edges=False)
print(selection())                           # 你在 Viewer 里做的标注
clear()                                      # 清空推送的模型
```

运行 `python3 python/demo_viewer.py` 会推送一个带颜色的小装配，可以用来试用。

### 发送到对话

页面先按标准 MCP Apps 流程握手（通过 `postMessage` 发 `ui/initialize`）。如果宿主授予了 `message` 能力，**发送**会以 `ui/message` 请求发出整理好的文本。如果宿主没有响应握手，**发送**会改用 MiniMax Code 页面桥接 `window.mcode.miniapp.message.append`，把文本放进对话输入框，在那里按回车发送。在 MiniMax Code 之外打开时，按钮会变成 **复制内容**，改为复制文本。

## 数据与访问

**读取**

- Viewer 所在对话的文件夹、加到它上面的额外文件夹，以及 AI 登记的文件夹：目录列表，以及 `.stl`、`.step`、`.stp` 文件的内容，不读其他文件。跳过其中的隐藏目录、`node_modules`、`__pycache__`、`venv`、`site-packages`；不跟随符号链接；每个文件夹最多 10 层、5 万个目录项、1000 个模型文件。会话文件夹可以在任何位置，但不能是用户目录本身或磁盘根目录；其他文件夹必须在用户目录下，且不能是用户目录本身、`~/Library` 或顶层隐藏目录。
- 页面所在的对话，通过 `window.mcode.miniapp.agent.session()`（Agent 权限 `session.read`）读取：只用它的文件夹（`workspaceDir`）和创建时间。返回里还带有对话标题、模型和最后一条回复，页面不保存也不发送它们。从不请求所有对话的列表（`agent.sessions()`）。
- `add_model_file` 带 `copy_to_scene` 时：AI 指定的那一个模型文件，位置不限（解析符号链接；只接受不超过 512 MB 的 `.stl`/`.step`/`.stp` 普通文件）。
- `~/.cqview/scene/`：`python/cqview.py` 或 `copy_to_scene` 推送的模型（`.stl`、`.step`、`.stp`、`scene.json`）。
- `~/.cqview/roots.json`、`~/.cqview/selections/<文件夹 ID>.json` 和 `~/.cqview/selection.json`（它自己的文件，见下文）。

**写入**：在 `dataDir` 之外只写自己的交换目录 `~/.cqview/`，都是原子写入（同目录下名字唯一的临时文件，再改名），逐个执行，并保留原文件的权限：

- `~/.cqview/roots.json`：会话文件夹之外登记过的文件夹（你添加额外文件夹，或 AI 为它调用 `add_model_folder` / `add_model_file` 时）。会话文件夹不写在这里。
- `~/.cqview/selections/<文件夹 ID>.json`：一个会话文件夹的标注，包括点、备注、说明和每个标注所在模型的绝对路径。每次修改都会重写。
- `~/.cqview/selection.json`：任意会话文件夹最近一次标注写入的副本（带文件夹 ID），给 `cqview.selection()` 用，以最后一次写入为准。
- `~/.cqview/scene/<name>.<扩展名>` 和 `~/.cqview/scene/scene.json`：只在 `add_model_file` 带 `copy_to_scene` 时写，包括复制的模型、它的颜色/不透明度，并删除同名的其他格式模型（和 `cqview.py` 一样）。
- 如果 `~/.cqview/`、`~/.cqview/scene/` 和 `~/.cqview/selections/` 不存在会创建。它从不写入你的项目文件夹。

在 `dataDir` 内保存 `step-cache/`，即 STEP 转换结果，按文件路径、大小和修改时间区分，可以随时删除（每次启动后第一次转换时，清理 30 天没用过的条目、超出 1 GB 的部分（最久没用的先删），以及超过一天的临时文件）；以及 `open-requests.json`，最近 24 小时内最多 20 条 AI 请求（文件夹 ID、相对该文件夹的路径、绝对路径、发起者的会话文件夹，或场景模型名）；`workspaces.json`（最近 100 个会话文件夹，以及各自添加的额外文件夹）；还有 `renders/`：`jobs.json`（最近 30 条渲染的选项、补充描述、状态、后台会话 ID、会话文件夹 ID），以及每条渲染一个文件夹，存白模截图、`args.json` 和结果。在面板里删除一条渲染会删掉它的文件夹。

**Agent 运行**：每次渲染跑一轮后台 Agent，指令见[白模渲染](#白模渲染)：上传截图、调用 MiniMax 图像生成、把结果下载到这条渲染的文件夹。Agent 使用它平常的工具和权限确认；它请求的授权显示在面板里，只有你点 **允许一次** 或 **拒绝** 才会回复。Viewer 只读回结果文件，并且先检查文件名、大小和图片文件头。

**子进程**：只有打开 STEP 时才启动 Python。参数以数组传递（不经过 shell），忽略标准输入输出，Viewer 关闭时结束所有子进程：

- 探测，直到找到可用的候选：`<python> -c "import cadquery"`（超时 60 秒）。
- 转换：`<python> <插件目录>/miniapp/node/step_mesh.py <模型.step> <dataDir>/step-cache/<hash>.cqvm.<pid>.tmp`（超时 300 秒）。
- 转换失败时退回：`<python> -c <内置 STEP→STL 脚本> <模型.step> <dataDir>/step-cache/<hash>.stl.<pid>.tmp`。如果转换是被主动停止的（超时、Mini App 关闭）或被直接结束（`SIGKILL`/`SIGTERM`），不再退回；`SIGSEGV` 这类原生崩溃仍会退回。Mini App 开始关闭后不再启动任何 Python 进程。

模型路径会先校验（在登记的文件夹内、扩展名允许、不是符号链接），再作为单个参数传入。

**请求校验**：所有路由（包括页面本身）都拒绝 `Host` 不是本机（`127.0.0.1`、`localhost`、`::1`）的请求，也拒绝带了 `Origin` 但不是这个端口本身的请求，所以通过 DNS rebinding 或其他来源的网页无法登记文件夹、读取模型。写请求只接受 JSON 请求体。

**MCP 端点**：Mini App 回环端口上的 `POST /mcp/cq-viewer`，同样经过上述校验。工具遵守和页面相同的文件夹规则。

**内置 skill**：Mini App 本身从不运行它。Agent 按 skill 操作时，会通过自己的终端工具（照常经过权限确认）运行其中的 Python 脚本：`run_cadquery_model.py` 在子 Python 进程里执行模型脚本并收集它写出的文件，`preview.py` 离屏渲染 PNG。脚本不发起网络请求；skill 会让 Agent 用网页搜索查真实尺寸，缺少依赖时它的安装说明会用 `pip`（或 `conda`）安装上面列出的 Python 包。

**监听**：Viewer 运行期间递归监听 `~/.cqview/scene/`、每个登记的文件夹，以及当前打开着的页面的会话文件夹（含额外文件夹）里的模型变化。

**浏览器存储**：只保存视图偏好，包括边线和网格开关、渲染的风格 / 画幅 / 是否保留零件颜色、触控板 / 鼠标模式，以及每个会话文件夹执行到的最后一条 AI 请求的序号。不保存打开的模型和隐藏的零件。

**宿主页面桥接**：启动时调用一次 `agent.session()`（见上文）；点 **发送** 时用 `message.append`，见上文；在渲染记录上点 **查看过程** 时用 `agent.open`。

**网络**：Mini App 本身不发起任何请求，three.js 已随包内置。渲染时后台 Agent 使用 `mcode-tools`：把截图传到 MiniMax 临时存储、调用 MiniMax 图像生成，再从 MiniMax 返回的地址下载结果。

## 测试环境

- 1.4.0：MiniMax Code `3.1.4-preview.4773`，macOS 26（Apple Silicon）。用临时探针（已移除）确认：声明 `agentAccess: ["session.run", "session.read"]` 后，页面的 `agent.session()` 返回它所在的对话，包含 `workspaceDir`；`open` 时带的查询参数能传到页面。发布后在一个对话里打开：页面自己登记了这个对话的文件夹（之前不在任何登记表里），对这个文件夹调用 `list_model_folders` 返回 `viewer_connected: true`。
- 1.3.0：同一版本。已发布到宿主（声明 `agentAccess` 后运行时正常就绪），并在 Mini App 标签页中打开。Node 入口写出的白模渲染指令原样交给一个全新的 MiniMax Code Agent 会话冷启动执行：上传、修改 `args.json`、`connector__matrix__generate_image`、`get_asset_url`、下载到路径含空格的文件夹、回复 `RENDER_DONE`；结果（2048 × 2048 PNG）通过了 Viewer 自己的文件名 / 大小 / 文件头校验。
- MiniMax Code 桌面版 `3.1.1-preview.4597`（Electron 42），macOS 26（Apple Silicon）；Python 3.9 + CadQuery 2.5.2 / OCP 7.7.2、trimesh 4.12、pyrender 0.1.45。
- 在 MiniMax Code 中验证（1.2.0）：本机安装并打开；连续选点本身在无头 Chrome 中验证（见下）。（1.1.1）：本机安装；带 `?root=` 打开的页面在新的 Host/Origin 校验下能正常读取和登记文件夹，面板开着时 `list_model_folders` 返回 `viewer_connected: true`。（1.1.0）：本机安装；新开的对话里能看到 `mcp__cq-viewer__add_model_folder`、`mcp__cq-viewer__add_model_file`、`mcp__cq-viewer__list_model_folders` 和 skill `cq-viewer:parametric-3d-printing`；经宿主调用了 `list_model_folders` 和 `add_model_folder`（`select: false`）。1.0.0 时验证过：打开、通过 `?root=` 登记文件夹、宿主桥接探测（这个版本不响应 `ui/initialize` 握手，因此走降级路径）。
- `node --test plugins/hanzijie/cq-viewer/tests/*.test.mjs`：共 35 个测试，用临时用户目录跑真实的 Node 入口。`tests/workspace.test.mjs`（1.4.0）：顶层隐藏目录里的会话文件夹可以登记并列出模型，用户目录、`/` 和不存在的文件夹被拒绝，会话文件夹不进 `roots.json`；额外文件夹只属于一个会话文件夹，可以移除；标注按文件夹分开保存，最近一次写入同步到 `selection.json`；带 `workspace` 的 AI 请求只到那个对话，会话文件夹之外的文件会把它所在的文件夹加为额外文件夹，不带 `workspace` 的请求按文件位置分发，隐藏子目录仍然不列出；`viewer_connected` 只算那个文件夹的页面；渲染按文件夹列出。`tests/render.test.mjs`（1.3.0，假的 `context.agent`）：每次渲染一轮 Agent，补充描述不进入指令、只在 `args.json` 里；结果以正确的类型和下载文件名返回；Agent 存在自己目录里的结果只有文件名对得上才会复制进来；非图片结果被拒绝；`RENDER_FAILED` 原因会显示；授权请求显示工具和命令，只按请求转发（错的请求 ID 和 `allowAlways` 被拒绝），从不自动回复；取消；进行中的渲染不能删除；重试沿用截图和设置；输入校验（画幅、风格、图片字节与声明不符、大小、描述长度、只收 JSON、外部 Origin）；没有 Agent 权限时返回 503；进行中最多 3 个；重启后未完成的渲染变为中断或完成。`tests/mcp.test.mjs`：三个工具、文件夹规则、带颜色复制到场景、重启后的请求记录、回环与 JSON 检查。`tests/server.test.mjs`：40 个并发保存标注、8 个并发登记文件夹（页面和 MCP 混合）没有报错也没有丢条目；用假 Python 验证转换中 dispose 会结束进程且不启动退回转换、被结束的转换不退回、`SIGSEGV` 崩溃仍会退回；缓存清理；所有路由的 Host/Origin 校验；版本号一致。
- 1.4.0 在无头 Chromium（Playwright）中对真实 Node 入口测试：不在对话里时页面什么都不列，提示从对话里打开；模拟 `agent.session()` 时把会话文件夹、添加的文件夹和 `~/.cqview/scene` 列成可折叠的文件夹分组，勾选之前不打开任何模型，搜索跨文件夹筛选，额外文件夹能添加和移除；标题栏显示插件图标。在模型上按下时画面不变（像素对比只有抗锯齿噪声），拖动时旋转中心的圆环正好在按下的位置；类似触控板的滚动会平移；**操作方式** 识别为触控板，切到鼠标后手势列表随之变化。没有控制台错误。
- 渲染面板在无头 Chromium（Playwright）中对真实 Node 入口 + 脚本化的 Agent 做了端到端测试，亮色和暗色各一遍（1400 px），另看了 760 px 下的面板：打开模型、白模预览、选风格和写描述、开始、授权卡片滚动到可见处、允许一次、完成后的缩略图和提示、带白模对比的大图查看、`Esc` 关闭、第二次渲染取消；没有控制台错误或失败请求。1600 px 的截图人工检查过（白模材质、裁到模型、没有网格和标注点）。
- 在无头 Chrome 中对同一个 Node 入口做了端到端测试，分别在 1400 px 和 800 px 宽度下各 19 项：第一批点确认后保持选点模式；正在编辑备注或「想让 AI 做什么」时继续点击，新点直接进入列表，光标跳到新点的备注框，已写的备注不丢；「撤销上一个」/`Backspace` 删除本次最后加的点；`⌘Z` 恢复它并保留期间改过的备注；连按两次 `Esc` 或点「完成」退出选点；再次点「选点」无需确认直接继续；收起的面板在新增点时自动展开；「清空标注」后恢复确认步骤；`selection.json` 中有点、备注和说明；窄屏下面板不遮挡选点栏。1.1.0 时测过：AI 调用工具后页面切换文件夹并打开文件；`copy_to_scene` 复制的零件按指定颜色显示；页面关着时请求的文件在下次打开时出现，之后不会重复执行，用户取消勾选后保持关闭；页面离开后 `viewer_connected` 变为 false。1.0.0 时测过：打开 STL 和 STEP（多层装配，含名称、颜色、复用实例）、自动重新加载、选点 → 确认 → 备注、模拟 MCP Apps 宿主下的 `ui/message` 路径、模拟页面桥接下的降级路径，以及没有宿主时按钮切换为复制。
- 内置 skill：在已安装的插件目录里运行 `run_cadquery_model.py --preview --strict`（建模 → STL → watertight 校验 → 预览图）。
- 未验证：经宿主调用 MCP 工具时的 `workspace` 参数（测试用的对话里工具列表是 1.4.0 之前的）；Electron 标签页里真实触控板的手势（只在无头 Chromium 里测过）；在 MiniMax Code 里从页面发起的渲染（宿主的后台会话、它的权限确认，以及它能否写入 Mini App 的 `dataDir`，还是退回到自己的目录）；Electron Mini App 标签页里的 **下载** 和 **复制图片**；**查看过程** 打开侧栏；Windows；查看器面板开着时经宿主调用 `add_model_file`（页面这一侧只在无头 Chrome 里验证过）；这个版本里发送的降级路径是否真的填进了对话输入框；其他 CAD 软件导出的带面级颜色的 STEP；skill 的 Gridfinity 生成器在 CadQuery 2.5 下的表现（skill 要求 2.6.1 及以上）。

## 第三方

- [three.js](https://threejs.org/) r170（`three.module.min.js`、`OrbitControls.js`、`STLLoader.js`），MIT 协议，见 `miniapp/client/assets/vendor/LICENSE-three.txt`。
- `skills/parametric-3d-printing/` 来自 [flowful-ai/cad-skill](https://github.com/flowful-ai/cad-skill)，PolyForm Noncommercial 1.0.0 协议，见 `skills/parametric-3d-printing/LICENSE` 和 `UPSTREAM.md`。
- STEP 转换使用你本机安装的 CadQuery / OCP，不随包分发。

## 许可证

[MIT](LICENSE)；`skills/parametric-3d-printing/` 除外，它保留自己的 [PolyForm Noncommercial 1.0.0](skills/parametric-3d-printing/LICENSE) 协议。
