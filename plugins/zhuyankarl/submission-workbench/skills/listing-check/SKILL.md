---
name: listing-check
description: 按官方《插件开发与上架指南》逐项核对 MiniMax Plugin 的清单与上架材料，定位缺失项、字段冲突与包体问题，并产出可审核的上架材料包。
---

# 插件上架材料自检

目标：在提交到官方市场之前，把能在本地查出来的问题全部查出来，并留下一份可复核的结论。

官方指南：<https://code.minimax.cn/docs/code/agents/plugin-submission.md>

## 什么时候用

- 用户说「检查我的插件清单能不能上架」「上架材料还缺哪些必填项」「生成插件上架材料包」。
- 准备提交新 Plugin，或更新已上架的 Plugin。

## 流程

1. **拿到清单全文**：让用户粘贴 `.minimax-plugin/plugin.json` 的完整内容，不要用片段或摘要代替。
   文件必须是 UTF-8 且不带 BOM；JSON 必须是对象且不能有重复 key。
2. **打开「插件上架材料工作台」**（本插件的 Mini App，页面地址 `/dashboard`），把清单粘进「插件清单」，
   依次填：期望市场名称、目标分类、简介、说明文档、最多 3 条示例 query、目标区域（CN/US）、
   启用端（桌面端/云端）、提交邮箱、提交飞书账号、组织/团队。
   区域与启用端是两个独立维度，不写进 `plugin.json`。
3. **上传素材**：图标（路径必须和清单里的 `icon` 一致）、至少一张截图、以及清单引用的
   Skill/MCP/App 文件。
4. **点「运行检查」**，逐条处理结果：
   - **缺失项**（error）：必填但没填的字段，必须补齐。
   - **内容冲突**（error/hint）：简介与清单 `description`、市场名称与 `displayName` 这类不一致。
   - **提示**（warning）：清单与说明文档对不上，比如说明文档里没提到插件名。
5. **点「生成上架材料包」**，下载 ZIP。ZIP 根目录直接含 `.minimax-plugin/plugin.json`，
   `listing-materials/` 下是自检报告与市场卡片预览。
6. **把自检报告和结论一起给用户**，并明确说明：材料包只是可审核材料，**不代表已提交或已上架**。

## 必须自己记住的硬性规则

- **至少一种能力**：`apps` / `mcpServers` / `skills` 至少有一项非空；没有的能力保留空数组。
- **`name`**：小写机器名，最长 80 字符，以字母开头，可用数字与 `.` `_` `-` 分隔。
- **`version`**：SemVer。**包内任意内容发生变化都必须提升版本号**；只调整区域、启用端等
  Catalog 元数据且包内容完全不变时，版本可以不变。
- **`icon`**：包内相对路径，只支持小写 `.png` / `.jpg` / `.jpeg` / `.webp`；不要声明 `darkIcon`。
- **`category`**：固定分类 `Office` / `Studio` / `Design & Sites` / `Code` / `Business` /
  `Sales` / `Productivity` / `Science & Healthcare` / `Education` / `Other`，选一项。
- **`exampleQueries`**：0–3 条真实示例，每条非空。
- **ZIP 结构**：根目录直接含 `.minimax-plugin/plugin.json`，不能再套一层目录；路径只用 ASCII
  字母、数字、点、下划线和连字符，统一用 `/`。
- **包体上限**：ZIP ≤ 64 MiB，entries ≤ 2048，普通文件 ≤ 1024，单文件解包 ≤ 16 MiB，
  完整路径 ≤ 512 bytes，路径深度 ≤ 16 段。
- **禁止内容**：OAuth、token、client secret、API key、平台专属二进制、软链接、
  `node_modules`、安装生命周期脚本（`preinstall` / `install` / `postinstall`）。

## 提交通道（不要替用户提交）

官方受理入口只有两个：飞书表单（人工在已登录浏览器里提交）和公开 GitHub 仓库。
**没有程序化投稿接口。** 提交后保存 `submission_id`，查询进度需要「原提交飞书账号 +
`submission_id` + 提交邮箱」三者匹配。

个人开发者的 Mini App 通常走开源社区仓库
（<https://github.com/MiniMax-AI/MiniMax-Code-MiniApps>）提 PR，而不是投稿表单；
表单受理的是 App / MCP / Skill 插件。

## 交付时怎么说

- 列出修了什么、还差什么，每条都指到具体字段。
- 附上材料包路径与自检报告结论。
- 明确写出「材料已生成，尚未提交；提交动作由用户在官方渠道完成」。
