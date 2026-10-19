# 仓库透视 (`repo-xray`)

[English](README.md) | 简体中文

读代码之前，先从 Git 历史看懂一个陌生的代码仓库。添加一个 GitHub / GitLab 仓库，或者选一个本机仓库，仓库透视会把提交记录变成一张可以逐层下钻的代码地图、一份高风险文件清单，告诉你谁在维护哪里、团队怎么交付、项目用了哪些技术。

分析用你本机的 `git` 在本地完成：不上传任何内容，页面也不加载任何远程资源。指标口径沿用 [codebase-recon-skill](https://github.com/yujiachen-y/codebase-recon-skill)，导出的 Markdown 也是这个 skill 的报告格式。界面为中文。

![仓库透视代码地图（虚构数据）](docs/preview.jpg)

*预览图使用虚构数据：为截图专门生成的一个虚构 monorepo。*

## 能做什么

- **概览**：关键数字、按确定性规则找出的主要问题、建议、与上次分析相比的变化，以及一张能点进完整地图的代码地图缩略图。
- **代码地图**：可以逐层下钻的目录 treemap。着色可选修改热度、Bug 占比、负责人、最近修改、知识流失（这块的全部历史提交中，来自近 3 个月没有任何提交的人的比例）和文件类型；面积可按文件数或修改次数；时间范围可选近 3、6、12 个月或全部历史。支持键盘操作。
- **风险文件**：同时出现在“修改热点”和“Bug 磁铁”（最常被提交说明里带 fix、bug、broken 的提交改动）两个榜单里的文件，附负责人。
- **贡献者**：按非合并提交排名、工作集中度、近 3 个月的活跃情况，机器人和令牌账号单独列出。默认把同名或同邮箱的身份合并，也可以切换成按作者名逐一统计。
- **节奏与救火**：月度提交趋势、提交日历，以及 revert、hotfix、emergency、rollback 类提交。
- **技术栈**：从 `package.json`、`go.mod`、`Cargo.toml`、`pyproject.toml`、`pom.xml`、`Gemfile` 等清单文件识别语言、框架和工具。
- ⌘K 搜索仓库、全部历史文件和贡献者；把报告复制或下载为 Markdown；或者把一段准备好的提示词放进对话输入框，让 Agent 帮你读最高风险的文件，内容由你确认后自己发送。
- 推荐最近用过的本机仓库，支持浅色和深色主题、键盘快捷键（按 `?` 查看），以及系统的“减弱动态效果”设置。

## 运行要求

- `PATH` 里有 `git`。分析远程仓库需要 Git 2.31 或更高版本，因为凭据和代理通过 `GIT_CONFIG_COUNT` 环境变量传给 git。
- 私有仓库：如果装了 `gh`（GitHub）或 `glab`（GitLab）并且已经登录，会直接复用登录状态；否则可以在设置里为对应主机填写访问令牌。

## 安装

把整个目录（包括隐藏的 `.minimax-plugin/`）复制到 MiniMax Code 的插件目录，命名为 `repo-xray/`（默认是 `~/.minimax/plugins/repo-xray/`，详见根目录 README 的安装说明）。重启 MiniMax Code，然后从右侧面板的 Mini App 入口打开仓库透视，或者对 Agent 说“打开仓库透视”。

## Tested environment

- 在 macOS 27 上的 MiniMax Code 3.1.3-preview.4675 中测试，Git 版本 2.54：通过宿主的发布流程安装（也从本仓库目录重新安装过），在右侧面板打开。
- 实测过：一个公开的 GitHub 仓库、一个通过 `glab` 登录访问的自建 GitLab 仓库和本机仓库，包括重新分析；所有分区；代码地图的全部着色、面积和时间范围选项，用鼠标和键盘逐层进入与返回；⌘K 搜索；Markdown 导出；浅色和深色主题。控制台没有报错，也没有失败的请求。
- 未实测：把页面弹出到独立窗口（`surface.window`，尺寸 1360×900）；追加到对话输入框（需要宿主弹窗确认）；“减弱动态效果”；Windows 和 Linux。

## Data & access

- 读取的文件：
  - 你添加的仓库。本机仓库只用下文列出的只读 git 命令原地读取：只看 `HEAD` 的历史，不 fetch，也不写入任何内容。
  - 本机仓库推荐：在扫描目录下列出子目录（默认 `~/Workspace`、`~/workspace`、`~/code`、`~/Code`、`~/src`、`~/Projects`、`~/projects`、`~/Developer`、`~/dev`、`~/repos`、`~/GitHub`、`~/git`；可在设置里改成最多 10 个自定义目录），最深 4 层、最多 4000 个目录和 300 个仓库，跳过隐藏目录和 `node_modules` 等目录。每个目录只检查有没有 `.git`，以及 `.git/FETCH_HEAD`、`.git/index`、`.git/HEAD` 的修改时间。
  - `glab` 配置文件（`$GLAB_CONFIG_DIR/config.yml`、`~/.config/glab-cli/config.yml` 或 `~/Library/Application Support/glab-cli/config.yml`）和 `gh` 的 `hosts.yml`（`$GH_CONFIG_DIR`、`$XDG_CONFIG_HOME/gh` 或 `~/.config/gh`）里的主机名，用来判断这两个 CLI 登录了哪些主机；不从这些文件读取令牌。
  - 在 `PATH`、`/opt/homebrew/bin`、`/usr/local/bin`、`/usr/bin`、`~/.local/bin`、`~/.local/share/mise/shims` 里查找 `gh` 和 `glab` 是否存在。
- 写入的文件，全部位于宿主提供的 `context.dataDir` 内（先写临时文件再原子替换；JSON 文件的权限是仅本人可读写的 `0600`）：
  - `config.json`：仓库列表和设置（扫描目录、代理，以及你在设置里填写的访问令牌；令牌以明文保存在这个文件里）。
  - `reports/<id>.json`：每个仓库的分析结果。
  - `repos/<id>.git`：远程仓库的 bare、blob-less 克隆，只包含提交和目录树，外加技术栈识别和目录说明用到的少量清单文件与 README 类文件。
  - 移除仓库时删除它的报告；如果是远程仓库，同时删除它的克隆。本机仓库从不改动。
- 网络：只有 `git` 会联网，通过 HTTPS 访问你添加的远程仓库所在的主机：clone 和 fetch、用 `ls-remote` 跟进默认分支改名、拉取上面提到的少量清单与 README 文件。`git@host:path` 和 `ssh://` 形式的地址会先校验主机名，再转换成 HTTPS 地址。设置了代理时 git 经代理连接，代理依次取自设置、`HTTPS_PROXY` / `https_proxy` / `HTTP_PROXY` / `http_proxy` 环境变量、macOS 系统 HTTPS 代理。页面只加载本应用同源的文件和 `/api/` 路由。指向 GitHub / GitLab 页面的链接只有在你点击时才会在浏览器里打开。没有任何统计上报。
- 本地服务：只响应 `Host` 是回环地址、并且 `Origin`（如果带了）就是本页面的请求，其余一律返回 `403`。
- 进程：全部用参数数组启动，从不经过 shell。你输入的地址和路径都会先校验，并作为独立参数传入，不会出现在选项位置：
  - `git`：`clone --bare --filter=blob:none`、`fetch`、`ls-remote`、`log`、`ls-tree`、`cat-file`、`rev-parse`、`for-each-ref`、`symbolic-ref`，以及 `config`（读取本机仓库的 `remote.origin.url` 来生成网页链接；只在应用自己的克隆里设置 `remote.origin.fetch` 和 `HEAD`）。继承来的、会把 git 指向别的仓库的环境变量（`GIT_DIR` 以及 `git rev-parse --local-env-vars` 列出的其余变量）和会打印请求的 `GIT_TRACE*` 都会被去掉。
  - `gh auth token --hostname <host>`（`github.com` 和 `gh` 的 `hosts.yml` 里的主机）和 `glab config get token --host <host>`（`glab` 配置里的主机），仅在装了这两个 CLI 时调用，用来复用已有登录。
  - macOS 上的 `/usr/sbin/scutil --proxy`，仅在设置和环境变量里都没有代理时调用。
- 凭据：来自 `gh`、`glab` 或设置的令牌只留在 Node 进程里，通过 `GIT_CONFIG_*` 环境变量以 `http.extraHeader` 的形式交给 git，不会出现在命令行参数、仓库配置、页面、日志或事件流里。带着令牌时 git 不跟随 HTTP 跳转（`http.followRedirects=false`），令牌只会发给你添加的那台主机；会跳转的仓库（改名或迁移过）需要用新地址重新添加。来自 `gh` 和 `glab` 的令牌只缓存在内存中。这些 git 命令会关闭凭据助手和交互式提示。
- Agent：不运行 Agent，没有声明 `agentAccess`，也没有 MCP 端点。“发到对话…”“让 Agent 讲解…”“让 Agent 读高风险文件…”会调用 `window.mcode.miniapp.message.append`，在宿主弹窗确认后把一段准备好的提示词（报告摘要和部分文件路径）放进对话输入框，由你决定是否发送。环境不支持这个接口时，改为复制到剪贴板。
- 剪贴板：只在你点击复制类操作（SHA、路径、Markdown 报告）时写入。
- 浏览器存储：`localStorage` 只保存主题、上次打开的仓库和身份合并偏好。
- 重置：在仓库页面点“移除”删除单个仓库；访问令牌可以在设置里清除。删除应用的数据目录即可清空它保存的全部内容。

## License

[MIT](./LICENSE)
