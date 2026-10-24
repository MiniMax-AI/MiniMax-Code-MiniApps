# 动态工作流控制台（`workflow-console`）

[English](README.md) | 简体中文

一个把 MiniMax Code 动态工作流跑起来、盯住、看清的 Mini App。

它内置了 `mcode-dynamic-workflows` 运行时，所以**没装过那个插件的机器上也能直接用**。打开控制台，
它会自己拉起一个 Workflow Studio 引擎，绑定到某个项目目录，然后把该项目的所有运行摊开给你看：
状态、实时事件流、按阶段和依赖画出来的流程图、每个节点的输出、最终报告。运行可以审核、开始、暂停、
取消、恢复，可以导出 Markdown 或 HTML，可以存成模板，也可以从模板还原。

界面文案是中文。

## 基于哪个项目

这个包**基于 `mcode-dynamic-workflows` 插件**（作者 `hetaoBackend`，取自
<https://github.com/MiniMax-AI/MiniMax-Code-Plugins/tree/main/plugins/hetaoBackend/mcode-dynamic-workflows>，
Apache-2.0）。

那个插件是一个 MCP server，用多 Agent 编排工作流，原本必须装成 MiniMax Code 插件、再经 MCP 调用。
这个包把它的运行时拿过来，做成了一个**自包含的 Mini App**：

- 上游运行时内置到 `miniapp/node/vendor/dynamic-workflows/`，控制台把它作为子进程拉起；
- 上游 `web/` 画布的 `graph-model.mjs` 被直接 import，所以控制台里画出来的流程图和 Workflow Studio
  用的是**同一套图模型**，不是另写一份；
- 插件没有的部分由控制台补上：按项目划分的运行列表、实时事件流、运行的审核与控制、模板管理、
  报告导出，以及一个常驻可见的工作目录选择器。

### 内置运行时：确切的版本与来源

| | |
| --- | --- |
| 上游仓库 | `MiniMax-AI/MiniMax-Code-Plugins` |
| 上游路径 | `plugins/hetaoBackend/mcode-dynamic-workflows` |
| 上游提交 | `6481e4ae1e0375a4ddb3d5e9b29845354ab1cead`（2026-09-21） |
| 上游插件版本 | **0.8.0**（上游至今只发布过这一个版本） |
| 许可 | Apache-2.0 —— 见内置目录里的 `LICENSE` 与 `THIRD_PARTY_NOTICES.txt` |

内置的每个文件都是那个提交的**逐字节副本**。这不是一句说明，而是一条随时可验的事实：
`tests/vendor-integrity.test.mjs` 记下了每个文件在上游仓库里的 **git blob 对象 ID**，
测试会本地重算一遍 git blob 哈希（`sha1("blob <字节数>\0" + 内容)`）再逐个比对。
改过任何一个字节、换过任何一个版本，测试立刻失败。

整份副本约 2.3 MB（`dist/main.mjs` 约 1.0 MB、`dist/quickjs.wasm` 约 0.5 MB、`web/` 约 0.27 MB）。
它锁定在某一个提交上，不会自动跟随上游升级；升级流程（怎么复制文件、怎么更新记录的 blob ID、
之后要复查什么）写在 `miniapp/node/vendor/dynamic-workflows/VENDOR.md` 里。

## 安装

把本目录连同隐藏的 `.minimax-plugin/` 一起复制进 MiniMax Code 的插件目录，命名为
`workflow-console/`（默认是 `~/.minimax/plugins/workflow-console/`；根 README 的 Install 一节说了那个
目录在哪）。重启 MiniMax Code，然后对 Agent 说「打开动态工作流控制台」。

没有配置步骤，也没有构建步骤。

### 选择项目目录

控制台需要知道引擎该在哪个项目里干活，而且它**不会猜**：

- 宿主用环境变量（`MCODE_WORKSPACE`、`MCODE_PROJECT_DIR`、`PROJECT_DIR`、`WORKSPACE`）声明了当前项目，
  就用那个目录；
- 否则用你在页面顶部那条常驻的**工作目录**栏里填的绝对路径（记在 `context.dataDir` 下）；
- 两者都没有，**引擎根本不会启动**，页面会请你填一个项目的绝对路径。
  它不会退回你的用户主目录——在主目录里跑一次运行，等于让它改写整个家目录——也不会用宿主的
  临时投放目录。

保存后引擎会按新目录重启，运行记录存在引擎自己的数据库里，不受影响。

跑真实工作流仍然需要本机 `mcode` CLI 可用：引擎通过它去编排 Agent。demo 执行器不需要。

## Skill

本包附带一个 Skill：`skills/workflow-console/SKILL.md`。它告诉 Agent 怎么用这个控制台——
引擎启动前必须先选定项目目录、运行在 `pending_review` 状态要等审核、
「审核通过 / 暂停 / 取消 / 恢复」各自意味着什么、复用模板只是新建草稿而不是开始执行、
`demo` 执行器不调模型。也明确要求 Agent 不要替用户猜工作目录，也不要在用户没点头时替他批准运行。

这个 Skill 是宿主注册本插件时加载的，控制台进程自己不会读它。

## 测试环境

- MiniMax Code 3.1.4 + Windows 11，Node.js 22 与 26。从本目录安装，经 Agent 打开，页面渲染正常，
  引擎能起来，demo 执行器下运行可审核、可执行。
- macOS（arm64）+ Node.js 26.8.1。在**从未装过上游插件**的机器上从本目录安装，工作目录解析、
  「还没选项目目录」这一状态、demo 执行器下的完整运行都验证过。
- 浏览器：Chromium 系桌面浏览器，1280x720 与 589x899 两种视口，浅色与深色主题。

未验证：真实模型执行，以及真实执行器上的暂停/恢复/取消。测试里的执行全部走 `demo` 执行器，不调模型。
`mcodeAvailable: true` 只代表本机存在 `mcode` 可执行文件，本包不检查它的登录状态与配额。

## 数据与访问

### 读取的文件

- `miniapp/client/` 与 `miniapp/node/vendor/` —— 本包自己的资源。
- `skills/workflow-console/SKILL.md` —— 宿主注册本插件时读取，控制台进程自己不读。
- 它绑定的那个项目目录 —— 引擎以它为工作目录运行，被它拉起的 `mcode` CLI 在其中读写文件。

本包**不读**自己包目录与项目目录之外的任何文件。特别是**不读**
`~/.mcode-dynamic-workflows/`：那是另一个 `mcode-dynamic-workflows` 插件的数据，里面存着那个插件的
服务地址和访问令牌，控制台既不读它，也不去连它登记的那些服务。控制台只跑自己内置的引擎。

### 写入的文件

一律写在 `context.dataDir` 下，绝不写到别处：

- `workspace.json` —— 内置引擎绑定的工作目录；
- `hidden-runs.json` —— 本地隐藏的运行列表。隐藏不是删除，记录仍在**内置引擎自己的数据库**里
  （`context.dataDir/engine/` 下的 `workflows.sqlite`），可恢复；
- `engine/` —— `address.json`、`endpoint.json`、`service.log`、`workflows.sqlite`，由内置引擎写入。

### 网络

只走回环地址。内置引擎监听 `http://127.0.0.1:<端口>`，控制台把页面代理过去。
**不访问任何外网主机，也不访问任何别的本机服务。**

### 进程

一个子进程，用 argv 数组启动，不经 shell：

```
node <pluginRoot>/miniapp/node/vendor/dynamic-workflows/dist/main.mjs --workspace <目录> --data-dir <目录>
```

`<目录>`就是页面顶部那条栏里显示的工作目录：宿主声明的，或用户填的。用户输入作为独立的
argv 元素传入，不会拼进命令行。应用退出时整棵进程树会被收掉。

引擎本身在跑真实执行器时可能拉起本机 `mcode` CLI，见下一节。

### Agent 回合

本包没有声明 `agentAccess`，自己也不发起 Agent 回合。

内置引擎在跑真实执行器时可能调用本机 `mcode` CLI。那是上游插件自带的行为，但有一点值得写清楚：
引擎调用的是 `mcode exec --permission smart`，所以**运行期间部分文件写入与命令会被自动放行，
需要你确认的步骤会让那个节点直接失败，而不是停下来等你**。页面上的「开始执行」确认框在批准之前
会把这话说一遍。

### 状态

所有持久化数据都在 `context.dataDir`（见上）。页面不在浏览器存储里放业务数据。

## 文件

```text
.minimax-plugin/plugin.json                 插件清单
package.json                                Mini App 声明
skills/workflow-console/SKILL.md            Agent 用来操作本控制台的 Skill
miniapp/miniapp.json                        运行时根目录、Node 入口、页面路由
miniapp/client/index.html                   /dashboard 上提供的页面
miniapp/client/app.js                       前端（原生 HTML/CSS/JS，无框架无构建）
miniapp/client/style.css                    样式，浅色与深色主题
miniapp/node/server.mjs                     Node 入口：start(context) -> { dispose }
miniapp/node/miniapp-api.ts                 运行时上下文的类型声明
miniapp/node/vendor/dynamic-workflows/      内置的上游运行时（0.8.0，Apache-2.0）
tests/workspace-resolution.test.mjs         工作目录解析
tests/engine-isolation.test.mjs             内置引擎是唯一的后端
tests/vendor-integrity.test.mjs             内置文件与记录的上游提交逐字节一致
tests/end-to-end.test.mjs                   引擎完整生命周期：从空工作目录到一次跑完的运行
tests/manual-mac-scenario.mjs               起一个模拟全新 macOS 宿主的隔离实例
icon.png                                    插件图标
```

## 测试

测试用 Node 自带的测试运行器，在沙箱主目录里起一个隔离的控制台实例，不会碰任何真实项目：

```bash
npm test
```

`npm test` 就是在本目录跑 `node --test "tests/*.test.mjs"`，不用 npm 直接敲那条命令也一样。

`tests/workspace-resolution.test.mjs` 覆盖工作目录解析：宿主那个临时投放目录和其它不可信路径会被拒掉，
用户主目录绝不会被当成兜底，没选定项目目录之前引擎不会启动。
`tests/engine-isolation.test.mjs` 造一份别的插件的服务登记簿——指向一个会计账的本地服务——
并断言控制台一次请求都没发过去。
`tests/vendor-integrity.test.mjs` 验证每个内置文件仍与上面记录的上游提交逐字节一致。
`tests/end-to-end.test.mjs` 会真的把内置引擎拉起来，把整条路走一遍：空工作目录 → 选定项目目录 →
引擎就绪 → 建一个 demo 运行 → 流程图 → 审核 → 运行跑完 → 导出报告 → 隐藏与恢复 → 换到另一个项目 →
拒绝非法目录。它走 `demo` 执行器，不调模型。
`tests/manual-mac-scenario.mjs` 会起一个工作目录指向临时投放目录的控制台，并打印出手工查看用的地址。

## 许可

[MIT](./LICENSE)。内置的上游运行时保留其自己的 Apache-2.0 许可。
