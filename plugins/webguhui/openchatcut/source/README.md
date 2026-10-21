# MiniMax Video 构建源码

MiniMax Video 基于 [OpenChatCut](https://github.com/0xsline/OpenChatCut) v0.2.16，固定提交 `2e6f4a29b784200cfb32b859b16f2561592bc3e8`，遵循 AGPL-3.0-or-later。上游完整源码由该提交提供；`upstream.patch` 是已跟踪文件的全部修改，`overlay/` 是新增源码，`adapter/` 是 Mini App 构建与验证脚本。运行入口和安装脚本以 `plugins/webguhui/openchatcut/miniapp/node/` 为源文件。对应许可证位于插件的 `LICENSE`。

构建源码位于插件包内的 `source/` 目录，可安装运行时位于 `../miniapp/`。插件可以直接复制安装，不需要用户编译。

## 重建

需要 Git、Node.js 24 和 npm。以下命令从仓库根目录执行；目标目录必须不存在。安装依赖和生成渲染资源会访问公共 npm、GitHub 和上游模型资源服务。

```sh
node plugins/webguhui/openchatcut/source/prepare-source.mjs ../openvideo-build
cd ../openvideo-build/upstream
npm ci
npm run sync:mediapipe
npx tsx desktop/prebuild-remotion.mts
npx vite build --config config/vite.miniapp.config.ts
node scripts/build-miniapp.mjs ../release
```

将构建目录根部的 `README.md`、`README.zh-CN.md` 和 `LICENSE` 复制到 `release/`，再在社区仓库运行 `node scripts/validate.mjs <release目录绝对路径>`。生成的 buildId 包含时间戳，不要求产物字节完全相同。字体、音效、AI 浏览器组件的清单与公开 CDN 地址位于 `resource-manifest.json`，下载会验证 SHA-256；更换资源必须同步清单与发布源，不能仅修改 URL。

## 验证

社区检查：在本仓库根目录执行 `npm run check`。

运行验证：准备源码后，在构建目录执行 `node verify-runtime.mjs ./release`。该程序启动隔离数据目录并检查服务与依赖恢复；首次运行可能下载当前平台所需的工具。它不能替代 MiniMax Code 内的真实 Agent、权限确认和视频导出测试。

已执行的原生测试与未覆盖平台见插件 README；不发布本机项目、用户对话、私有日志和凭据。
