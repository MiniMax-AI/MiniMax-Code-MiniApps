# GML 练习记录 · 项目存档管理器

GameMaker（GML）代码学习笔记的 Mini App：**多本互不干扰的练习存档**，每本都能独立打卡、登记 API 库、按顺序记录代码载体，随写随存。

把「Gml代码练习记录」打卡网页版搬进 MiniMax Code：数据从浏览器的 localStorage 换成了 Mini App 的数据目录（本机的 `.json` 文件），项目之间彻底隔离，回收站和备份也都在。

---

## 功能

**项目管理器**

- 多本练习笔记并存，互不干扰；每一本是一个独立的 `.json` 存档文件
- 项目列表每次从磁盘重读，删文件/改文件都能被识别
- 回收站：删除的项目进回收站，`trash-index.json` 记着清单，随时恢复
- 导出全部 / 导出单个项目 / 导入存档
- 界面语言中英双语，跟随 MiniMax Code 的界面语言

**练习记录（打卡网页版）**

- 打卡记录：题目要求 + 提示 + 按顺序排列的代码载体（操作描述 / 脚本 / 对象）
- API 库：代码名 + 一句话介绍 + 参数列表，记录按引用关联
- 打卡日历、每日目标、连续打卡天数
- 一键分享打卡记录长图

**版本管理**

- 内置一份网页版副本，离线可用
- 「抓取最新版本」从来源地址重新下载网页版并缓存到数据目录
- 「恢复内置版」删掉缓存，回到内置副本
- 抓取版与内置版都可用，存档数据始终写在数据目录里

---

## 安装

### 从 Git 仓库导入（推荐）

MiniMax Code v3.1.11 起支持从公开 Git 仓库导入 Mini App：

1. 插件市场点「创建」→ 选「Mini App」分类下的「从 Git 仓库导入」
2. 填仓库地址（单个包就填插件子目录的链接）：

   ```
   https://github.com/MiniMax-AI/MiniMax-Code-MiniApps/tree/main/plugins/basetier-gml/miniapp-44928b90-e36d-46c5-9f7e-4d3d5ac5cda0
   ```

3. 点「预览」核对包名、版本、来源目录和声明的权限 → 「导入」
4. 在插件管理里确认已启用，再正常打开

> 不要把整个社区仓库当作一个 Mini App 导入。

### 手动安装

把整个插件目录（**包括隐藏的 `.minimax-plugin/`**）复制到：

```
<dataDir>/plugins/miniapp-44928b90-e36d-46c5-9f7e-4d3d5ac5cda0/
```

默认是 `~/.minimax/plugins/`。重启 MiniMax Code，确认插件已识别并启用。

### 从 ZIP 安装

把目录或 ZIP 直接交给 Agent，让它按成品包流程发布即可。

---

## Data & access

数据与服务访问范围：

**本机数据（只写不读，除用户自己的存档外不碰任何其他文件）**

| 位置 | 内容 |
| --- | --- |
| `<dataDir>/GML-Saves/` | 练习存档 `<名称>.<id>.json` + `save-index.json` |
| `<dataDir>/GML-Trash/` | 回收站 `<id>.<删除时间>.json` + `trash-index.json` |
| `<dataDir>/GML-App/` | 抓取下来的网页版 `app.html` + `app-meta.json` |
| `<dataDir>/exports/` | 用户导出的备份文件 |

`<dataDir>` 由宿主注入，随 Mini App 数据目录走。**所有写入都是原子写**（同目录临时文件 → rename），宿主强制结束进程也不会留下半个文件。

**网络访问**

只有一处：用户在页面上主动点「抓取最新版本」时，Node 服务会去下载网页版。

- 默认来源：`https://basetier-gml.github.io/gml-practice-log/`
- 来源地址可在页面上改
- 下载有大小上限和超时；失败时保留原来的版本，应用照常可用

**不上传任何数据。** 练习内容、API 库、存档文件全部留在本机，不发往任何服务器。

**不申请** Connector、Agent 运行、设备、导航等任何额外权限。

---

## Agent 能做什么

包里带了一个托管 MCP server `gml-notes` 和一个 Skill，Agent 可以直接查你的笔记：

| 工具 | 用途 |
| --- | --- |
| `list_projects` | 列出所有练习笔记（记录数、API 数、打卡天数） |
| `get_project` | 读一本笔记的完整内容 |
| `search_notes` | 跨所有笔记搜索题目、提示、代码、API 介绍 |
| `list_api_library` | 汇总 API 库（代码名、介绍、参数） |
| `create_project` | 新建一本空白笔记 |
| `export_backup` | 导出全部存档为 JSON 备份 |

边界说明：练习记录的**正文**（题目、提示、代码载体）只能在页面里编辑——那是浏览器侧的写入通道，托管 MCP 不暴露写接口。所以 Agent 负责读、搜、汇总、整理，以及新建笔记和导出备份；要落进某条记录的具体内容，Agent 会把整理好的版本给你，由你粘到页面里。

---

## Tested environment

测试环境：

- MiniMax Code **v3.1.16**（Windows x64）—— 完整功能验证
- Mini App 运行时（Node 进程）：`node:http` + 内置模块，无第三方依赖，无构建步骤
- 网页版：`bzhm-1cb4mgb`（来源 `basetier-gml/gml-practice-log`，MIT）

已验证：内置版与抓取版都能正常打开项目、读写存档；API 介绍随存档落盘并在重新载入后保留；退出前的「要不要导出存档」提醒在 Mini App 里被屏蔽（存档由宿主自动落盘，不需要用户手动导出）；存档文件在完全刷新、重启服务后逐字节一致。

---

## 已知限制

- 练习记录正文只能在本机页面上编辑，Agent 不能直接写入（见上文边界说明）
- 「抓取最新版本」依赖网络；离线时请用内置版
- 网页版页面被嵌在 Mini App 的 iframe 里，因此网页菜单里的「存档 / 读档 / 清空缓存 / 新手教程 / 切换语言」入口被隐藏，由项目管理器统一接管
- 打卡分享长图依赖浏览器的截图能力，在部分嵌入环境下可能不可用

---

## 许可与致谢

本插件代码以 MIT 许可发布，见 [LICENSE](LICENSE)。

内置的练习应用网页版（`miniapp/client/core/app.html`）来自 [basetier-gml/gml-practice-log](https://github.com/basetier-gml/gml-practice-log)，同为 MIT 许可，版权归原作者所有。
