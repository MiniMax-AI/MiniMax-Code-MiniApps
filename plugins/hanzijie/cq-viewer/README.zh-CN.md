# CadQuery Viewer

简体中文 | [English](README.md)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/cqviewer-lockup-dark.png">
  <img alt="CadQuery Viewer" src="docs/brand/cqviewer-lockup-light.png" width="420">
</picture>

MiniMax Code 里的本地 3D 模型查看器。打开项目文件夹里的 STL 和 STEP（STEP 装配保留零件名称、颜色和真实 CAD 边线），实时显示 CadQuery 脚本推送的模型，在模型上标出位置后一键发到对话里，让 AI 准确知道你说的是哪个面、哪个孔、哪条边。AI 可以通过 MCP 工具登记模型文件夹、在查看器里打开模型；包里还内置了 flowful-ai 的 CadQuery 参数化建模 skill。

作者：[HanZijie](https://github.com/HanZijie) · [flowful-ai](https://github.com/flowful-ai)（内置的 CadQuery skill） · 版本：`1.2.1`

![CadQuery Viewer：一个 STEP 装配，已标注三个位置，准备发送](docs/preview.jpg)

## 功能

| 模块 | 说明 |
| --- | --- |
| 查看 | 全窗口画布，正交相机，Z 轴向上（与 CadQuery 一致）。7 个预设视角、适配、边线、网格、X/Y/Z 剖切、坐标轴指示，跟随亮色/暗色主题。 |
| 项目文件夹 | 递归列出文件夹里的 `.stl`、`.step`、`.stp`，勾选即打开；文件在磁盘上变化时自动重新加载。 |
| STEP | 在本机转换成网格，保留装配结构：零件名称、位置、颜色和 B-rep 边线（隐藏缝合线）。「已打开」里显示文件包含几个零件。转换结果会缓存。 |
| CadQuery 推送 | `python/cqview.py` 的 `show(零件或装配, "名字")` 写入 `~/.cqview/scene/`，Viewer 立即显示。装配以 STEP 推送，名称和颜色都保留。 |
| 标注 | 选点模式（`P`）：先在表面上点几个位置并确认（`Enter`）。之后选点模式保持开启，每点一下就直接加入标注列表，并自动聚焦到它的备注框：点一个位置、写一句要求、再点下一个，想一步写一步。每个点记录所在零件、装配里的子零件、坐标和表面法向；每个点可写备注，再写一句想让 AI 做什么。 |
| 发给 AI | 一个按钮把整理好的消息发到对话（见[发送到对话](#发送到对话)）。同样的数据也保存在 `~/.cqview/selection.json`，方便 Agent 和脚本读取。 |
| AI 工具（MCP） | `add_model_folder`、`add_model_file`、`list_model_folders`：AI 登记文件夹、打开它刚导出的模型。查看器开着就立刻切过去，没开就在下次打开时执行（见 [AI 工具](#ai-工具mcp)）。 |
| CadQuery skill | 来自 [flowful-ai/cad-skill](https://github.com/flowful-ai/cad-skill) 的 `parametric-3d-printing`：需求梳理 → 分阶段 CadQuery 建模 → 导出 STL/STEP → watertight 校验 → 多视角预览，另带一个经过测试的 Gridfinity 生成器（见[内置 CadQuery skill](#内置-cadquery-skill)）。 |

## 运行要求

- 支持 Mini App 的 MiniMax Code。
- STL 不需要额外依赖。
- STEP 需要本机 Python 3 和 [CadQuery](https://github.com/CadQuery/cadquery)（`pip install cadquery`）。Viewer 依次查找 `$CQVIEW_PYTHON`、`python3`、`python`、`/usr/bin/python3`、`/opt/homebrew/bin/python3`、`/usr/local/bin/python3`，使用第一个能 `import cadquery` 的。
- 内置 skill 的脚本另外需要 `trimesh`、`pyrender`、`Pillow`、`numpy`、`lxml`（见 `skills/parametric-3d-printing/requirements.txt`）；`outline_from_scan.py` 还需要 `shapely`。

## 安装与使用

把本目录复制到当前 MiniMax Code 数据目录的 `plugins/` 下。`<dataDir>` 默认是 `~/.minimax`，默认安装路径为：

```text
<dataDir>/plugins/cq-viewer/
```

保留隐藏目录 `.minimax-plugin/`。重启 MiniMax Code 后，从插件列表打开「CadQuery Viewer」，或直接对助手说「打开 CadQuery Viewer 看一下这个项目里的模型」。MCP 工具和 skill 在安装之后新开的对话里可用。

1. **选文件夹**：点左侧的文件夹图标，再点 **+** 添加文件夹（用户目录下的任意项目文件夹）。助手也可以调用 `add_model_folder`，或用 `/viewer?root=<文件夹绝对路径>` 打开页面。
2. **打开模型**：在列表里勾选文件，或让助手调用 `add_model_file`。底部工具条可以切换视角、适配（`F`）、边线、网格和剖切。
3. **标注**：点 **选点**（`P`），在模型上点击位置，再点 **确认**（`Enter`）。标注面板打开后仍在选点模式：给一个点写备注，接着点下一个位置（它会立刻加入列表，光标跳到它的备注框），如此往复；「想让 AI 做什么」随时可以写。点 **完成** 或按 `Esc` 结束选点；之后再点 **选点**，会接着往同一个列表里加。
4. **发送**：点 **发送到对话**（在说明框里可按 `⌘/Ctrl + Enter`）。

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
| `add_model_folder` | `{ path, select? }` 登记一个文件夹，规则和 **+** 一样：在用户目录下，不能是用户目录本身、`~/Library` 或顶层隐藏目录。返回文件夹 ID 和最多 200 个模型路径。`select`（默认 `true`）为真时查看器切到这个文件夹。 |
| `add_model_file` | `{ path }` 原地打开一个 `.stl` / `.step` / `.stp`：优先用能列出这个文件的、最近的已登记文件夹，没有就登记文件所在的文件夹。查看器会勾选它、适配视图，文件重新导出时自动刷新。文件必须在用户目录下。 |
| | `{ path, copy_to_scene: true, name?, color?, opacity? }` 改为把文件复制到 `~/.cqview/scene/<name>.<扩展名>`（和 `cqview.show_file` 一样），适合 `/tmp` 等其他位置的文件。之后源文件的修改不会同步。 |
| `list_model_folders` | `{ folder? }` 列出已登记的文件夹和推送场景；传文件夹 ID 或路径时，列出该文件夹里的模型（绝对路径，最多 200 个）。只读。 |

请求会在 `dataDir` 里保留 24 小时（最近 20 条），所以查看器关着时 AI 打开的模型，会在你下次打开查看器时出现。每个浏览器只执行一次同一条请求；你自己取消勾选的文件，刷新后不会被重新打开。工具结果里的 `viewer_connected` 告诉 AI 当前有没有查看器窗口在线。

### 内置 CadQuery skill

`skills/parametric-3d-printing/` 是 [flowful-ai/cad-skill](https://github.com/flowful-ai/cad-skill) 里的 `parametric-3d-printing` skill（commit `fe42159`），在 MiniMax Code 里显示为 `cq-viewer:parametric-3d-printing`。它引导 Agent 梳理需求、分阶段建模并随时给出预览、做可打印性检查、给出切片建议，自带 `run_cadquery_model.py`、`preview.py`、`gridfinity.py`、`stl_to_3mf.py`、`outline_from_scan.py`。`SKILL.md` 末尾追加了一节，让 Agent 用 `add_model_file` 打开每个导出的模型；其余内容没有改动，见 `skills/parametric-3d-printing/UPSTREAM.md`。

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

- 你或 AI 登记的文件夹：目录列表，以及 `.stl`、`.step`、`.stp` 文件的内容，不读其他文件。跳过隐藏目录、`node_modules`、`__pycache__`、`venv`、`site-packages`；不跟随符号链接；每个文件夹最多 10 层、5 万个目录项、1000 个模型文件。文件夹必须在用户目录下，且不能是用户目录本身、`~/Library` 或顶层隐藏目录。
- `add_model_file` 带 `copy_to_scene` 时：AI 指定的那一个模型文件，位置不限（解析符号链接；只接受不超过 512 MB 的 `.stl`/`.step`/`.stp` 普通文件）。
- `~/.cqview/scene/`：`python/cqview.py` 或 `copy_to_scene` 推送的模型（`.stl`、`.step`、`.stp`、`scene.json`）。
- `~/.cqview/roots.json` 和 `~/.cqview/selection.json`（它自己的文件，见下文）。

**写入**：在 `dataDir` 之外只写自己的交换目录 `~/.cqview/`，都是原子写入（同目录下名字唯一的临时文件，再改名），逐个执行，并保留原文件的权限：

- `~/.cqview/roots.json`：登记过的文件夹（添加文件夹、页面带 `?root=` 打开，或 AI 调用 `add_model_folder` / `add_model_file` 时）。
- `~/.cqview/selection.json`：当前标注，包括点、备注、说明和每个标注所在模型的绝对路径。每次修改都会重写，以最后一次写入为准。
- `~/.cqview/scene/<name>.<扩展名>` 和 `~/.cqview/scene/scene.json`：只在 `add_model_file` 带 `copy_to_scene` 时写，包括复制的模型、它的颜色/不透明度，并删除同名的其他格式模型（和 `cqview.py` 一样）。
- 如果 `~/.cqview/` 和 `~/.cqview/scene/` 不存在会创建。它从不写入你的项目文件夹。

在 `dataDir` 内保存 `step-cache/`，即 STEP 转换结果，按文件路径、大小和修改时间区分，可以随时删除（每次启动后第一次转换时，清理 30 天没用过的条目、超出 1 GB 的部分（最久没用的先删），以及超过一天的临时文件）；以及 `open-requests.json`，最近 24 小时内最多 20 条 AI 请求（文件夹 ID、相对该文件夹的路径，或场景模型名）。

**子进程**：只有打开 STEP 时才启动 Python。参数以数组传递（不经过 shell），忽略标准输入输出，Viewer 关闭时结束所有子进程：

- 探测，直到找到可用的候选：`<python> -c "import cadquery"`（超时 60 秒）。
- 转换：`<python> <插件目录>/miniapp/node/step_mesh.py <模型.step> <dataDir>/step-cache/<hash>.cqvm.<pid>.tmp`（超时 300 秒）。
- 转换失败时退回：`<python> -c <内置 STEP→STL 脚本> <模型.step> <dataDir>/step-cache/<hash>.stl.<pid>.tmp`。如果转换是被主动停止的（超时、Mini App 关闭）或被直接结束（`SIGKILL`/`SIGTERM`），不再退回；`SIGSEGV` 这类原生崩溃仍会退回。Mini App 开始关闭后不再启动任何 Python 进程。

模型路径会先校验（在登记的文件夹内、扩展名允许、不是符号链接），再作为单个参数传入。

**请求校验**：所有路由（包括页面本身）都拒绝 `Host` 不是本机（`127.0.0.1`、`localhost`、`::1`）的请求，也拒绝带了 `Origin` 但不是这个端口本身的请求，所以通过 DNS rebinding 或其他来源的网页无法登记文件夹、读取模型。写请求只接受 JSON 请求体。

**MCP 端点**：Mini App 回环端口上的 `POST /mcp/cq-viewer`，同样经过上述校验。工具遵守和页面相同的文件夹规则。

**内置 skill**：Mini App 本身从不运行它。Agent 按 skill 操作时，会通过自己的终端工具（照常经过权限确认）运行其中的 Python 脚本：`run_cadquery_model.py` 在子 Python 进程里执行模型脚本并收集它写出的文件，`preview.py` 离屏渲染 PNG。脚本不发起网络请求；skill 会让 Agent 用网页搜索查真实尺寸，缺少依赖时它的安装说明会用 `pip`（或 `conda`）安装上面列出的 Python 包。

**监听**：Viewer 运行期间监听 `~/.cqview/scene/` 和每个登记的文件夹（递归）里的模型变化。

**浏览器存储**：只保存视图偏好，包括选中的文件夹、打开的文件、隐藏的零件、边线和网格开关，以及这个浏览器执行到的最后一条 AI 请求的序号。

**宿主页面桥接**：只在点 **发送** 时使用，见上文。

**网络**：无。three.js 已随包内置。

## 测试环境

- MiniMax Code 桌面版 `3.1.1-preview.4597`（Electron 42），macOS 26（Apple Silicon）；Python 3.9 + CadQuery 2.5.2 / OCP 7.7.2、trimesh 4.12、pyrender 0.1.45。
- 在 MiniMax Code 中验证（1.2.0）：本机安装并打开；连续选点本身在无头 Chrome 中验证（见下）。（1.1.1）：本机安装；带 `?root=` 打开的页面在新的 Host/Origin 校验下能正常读取和登记文件夹，面板开着时 `list_model_folders` 返回 `viewer_connected: true`。（1.1.0）：本机安装；新开的对话里能看到 `mcp__cq-viewer__add_model_folder`、`mcp__cq-viewer__add_model_file`、`mcp__cq-viewer__list_model_folders` 和 skill `cq-viewer:parametric-3d-printing`；经宿主调用了 `list_model_folders` 和 `add_model_folder`（`select: false`）。1.0.0 时验证过：打开、通过 `?root=` 登记文件夹、宿主桥接探测（这个版本不响应 `ui/initialize` 握手，因此走降级路径）。
- `node --test plugins/hanzijie/cq-viewer/tests/*.test.mjs`：共 19 个测试，用临时用户目录跑真实的 Node 入口。`tests/mcp.test.mjs`：三个工具、文件夹规则、带颜色复制到场景、重启后的请求记录、回环与 JSON 检查。`tests/server.test.mjs`：40 个并发保存标注、8 个并发登记文件夹（页面和 MCP 混合）没有报错也没有丢条目；用假 Python 验证转换中 dispose 会结束进程且不启动退回转换、被结束的转换不退回、`SIGSEGV` 崩溃仍会退回；缓存清理；所有路由的 Host/Origin 校验；版本号一致。
- 在无头 Chrome 中对同一个 Node 入口做了端到端测试，分别在 1400 px 和 800 px 宽度下各 19 项：第一批点确认后保持选点模式；正在编辑备注或「想让 AI 做什么」时继续点击，新点直接进入列表，光标跳到新点的备注框，已写的备注不丢；「撤销上一个」/`Backspace` 删除本次最后加的点；`⌘Z` 恢复它并保留期间改过的备注；连按两次 `Esc` 或点「完成」退出选点；再次点「选点」无需确认直接继续；收起的面板在新增点时自动展开；「清空标注」后恢复确认步骤；`selection.json` 中有点、备注和说明；窄屏下面板不遮挡选点栏。1.1.0 时测过：AI 调用工具后页面切换文件夹并打开文件；`copy_to_scene` 复制的零件按指定颜色显示；页面关着时请求的文件在下次打开时出现，之后不会重复执行，用户取消勾选后保持关闭；页面离开后 `viewer_connected` 变为 false。1.0.0 时测过：打开 STL 和 STEP（多层装配，含名称、颜色、复用实例）、自动重新加载、选点 → 确认 → 备注、模拟 MCP Apps 宿主下的 `ui/message` 路径、模拟页面桥接下的降级路径，以及没有宿主时按钮切换为复制。
- 内置 skill：在已安装的插件目录里运行 `run_cadquery_model.py --preview --strict`（建模 → STL → watertight 校验 → 预览图）。
- 未验证：Windows；查看器面板开着时经宿主调用 `add_model_file`（页面这一侧只在无头 Chrome 里验证过）；这个版本里发送的降级路径是否真的填进了对话输入框；其他 CAD 软件导出的带面级颜色的 STEP；skill 的 Gridfinity 生成器在 CadQuery 2.5 下的表现（skill 要求 2.6.1 及以上）。

## 第三方

- [three.js](https://threejs.org/) r170（`three.module.min.js`、`OrbitControls.js`、`STLLoader.js`），MIT 协议，见 `miniapp/client/assets/vendor/LICENSE-three.txt`。
- `skills/parametric-3d-printing/` 来自 [flowful-ai/cad-skill](https://github.com/flowful-ai/cad-skill)，PolyForm Noncommercial 1.0.0 协议，见 `skills/parametric-3d-printing/LICENSE` 和 `UPSTREAM.md`。
- STEP 转换使用你本机安装的 CadQuery / OCP，不随包分发。

## 许可证

[MIT](LICENSE)；`skills/parametric-3d-printing/` 除外，它保留自己的 [PolyForm Noncommercial 1.0.0](skills/parametric-3d-printing/LICENSE) 协议。
