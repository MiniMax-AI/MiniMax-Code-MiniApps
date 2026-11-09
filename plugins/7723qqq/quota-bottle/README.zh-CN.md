# 额度瓶（`quota-bottle`）

一只章鱼形状的玻璃瓶，装着你的 MiniMax Token Plan 剩余额度：液面高度和液体不透明度都按剩余占比走。额度满时章鱼装满、颜色最饱和；额度用光时只剩透明玻璃轮廓。同一张页面也能变成透明的小悬浮窗。

页面用 SVG 绘制，没有框架、CDN、构建步骤或运行时依赖。它显示剩余 / 总额度、百分比、重置时间、分模型明细、周额度标签，并支持明暗主题。界面跟随客户端语言（中文或英文），标题栏的 中 / EN 可以随时切换并记住选择。

## 安装

把整个目录（连同隐藏的 `.minimax-plugin/`）复制到 MiniMax Code 的插件目录，目录名用 `quota-bottle/`（默认在 `~/.minimax/plugins/quota-bottle/`）。重启 MiniMax Code，然后在对话里说“打开额度瓶”。

## 悬浮窗

瓶子下方点 **Pin to desktop**，页面会移到 220 × 300 的无边框、透明、置顶窗口；面板继续运行。该功能最低需要 MiniMax Code 3.1.2。

窗口是 220 × 300。MiniMax Code 会按插件记住弹出窗口的位置和大小，记忆排在清单之前，所以窗口会按上次的尺寸打开。包里把窗口设成不可缩放——在 Windows 上，可缩放的透明无边框窗口会失去透明；客户端如果报告窗口可缩放，页面才提供一次尺寸修复，而且那个补丁会带上可见位置，因为宿主会拒绝会跑到屏幕外的几何改动。页面本身不画任何底——根元素和 body 都是透明的。在把 Mini App 渲染在 `webview` 后端上的客户端里，窗口表面本身是不透明的：页面照样没画底，但桌面透不过来。这是客户端侧的限制，已在上游 [MiniMax-AI/minimax-code#597](https://github.com/MiniMax-AI/minimax-code/issues/597) 记录。

MiniMax Code 只在用户操作下开窗：窗口不会随启动打开，不在点击里的模式切换会被拒绝（`not_permitted`）。所以第一次固定需要点一下，入口就放在首屏，而不是藏在菜单里。之后窗口在客户端运行期间一直存在；关掉它回到面板，下次固定再点一下。

- 窗口没有系统标题栏，所以拖动准备了两种方式：页面把内容标成拖动区（`-webkit-app-region: drag`，右上角 × 保持 `no-drag`），渲染器支持时由系统移动窗口；而客户端可能用 WebView2 渲染 Mini App，那里不认识这个属性，所以页面也能自己移动窗口——位移用屏幕坐标，避免窗口自身的移动把拖动抵消掉。两条路只有一条会生效：有拖动区时它先把指针事件吞掉。
- 右上角的 × 回到面板；像普通窗口那样关闭也一样，面板仍在运行。
- 悬浮窗每 5 秒刷新一次，面板每 10 秒，页面不可见时每 60 秒；点固定后会立刻读一次，不等第一次轮询。Node 对实时额度缓存 3 秒，对本机用量快照缓存 15 秒；点 **Refresh** 会开启新的缓存代际，不会复用登录前或跨月之前的在途请求。
- 胶囊里除了百分比和 token 数，还会显示重置倒计时、周额度和视频模型的已用占比（数据里有才显示）。
- 需要登录、设置手填总额，或实时额度读取有问题时，悬浮计量条会给出简短提示。

## 额度怎么算

页面向 Node 请求 `/api/state`；Node 先尝试实时 Token Plan 额度，失败后才使用手填总额与本机用量。

实时额度只有一个来源：你自己配置的凭据。

1. **插件自己的登录。** 面板里的设备码登录把 OAuth token 写进 `<context.dataDir>/credentials.json`，刷新也写在这里。之后带 `Authorization: Bearer <token>` 请求 `GET <baseUrl>/v1/token_plan/remains`。
2. **CLI 配置里已有的凭据。** `~/.mmx/config.json`（或 `$MMX_CONFIG_DIR/config.json`）只读：里面的 API key，或还没过期的 OAuth access token。CLI 自己的 token 不会被刷新或轮换；过期后由面板提供自己的登录。这样 `mmx auth login` 建立的会话保持 CLI 留下的样子。

瓶子不借用 MiniMax Code 已登录的桌面会话，也不读取桌面端的租约、能力文件或任何别的 Host 凭据。

### 1. Token Plan 额度

Node 按这个顺序取凭据快照：插件自己的凭据、CLI 配置里仍有效的 OAuth access token、CLI 配置里的 API key。然后请求 `GET <baseUrl>/v1/token_plan/remains`。

主机由分区决定：`cn` 区用 `https://api.minimaxi.com`，`global` 区用 `https://api.minimax.io`。配置中的 `base_url` 或 OAuth `resource_url` 只有属于 HTTPS MiniMax API 主机时才会被接受；另一个分区的主机保留为备选，因此写错的分区设置不会掩盖本来可用的凭据：候选主机按顺序逐个请求，第一个返回额度的即为命中。传输层失败（网络、超时）会中止这次遍历，因为那说明不了主机的问题。`MINIMAX_BASE_URL` 可显式指定回环 HTTP 地址，仅用于本地 stub 测试，此时它会替换掉全部候选主机。

带凭据的请求一律不跟随重定向。`MINIMAX_BASE_URL`、`MINIMAX_REGION`、`MMX_CONFIG_DIR`、`MINIMAX_DATA_DIR`、`MAVIS_HOME` 都可能改变所用主机或本机文件，均从 Node 进程环境读取。

#### 登录一次

没有任何凭据能读到额度时——没有、过期、被拒或读不出来——面板显示 **Token Plan login**：

- 点 **Log in** 启动设备码 OAuth。Node 向固定的 `account.minimaxi.com` 或 `account.minimax.io` 申请设备码，校验返回的 URL 和 code，打开授权页，并在页面显示 URL 与 code。授权页本身在对应分区的平台站上（`platform.minimaxi.com` / `platform.minimax.io`）；账号站仍然保留，因为旧响应指向那里。每个分区只接受自己的这两个来源。
- 面板会按已存凭据或 CLI 配置里的分区发起登录。
- 页面轮询 `GET /api/login`，Node 轮询账户服务的 token 接口；成功后把凭据写进 `<context.dataDir>/credentials.json`。token 不发给页面、不写日志、不进错误响应。
- 登录和 token 刷新都不会写 CLI 配置；其中的 `api_key`、`base_url`、分区等字段保持用户留下的原样。
- 取消或替换待完成的登录流程后，迟到的响应不会把凭据按另一个 region 写入。`dispose()` 会中止在途账户和额度请求。
- 凭据写入是原子的、串行化的，使用带进程标识的临时文件，默认 0600。

`sk-api-` 开头的 key 是账户余额 key，不是 Token Plan key；插件会在发请求前拒绝，并退回手填总额。

被服务端拒绝的凭据会被指名，而不是笼统归为“接口拒绝”：`2049 invalid api key` 记为 `invalid_credential`，`1004`（请求里没带 secret key）记为 `missing_credential`，HTTP 401 或 403 记为 `unauthorized`。这些都能靠重新登录解决，所以面板会给出 **Token Plan login**，而不是把用户堵在死路上。多个主机给出的失败原因不同时，最终上报的是用户能动手解决的那一个。

响应归一化：

- 瓶子使用当前周期（`current_interval_*`）；周额度另作一个小标签显示。
- `current_interval_usage_count` 在旧响应里表示“剩余”，在新响应里可能表示“已用”。有 `current_interval_remaining_percent` 时，取与该百分比相差不超过 1 个百分点的读法；两种读法都对不上，或百分比越界的行，会被忽略。没有百分比时保留旧读法。
- `current_interval_status === 3`（不限量）或总额为 0 的行跳过；剩余值限制在 `[0, total]`。
- `ratio = 剩余 / 总额`；液体不透明度等于这个比例。瓶身占用前 80% 的高度，最后 20% 填满瓶颈和两只耳朵，所以 100% 时液面到瓶口。
- 只有所有展示模型都有可用的周额度数据时才显示周百分比；这里不应用套餐的周额度加成倍率。

### 2. 手填总额度

拿不到实时额度时，页面会让你填一个总额度（单位是 token），存在插件自己的 `dataDir/quota.json`。

- 已用量：**默认关闭。** 面板里有“读取 MiniMax Code 的本机用量”开关。只有打开后，才从 `<数据根目录>/v2/sqlite/runtime-state.sqlite` 的 `local_runtime_token_usage` 表读取本机当前自然月，按 `startMs <= ts < endMs` 汇总 `input_tokens + output_tokens + cache_read_tokens + cache_write_tokens`。reasoning token 不另加。数据库以只读方式打开，用 `VACUUM INTO` 复制到 `context.dataDir` 下的临时快照，查完删除；宿主数据库永远不会被写入。
- 数据根目录只来自 `MINIMAX_DATA_DIR`、`MAVIS_HOME`、`~/.minimax`。瓶子不会从 `context.dataDir` 推断，也不会沿宿主目录树向上找。该路径和 schema 都是未公开的宿主布局；如果你的安装把数据放在别处，设置 `MINIMAX_DATA_DIR`。
- 开关关闭时，数据库不会被打开、复制或读取：手填状态报 `usage_scan_off`，页面显示本机用量已关闭。
- `剩余 = max(0, 总额 - 已用)`，`ratio = 剩余 / 总额`。
- 用量超过手填总额时，会作为独立状态上报（`overBudget`、`overBy`），而不是被夹成一个看起来合理的空瓶。页面会说明用量比手填总额高出多少，并继续指向真实额度。
- 这是原始 token 数，不是 Token Plan 的计数，两种来源的数字不要互相比较。

## 验证环境

- MiniMax Code 3.1.12.216，Windows 11：插件已安装，能从对话打开，悬浮的章鱼窗能渲染。
- `surface.window` 要求 MiniMax Code 3.1.2 或更高版本。
- Node.js 24.9.0，Windows 11：`node --test "tests/*.test.mjs"` 的 85 项插件测试全部通过；`node scripts/validate.mjs plugins/7723qqq/quota-bottle` 报告 OK。
- 合成 HTTP 集成测试覆盖页面、拒绝外部 Host/Origin、写入手填总额、JSON body 限制、用量开关校验，以及 `dispose()` 释放监听端口。
- 凭据测试先在 CLI 配置里放 `api_key`、`base_url` 和一个无关字段，再跑面板登录，断言 CLI 文件逐字节不变；刷新测试断言 CLI 自己的 token 不会被刷新或写入，而插件自己的 token 会刷新进 `dataDir/credentials.json`。
- 状态测试断言“读取本机用量”开关关闭时不会打开宿主 SQLite，打开后才读取本月；打桩的额度接口覆盖按分区选站、回退到另一主机、被指名的凭据失败，以及余额 key 的提前拒绝；页面测试覆盖窗口拖拽几何与验证页来源，并保证错误码与“可登录修复”集合和 Node 侧目录保持一致。
- 合成额度响应覆盖字段歧义、冲突行拒绝、只有百分比的行、不限量行和周额度汇总；合成 SQLite 数据库覆盖本月边界与 schema 缺失。
- 本轮没有重跑完整的设备码授权；macOS/Linux 未验证。

## 数据与权限

- 读取的文件：
  - `<context.dataDir>/credentials.json`：面板登录写入的 OAuth token。
  - `~/.mmx/config.json` 或 `$MMX_CONFIG_DIR/config.json`：只读。API key，或仍有效的 OAuth access token。读取依赖当前 `mmx` 布局，不是 Mini App 的正式接口。
  - `<数据根目录>/v2/sqlite/runtime-state.sqlite`：只读，仅在“读取本机用量”打开时读取。`VACUUM INTO` 会在 `context.dataDir` 下创建临时快照，查询后删除。该宿主 schema 与路径均依赖未公开布局。
  - 自己的 `miniapp/client/index.html`，以及 `dataDir` 下的 `quota.json`、`settings.json`。
- 写入的文件：
  - `<context.dataDir>/credentials.json`：面板登录与 OAuth 刷新。本包不写 CLI 或 Host 文件。
  - `<context.dataDir>/quota.json`：手填总额度；`<context.dataDir>/settings.json`：用量开关。两者都是同目录临时文件，再原子重命名。
  - `<context.dataDir>/.usage-*` 下的临时 SQLite 快照，仅在开关打开时创建，读取后删除。
- 网络：
  - `https://account.minimaxi.com` / `https://account.minimax.io`：设备码启动与轮询。
  - `https://api.minimaxi.com` / `https://api.minimax.io`：通过插件登录或 CLI 凭据读取 Token Plan 额度，或通过校验的 HTTPS MiniMax API 覆盖地址；不跟随重定向。
  - 回环 HTTP stub 仅在测试里通过 `MINIMAX_BASE_URL` 使用。
  - 只要配置里存在凭据，即使已保存手填总额，每次状态请求仍会先尝试实时额度；仅使用手填模式的配置不会触发实时网络请求。
- 子进程：只有打开已校验授权页的系统浏览器（Windows `explorer.exe`、macOS `open`、Linux `xdg-open`）。额度和 OAuth 请求在进程内完成，没有 `mmx` 可执行文件，也不经过 shell。
- Agent 轮次：无；没有声明 `agentAccess`。
- 读取会话：无；没有 `session.read`。
- 调用工具：无；没有 `toolAccess`。
- 麦克风：不使用；没有 `deviceAccess`。
- 密钥：token 只在 Node 进程和 `dataDir/credentials.json`（或用 CLI 回退时的 CLI 配置）里，不写页面、不写日志、不进错误响应。响应只暴露固定的错误码。
- 源码与美术：实现和图标均为本包原创，见 `NOTICE.md`。
- 持久状态：`dataDir` 下的 `credentials.json`、`quota.json`、`settings.json`；主题与语言偏好是视图状态，存在 `localStorage`。

## 文件

```text
.minimax-plugin/plugin.json   插件清单
package.json                  Mini App 声明
miniapp/miniapp.json          载荷目录、Node 入口、页面路由
miniapp/client/index.html     页面，由 /bottle 提供
miniapp/node/server.mjs       Node 入口：start(context) → { dispose }
miniapp/node/quota.mjs        响应归一化、手填总额状态与额度入口
miniapp/node/cache.mjs        带代际的 TTL 缓存
miniapp/node/urls.mjs         主机、URL 与时间字段校验
miniapp/node/net.mjs          不跟随重定向的带凭据请求
miniapp/node/errors.mjs       固定错误码目录与“可登录修复”分类
miniapp/node/auth/*.mjs       CLI 配置读取、插件凭据存储与设备码实现
miniapp/node/usage.mjs        可选、只读的本机 token 用量与 SQLite 快照
miniapp/node/settings.mjs     用量开关，默认关闭
miniapp/node/store.mjs        手填总额度，原子写入 dataDir
miniapp/node/miniapp-api.ts   运行时 context 类型声明
tests/*.test.mjs              插件回归测试
NOTICE.md                     源码与美术归属说明
icon.png                      原创插件图标
```

## 许可

[MIT](./LICENSE)。许可范围见 [NOTICE.md](./NOTICE.md)。
