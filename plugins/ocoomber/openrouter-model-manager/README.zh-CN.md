# 模型管理器（`openrouter-model-manager`）

[English](README.md) | 简体中文

一个 [MiniMax Code](https://github.com/MiniMax-AI) Mini App，用于浏览、搜索并启用/停用 MiniMax Code `config.yaml` 中的模型 —— 不用再在记事本里查找替换了。

作者：[ocoomber](https://github.com/ocoomber) · 版本：`1.2.4`

> 插件 ID `openrouter-model-manager` 为保持稳定而保留，但本应用**并非** OpenRouter 专用 —— 支持任意提供商（见"功能"）。

## 功能

- **支持任意提供商** —— OpenRouter、自定义提供商，以及本地服务（Ollama、LM Studio）。自动读取配置中的所有模型块 —— 全部模型合并为一个列表，按模型家族分组，无需任何切换操作。
- **重启提醒** —— 一旦有任何改动，页面会出现醒目的横幅，提醒你需要重启 MiniMax Code（Mini App 无法代替你重启宿主程序）。
- **搜索** —— 同时匹配模型 ID 和显示名称。
- **即时保存** —— 每次切换立即写入配置，没有保存按钮。
- **筛选** —— 全部 / 仅启用 / 仅停用。
- **批量操作** —— "启用匹配项 / 停用匹配项"只作用于当前搜索结果；每个模型家族也有自己的启用/停用按钮。
- **一步撤销** —— 批量开启后后悔了？点一下即可恢复上一个配置。若期间配置在应用之外被修改过，撤销会拒绝执行，而不会覆盖你的改动。跨提供商的批量操作会作为一个整体被撤销，不会出现"只回滚最后一个提供商"的情况。
- **自动备份** —— 每次批量改动前，都会在 Mini App 自己的数据目录下的 `backups/` 里保存一份带时间戳的副本（遵循 Mini App 运行时"将持久状态存放到注入的 dataDir"的原则），最多保留最新 20 份。
- **可折叠的模型家族** —— 模型按 ID 中 `/` 之前的前缀分组；家族内有已启用的模型时，折叠状态会显示绿点。
- **OpenRouter 链接** —— 每个模型行可跳转到 OpenRouter 页面（仅 OpenRouter 提供商显示）。右键链接可选择外部浏览器、内置浏览器或复制网址。
- **上下文长度徽标** —— 直接读取自你的配置。

## 测试环境

- **Windows 11**（build 10.0.26200）、**MiniMax Code 3.0.73**、插件 `1.2.4` —— 作者已完成端到端实测（切换、批量操作、撤销、重启生效流程）。
- **macOS / Linux** 走相同代码路径，但**未经作者实测** —— 欢迎反馈问题。

## 安装

将本目录完整复制（或克隆）到 MiniMax Code 的插件目录：

```
~/.minimax/plugins/openrouter-model-manager/
```

保留 `.minimax-plugin` 隐藏目录。重启 MiniMax Code，确认插件已被识别，然后打开"模型管理器"，或在对话中说"打开模型管理器"。

> 注意：切换模型之后，需要重启 MiniMax Code 本体才能生效 —— 配置是在启动时读取的。

## 工作原理

Node 运行时逐行读取 `config.yaml`（不依赖 YAML 库），找出所有带 `enabled:` 开关的 `models:` 块。切换某个模型时只改写该模型的 `enabled:` 一行。所有写入都是原子性的（先在你的配置文件旁边写临时文件 `.config.yaml.mm-tmp` 再重命名，失败时会删除临时文件），完整保留你文件原有的缩进和换行符，并且并发修改会被串行化，多次快速点击不会互相覆盖。模型 ID 解析兼容 `llama3.1:latest`、`:free` 这类带冒号的写法。

视觉支持等模型能力刻意不从外部 API 获取 —— 配置文件是唯一数据来源。

## 隐私与数据安全

- 界面永远接触不到你的密钥：服务端只返回模型的 **id / name / enabled / contextLimit**。配置中的 API Key 不会被读入界面、不会通过 API 返回、也不会显示。
- 应用自身**不发起任何网络请求**。
- **进程启动（主动披露）**：唯一涉及操作系统层面的动作，是用你自己的浏览器打开 OpenRouter 模型页面 —— Windows 上通过 `rundll32`/`cmd`/`explorer`，macOS 上 `open`，Linux 上 `xdg-open`。仅接受 `https://openrouter.ai/...` 格式的网址，其余一律被服务端拒绝。
- 配置位置：运行时从被注入的数据目录向上逐级查找 `config.yaml`（Host 给每个 Mini App 注入的是一个位于数据根目录下方若干层的、由插件自有的子目录，MiniMax Code 的配置在当前 Host 布局下位于数据根目录或其某个上层目录里）。若沿这条路径没找到，则回退到默认的 `~/.minimax/config.yaml`。向上查找对应的是当前 Host 的实现细节，不是保证稳定的 API，所以默认回退才是保护非默认安装的关键。

## 文件结构

```
.minimax-plugin/plugin.json   插件清单
package.json                  Mini App 引导文件
miniapp/miniapp.json          Mini App 界面/运行时配置
miniapp/client/index.html     界面（自动适配亮/暗色）
miniapp/node/server.mjs       Node 运行时 + REST API
miniapp/node/miniapp-api.ts   运行时 API 类型声明
icon.png                      插件图标
tests/api-set.test.mjs
tests/parser.test.mjs
tests/resolveConfigPath.test.mjs
```

`tests/` 目录位于 Host 运行时负载根目录（`miniapp/client`、`miniapp/node`）之外，因此应用本身不会加载它 —— 你如果整体复制插件目录就会带上它。在插件根目录执行 `node --test` 即可运行。

## 许可证

[MIT](./LICENSE)
