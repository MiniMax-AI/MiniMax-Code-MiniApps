# 磁盘透视（`disk-insight`）

[English](README.md) | 简体中文

macOS 和 Windows 上的磁盘空间查看和清理工具。选好一个磁盘或文件夹，磁盘透视会告诉你空间都去了哪里：旭日图形式的空间地图、按删除风险分好档的垃圾文件、大文件和重复文件，以及代码仓库和 Git worktree 各占多少。拿不准的条目可以先问 Agent。选中的条目在确认框里逐一列出，确认后**直接永久删除**，不进废纸篓或回收站。界面只有中文。

下面的预览图使用模拟数据。

![空间地图：磁盘容量、旭日图和目录列表](docs/preview-map.png)

![垃圾清理：按分类统计的可释放空间和分档列表](docs/preview-junk.png)

## 能做什么

- **空间地图**（首页）：左边是扫描范围的旭日图，右边是当前目录的子项列表，支持搜索和排序，点击可以逐层进入。切到「文件类型」可以按类型统计占用（视频、图片、音频、磁盘镜像、压缩包、安装包、虚拟机磁盘、开发缓存、其他）。
- **必须先选扫描范围**：不选范围就不扫描。范围可以是一个或多个磁盘，也可以是文件夹；文件夹可以用系统的文件夹选择框选，也可以直接粘贴路径。快速扫描先出第一批结果，完整扫描在后台继续。
- **垃圾清理**：按规则识别临时文件、包管理器缓存、浏览器缓存、日志、开发构建产物、旧安装包、应用和聊天软件缓存、Python 虚拟环境、模拟器、大且久未修改的文件、重复文件等，分三档：
  - **建议清理**：删除后会自动重建，默认勾选（开发构建产物只在所在项目 90 天没改动时才默认勾选）。
  - **需要确认**：可能丢失信息，默认不勾选。
  - **仅提示**：系统垃圾、废纸篓或回收站、Docker 磁盘镜像、Go 模块缓存。只显示大小和去哪里处理，不能勾选。

  有按分类统计可释放空间的饼图，列表支持搜索、排序，还有忽略名单，不想再被建议的条目可以放进去。
- **大文件与重复文件**：500 MB 及以上的文件；1 MB 及以上的重复文件，用 SHA-256 确认内容相同，可以「每组只保留最新的一份」。Git 工作区里的文件不参与比对。
- **代码仓库**：每个仓库的大小、worktree 数量和大小、Git 数据和依赖的占用。「勾选依赖和构建产物」把仓库里的依赖和构建产物加入已选清单；「清理失效 worktree」删除目录已经不存在的 worktree 记录。有未提交改动或未推送提交的 worktree 会锁定，不能勾选。
- **问 Agent**：任何条目都可以问 Agent 这是什么、删了会怎样、建不建议删，回答实时显示在侧边面板里。
- **清理记录和统计**：每个被删条目的时间、大小和结果（更多 → 清理记录），页头显示累计释放的空间和清理次数。
- **无权限的目录**（更多 → 无权限的目录）：列出扫描时读不了的目录。在 macOS 上会说明怎么开启完全磁盘访问权限，并可以直接打开系统设置的对应页面。
- 在访达或资源管理器中显示条目，快速预览文件（macOS）。主题跟随系统。

## 安装

需要 MiniMax Code 3.1.2 或更高版本，因为包里声明了 `agentAccess`、`agentConcurrency` 和 `surface.window`（弹出窗口的尺寸），更早的版本无法安装。

把整个目录（包括隐藏的 `.minimax-plugin/`）复制到 MiniMax Code 的插件目录，命名为 `disk-insight/`（默认是 `~/.minimax/plugins/disk-insight/`，见根目录 README 的安装说明）。重启 MiniMax Code，在右侧面板的 Mini App 入口打开「磁盘透视」，或者让 Agent「打开磁盘透视」。

在 macOS 上要扫全，需要给 MiniMax Code 开启完全磁盘访问权限（系统设置 → 隐私与安全性 → 完全磁盘访问权限）并重启。没开时，受保护的目录会列为无权限读取，占用的空间算在「未扫描或无权限」里。

## 测试环境

- macOS 27.0（Apple Silicon）上的 MiniMax Code 3.1.3-preview.4684（内部预览版）。通过宿主的发布流程安装，在右侧面板打开。
- 授予完全磁盘访问权限后，对主目录做过完整扫描：约 762 GB、约 7,300 万个文件，Mini App 进程内存峰值 561 MB。快速扫描约 0.2 秒出第一批结果。
- 代码仓库：识别出的 worktree 和 `git worktree list` 对照一致（一个仓库 58 个）。「清理失效 worktree」在真实仓库执行过一次，删了 13 条失效记录，事后用 git 复查过。
- 永久删除在真实桌面端执行过：一个 170 多天没动过的项目里的 5 个 `__pycache__` 目录。删后目录不存在，`.py` 文件还在，git 状态干净。另外有一个端到端测试：被删目录里有指向目录外的符号链接，删完后链接目标都完好。
- 问 Agent 用真实 Agent 跑过三次，最后一次用的是当前提示词格式（Data & access 里说的数据段），回答仍按三段格式。
- 无权限目录列表在授权前、授权后都看过。快速预览、在访达中显示都试过。系统文件夹选择框里取消和选中文件夹都试过，选中的文件夹会加入扫描范围。
- 深色主题：把 MiniMax Code 的外观设成深色后，在真实桌面端检查了空间地图、垃圾清理、代码仓库和清理记录弹窗。页面跟随的是 MiniMax Code 的外观设置，不是 macOS 的系统外观。
- 单元测试 53 个，全部通过（在本目录运行 `npm test`）。
- 尚未验证：Windows 上的全部功能；删除特别大的 `node_modules` 的耗时；真实 Agent 运行中出现权限请求的情况（把权限模式改成逐项询问后，Agent 只运行了只读命令，没有出现权限请求，所以权限卡片只用模拟的 Agent 测过）。

## 数据与访问

- **状态**：磁盘透视存的所有数据都在宿主提供的 `context.dataDir` 下。每个文件都先写临时文件 `.tmp`，再改名替换。
  - `scan-v4.ndjson.gz`：上一次的扫描结果（gzip 压缩的 NDJSON），包括扫描到的目录树和大小、识别出的条目、重复文件分组、代码仓库和 worktree，里面有被扫描文件和目录的路径。
  - `selection-v1.json`：已选清单（条目编号和路径）。
  - `history-v1.json`：清理记录，每个被删条目的时间、路径、释放大小和结果。
  - `stats-v1.json`：累计释放空间、清理次数、上一次清理的汇总。
  - `scope-v1.json`：上一次的扫描范围（磁盘编号和文件夹路径）。
  - `ignore-v1.json`：忽略名单（路径）。

  页面不在 `localStorage` 或其他浏览器存储里保存任何东西。
- **读取的文件**：
  - 所选范围里的全部文件和目录的元数据（`lstat`：名称、大小、时间、设备号和 inode），不读内容。不跟随符号链接和目录联接。macOS 上扫描整个磁盘时跳过 `/System/Volumes`、`/Volumes`、`/dev`、`/net`、`/home`、`/.vol`、`/.resolve`、`/.nofollow`。iCloud 云盘（`~/Library/Mobile Documents`）、`~/Library/CloudStorage` 和 OneDrive 目录完全不列，因为列目录可能触发云端下载。
  - 重复文件比对会读文件内容来算哈希：先读同样大小的文件头尾各 64 KB，对得上再读全文算 SHA-256。只比对 1 MB 及以上的文件；Git 工作区、缓存和构建产物、受保护的目录、`~/Library` 和 macOS 系统目录（macOS）、`AppData`（Windows）里的文件都跳过。
  - 范围内代码仓库的 Git 元数据：worktree 或子模块的 `.git` 文件、`<git 目录>/worktrees/*/gitdir`、`HEAD`（取分支名）、`<git 目录>/index` 的修改时间（最近活动）。`git status` 还会读工作区（见「进程」）。
  - 废纸篓（`~/.Trash`）和回收站只统计大小。
  - 清理规则里的固定位置，完整列表见 `miniapp/node/rules.mjs`（macOS）和 `miniapp/node/rules-win.mjs`（Windows）。例如 macOS 上的 `~/Library/Caches`、`~/Library/Logs`、`~/.npm`、Xcode 的 `DerivedData`、`~/Library/Containers` 和 `~/Library/Application Support` 下的聊天软件目录、`/Library/Caches`、`/private/var/log`；Windows 上的 `%TEMP%`、`%LOCALAPPDATA%` 和 `%APPDATA%` 下的缓存、`%USERPROFILE%\Documents` 下的聊天软件目录、`%SystemRoot%\SoftwareDistribution\Download`。每次扫描开始时用 `realpath` 确认这些位置是否存在，并列出规则路径里 `*` 代表的目录（例如每个聊天账号一个目录）。
  - 其他固定位置：只为判断有没有完全磁盘访问权限而列 `~/Library/Safari` 和 `~/Library/Mail`；为找数据卷和其他磁盘读 `/usr/share/firmlinks`、`/System/Volumes/Data` 和 `/Volumes`；检查主目录、桌面、下载、文稿这几个文件夹是否存在，作为扫描范围的快捷选项。
  - MiniMax Code 数据目录从 `context.dataDir` 推出来：往上找第一个名字以 `.minimax` 开头的目录，找不到就用 `~/.minimax`。这依赖未公开约定的目录布局。推出来的目录只用来加进保护名单，不读里面的任何文件。
  - 输入或选择的文件夹会先用 `realpath` 和 `stat` 检查后才接受。「问 Agent」用到的最大子项取自扫描结果；扫描结果里没有时当场列一次目录（最多 2,000 项、20,000 次 `lstat`）。
- **删除或写入 `dataDir` 以外的文件**：
  - 清理会**永久删除**你勾选并确认的条目，用 `fs.rm` 递归删除；符号链接只删链接本身，不跟随，链接指向的文件和目录不受影响。不进废纸篓或回收站，不做备份，删了不能恢复。
  - 受保护的路径不能勾选，也不会被删除：系统目录（macOS 的 `/System`、`/Library`、`/usr`、`/bin`、`/sbin`、`/private`、Safari、`/Applications/Utilities`；Windows 的 `%SystemRoot%`、`Program Files`、`Program Files (x86)`、`ProgramData`、`%APPDATA%\Microsoft`，以及每个磁盘上的 `System Volume Information`、`$Recycle.Bin`、`pagefile.sys`、`hiberfil.sys`、`swapfile.sys`）、凭据（`~/Library/Keychains`、`~/.ssh`、`~/.gnupg`）、云盘（iCloud 云盘、`~/Library/CloudStorage`、OneDrive）、废纸篓、Go 模块缓存、MiniMax Code 数据目录、本 Mini App 自己的 `dataDir`、所有 `.git` 目录本身、磁盘根目录，以及包含受保护路径的目录。主目录、`~/Library`（Windows 上是 `AppData` 及其 `Local`、`LocalLow`、`Roaming`）和标准的桌面、文稿、下载、图片、影片或视频、音乐文件夹只保护本身，里面的条目可以勾选。
  - 每一项删除前当场复查五项，任何一项不通过就跳过：路径存在；不是符号链接，设备号、inode 和修改时间都和扫描时一致；`realpath` 和扫描到的路径一致；没有被锁定；所在磁盘允许删除。
  - 外接盘和网络盘上的条目只扫描，不删除。
  - 确认框列出全部已选条目，并写明删除后不能恢复。含 Git 仓库或聊天文件的条目逐条列出并带提示，其余按来源分组。
  - 「清理失效 worktree」在你确认失效记录清单后执行 `git -C <主仓库> worktree prune`，Git 只删除 worktree 目录已经不存在的记录。
- **进程**：所有命令都用参数数组启动（`child_process.spawn` 或 `execFile`），不经过 shell，都有超时；`dispose` 时结束还在运行的进程。命令行里只有固定文本和取自扫描结果的路径（页面传的是条目编号，不是路径）。

  | 命令 | 平台 | 时机和用途 |
  | --- | --- | --- |
  | `/bin/df -k <卷>` | macOS | 列磁盘：读每个卷的已用和可用空间。 |
  | `/sbin/mount` | macOS | 列磁盘，`/Volumes` 下有其他卷时：区分外接盘和网络盘。 |
  | `/bin/ps -axco comm` | macOS | 扫描结束后：给正在运行的应用的缓存加上「可能被占用」标签。 |
  | `tasklist.exe /fo csv /nh` | Windows | 同 `ps`。 |
  | `powershell.exe -NoProfile -NonInteractive -Command "Get-CimInstance Win32_LogicalDisk \| Select-Object DeviceID,DriveType,Size,FreeSpace,VolumeName \| ConvertTo-Json -Compress"` | Windows | 列磁盘。 |
  | `go env GOMODCACHE` | 两者 | 页面第一次加载时运行一次：找到 Go 模块缓存并加进保护名单。依次尝试 `PATH` 里的 `go`、`/usr/local/go/bin/go`、`/opt/homebrew/bin/go`、`/usr/local/bin/go`（Windows 是 `go.exe`、`C:\Program Files\Go\bin\go.exe`），设置 `GOTOOLCHAIN=local` 避免下载工具链，在 `dataDir` 里执行。找不到时用 `$GOPATH/pkg/mod`，再不行用 `~/go/pkg/mod`。 |
  | `/usr/bin/xcode-select -p` | macOS | 使用 `/usr/bin/git` 之前：确认装了命令行工具，避免系统弹出安装提示。git 按 `PATH`、`/opt/homebrew/bin`、`/usr/local/bin`、`/usr/bin` 的顺序查找（Windows 用 `PATH` 里的 `git`）。 |
  | `git -C <worktree> status --porcelain=v1 --branch` | 两者 | 代码仓库视图里点「检查状态」时，以及勾选 worktree 之前：检查有没有未提交的改动和未推送的提交。带 `GIT_OPTIONAL_LOCKS=0`、`GIT_TERMINAL_PROMPT=0`，同时最多 4 个。 |
  | `git -C <主仓库> worktree prune` | 两者 | 你确认「清理失效 worktree」后：删除失效的 worktree 记录。 |
  | `/usr/bin/open -R <路径>` | macOS | 「在访达中显示」。 |
  | `/usr/bin/open x-apple.systempreferences:com.apple.settings.Storage` | macOS | 系统垃圾分类上的「打开存储设置」。 |
  | `/usr/bin/open x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles` | macOS | 打开完全磁盘访问权限设置页。 |
  | `/usr/bin/osascript -e 'POSIX path of (choose folder with prompt "选择要扫描的文件夹")'` | macOS | 文件夹选择框，脚本固定。 |
  | `/usr/bin/qlmanage -p <文件>` | macOS | 快速预览，最多开 10 分钟。 |
  | `powershell.exe -STA -NoProfile -Command <脚本>` | Windows | 文件夹选择框。脚本是固定的 `FolderBrowserDialog` 脚本，选中的路径用 base64 传回。 |
  | `explorer.exe /select,"<路径>"` | Windows | 在资源管理器中显示，路径作为一个原样参数传入。 |
  | `explorer.exe ms-settings:storagesense` | Windows | 打开存储设置。只作为系统操作接口存在，页面目前没有入口。 |
  | `cleanmgr.exe` | Windows | 系统垃圾分类上的「打开磁盘清理」。 |
- **网络**：无。Node 进程只在 `context.listen` 上提供页面，页面只请求自己的相对路径接口。
- **Agent 运行**（`agentAccess: ["session.run"]`，`agentConcurrency: 2`）：每次「问 Agent」由页面发起一次 Agent 运行，每次都是新会话。提示词里有条目的路径、操作系统、大小和可释放大小、最后修改时间、扫描分类和删了会怎样、标签（含 git 仓库、聊天软件文件、可能被正在运行的程序占用），以及最多 10 个最大的子项和大小。从磁盘读到的路径和名称不可信：它们放在 `<<<条目信息` 和 `条目信息>>>` 两个标记之间，提示词标明这一段只是数据；每个路径和名称都写成转义过的 JSON 字符串，文件名没法多出一行或伪造结束标记；并告诉 Agent 不要照其中的任何指令做。提示词要求 Agent 只做分析：不删除、移动、修改任何文件，也不运行会改动文件的命令（确实需要时可以用只读命令查看目录结构）；按「这是什么、删了会怎样、建议和理由」三段回答；判断不了就说不确定；用与请求相同的语言回答，不超过 300 字。Agent 保留正常的能力（文件、Shell、MCP），所以这只是要求，不是沙箱。磁盘透视不会根据回答做任何操作。
- **权限**：问 Agent 过程中的每个权限请求都以卡片显示，有「允许一次」和「拒绝」两个按钮。磁盘透视从不自己回复请求：按钮只把你对这一个请求的点击转给宿主，你不点就一直等着。Agent 提问时会提示你点「在对话中打开」，在聊天侧栏里打开这个会话继续。「停止」会取消这次运行。
- Agent 的回答按安全的 Markdown 子集渲染：先整段做 HTML 转义，再把标题、列表、引用、代码、粗体和斜体换成固定标签；链接只显示文字和网址，不能点击。

## 文件

```text
.minimax-plugin/plugin.json   插件清单
package.json                  Mini App 声明和 npm test 脚本
miniapp/miniapp.json          运行时目录、Node 入口、页面路由、弹出窗口尺寸、agentAccess
miniapp/client/               页面（index.html、assets/app.js、assets/app.css）
miniapp/node/server.mjs       Node 入口：启动 HTTP 服务，返回 dispose
miniapp/node/routes.mjs       HTTP 路由；http.mjs 提供页面和服务端推送
miniapp/node/app*.mjs         状态，以及扫描、清理、代码仓库、已选清单等操作
miniapp/node/scan-engine.mjs  扫描阶段（快速、完整、重复文件）；scanner.mjs 遍历目录
miniapp/node/rules*.mjs       清理分类和固定位置（macOS、Windows）
miniapp/node/protect.mjs      保护名单和锁定原因
miniapp/node/cleaner.mjs      删除前复查和永久删除
miniapp/node/repos.mjs        代码仓库和 worktree 识别
miniapp/node/platform.mjs     磁盘、完全磁盘访问、正在运行的应用、选择框、系统设置
miniapp/node/exec.mjs         子进程：参数数组、超时、dispose 时清理
miniapp/node/prompt.mjs       「问 Agent」的提示词
miniapp/node/store.mjs        dataDir 里的状态文件
miniapp/node/*.ts             运行时 API 的类型声明，运行时不加载
tests/                        单元测试（node --test），夹具放在临时目录
docs/                         README 截图
icon.png                      插件图标
```

在本目录运行 `npm test` 跑测试。夹具在 macOS 上建在 `~/Library/Caches/disk-insight-test`，其他系统建在系统临时目录；设置 `DISK_INSIGHT_TEST_TMP` 可以换到别的目录。

## 许可

[MIT](./LICENSE)。
