# MiniMax Code MiniApps

[English](README.md) | 简体中文

**MiniMax Code 桌面端 MiniApp 官方社区仓库**。发现实用工具、有趣的小应用，也可以在这些作品的基础上制作自己的 MiniApp。

[浏览作品](#miniapps) · [开始使用](#开始使用) · [贡献作品](CONTRIBUTING.zh-CN.md) · [反馈问题](https://github.com/MiniMax-AI/MiniMax-Code-MiniApps/issues)

## 关于本仓库

本仓库面向开源社区开放：任何开发者都可以通过 Pull Request 贡献自己的 MiniApp 插件。MiniApp 是以 MiniMax Plugin 形式承载的交互式应用。本仓库收录开发者贡献的完整插件包，每个作品都包含独立使用所需的文件、源码和说明。

作品按作者存放在 `plugins/<github-username>/<plugin-id>/` 下。你可以下载后手动安装到 MiniMax Code，也可以参考源码开发自己的作品。

## MiniApps

| MiniApp | 功能 | 作者 |
| --- | --- | --- |
| [Token 用量看板](plugins/amszuidas/mcode-token-usage-board/README.zh-CN.md) | 按时间、模型和会话查看本机 Token 用量，包含输入、输出和缓存用量 | [amszuidas](https://github.com/amszuidas) |
| [Token 用量看板](plugins/yanhy2000/mcode-usage-monitor/README.zh-CN.md) | 近实时查看本机 Token 用量、输出速度与缓存命中率，可按时间范围、模型和会话筛选 | [yanhy2000](https://github.com/yanhy2000) |
| [模型管理器](plugins/ocoomber/openrouter-model-manager/README.zh-CN.md) | 浏览、搜索并启用/停用 `~/.minimax/config.yaml` 中的模型，支持即时保存、批量操作、一键撤销和自动备份 | [ocoomber](https://github.com/ocoomber) |
| [自驾规划](plugins/hanzijie/self-drive-route-planner/README.zh-CN.md) | 【官方插件】规划自驾路线、地点搜索、候选算路与小红书 3:4 行程图；支持演示模式 | [HanZijie](https://github.com/HanZijie) |

<details>
<summary>预览：Token 用量看板</summary>

![Token 用量看板，使用合成数据展示用量趋势](plugins/amszuidas/mcode-token-usage-board/docs/preview.png)

预览使用合成数据，应用界面目前为中文。数据访问范围、统计口径和兼容性说明见作品 [README](plugins/amszuidas/mcode-token-usage-board/README.zh-CN.md)。

</details>

<details>
<summary>预览：Token 用量看板（mcode-usage-monitor）</summary>

![Token 用量看板，使用合成数据展示用量趋势](plugins/yanhy2000/mcode-usage-monitor/docs/preview.png)

预览使用合成数据，应用界面目前为中文。数据访问范围、统计口径和兼容性说明见作品 [README](plugins/yanhy2000/mcode-usage-monitor/README.zh-CN.md)。

</details>

## 开始使用

### 使用要求

需要支持 MiniApp 的 MiniMax Code 桌面端版本。各作品的 README 会说明已验证的客户端版本、操作系统、所需配置和已知限制，兼容性以具体作品为准。

### 1. 下载

点击仓库页面的 **Code → Download ZIP** 并解压，或 clone 仓库：

```sh
git clone https://github.com/MiniMax-AI/MiniMax-Code-MiniApps.git
```

在 `plugins/<github-username>/` 下找到想用的作品，阅读其 README，了解它会访问哪些本地文件或网络服务。

### 2. 安装

将**完整插件目录**复制到 `<dataDir>/plugins/`，保留 `.minimax-plugin` 隐藏目录。

`<dataDir>` 默认为用户主目录下的 `.minimax`，即 `~/.minimax`，因此默认安装目录为 `~/.minimax/plugins/`。如果你配置了其他数据目录，请使用实际配置的路径。

以 Token 用量看板为例：

```text
仓库中：plugins/amszuidas/mcode-token-usage-board/
安装到：<dataDir>/plugins/mcode-token-usage-board/
```

安装后的插件清单应位于：

```text
<dataDir>/plugins/mcode-token-usage-board/.minimax-plugin/plugin.json
```

作者目录（`amszuidas/`）只用于仓库归类。复制到客户端时，将插件目录直接放入 `plugins/`，不要多套一层作者目录。

这些插件包采用**手动安装**方式，客户端的 GitHub 插件导入功能目前不支持这类 MiniApp 包。

### 3. 打开

重新启动 MiniMax Code，确认插件已被识别并启用，再按作品 README 打开 MiniApp。例如，你可以请 Agent 打开“Token 用量看板”。

更新时先关闭 MiniApp 并退出客户端，再替换完整插件目录。备份放在 `plugins/` 之外，数据保留方式按作品说明处理。卸载时同样先关闭应用并退出客户端，再移除对应插件目录；单独保存的应用数据可能仍会保留。

## 贡献作品

欢迎分享工具、游戏、可视化应用和小实验。提交作品只需：

1. Fork 仓库，把 `examples/hello-miniapp/` 复制到 `plugins/<你的-github-username>/<plugin-id>/`，在此基础上开发。插件包规则见 [`docs/`](docs/package-contract.md)（英文）；AI 编码助手会自动读取 [`AGENTS.md`](AGENTS.md)。
2. 附上 README、许可证和运行所需文件，说明配置方式、数据访问范围与验证情况。
3. 在根目录的中英文 README 作品表格中增加一行，运行 `npm run check`，然后提交 Pull Request。

作者目录使用小写 GitHub username。插件目录名必须与 `.minimax-plugin/plugin.json` 中的 `name` 一致，且**插件 ID 在整个仓库中唯一**，因为安装路径不包含作者目录。

完整说明见[贡献指南](CONTRIBUTING.zh-CN.md)。

## 问题与建议

欢迎通过 [GitHub Issues](https://github.com/MiniMax-AI/MiniMax-Code-MiniApps/issues) 反馈问题、分享作品想法或提出改进建议。反馈插件问题时，请提供插件 ID 和版本、MiniMax Code 版本、操作系统、复现步骤，以及预期和实际结果。日志和截图请移除凭据及私人会话内容。

如果你希望 MiniApp 获得目前还不具备的运行时能力（例如新的 `context` API 或窗口行为），请直接在置顶的[能力愿望单](https://github.com/MiniMax-AI/MiniMax-Code-MiniApps/issues/9)下评论，不必另开 issue。

## 许可证

本仓库采用 [MIT License](LICENSE)。各 MiniApp 以其目录中附带的许可证为准。
