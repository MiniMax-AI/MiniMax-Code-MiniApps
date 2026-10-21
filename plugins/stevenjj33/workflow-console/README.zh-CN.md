# 动态工作流控制台（`workflow-console`）

English | [简体中文](README.zh-CN.md)

一个把 MiniMax Code 动态工作流跑起来、盯住、看清的 Mini App。

它内置了 `mcode-dynamic-workflows` 运行时，所以**没装过那个插件的机器上也能直接用**。打开控制台，
它会自己拉起一个 Workflow Studio 引擎，绑定到某个项目目录，然后把该项目的所有运行摊开给你看：
状态、实时事件流、按阶段和依赖画出来的流程图、每个节点的输出、最终报告。运行可以审核、开始、暂停、
取消、恢复，可以导出 Markdown 或 HTML，可以存成模板，也可以从模板还原。

界面文案是中文。

## 基于哪个项目

这个包**基于 `mcode-dynamic-workflows` 插件**（作者 `hetaoBackend`，取自
<https://github.com/MiniMax-AI/MiniMax-Code-Plugins/tree/main/plugins/hetaoBackend/mcode-dynamic-workflows>，
版本 0.8.2，Apache-2.0）。

那个插件是一个 MCP server，用多 Agent 编排工作流，原本必须装成 MiniMax Code 插件、再经 MCP 调用。
这个包把它的运行时拿过来，做成了一个**自包含的 Mini App**：

- 上游 `dist/` 运行时原样内置到 `miniapp/node/vendor/dynamic-workflows/`，控制台把它作为子进程拉起；
- 上游 `web/` 画布的 `graph-model.mjs` 被直接 import，所以控制台里画出来的流程图和 Workflow Studio
  用的是**同一套图模型**，不是另写一份；
- 插件没有的部分由控制台补上：按项目划分的运行列表、实时事件流、运行的审核与控制、模板管理、
  报告导出，以及一个常驻可见的工作目录选择器。

`miniapp/node/vendor/dynamic-workflows/VENDOR.md` 记录了内置了哪些文件，以及本控制台与上游插件的
全部行为差异。

## 安装

把本目录连同隐藏的 `.minimax-plugin/` 一起复制进 MiniMax Code 的插件目录，命名为
`workflow-console/`（默认是 `~/.minimax/plugins/workflow-console/`；根 README 的 Install 一节说了那个
目录在哪）。重启 MiniMax Code，然后对 Agent 说「打开动态工作流控制台」。

没有配置步骤，也没有构建步骤。首次打开需要指定一个项目目录：控制台会先从正在运行的 Workflow Studio
服务上找，再从早前插件运行留下的项目登记簿里找，都找不到就退回你的用户主目录，并让你在页面顶部
那条常驻的**工作目录**栏里填一个绝对路径。保存后引擎会按新目录重启，运行记录存在引擎自己的数据库里，
不受影响。

跑真实工作流仍然需要本机 `mcode` CLI 可用：引擎通过它去编排 Agent。demo 执行器不需要。

## 测试环境

- MiniMax Code 3.1.4 + Windows 11，Node.js 22 与 26。从本目录安装，经 Agent 打开，页面渲染正常，
  引擎能起来，demo 执行器下运行可审核、可执行。
- macOS（arm64）+ Node.js 22.22.3。在**从未装过上游插件**的机器上从本目录安装，服务发现、工作目录
  解析、demo 执行器下的完整运行都验证过。
- 浏览器：Chromium 系桌面浏览器，1280x720 与 589x899 两种视口，浅色与深色主题。

未验证：真实模型执行，以及真实执行器上的暂停/恢复/取消。测试里的执行全部走 `demo` 执行器，不调模型。
`mcodeAvailable: true` 只代表本机存在 `mcode` 可执行文件，本包不检查它的登录状态与配额。

## 数据与访问

### 读取的文件

- `miniapp/client/` 与 `miniapp/node/vendor/` —— 本包自己的资源。
- `~/.mcode-dynamic-workflows/projects/<sha256>/address.json` 与 `endpoint.json` ——
  **宿主侧目录，没有受支持的 API**。位置是 `<home>/.mcode-dynamic-workflows/projects/`，
  读它只是为了知道别的 Workflow Studio 服务绑在哪个项目上，并据此挑一个默认工作目录。
  这依赖的是一套未公开的布局，MiniMax Code 随时可能改。该目录不存在时本包照常工作，
  工作目录退回用户主目录。

### 写入的文件

一律写在 `context.dataDir` 下，绝不写到别处：

- `selection.json` —— 控制台当前指向的服务 id；
- `workspace.json` —— 内置引擎绑定的工作目录；
- `hidden-runs.json` —— 本地隐藏的运行列表。隐藏不是删除，记录仍在引擎数据库里，可恢复；
- `engine/` —— `address.json`、`endpoint.json`、`service.log`、`workflows.sqlite`，由内置引擎写入。

### 网络

只走回环地址。内置引擎监听 `http://127.0.0.1:<端口>`，控制台把页面代理过去；发现到的 Workflow Studio
服务同样只在 `http://127.0.0.1` 上访问。**不访问任何外网主机。**

### 进程

一个子进程，用 argv 数组启动，不经 shell：

```
node <pluginRoot>/miniapp/node/vendor/dynamic-workflows/dist/main.mjs --workspace <目录> --data-dir <目录>
```

`<目录>`就是页面顶部那条栏里显示的工作目录：用户填的，或从发现到的服务上解析来的。用户输入作为独立
的 argv 元素传入，不会拼进命令行。应用退出时整棵进程树会被收掉。

### Agent 回合

无。本包没有声明 `agentAccess`，自己也不发起 Agent 回合。内置引擎在跑真实执行器时可能调用本机
`mcode` CLI，那是上游插件自带的行为，由上游文档说明。

### 状态

所有持久化数据都在 `context.dataDir`（见上）。页面不在浏览器存储里放业务数据。

## 文件

```text
.minimax-plugin/plugin.json                 插件清单
package.json                                Mini App 声明
miniapp/miniapp.json                        运行时根目录、Node 入口、页面路由
miniapp/client/index.html                   /dashboard 上提供的页面
miniapp/client/app.js                       前端（原生 HTML/CSS/JS，无框架无构建）
miniapp/client/style.css                    样式，浅色与深色主题
miniapp/node/server.mjs                     Node 入口：start(context) -> { dispose }
miniapp/node/miniapp-api.ts                 运行时上下文的类型声明
miniapp/node/vendor/dynamic-workflows/      内置的上游运行时（0.8.2，Apache-2.0）
tests/workspace-resolution.test.mjs         工作目录解析
tests/service-discovery.test.mjs            没装上游插件的机器上的服务发现
tests/manual-mac-scenario.mjs               起一个模拟全新 macOS 宿主的隔离实例
icon.png                                    插件图标
```

## 测试

测试用 Node 自带的测试运行器，在沙箱主目录里起一个隔离的控制台实例，不会碰任何真实项目：

```bash
node --test "tests/*.test.mjs"
```

`tests/service-discovery.test.mjs` 覆盖的是「`~/.mcode-dynamic-workflows/projects` 不存在」这一情形，
也就是从没装过上游插件的机器长什么样。`tests/workspace-resolution.test.mjs` 覆盖工作目录解析，
包括宿主那个临时投放目录——它绝不能被当成项目。`tests/manual-mac-scenario.mjs` 会起一个工作目录
指向临时投放目录的控制台，并打印出手工查看用的地址。

## 许可

[MIT](./LICENSE)。内置的上游运行时保留其自己的 Apache-2.0 许可。
