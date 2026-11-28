# Postman Lite (`postman-lite`)

轻量的本地 API 请求工具。在页面里构建请求，由 Node 代理转发（绕过浏览器的 CORS 限制），再读取响应——
状态码、耗时、字节数、响应头、响应体，以及 HTML 预览；集合以纯 JSON 形式保存在本地磁盘。

Mini App 自身托管 Node 运行时，不用安装任何依赖，也不用另外起服务：打开面板就能发请求。

[English](./README.md)

## 安装

把这个目录（含隐藏的 `.minimax-plugin/`）复制到 MiniMax Code 的插件目录，命名为 `postman-lite/`
（默认 `~/.minimax/plugins/postman-lite/`；根 README 的 Install 一节说明了该目录的位置）。
重启 MiniMax Code，然后让 Agent「打开 Postman Lite」。

## 功能

- **请求构建器** —— 方法、地址、Query 参数、请求头，请求体支持 `无` / `raw` / JSON /
  `x-www-form-urlencoded` / `form-data`。是否跟随跳转、超时时长可按请求切换。
- **响应查看器** —— 状态码、耗时、字节数；响应体可看美化后的 JSON、原文，或用 iframe 预览 HTML；
  二进制响应直接预览或下载。
- **集合** —— 集合 / 文件夹 / 请求三层树，可新建、重命名、删除，改动自动落盘。

## 测试环境

- MiniMax Code 3.1.2 及以上，Windows 11。本包用到 `surface.window`，其最低客户端版本为 3.1.2；
  本次会话中 Agent 无法读取客户端的具体构建号。
- 客户端验收覆盖：首屏渲染与结构、浅色与深色主题、新建集合、通过代理发送 GET 与 POST JSON、
  无法解析的域名时的错误处理，以及刷新页面后集合仍然存在。
- 运行时诊断：无 console 错误，无失败或 4xx/5xx 的网络请求。
- 请求以本地回显服务器为目标验证。

未验证：需要凭据或在本网络下不可达的第三方接口；macOS 与 Linux 上的行为。

## 数据与访问

- **文件** —— 读取自己的 `miniapp/client/` 产物与 `miniapp/node/` 代码；在 Host 分配的数据目录里
  写入 `state.json`。
- **网络** —— 用户明确请求的目标地址，以及重定向所指向的主机：默认跟随跳转，因此响应
  可能把请求转发到地址栏之外的主机。关掉「跟随跳转」可让请求始终留在原始主机上。无任何遥测。
- **进程** —— 无。
- **Agent 对话轮次** —— 无。
- **读取的会话** —— 无。
- **调用的工具** —— 无。
- **麦克风 / 摄像头 / 通知** —— 未使用。
- **Host 导航读取** —— 未声明。
- **状态位置** —— Host 分配的插件数据目录。`state.json` 保存集合树，采用原子替换写入，
  进程被强制终止也不会留下半截文件。请求头按原样保存，因此 `Authorization`、`Cookie`、
  `X-Api-Key` 等凭据会以明文存在 `state.json` 里，并由 `GET /api/state` 返回；
  清空该目录即重置所有集合。

## 文件

```text
.minimax-plugin/plugin.json   插件清单
package.json                  Mini App 声明
miniapp/miniapp.json          产物根目录、Node 入口、页面路由
miniapp/client/index.html     在 / 上提供的页面
miniapp/client/assets/        前端构建产物
miniapp/node/server.mjs       Node 入口：start(context) -> { dispose }
miniapp/node/miniapp-api.ts   运行时上下文的类型声明
miniapp/node/api.js           路由：/api/send、/api/state、/api/health
miniapp/node/proxy.js         请求转发、计时、二进制处理
miniapp/node/store.js         原子 JSON 持久化
miniapp/node/static.js        静态文件服务
miniapp/node/config.js        数据目录与各项限制
miniapp/node/shared/          共享的请求构建逻辑
icon.png                      插件图标
```

## 许可

[MIT](./LICENSE)
