---
name: route-planning
description: 规划、修改或优化自驾路线，并把 Agent 的操作实时同步到自驾规划地图。用户提到自驾、地点搜索、途经点、路线比较或地图显示时使用；用户提到旅游规划、旅行攻略、去哪玩、小红书攻略/种草/避雷调研时，同时启用本 skill 内置的小红书数据源（本地服务 curl 直调，无需配置 MCP；二进制首次使用自动下载）。
---

# 自驾规划

自驾规划作为 MiniMax Code Mini App 运行：本地后端与实时地图页面由宿主托管，Agent 通过 `route-planner` MCP 工具操作行程。真实地点搜索、驾车算路和页面真实地图图面共用同一个高德 Key：用户可在自驾规划页面右上角"设置"中粘贴，Agent 也可以调用 `set_amap_key` 工具直接配置（保存后自动切到真实数据模式并在线验证）。未配置时页面会明确提示，也可以在设置中切换到演示模式先体验。

## 工作流

1. 请用户在 MiniMax Code 会话的 Mini App 面板中打开"自驾规划"页面；`map_open` 工具只返回打开方式提示，不会自行弹出页面。
2. 调用 `trip_get` 读取活动行程及最新 `revision`。如果返回 `NO_ACTIVE_TRIP`，调用 `trip_create`。
3. 每个起点、终点和途经点都先调用 `place_search`。候选存在歧义时向用户确认；不要凭空编造坐标。
4. 使用 `trip_set_endpoint`、`trip_add_waypoint`、`trip_update_waypoint`、`trip_remove_waypoint` 或 `trip_reorder_waypoints` 修改行程。每次写入都使用上一次返回的新 `revision`。
5. 站点支持 `note`（备注：住哪、干什么等）和 `depart_at`（从该点出发的时间，ISO 8601）：起点的 `depart_at` 是整条时间线的起点；每个途经点可各自设定出发时间。到达时间与停留时长由页面自动推算（到达 = 上一点出发 + 该段行车耗时；停留 = 本点出发 − 本点到达），终点到达时间同样自动推算，不要手工计算后写回。`trip_add_waypoint` 的 `place` 里可直接带这些字段，已有途经点用 `trip_update_waypoint` 的 `patch` 修改。只改备注或时间不会作废已算好的路线。`stay_minutes` 仅作为未设出发时间时的停留兜底，一般优先用 `depart_at`。
6. 调用 `route_recalculate` 生成真实驾车路线；需要时用 `route_select` 选择候选方案。
7. 调用 `map_focus` 聚焦整条行程或指定路线，并用简短文字汇总总里程、预计时长、收费及途经顺序。

## 约束

- 遇到 `REVISION_CONFLICT` 时重新调用 `trip_get`，不要覆盖较新的用户修改。
- 往返路线的终点可以与起点相同，但仍需使用明确的地点候选。
- `MAP_NOT_CONFIGURED` 表示高德未连接：用户有 Key 就直接调用 `set_amap_key` 配置；用户还没有 Key 时，主动提醒 ta 可以用「高德申请 API Key」（amap-apikey）skill 自动去高德控制台申请一个，拿到后再 `set_amap_key`；也可先切换演示模式体验。
- `AMAP_AUTH_FAILED` 表示 Key 无效或权限不正确：请用户核对后用 `set_amap_key` 重新配置。配置 Key 后，已打开的页面刷新一次才会加载真实图面。
- 配置 Key 后页面显示真实高德地图（支持缩放、卫星图、路况、路线自动居中）；未配置时使用本地矢量图面。Key 只保存在本机。

---

# 小红书数据源（旅游攻略调研）

数据源用 xiaohongshu-mcp（官方 release `v2.5.0`，源码等价于 main@aad2a3d，其后仅 docs/CI 提交）。二进制**不随插件打包**（市场要求包平台无关）：首次启动时自动从 GitHub Release 下载到 `~/.xhs-mcp/bin/`，带 sha256 校验，GitHub 直连失败自动走镜像（gh-proxy.com / ghfast.top）。

**不走 MCP 配置**：启动本地服务后 curl 直接 POST `http://localhost:18060/mcp`（服务端 Stateless + JSONResponse，无需 initialize 握手、无需 session header，返回纯 JSON）。只用两个只读工具：`search_feeds`、`get_feed_detail`。运行数据（cookie/日志/二维码）固定在 `~/.xhs-mcp/`，与插件包解耦，republish 不丢登录态。

## Step 0 启动服务

先探活：`curl -s -m 2 http://localhost:18060/health`，返回 healthy 即跳过。

macOS：`bash <本skill目录>/scripts/start-xhs-mcp.sh`（幂等；首次运行自动下载 ~16MB 二进制并校验，再自动下载 ~150MB 内置浏览器，实测国内 30 秒内，缓存后都不再下载）。

Windows（PowerShell，含首次下载 + sha256 校验）：

```powershell
$dir = "$env:USERPROFILE\.xhs-mcp"; $bin = "$dir\bin\xiaohongshu-mcp-windows-amd64.exe"
$sha = "3578C9FCF3E7BE0B79564AECEEF8C4F38E0072D9357CA1F911EE14CD37BD454C"   # v2.5.0
New-Item -ItemType Directory -Force "$dir\bin" | Out-Null
if (!(Test-Path $bin) -or (Get-FileHash $bin -Algorithm SHA256).Hash -ne $sha) {
  $u = "github.com/xpzouying/xiaohongshu-mcp/releases/download/v2.5.0/xiaohongshu-mcp-windows-amd64.exe"
  foreach ($base in "https://$u", "https://gh-proxy.com/https://$u", "https://ghfast.top/https://$u") {
    try {
      Invoke-WebRequest $base -OutFile "$bin.tmp" -TimeoutSec 300
      if ((Get-FileHash "$bin.tmp" -Algorithm SHA256).Hash -eq $sha) { Move-Item -Force "$bin.tmp" $bin; break }
    } catch {}
  }
}
if (!(Test-Path $bin)) { Write-Host "下载失败，可手动下载后放到 $bin"; return }
$env:COOKIES_PATH = "$dir\cookies.json"
Start-Process -FilePath $bin -WorkingDirectory $dir -WindowStyle Hidden
1..120 | % { try { Invoke-RestMethod http://localhost:18060/health -TimeoutSec 2 | Out-Null; Write-Host "服务已就绪"; break } catch { Start-Sleep 5 } }
```

## Step 1 登录检查（每次搜索前必做）

**⚠️ 未登录时 `search_feeds` 不报错，静默返回 `{"feeds":[],"count":0}`**，必须先查登录态：

```bash
curl -s -m 30 -X POST http://localhost:18060/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"check_login_status","arguments":{}}}'
# content[0].text 含 "✅ 已登录" / "❌ 未登录"
```

未登录 → 二维码登录（全程不弹窗）：

```bash
curl -s -m 90 -X POST http://localhost:18060/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_login_qrcode","arguments":{}}}' \
| python3 -c "
import json,sys,base64,os
d=json.load(sys.stdin)['result']['content']
print(d[0].get('text',''))
for blk in d:
    if blk.get('type')=='image':
        open(os.path.expanduser('~/.xhs-mcp/login_qr.png'),'wb').write(base64.b64decode(blk['data']))
        print('二维码已存 ~/.xhs-mcp/login_qr.png')
"
```

把二维码呈现给用户扫码（约 4 分钟过期），**macOS 必须用 `open ~/.xhs-mcp/login_qr.png` 弹系统预览窗口**（实测 `<media />` 发本地图片可能不在前端显示，弹窗必现；Windows 用 `Invoke-Item`），可同时再发一份 `<media />` 兜底。然后每 10s 轮询 check_login_status，过期重新取码。登录一次后 cookie 长期有效。**提醒用户：同一账号不要再登小红书网页版（互踢），App 不受影响。**

## Step 2 搜索攻略 search_feeds

```bash
curl -s -m 120 -X POST http://localhost:18060/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_feeds","arguments":{"keyword":"成都三日游 攻略","filters":{"sort_by":"最多点赞","note_type":"图文","publish_time":"半年内"}}}}'
```

| 参数 | 取值（中文枚举原样传） |
|---|---|
| `keyword` | 必填 |
| `filters.sort_by` | `综合`(默认) / `最新` / `最多点赞` / `最多评论` / `最多收藏` |
| `filters.note_type` | `不限`(默认) / `视频` / `图文` |
| `filters.publish_time` | `不限`(默认) / `一天内` / `一周内` / `半年内` |
| `filters.search_scope` | `不限`(默认) / `已看过` / `未看过` / `已关注` |
| `filters.location` | `不限`(默认) / `同城` / `附近` |

返回解析：`result.content[0].text` 是 JSON **字符串**（二次解析）→ `{"feeds":[{"id","xsecToken","noteCard":{标题/作者/interactInfo}}],"count":N}`。`feeds[].id`/`feeds[].xsecToken` 即下一步的 `feed_id`/`xsec_token`。单次调用是浏览器自动化，5–30 秒，浏览器冷启动首次可能 1 分钟+，超时重试一次；不要并发调用。

## Step 3 拿正文和评论 get_feed_detail

```bash
curl -s -m 180 -X POST http://localhost:18060/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_feed_detail","arguments":{"feed_id":"<feeds[].id>","xsec_token":"<feeds[].xsecToken>","load_all_comments":true,"limit":20}}}'
```

| 参数 | 默认 | 说明 |
|---|---|---|
| `feed_id` / `xsec_token` | 必填 | 来自 search_feeds |
| `load_all_comments` | false | true 才加载更多评论（挖避雷/实况必开） |
| `limit` | 20 | 一级评论上限（load_all_comments=true 时生效） |
| `click_more_replies` | false | 展开二级回复（load_all_comments=true 时生效） |
| `reply_limit` | 10 | 跳过回复过多的评论（click_more_replies=true 时生效） |
| `scroll_speed` | normal | `slow`/`normal`/`fast`（load_all_comments=true 时生效） |

返回：正文、图片、作者、点赞/收藏/分享数、评论列表；视频笔记额外带 `video` 直链（带签名有时效）。同样 `content[0].text` 二次解析。

## 与路线规划的闭环工作流

1. **调研**：按目的地拆搜索意图各调一次 search_feeds——`{目的地} 攻略`（最多点赞）、`{目的地} 避雷`、`{目的地} 美食/住宿`、`{目的地} N日游`；近期出行加 `publish_time=半年内`。
2. **精读**：挑点赞最高的 2~3 篇调 get_feed_detail（`load_all_comments=true`），评论区的避雷/排队/交通实况比正文更新。
3. **落图**：把筛出的景点/餐厅/住宿经 `place_search` 确认坐标后，用 trip 工具写入行程（备注里带来源笔记 `https://www.xiaohongshu.com/explore/{feed_id}`），再 `route_recalculate` 出真实驾车路线。

## 小红书图片导出（本地分叉版）

页面顶部的“**小红书图片**”按钮会读取当前已规划行程并下载一组 3:4 PNG（900×1200）：

1. 首图是路线图；后续按检测到的日期分组生成每日行程页。
2. 每页使用一个标题、行程和一段备注；活动内容直接取途经点/起终点的 `note`，不另造活动。
3. 页面会根据 `depart_at`、路线到达时间和停留时间自动识别天数；没有时间时退化为“行程概览”。
4. 每页 Markdown 文本预算不超过 100 字，超出时自动拆页并截断；使用白底和多巴胺色标题排版。

## 排查

| 症状 | 处理 |
|---|---|
| 搜索空结果 | 先 check_login_status，九成是没登录/cookie 过期 |
| cookie 过期 | 调 `delete_cookies` 工具后重新扫码 |
| 停止服务 | `pkill -f xiaohongshu-mcp-darwin-arm64`（Win: `taskkill /IM xiaohongshu-mcp-windows-amd64.exe /F`） |
| 看日志 | `tail -50 ~/.xhs-mcp/xhs-mcp.log` |
| 强制重新下载 | 删除 `~/.xhs-mcp/bin/` 下的二进制后重新执行 Step 0 |
| 升级版本 | 改 `scripts/start-xhs-mcp.sh` 顶部的 `XHS_VERSION`/`BIN_SHA256`（Windows 同步改上方代码块的版本号与 `$sha`），新摘要取自 release 页面；也可自行 `CGO_ENABLED=0 go build` 后放 `~/.xhs-mcp/bin/` |

边界：浏览器自动化方案，页面改版可能失效（更新二进制即可）；单任务控制在 10 次工具调用以内；只用只读工具，不碰发布/评论/点赞。
