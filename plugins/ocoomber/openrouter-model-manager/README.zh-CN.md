# 模型管理器（`openrouter-model-manager`）

[English](README.md) | 简体中文

一个 [MiniMax Code](https://github.com/MiniMax-AI) Mini App，用于浏览、搜索并启用/停用 `~/.minimax/config.yaml` 中的模型 —— 不用再在记事本里查找替换了。

作者：[ocoomber](https://github.com/ocoomber) · 版本：`1.2.1`

## 功能

- **支持任意提供商** —— OpenRouter、自定义提供商，以及本地服务（Ollama、LM Studio）。配置里有多个提供商时会出现下拉框用于切换；只有一个时自动隐藏，不占地方。
- **重启提醒** —— 一旦有任何改动，页面会出现醒目的横幅，提醒你需要重启 MiniMax Code（Mini App 无法代替你重启宿主程序）。
- **搜索** —— 同时匹配模型 ID 和显示名称。
- **即时保存** —— 每次切换立即写入配置，没有保存按钮。
- **筛选** —— 全部 / 仅启用 / 仅停用。
- **批量操作** —— "启用匹配项 / 停用匹配项"只作用于当前搜索结果；每个模型家族也有自己的启用/停用按钮。
- **一步撤销** —— 批量开启后后悔了？点一下即可恢复上一个配置。
- **自动备份** —— 每次批量改动前，都会在插件数据目录的 `backups/` 里保存一份带时间戳的配置副本。
- **可折叠的模型家族** —— 模型按 ID 中 `/` 之前的前缀分组；家族内有已启用的模型时，折叠状态会显示绿点。
- **OpenRouter 链接** —— 每个模型行可跳转到 OpenRouter 页面（仅 OpenRouter 提供商显示）。右键链接可选择外部浏览器、内置浏览器或复制网址。
- **上下文长度徽标** —— 直接读取自你的配置。

## 安装

将本目录完整复制（或克隆）到 MiniMax Code 的插件目录：

```
~/.minimax/plugins/openrouter-model-manager/
```

保留 `.minimax-plugin` 隐藏目录。重启 MiniMax Code，确认插件已被识别，然后打开"模型管理器"，或在对话中说"打开模型管理器"。

> 注意：切换模型之后，需要重启 MiniMax Code 本体才能生效 —— 配置是在启动时读取的。

## 工作原理

Node 运行时逐行读取 `~/.minimax/config.yaml`（不依赖 YAML 库），找出所有带 `enabled:` 开关的 `models:` 块。切换某个模型时只改写该模型的 `enabled:` 一行。所有写入都是原子性的（先写临时文件再重命名），并完整保留你文件原有的缩进和换行符。模型 ID 解析兼容 `llama3.1:latest`、`:free` 这类带冒号的写法。

视觉支持等模型能力刻意不从外部 API 获取 —— 配置文件是唯一数据来源。

## 隐私

应用只读写你的 `~/.minimax/config.yaml`（备份保存在插件自己的数据目录）。不发起任何网络请求，也不会显示 API Key —— 密钥在界面中始终隐藏。

## 文件结构

```
.minimax-plugin/plugin.json   插件清单
package.json                  Mini App 引导文件
miniapp/miniapp.json          Mini App 界面/运行时配置
miniapp/client/index.html     界面（自动适配亮/暗色）
miniapp/node/server.mjs       Node 运行时 + REST API
miniapp/node/miniapp-api.ts   运行时 API 类型声明
icon.png                      插件图标
```

## 许可证

[MIT](./LICENSE)
