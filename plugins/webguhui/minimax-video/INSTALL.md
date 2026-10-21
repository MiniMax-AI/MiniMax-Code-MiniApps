# MiniMax Video 安装与下载源

从社区仓库复制完整的 `plugins/webguhui/minimax-video/` 目录。应用主体共用一个包，首次打开自动识别系统和芯片，再安装对应的媒体处理组件，不需要用户安装 Node、npm、FFmpeg 或编译工具。

首次打开选择“中国大陆下载源”或“海外下载源”。宿主暂未提供区域字段，因此不根据语言、时区猜测用户位置。选择会保存在应用数据目录；后续启动复用已验证缓存，不重复下载。下载失败时可切换来源重试，不会自动把国内请求转到海外。

国内：npm 包使用 registry.npmmirror.com，FFmpeg 使用其 binary 镜像。海外：registry.npmjs.org 与 FFmpeg 官方 GitHub release。两种来源使用同一固定版本和官方摘要清单，校验失败不得安装。安装只解压文件，不运行 npm 生命周期脚本，不修改 PATH 或全局依赖。

平台清单包含 macOS arm64、macOS x64、Windows x64、Linux x64/arm64（glibc）。Windows ARM64 原生进程和 Linux musl 暂不支持，会明确提示。平台识别依据宿主运行进程的架构。当前实测机器只有 macOS Apple Silicon，其他系统尚待实机验收。

核心版本：Remotion compositor 4.0.509、sqlite-vec 0.1.9、FFmpeg/FFprobe 发布资产 b6.1.1（各平台二进制的版本输出以发行资产为准）。清单：`miniapp/node/native-dependencies.json`。npm 包使用发布 metadata 的 sha512 integrity；FFmpeg 文件使用 GitHub release asset 的 SHA-256。更新版本必须重新核对官方摘要，不能用镜像下载结果自行生成新的可信摘要。

Mini App 的字幕识别使用浏览器实现；未使用的 whisper-cli 原生程序不再随包携带。语音模型下载与其他已有在线服务不属于本次核心依赖安装改动，不应宣称这些功能全部具备国内镜像。

## 维护与打包

源码、固定上游版本和重建命令见 `source/README.md`。安装用户无需构建。

在应用根目录运行 `node scripts/verify-installer.mjs` 验证下载源、摘要拒绝、不支持平台和取消安装。完整验证还需在干净数据目录实际下载并启动，导出媒体，然后断网重启验证缓存。

依赖保存在 `<dataDir>/dependencies/<platform>-<manifest-hash>`，运行文件展开到 `<dataDir>/runtime/<buildId>`；这两个目录为可重建缓存，工程和素材在其他目录。不要为了重新安装删除整个 dataDir。首次准备过程中关闭应用会取消下载，未完成的临时目录会清理。

## 可选资源按需下载

艺术字体、内置音效、语音试听，以及随编辑器提供的浏览器 AI 模型与 WASM，改为首次使用时下载。默认 Noto Sans SC 字体继续随包提供。资源来自开平国内 `filecdn.minimax.chat` 或开平海外 `file.cdn.minimax.io`；在“设置与关于 → 资源下载”中可随时切换，沿用首次安装时的区域选择。

原工程中的 `/fonts/`、`/sound-effects/` 等地址不变。应用在本地代理下载并校验压缩文件和解压后文件，缓存到 `<dataDir>/resources/<manifest-hash>`；导出前补齐工程引用的字体与素材，渲染器使用相同资源。下载失败会阻止对应操作并显示错误，修复网络或切换源后重新执行即可。不要删除工程数据来重试。已下载资源可离线复用，未下载资源首次仍需联网。宿主大模型、在线生成和第三方可选模型服务不因此变为离线功能。

维护资源时，先运行 `node scripts/prepare-resources.mjs <完整 client 目录> <临时上传目录>`，通过上传页面分别上传到开平国内和海外。将页面真实返回的 URL 写入 `miniapp/node/resource-manifest.json`，逐项下载核对 SHA-256；禁止猜测 CDN 地址。打包末尾自动剥离清单资源；任何文件内容变化、缺少区域 URL 都会使打包失败，必须重新上传。字体和模型许可证继续保留在包内。

## AI 草稿与多个会话

草稿属于当前工程，不绑定某条 MCP 连接。重新连接或另一会话继续处理时，先列出并读取现有草稿，再继续修改。

读取草稿会返回已有操作摘要，以及草稿创建后正式工程发生的变化。另一会话修改过草稿时，旧会话必须重新读取；同时写入会被暂时拒绝。正式工程版本改变后仍保留原有冲突检查，不自动覆盖或声称已合并。用户确认前，草稿不会写入正式工程。

## 精简包

服务端 JavaScript 依赖编译合并，删除调试映射与类型声明；保留许可证及第三方声明。原生组件和可选资源仍按需下载，不提高宿主原有包上限。构建后必须使用宿主包校验，并实际启动、导出，不能仅根据压缩包大小判断可用性。
