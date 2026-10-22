# Regex Lab · 正则实验室（`regex-lab`）

运行在 MiniMax Code 内部的实时正则工作台。输入正则和样例文本，逐条查看匹配结果及其捕获组、
命名组，并预览替换效果——全部由 Mini App 自带的 Node 后端完成，文本不会发往任何外部地址。

## 功能

- **实时匹配**：显示每处匹配的位置（`index`–`end`）、匹配内容、编号捕获组与命名捕获组。
- **替换预览**：支持标准 `$1`、`$<name>`、`$$`、`$&`、`` $` ``、`$'` 等替换符。
- **修饰符开关**：`g` / `i` / `m` / `s` / `u` / `y`，也可在文本框直接输入。
- **非法正则提示**：正则无效时显示引擎报错，而不是静默失败。

计算逻辑位于 `miniapp/node/regex-engine.mjs`（纯函数、无 DOM），同时被 Node 接口与单元测试复用，
所见即所跑。

## 安装

将本目录（含隐藏目录 `.minimax-plugin/`）整体复制到 MiniMax Code 的插件目录，命名为
`regex-lab/`（`~/.minimax/plugins/regex-lab/`）。重启 MiniMax Code，请 Agent 打开
「Regex Lab 正则测试器」。

## 验证环境

- 本机使用 Node.js 22 校验通过：`node scripts/validate.mjs plugins/lym308758/regex-lab` 无错误，
  `node --test plugins/lym308758/regex-lab/tests/` 全部通过（引擎 + HTTP 接口）。
- **未在 MiniMax Code 宿主界面内验证**：当前环境没有 MiniMax Code 桌面端，因此未把页面真正在侧边栏
  中打开，也未做端到端的界面点击验证。Node 后端（页面托管 + `/api/match` + `/api/replace`）由
  `tests/server.test.mjs` 在真实 `node:http` 服务上覆盖，正则引擎由 `tests/regex-engine.test.mjs` 覆盖。

## 数据访问

- **文件**：仅读取自身的 `miniapp/client/index.html` 以托管页面，不写入任何文件。
- **网络**：除宿主回环（页面与 JSON 接口）外无任何外部网络访问。
- **进程**：不创建子进程。
- **Agent 回合**：无；本 Mini App 未声明 `agentAccess`。
- **状态**：不存储任何状态，每次计算仅针对你粘贴的文本。

## 许可证

[MIT](./LICENSE)
