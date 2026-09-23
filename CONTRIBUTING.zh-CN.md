# 贡献 MiniApp

[English](CONTRIBUTING.md) | 简体中文

欢迎分享你为 MiniMax Code 制作的小工具、游戏和其他有趣作品。

1. Fork 本仓库，在 `plugins/<你的 GitHub username>/<plugin-id>/` 下放入完整插件包。用户名目录统一使用小写。
2. 从 `examples/hello-miniapp/` 复制开始。保留 `.minimax-plugin/` 隐藏目录、`package.json`、`miniapp/` 和运行所需资源。插件应能独立复制使用，不依赖仓库里的其他目录。具体规则见 `docs/package-contract.md`、`docs/runtime.md` 和 `docs/security.md`（英文）。
3. 添加简短的英文 `README.md`，可另附 `README.zh-CN.md` 并互相链接。说明用途、安装与使用方式、已验证的客户端版本和系统，以及需要的配置、文件访问或网络请求。欢迎附上截图或 GIF。
4. 添加你有权使用的 `LICENSE`，保留第三方代码和素材要求的署名。
5. 在根目录中英文 README 的作品表格中各增加一行，运行 `npm run check`（需要 Node.js 22 或更高版本）直到没有 error，再提交 Pull Request。

插件目录名应与 `.minimax-plugin/plugin.json` 的 `name` 一致。**插件 ID 在整个仓库中唯一**，因为安装到客户端时不保留作者目录。重名时可加上作者前缀。

提交可直接运行的文件；如果需要构建，附上源码和构建说明。不要提交 `node_modules/`、密钥、真实会话记录、个人数据或运行缓存。截图和示例请使用合成数据或充分脱敏的数据。

提交前在 MiniMax Code 中手动安装、打开并检查主要功能，在 PR 中写明测试环境和结果；未验证的部分如实说明。更新已有作品时，保留插件 ID，并按改动更新版本与使用说明。

使用 AI 编码助手时，它会自动读取 `AGENTS.md`；`docs/` 里是同一套规则的人类可读版本。
