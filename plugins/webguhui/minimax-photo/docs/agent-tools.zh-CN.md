# Agent 工具与组合调用

应用提供 13 个 MCP 工具。主编辑器为 PhotoCraft WASM；旧版轻量工作台仍可从“打开旧版工程”进入。两者的命令结构不同，不要把旧版操作名称直接传给 PhotoCraft。

## 用户入口

在右下角助手输入需求并发送，直接运行宿主 Agent，无需复制到主聊天。权限和补充问题由用户回答。助手可停止、收起或新建对话；生成图片回传后可打开为新作品。页面必须保持打开，当前没有脱离页面的后台渲染器。

## 工具目录

| 工具 | 用途 |
| --- | --- |
| `editor_list` | 列出已连接页面及工程，明确目标 editorId |
| `editor_inspect` | 读取页面最后报告的文档、图层和版本 |
| `editor_capabilities` | 获取旧版轻量工作台的操作目录 |
| `photo_call` | 查询 PhotoCraft 命令，执行单步或批次，预览和导出 |
| `editor_preview` | 旧版轻量工作台预览；主编辑器用 photo_call preview |
| `editor_create` | 旧版轻量工作台新建；主编辑器用 PTC editor.create |
| `editor_batch` | 旧版轻量工作台的结构化批量编辑 |
| `editor_export` | 旧版轻量工作台导出；主编辑器用 photo_call export |
| `editor_job` | 查询任务状态与返回文件 |
| `editor_run_code` | 提交 QuickJS 组合脚本 |
| `editor_code_result` | 查询脚本结果和逐步记录 |
| `get_image_request` | 读取生成/修改图片需求及参考 PNG |
| `submit_image_result` | 将真实图片工具生成的本机 PNG 回传 |

先使用 `editor_list` 和 `editor_inspect`，然后使用 `photo_call` 的 `commands` 方法查询实际命令和参数，再调用 `execute` 或 `batch`。`photo_call` 支持 `commands`、`execute`、`batch`、`preview`、`export`。不要猜命令名称；返回任务编号后必须查询 `editor_job`，只有 `succeeded` 表示页面已确认。

## 程序化组合（PTC）

`editor_run_code({editorId, expectedVersion, requestId, code})` 返回 runId。脚本在包内 QuickJS 中运行，支持变量、函数、循环、条件、await 和顶层 return。工具必须逐个 await。

```js
const before = await editor.inspect();
const commands = await editor.commands({filter: 'blackWhite'});
return {before, commands};
```

可调用 `editor.inspect()`、`capabilities()`、`commands({filter})`、`execute({command,params})`、`edit([{command,params}])`、`draw({strokes,intervalMs})`、`preview(options)`、`create({width,height,name})`、`export({format})`。PhotoCraft 使用其真实命令；旧版的 `edit` 使用 `{op,...}` 操作，示例见 `examples/ptc-script.js`。

每次最多 32 KB 代码、32 MB VM 堆、64 次工具调用和 120 秒。没有 Node、文件或网络 API。QuickJS 位于 Node worker thread，库的 stdout/stderr 被单独接收，不写入宿主协议输出。语义识图由 Agent 查看 MCP 图片完成，脚本不会自己调用模型。

每批编辑可以整体撤销；整个脚本不是一个事务，后面的失败不会撤销前面已成功的步骤。用 `editor_code_result` 查看逐步记录，再查询相应 `editor_job`。在结果未知、超时或断线后不要直接重放。

## 一致性和边界

写操作携带 editorId、expectedVersion 和新的 UUID requestId。旧版本被拒绝；同一请求重复提交返回已有任务，不重复修改；不同内容不能复用编号。PhotoCraft 在页面应用后持久化回执，因此可能出现“已应用但尚未确认”。服务不会自动重放中断任务。

PhotoCraft 的批量操作在独立文档副本执行，成功后提交一次历史记录；并非所有引擎命令都允许进入批次。旧版轻量工作台先持久化检查点再让页面应用；其 `.retouch.json` 检查点可在旧版打开。主编辑器保存 `.pcraft`。

`sdk/editor.mjs` 和 `examples/compose-edit.mjs` 提供传输无关的旧版组合调用示例；实际 MCP 传输由调用者提供，不假设宿主有某个全局 PTC 对象。

工具存在不代表所有命令和模型理解都经过验证。编辑后查看预览；重要作品先保存工程。记录和结果暂不自动清理，长期运行会占用本地磁盘。

## 逐笔绘制和参考图

`await editor.draw({strokes, intervalMs:550})` 顺序执行 1–96 笔，每笔真实更新画布且可以单独撤销。每笔可以使用点数组或绝对路径命令 M/L/Q/C/Z；同段脚本内可循环分组，但总耗时仍须小于 120 秒。整笔 `pressure:0..1` 对路径和点数组均生效；逐点压力优先，未指定时保留引擎默认值，不改变倾角、旋转等扩展采样字段。绘画展示建议间隔 500–600 ms。`editor.edit` 的批量提交不等于逐笔绘制。

Skill 附带通用参考图轮廓脚本，适合边界清楚的插画和标志，需要 Python 3 与 Pillow，由 Agent 按需调用。它不识别语义，不自带图片模型，也不适合直接提取照片的所有色块。参见 [参考图轮廓转笔触](../skills/minimax-photo/references/reference-tracing.md)。

PTC 支持 `console.log/info/warn/error/debug`，结果中最多保留 50 条、总计 10000 字符的日志。日志不是任务成功证明；仍应查询运行结果并查看预览。


### 压力笔刷参数（0.2.24 宿主实测）

压力不一定改变笔宽，取决于笔刷设置。使用内置 `Hard Round Pressure Size` 或明确启用 `brush.shapeDynamics.enabled=true`、`brush.shapeDynamics.size.control="penPressure"`；线性 curve `[[0,0],[1,1]]`、minimum 为 0 时，30px 笔刷的压力 0.2 对应约 6px，压力 1 对应 30px。`transfer.opacity.control="penPressure"` 控制的是不透明度，不是笔宽。可通过 `brush.presets.list` 的 `full:true` 获取完整预设，在 PTC 内筛选所需预设再返回，避免整份结果被截断。


### 多会话编辑器识别

先在当前会话打开插件 ID `minimax-photo`，再读取当前 MiniApp 页面 `html` 的 `data-photo-editor-id`，与 `editor_list` 的 ID 精确匹配。页面会报告 `page.visibility`（visible/hidden/unknown）和 `page.focused`（布尔或 null）；旧页面不报告时返回 unknown/null。这两个值只作提示，不是会话归属或访问权限证明。工具不会自动选择最新、首个或可见实例。任务运行中的可见状态更新不会覆盖任务持有的文档版本。

## 打开本机文件

`editor_open_file({editorId,expectedVersion,requestId,filePath})` 读取已知附件或导出文件路径，将 PNG/JPEG/WebP/PSD/pcraft（最多 32 MB）作为新文档打开。使用 editor_job 等待完成，再 inspect 核对尺寸和图层。旧文档保留；无需在上下文传 base64，也不通过 Web 引擎的 file.openAs 访问本机路径。原文件不修改，工具结果省略文件字节。

`execute`/`batch` 的 params 必须是 JSON 对象。`document.pixel` 的 x、y 必须明确传入 32 位整数；字符串、小数、缺失坐标和越界值在任务入队前拒绝，不再落到默认的 (0,0) 像素。该检查用于取色命令，不表示所有引擎命令参数均有完整类型校验。
