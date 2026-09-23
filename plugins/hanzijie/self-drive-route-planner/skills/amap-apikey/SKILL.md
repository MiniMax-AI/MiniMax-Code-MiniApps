---
name: amap-apikey
description: |
  在高德开放平台控制台(console.amap.com)用会话内置 Browser 走完"创建应用 → 添加 Key → 提取
  Key 值 → 在线验证"的全流程,拿到可用的高德 API Key。用户说"申请高德 API Key / 高德开放平台
  建应用 / 创建高德 Key / 帮我搞个 amap key / apply amap api key"等就加载本 skill。
  不该触发的相邻情况:已有 Key、只是想调高德 REST/JS API 查地理数据(直接调接口即可);
  高德控制台的其他操作(删应用、查账单、实名认证)也不适用本流程。
descriptions:
  zh-Hans: "高德开放平台全自动申请 API Key:内置 Browser 原子操作,逐步校验,傻瓜式流程。"
displayNames:
  zh-Hans: "高德申请 API Key"
---

# 高德开放平台申请 API Key(BU 原子操作流程)

按 Step 1→8 顺序执行。每步只做一个 mcp_browser 原子动作,等结果、核对"判据"后再走下一步。
判据不满足就走该步的失败分支;同一动作最多重试 1 次,连续 2 次失败则截图停下向用户报告现场,
不要盲目重复点击(会把页面状态搞乱,后续全错)。

## 硬规则(先读,原因都写在括号里)

- 先加载 `browser-use:control-in-app-browser` skill,每个会话一次,然后才能调 mcp_browser
  (未加载会被 SKILL_REQUIRED 拒绝)。
- 登录、注册、验证码、滑块一律 ask_user 请用户在右侧浏览器接管(凭证是用户资产,代填是红线;
  且你也拿不到验证码)。等用户回复"完成"后再继续。
- ref 是快照级的:弹窗开/关、页面刷新、frame 变化后旧 ref 全部失效(报 stale/invalid),
  此时重新 query 拿新 ref,从当前步骤的判据点继续,不要凭记忆重发旧 ref。
- 文中所有坐标是 1440×900 viewport 的参考值,仅用于帮你在截图里快速找目标;点击前必须以
  当次 screenshot 实测换算(viewport 不同坐标就不同)。
- 下拉选项、radio 圆圈、部分按钮不进语义索引:semantic query 返回空是正常现象不是 bug,
  按各步骤给的 screenshot+position 兜底路径走。

## Inputs to collect

| 参数 | 必填 | 默认 | 约束 |
|---|---|---|---|
| APP_NAME 应用名称 | 是 | — | ≤15 字符;汉字/数字/字母/下划线/中划线 |
| KEY_NAME Key 名称 | 是 | `<APP_NAME>-web`(超长则截断) | 同上 |
| PLATFORM 服务平台 | 是 | **Web服务** | **只选择 Web服务**；不要选择 Web端(JS API) / Android / iOS / 微信小程序 / HarmonyOS |
| APP_TYPE 应用类型 | 否 | 其他 | 见 Step 4 的选项列表 |
| IP_WHITELIST | 否 | 空=不限制 | 仅 Web服务 平台有此字段 |

必填项缺失时用一次 ask_user 问全(问名称时顺带确认 PLATFORM),不要拆成多轮。
**本插件只申请高德 Web服务 Key：服务平台必须选“Web服务”，无需“Web端(JS API)”；不申请 JS API 安全密钥。**
本流程在 Web服务 平台实测通过;不再走其他平台分支。

## 状态机总览

| # | 步骤 | 成功判据 | 失败去向 |
|---|---|---|---|
| 1 | 打开控制台 | url 停留 console.amap.com | 跳到 lbs.amap.com → Step 2 |
| 2 | 用户登录接管 | 重开后 url 停留 console | 重试 1 次 → 停 |
| 3 | 幂等检查 | 三种去向取其一 | — |
| 4 | 创建应用 | body text 出现 APP_NAME + "创建" | 截图 → 停 |
| 5 | 打开 Key 表单 | editable 出现 input#keyName | 重点 1 次 → 停 |
| 6 | 填表并提交 | body text 出现 KEY_NAME 行 | 截图 → 停 |
| 7 | 提取并验证 Key | 32 位 hex + REST "status":"1"，随后安全交给调用方 | 报告异常 |
| 8 | 输出报告 | 只报告脱敏信息，不输出完整 Key | — |

## Procedure

### Step 1 打开控制台并判定登录态

当前 tab 空白用 navigate,已有加载页面用 open_tab(避免覆盖用户正在看的页面):

```json
{"action":"open_tab","input":{"url":"https://console.amap.com/dev/key/app"}}
```

读返回的 result.url 判定:

- 停留在 `console.amap.com/dev/key`(title 含"高德控制台")→ 已登录 → Step 3
- 被重定向到 `lbs.amap.com`(页面自动弹出登录框)→ 未登录 → Step 2

页面在转圈加载时先 `{"action":"wait","input":{"kind":"timeout","timeout":2500}}` 再读内容,
否则 query 会拿到空壳页。

### Step 2 登录交给用户

调 ask_user:告知右侧浏览器已弹出高德登录框(支持密码/短信/二维码登录,框内有"免费注册"入口,
没弹的话点页面右上角"登录"),请用户完成后选"已完成"。收到回复后重做 Step 1(open_tab 重开
console URL)验证。仍跳登录页 → 再请求一次接管;第二次仍失败 → 停,报告卡点。

### Step 3 幂等检查(防止重复创建)

```json
{"action":"query","input":{"kind":"text","selector":"body","maxChars":3000}}
```

- KEY_NAME 已存在且同行有 32 位 hex → 直接跳 Step 7(提取已有 Key,不再创建)
- APP_NAME 卡片存在但看不到 KEY_NAME:卡片可能是折叠的(折叠卡片的 Key 行不出现在 body
  text 里)。semantic query APP_NAME 找到卡片头(role=button 的 div),click 展开后重新
  query text 复查;确认没有 KEY_NAME → 跳 Step 5
- 两者都不存在 → Step 4

### Step 4 创建应用

1. 定位并点击入口(页面右上角):

   ```json
   {"action":"query","input":{"kind":"semantic","text":"创建新应用","limit":5}}
   ```

   取唯一的 button ref → `{"action":"click","input":{"ref":"<ref>"}}`
2. 判据:`{"action":"query","input":{"kind":"editable"}}` 返回含 `id=productName` 的
   input(此弹窗唯一的输入框)。没出现 → 再点一次;仍没有 → 截图停。
3. 填应用名称:`{"action":"fill","input":{"ref":"<productName ref>","text":"<APP_NAME>"}}`。
   判据:effect.verified:true 且 textLength 等于名称长度。
4. 打开"应用类型"下拉:

   ```json
   {"action":"click","input":{"selector":".ant-modal .ant-select"}}
   ```

   此刻页面只有这一个弹窗,该选择器安全(Step 6 之后就不安全了,见那边的警告)。
   post-action 截图里应出现选项列表,首项"出行"。
5. 选类型。完整选项顺序:出行/音乐/财务/美食佳饮/社交/生活/游戏/旅游/新闻/教育/效率/
   商品指南/商务/参考/医疗/儿童/健康健美/体育/其他。下拉选项不进语义索引,只能滚动+截图+
   坐标点击:
   - 默认值"其他"在列表最底,先滚到底(循环直到 effect.atEnd:true,最多 3 次):

     ```json
     {"action":"scroll","input":{"direction":"down","distance":600,"selector":".ant-select-dropdown-menu"}}
     ```

     注意:scroll 不接受 position 目标;不带 selector 滚的是页面本身,会返回 moved:false
     (页面不可滚),必须带这个 selector。
   - 截下拉区域(参考 clip:x 490, y 250, w 360, h 300),在图里找目标选项行,
     viewport 坐标 = clip 原点 + 行中心偏移:

     ```json
     {"action":"screenshot","input":{"scope":"clip","clip":{"x":490,"y":250,"width":360,"height":300}}}
     ```
   - `{"action":"click","input":{"position":{"x":<换算值>,"y":<换算值>}}}`
6. 判据:`{"action":"query","input":{"kind":"text","selector":".ant-modal","maxChars":500}}`
   文本含所选类型(如"其他")且不再含"请选择应用类型"。
7. 提交:`{"action":"click","input":{"selector":".ant-modal .ant-btn-primary"}}`(即"新建"按钮,
   此刻仍只有一个弹窗,安全)。
8. 判据:query text body 出现 `APP_NAME` 和当日日期 + "创建"。弹窗没关或出现红字报错 →
   截图停(常见原因:名称重复、超 15 字符、非法字符)。

### Step 5 打开"添加Key"表单

1. `{"action":"query","input":{"kind":"semantic","text":"添加Key","limit":6}}` 会返回多个
   应用卡片的同名按钮。选取规则:先找 text 以 `APP_NAME` 开头的卡片头元素,记下 rect.y;
   选 rect.y 与之相同(±10px)的"添加Key" button(新建应用的卡片在列表顶部,y≈132)。
   选错卡片会把 Key 建到别的应用底下。
2. click 该 ref。
3. 判据:query editable 出现 `id=keyName` 的 input。若出现的是 productName,说明误开了
   "新建应用"弹窗 → 点右上角 X 关掉,回本步第 1 小步。没弹 → 重点 1 次。

### Step 6 填 Key 表单并提交

弹窗标题:为「APP_NAME」添加Key。服务平台默认选中 Android平台(表单带 SHA1/PackageName
字段),所以必须手动切平台,不能跳过。

1. 填 Key 名称:fill keyName ref → 判据 effect.verified:true。
2. 切平台：**必须选“Web服务”**，不要选“Web端(JS API)”；radio 不进语义索引,截图定位:
   `{"action":"screenshot","input":{"scope":"viewport"}}` → 找"Web服务"字样左侧的圆圈
   (1440×900 参考:x≈534,y≈298)→ click position。
3. 硬判据,本流程最关键的一次校验:

   ```json
   {"action":"query","input":{"kind":"editable"}}
   ```

   必须出现 `id=ips` 的 textarea(IP白名单,Web服务 专属字段),且 SHA1/PackageName 字段
   消失。ips 没出现 = radio 没点中 → 改点"Web服务"三个字重试 1 次。
   本流程不接受“Web端(JS API)”或其他平台：若页面最终显示 JS API / Android 等字段，立即回到平台选择重新选“Web服务”，不要继续提交。
4. IP_WHITELIST 非空才 fill 进 ips;留空表示不限制 IP。
5. 勾服务协议(提交的必要条件,勾选即代表用户同意高德服务协议与隐私政策):

   ```json
   {"action":"check","input":{"selector":"input[type='checkbox']"}}
   ```

   判据:effect.verified:true。
6. 定位"提 交"按钮。不要用 `.ant-modal .ant-btn-primary`:DOM 里还残留着 Step 4 那个
   隐藏的"新建应用"弹窗,querySelector 命中的是它的"新建"按钮,点了无效甚至误触。
   正确做法:截弹窗底部(参考 clip:x 360, y 580, w 740, h 320)找右下角"提 交"
   (1440×900 参考:x≈1054,y≈878)→ click position。
7. 点完立刻 query text body:
   - 出现 KEY_NAME 行 → Step 7
   - 弹出滑块/验证码 → ask_user 请用户拖完,回本步复查
   - 弹窗仍在且有红字 → 截图停(常见:Key 名称重复/超长、协议未勾中)。

### Step 7 提取 Key 并在线验证

1. `{"action":"query","input":{"kind":"text","selector":"body","maxChars":3000}}`
   Key 行格式:`KEY_NAME→32位hex→安全密钥列→绑定服务→操作`,其中 32 位 hex 就是 API Key。
   安全密钥列显示"—"对 Web服务 是正常的:安全密钥(jscode)只配发给 Web端(JS API) 平台,
   不要当成失败去反复排查。
2. 在线验证(仅 Web服务 平台;用 web_fetch,不动浏览器):
   `https://restapi.amap.com/v3/geocode/geo?address=北京&key=<KEY>`
   - 响应含 `"status":"1"`(infocode 10000)→ Key 生效
   - `"infocode":"10001"`(INVALID_USER_KEY)→ Key 无效,回 Step 3 复查提取是否拿错行
   - `USERKEY_PLAT_NOMATCH` → 平台选错(如拿 JS API 的 Key 调 REST 接口)
   - 其他平台的 Key 不能用此 URL 验证,跳过本小步并在报告里说明未在线验证。

### Step 8 输出报告

## Output contract

报告必须包含,不要输出完整 Key（凭据只能留在 Node 进程或用户自己的密码输入框中）:

- 应用名称 + 应用类型;Key 名称;脱敏后的 Key（只保留末 4 位）;服务平台
- 安全密钥说明(Web服务 无安全密钥属正常;仅 JS API 有)
- IP 白名单状态(空=不限制,后续可在控制台该 Key"设置"里收紧)
- 在线验证结果(`"status":"1"` 或未验证的原因)
- 管理链接 <https://console.amap.com/dev/key/app>(免费配额在该页"查看配额")

## Failure handling

| 现象 | 处理 |
|---|---|
| ref 报 stale/invalid、frame 变化、页面自刷新 | 旧 ref 全作废;重新 query 定位,从当前 Step 的判据点继续 |
| semantic / editable query 返回空 | 下拉选项、radio 本就不进索引;改用该步骤的 screenshot+position 路径 |
| query text `.ant-modal` 读到旧弹窗内容 | 该选择器命中 DOM 第一个 modal;Step 5 之后弃用,改截图读可见弹窗 |
| BROWSER_OPERATION_TIMEOUT | 不重发原查询;先 `{"action":"inspect","input":{"limit":40}}` 看现场,页面可能已刷新导致弹窗被关,按状态机回到对应 Step |
| 滑块 / 验证码 / 手机二次验证 | ask_user 用户接管,完成后从当前判据点继续 |
| 名称超 15 字符或含非法字符被拒 | 截断/替换后重试 1 次;仍拒 → 问用户要新名称 |
| 同一判据连续 2 次不满足 | 停止,截图 + 现状报告用户,不要继续盲试 |

## Examples

Input:"帮我去高德开放平台申请一个API KEY"(未给名称)
→ ask_user 一次问全:APP_NAME、PLATFORM(默认 Web服务)→ 用户答 MavisAgent / Web服务
→ Step 1 发现未登录 → Step 2 用户接管登录 → Step 3 无同名 → Step 4 建应用(类型:其他)
→ Step 5/6 添加 Key(MavisAgent-web,勾协议,提交)→ Step 7 提取并立即交给自驾规划的 `set_amap_key`（或让用户在设置中粘贴），只保留 `35c0…9aee` 这样的脱敏值并完成 REST 验证
`"status":"1"` → Step 8 输出脱敏报告与管理链接，绝不输出完整 Key。
