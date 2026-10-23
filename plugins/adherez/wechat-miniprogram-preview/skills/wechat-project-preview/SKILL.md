---
name: wechat-project-preview
description: 在 MiniMax Code 中开发、打开、调试原生微信小程序或小游戏时，复用已安装的 wechat-miniprogram-preview 展示原工程。用于“微信预览 Mini App”“小程序预览”“在 miniapp 里展示”等请求；不是创作另一份 MCode Mini App，也不代替官方真机或发布工具链。
---

# 原微信工程直接预览

本插件把 WXML/WXSS/JS/TS 小程序或 game.json/game.js 小游戏编译为本地 H5 近似预览。用户工程是唯一业务源码，预览器固定为 **`wechat-miniprogram-preview`**。

## 选择正确路线

- 在当前会话的工作区开发或读取用户指定的原生微信工程；不要因为目录名是 `miniapps/` 就把它当成 MCode 插件。
- 用户说“用我们的 Mini App 预览”，是使用本插件，不是制作新插件。不要调用 `miniapp.init/publish` 创建另一份 HTML 来代替 WXML/WXSS 验证，也不要加载 `miniapp-creator`，除非用户明确要求开发或修改预览器本身。
- 本版本正常 Host 接纳的 Agent 工具可直接打开合法工程，不需要额外目录授权。旧记忆中的“新目录必须在面板点授权”不适用于本版本；不要问授权问卷或编辑旧授权文件。
- 微信开发者工具、真机、扫码、上传及发布仅在用户明确要求时启用；本插件不能宣称微信官方运行时完全兼容。

## 打开并展示

1. 确定工程绝对路径：小程序含 `app.json`，或 `project.config.json` 指定合法 `miniprogramRoot`；小游戏含 `game.json` 和 `game.js`/`game.ts`。Taro/uni-app 先使用项目自身构建生成原生工程。本插件不替用户安装依赖或执行构建脚本。
2. `preview_list` 查看已有预览。已知目标传其 `preview_id`；确需独立预览用 `create_new:true`，不同时传两者，不猜测或抢占其他预览。
3. 调用 `preview_open_project`，传 `project_path`，必要时传 `project_kind:"miniprogram"|"minigame"`。小游戏不传 page/query。
4. **必须执行结果中的 `hostOpenAction`**：用内置 `miniapp` 工具，`action:"open"`、`pluginId:"wechat-miniprogram-preview"`、`path:surfacePath`。这不是另一次安装或发布。
5. 查询 `preview_status` 确认目标工程、构建、连接和运行状态，再通过正常 Browser 或用户实际交互检查画面。`build=ok` 不等于面板已显示，`accepted` 不等于动作完成，`rendered` 也不替代视觉验收。

示例（实际使用结果中的路径，不编造 previewId）：

```json
{"project_path":"/absolute/path/to/wechat-project","project_kind":"miniprogram","create_new":true}
```

```json
{"action":"open","pluginId":"wechat-miniprogram-preview","path":"/preview?previewId=<实际返回的ID>"}
```

`surfacePath` 是 Host 内部的相对页面路径，**不能交给普通 Browser open_tab/navigation 当网址或搜索词**。不要探测端口、读取宿主凭据、自起服务、手拼模拟器 HTML、抽取 runtime 制造离线替代页，或把工程复制进插件安装目录／运行包／demo。

## 页面与迭代

外壳只有预览画面和“刷新预览”，没有打开工程、设置诊断、设备选择、暂停或重启按钮。工程选择、状态和日志由聊天工具完成。源码保存触发自动构建，手动刷新会安全重建当前页面；普通内存重置，已确认的 Storage 保留，不是 HMR。

小程序通过 `preview_navigate` 切路由，随后查回报；小游戏需要控制时使用 `preview_game_control`，不能用小程序导航。错误用 `preview_status` 与 `preview_logs` 定位并修原工程，不新造展示版。

## 失败处理

- 工程类型不明确：按错误提供的候选澄清 `project_kind`。缺文件、语法错误按 file/line 修原工程。
- 多预览歧义：明确 preview_id，不靠反复 create_new 消歧。预览或活动工程容量满时列出影响范围，让用户决定复用或关闭；不能自动关闭其他窗口。
- `preview_close` 只关闭没有活动页面的空闲预览，须用户确认并传当前 serverEpoch/leaseEpoch；有活动 Shell 时先用其恢复通道安全关闭，不强制删除数据。
- 存储冲突、响应丢失、文档失败：读取 `preview_status.recoveryShells` 的 `clientId`、`state.revision` 和 `availableActions`，用 `preview_recover` 请求该页面处理。`retry` 不丢数据；`export_local` 仅请求本地下载，实际下载成功才算备份；不把业务快照上传到模型。
- `discard_local`、`takeover`、`close` 只有用户明确同意影响后才能传 `confirmed:true`，页面也会确认风险。状态变化后重新查询，不伪造 revision，不用新 request_id 盲目重复不确定操作。Shell 离开时不能宣称已导出其内存。
- 系统／敏感目录、符号链接越界或目录被替换：停止并报告具体限制，不能改白名单、迁进 demo 或关闭安全机制。

## 交付口径

报告原工程路径、实际打开的 previewId、构建／运行／画面验证的分别结果及未支持能力。不把另一份 HTML 页面测试成功说成微信工程已验收；不把本地预览通过说成可正式发布。
