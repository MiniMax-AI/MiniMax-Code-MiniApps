# 内置 Workflow Studio 引擎

本目录是 [mcode-dynamic-workflows](https://github.com/MiniMax-AI/MiniMax-Code-Plugins/tree/main/plugins/hetaoBackend/mcode-dynamic-workflows)
插件的运行时代码副本，被直接内置进「动态工作流控制台」Mini App，使控制台不依赖插件在场也能运行。

## 版本与来源（逐字节可验证）

| | |
| --- | --- |
| 上游仓库 | `MiniMax-AI/MiniMax-Code-Plugins` |
| 上游路径 | `plugins/hetaoBackend/mcode-dynamic-workflows` |
| 上游提交 | `6481e4ae1e0375a4ddb3d5e9b29845354ab1cead` |
| 提交日期 | 2026-09-21 |
| 上游插件版本 | **0.8.0**（上游 `package.json` 与 `plugin.json` 里写的版本号，从 2026-09-17 首次发布起没有再动过） |
| 许可 | Apache-2.0，完整许可见本目录 `LICENSE`，第三方组件声明见 `THIRD_PARTY_NOTICES.txt` |

**本目录里的每个文件都是那个提交的逐字节副本，没有改过一个字节。**
这不是一句说明，而是一条随时可验的事实：`tests/vendor-integrity.test.mjs`
把每个文件在上游仓库里的 **git blob 对象 ID** 记了下来，测试会本地重算一遍 git blob 哈希
（`sha1("blob <字节数>\0" + 内容)`）再逐个比对。只要副本被改动过、被换成别的版本，
或者来源说不清，测试立刻失败。

> 上一版副本声称来自「0.8.2 的本地插件缓存」，但上游从来没有发布过 0.8.2，
> 而且那份副本的 `dist/main.mjs`、`web/app.js`、`web/app.source.mjs`
> 与上游任何一个公开提交都对不上（其余 11 个文件则与 `00878c7ef606` 一致）。
> 这一版改为直接从上游提交复制，来源因此可以逐个文件验证。

## 包含内容

| 路径 | 说明 |
| --- | --- |
| `dist/main.mjs` | 引擎与本地 HTTP 服务（SQLite 存储、调度器、静态拓扑分析、报告导出） |
| `dist/sandbox.mjs`、`dist/quickjs.wasm` | 工作流脚本沙箱 |
| `web/` | 原生 Workflow Studio 面板（控制台点「打开完整 Studio」时访问的就是它） |
| `examples/` | 上游示例脚本，`/api/config` 的 `example` 字段依赖它 |

`dist/`、`web/`、`examples/` 三个目录必须与 `dist/main.mjs` 保持同级关系：
上游引擎用 `new URL("../web/", import.meta.url)` 和 `new URL("../examples/", import.meta.url)`
定位自己的静态资源和示例，挪动目录会让引擎起不来。

## 体积

整份副本约 2.3 MB（`dist/main.mjs` 约 1.0 MB、`dist/quickjs.wasm` 约 0.5 MB、
`web/` 约 0.27 MB，其余为示例与声明文件）。控制台把它整个带在身上，
换取的是「这台机器没装过那个插件也能跑」——插件包本来就是按自包含交付的，
仓库不提交 `node_modules`，第三方代码只能内置在运行时代码里。

## `web/graph-model.mjs` 是承重依赖（升级时必看）

控制台的「执行流程图」直接 `import` 了 `web/graph-model.mjs` 里的 `workflowGraph()`，
用它把静态拓扑和运行步骤合并成一张有向图。这样控制台画出来的图和 Studio 里那张
是同一套语义，不会各画各的。

该文件是纯逻辑、零依赖的 ESM，可以安全地在 Node 侧引入。**但如果升级 vendor 时
上游改了它的导出名或签名，控制台会在启动时直接报错**——升级流程里必须检查这个引用。
`tests/vendor-integrity.test.mjs` 里也有一条测试专门盯这个导出名。
若上游重写了这套图模型，优先改成适配层，而不是在客户端另写一份合并逻辑。

## 与插件服务的差别（重要）

| | 内置引擎 | 插件服务 |
| --- | --- | --- |
| 生命周期 | 随控制台启停（`dispose()` 连进程树一起收） | 按项目常驻，脱离聊天 |
| 数据目录 | `context.dataDir/engine` | `~/.mcode-dynamic-workflows/projects/<hash>` |
| 历史记录 | 与插件的历史互相独立 | 同左 |
| 端口 | 自行分配并复用 | 固定并记录在 `address.json` |

**控制台只使用内置引擎，不会去连接插件服务。**
它不读 `~/.mcode-dynamic-workflows` 下的任何文件，也不使用那里登记的服务地址和访问令牌——
那些是另一个插件的数据与凭证。`tests/engine-isolation.test.mjs` 会造一份假的插件登记簿
指向一个会计账的本地服务，断言控制台一次请求都没发过去。

## 仍需的外部依赖

内置引擎调度真实 Agent 时依旧调用 **MCode CLI**（`mcode exec --permission smart …`），
它需要单独安装并完成登录。本目录只替代插件，不替代 MCode CLI。

`--permission smart` 意味着：运行期间部分文件写入与命令会被自动放行，
需要人工确认的步骤会让那个节点直接失败，而不是停下来等人。
控制台的「开始执行」确认框和 README 都写明了这一点。

## 更新方式（怎么跟上上游）

副本锁定在 `6481e4ae1e0375a4ddb3d5e9b29845354ab1cead`，不会自动跟随上游升级。
上游发新版后按下面走一遍：

1. 找到上游插件目录的新提交：

   ```sh
   git clone --filter=blob:none https://github.com/MiniMax-AI/MiniMax-Code-Plugins.git
   git -C MiniMax-Code-Plugins log --oneline -- plugins/hetaoBackend/mcode-dynamic-workflows
   ```

2. 取出该提交下的 `dist/`、`web/`、`examples/`、`LICENSE`、`THIRD_PARTY_NOTICES.txt`，
   覆盖本目录对应文件（目录结构不要动）。

3. 用上游 git 对象 ID 更新 `tests/vendor-integrity.test.mjs` 里的 `UPSTREAM_BLOBS` 表：

   ```sh
   git -C MiniMax-Code-Plugins ls-tree -r <新提交> \
     -- plugins/hetaoBackend/mcode-dynamic-workflows
   ```

4. 更新本文件里的「上游提交」「提交日期」「上游插件版本」三行。

5. 跑测试：

   ```sh
   node --test tests/
   ```

   `vendor-integrity.test.mjs` 会逐个文件重算 git blob 哈希并比对；
   `graph-model` 那条测试会确认 `workflowGraph()` 的导出名没变。

6. 跑一遍完整冒烟（见 `tests/manual-mac-scenario.mjs`），确认引擎能起、页面能渲染。

**别做的事**：不要「顺手改一改」副本里的代码，也不要把上游的文件改名。
一旦副本不再是逐字节的上游副本，上面这套验证就失效了，
「这份代码来自哪里、能不能安全升级」也就没人能回答了。
控制台自己的逻辑请写在 `miniapp/node/server.mjs` 和 `miniapp/client/` 里。
