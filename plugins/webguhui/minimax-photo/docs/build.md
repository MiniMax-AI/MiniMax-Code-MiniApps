# 构建 MiniMax Photo

仓库提交的 `miniapp/client`、`miniapp/node` 已可运行。下面的命令仅供修改源码后重建，不是安装步骤。旧工程格式标识 `retouch-lab` 为内部兼容名称，不是插件 ID。

## 前端与 PTC

在本插件目录运行，需要 Node.js 22+ 和 npm：

```sh
npm ci --prefix ui-src
node ui-src/build.mjs
npm ci --prefix ptc-src
node ptc-src/build.mjs
node scripts/check.mjs
node scripts/check-ptc.mjs
node scripts/check-recovery.mjs
```

React / shadcn 界面源码在 `ui-src/`。输出 `workbench-ui.js` 和 `components.css`。QuickJS 工作线程源码在 `ptc-src/worker.mjs`；构建同时复制对应版本的 WASM。依赖锁文件随源码提供，`node_modules` 不提交。

## PhotoCraft 编辑器

上游：[storytold/photocraft](https://github.com/storytold/photocraft)，固定提交 `5f65579ecb44047c2a619036c18ff273202e1389`。修改源码完整保存在 `photocraft/miniapp.patch`，包括浏览器编辑桥接、欢迎页和标题调整，以及该提交的 `Persisted.export_presets` 初始化修正。第三方来源和许可证位于 `../licenses/`。

需要 Rust、`wasm32-unknown-unknown` target、`wasm-bindgen-cli 0.2.129`。把下面两个路径替换为插件与独立构建目录的绝对路径：

```sh
export PHOTO_PACKAGE=/absolute/path/to/minimax-photo
git clone https://github.com/storytold/photocraft.git /absolute/path/to/photocraft-build
cd /absolute/path/to/photocraft-build
git checkout 5f65579ecb44047c2a619036c18ff273202e1389
git apply "$PHOTO_PACKAGE/docs/photocraft/miniapp.patch"
rustup target add wasm32-unknown-unknown
cargo build --locked -p photocraft-web --target wasm32-unknown-unknown --profile wasm-release
wasm-bindgen target/wasm32-unknown-unknown/wasm-release/photocraft-web.wasm --target web --out-name photocraft --out-dir "$PHOTO_PACKAGE/miniapp/client/photocraft"
gzip -n -9 -f "$PHOTO_PACKAGE/miniapp/client/photocraft/photocraft_bg.wasm"
```

服务端以 `Content-Encoding: gzip` 提供压缩 WASM，避免超过社区单文件 16 MiB 限制。不要把未压缩 WASM 一起提交。无需 Electron、Trunk 或模型权重。此构建未开启 HEIF feature。

`frame.js`、`frame.css` 和 `index.html` 是本包维护的页面适配文件，不由 wasm-bindgen 生成。iframe 使用同源资源以支持宿主的本机认证，通过固定方法集合、来源窗口检查和请求标识传递编辑操作；不要将其当作不可信代码的安全隔离边界。PTC 则在单独 QuickJS VM 中执行。

`cjk-ui.otf` 是 Noto Sans CJK JP Regular 的 UI 字符子集（SIL OFL 1.1），原字体来自 [noto-cjk](https://github.com/notofonts/noto-cjk)。该文件作为可分发字体资源直接提交；新增 UI 字符时需要用 fonttools `pyftsubset` 重新生成，保留三份 CJK 翻译目录使用的字符、假名和标点。它不是完整的中文排版字体，作品的特殊字形需另行导入对应字体。

## 本地预览与打包

```sh
node scripts/preview.mjs
python3 scripts/package-preview.py
```

预览端口可用 `RETOUCH_PREVIEW_PORT` 设置，预览数据根目录可用 `RETOUCH_DATA_DIR` 设置。普通浏览器没有宿主 Agent API，不会伪造 AI 回复。打包脚本生成运行 ZIP 和独立开发资料 ZIP；生成物不提交仓库。运行包不包含 npm 依赖目录、测试记录或原始重复图片。

生成后，在社区仓库根目录运行 `npm run check`，再按官方说明在 MiniMax Code 中手动安装。不能用构建通过代替真实宿主 AI 验收。

0.2.15 新增只读 `viewport` 桥接，用编辑器坐标映射显示 AI 操作轨迹。修改引擎后需重新编译 WASM，并同步 `docs/photocraft/miniapp.patch`。轨迹检查：`node scripts/check-activity.mjs`。

逐笔显示验证：`node scripts/check-draw.mjs`。`miniapp/client/photocraft/draw.js` 顺序提交真实笔触并让出渲染时间；不修改原有原子批量命令。

## 示例图压缩

0.2.27 的三张示例图保留 1122×1402 尺寸，使用 WebP 有损编码 quality=90、method=6，总大小由 4,294,712 降为 535,320 字节。它们是教学示例，不是无损原片。后续更换素材请从原始图片重新编码，避免反复压缩已压缩的 WebP；检查人像纹理、海报文字及商品渐变，再检查解码尺寸。
