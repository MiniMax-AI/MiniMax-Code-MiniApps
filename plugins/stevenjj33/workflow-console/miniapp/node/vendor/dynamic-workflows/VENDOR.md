# 内置 Workflow Studio 引擎

本目录是 [mcode-dynamic-workflows](https://github.com/MiniMax-AI/MiniMax-Code-Plugins/tree/main/plugins/hetaoBackend/mcode-dynamic-workflows)
插件的运行时代码副本，被直接内置进「动态工作流控制台」Mini App，使控制台不依赖插件在场也能运行。

## 版本与来源

- 上游：`MiniMax-AI/MiniMax-Code-Plugins` → `plugins/hetaoBackend/mcode-dynamic-workflows`
- 版本：**0.8.2**（从本机插件缓存原样复制，未做任何修改）
- 许可：Apache-2.0，完整许可见本目录 `LICENSE`，第三方组件声明见 `THIRD_PARTY_NOTICES.txt`

## 包含内容

- `dist/main.mjs` — 引擎与本地 HTTP 服务（SQLite 存储、调度器、静态拓扑分析、报告导出）
- `dist/sandbox.mjs`、`dist/quickjs.wasm` — 工作流脚本沙箱
- `web/` — 原生 Workflow Studio 面板（控制台点「打开完整 Studio」时访问的就是它）
- `examples/` — 上游示例脚本，`/api/config` 的 `example` 字段依赖它

## `web/graph-model.mjs` 是承重依赖（升级时必看）

控制台的「执行流程图」直接 `import` 了 `web/graph-model.mjs` 里的 `workflowGraph()`，
用它把静态拓扑和运行步骤合并成一张有向图。这样控制台画出来的图和 Studio 里那张
是同一套语义，不会各画各的。

该文件是纯逻辑、零依赖的 ESM，可以安全地在 Node 侧引入。**但如果升级 vendor 时
上游改了它的导出名或签名，控制台会在启动时直接报错**——升级流程里必须检查这个引用。
若上游重写了这套图模型，优先改成适配层，而不是在客户端另写一份合并逻辑。

## 与插件服务的差别（重要）

| | 内置引擎 | 插件服务 |
| --- | --- | --- |
| 生命周期 | 随控制台启停（`dispose()` 连进程树一起收） | 按项目常驻，脱离聊天 |
| 数据目录 | `context.dataDir/engine` | `~/.mcode-dynamic-workflows/projects/<hash>` |
| 历史记录 | 与插件的历史互相独立 | 同左 |
| 端口 | 自行分配并复用 | 固定并记录在 `address.json` |

控制台仍会扫描并列出本机已有的插件服务，可在顶部下拉里切换；默认使用内置引擎。

## 仍需的外部依赖

内置引擎调度真实 Agent 时依旧调用 **MCode CLI**，它需要单独安装并完成登录。本目录只替代插件，
不替代 MCode CLI。

## 更新方式

本副本锁定在 0.8.2，不会自动跟随上游升级。上游发新版后，需要重新从插件缓存复制
`dist/`、`web/`、`examples/` 三个目录，并同步版本号。
