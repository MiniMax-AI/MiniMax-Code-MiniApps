---
name: h3-image-executor
description: 用户要画图、生成图片、做张图、画漫画/海报/插画/信息图/写真时使用。把需求原样送进 H3-Image-Executor Mini App，跑完整的检索参考图→规划→生成→看图评审→色偏校正→修正循环→选优→4K 交付流水线。用户点名要用别的工具、或者说不想用这个面板时，按用户说的做。
---

# 把画图需求交给 H3-Image-Executor

## 默认规则

**画图需求默认交给 H3-Image-Executor，不要自己在聊天里生图。**

用户在聊天里说「画一张…」「帮我生成…」「做张图…」「画个漫画…」时，默认不要调 `generate_image`、
不要加载 `image-generation` skill、不要调别的生图 MCP 工具，也不要自己写 prompt 去画；
你在聊天里要做的是把需求**递进去**。

自己生图会绕过这条流水线的全部价值：参考图检索、分镜规划、看图评审、色偏校正、修正循环、
跨图角色一致性、4K 交付和验收报告，一个都不会有。用户看到的会是一张没有 request_id、
没法复现、也没法接着调的图。

**例外：用户说了算。**

- 用户点名要用别的工具或模型（例如「用 xxx 画」），或者说不想用这个面板，就按用户说的做。
- 用户说自己没有 H3-Image 接口、面板提示「未配置生图接口」而用户不打算配置时，告诉用户可以在面板左下角
  配置接口，或者改用别的生图方式，由用户选。

## 怎么做

```js
miniapp({
  action: 'open',
  pluginId: 'h3-image-executor',
  path: '/dashboard?prompt=' + 需求原文 + '&len=' + 字符数 + '&auto=1'
})
```

面板打开后会自己把需求填进输入框并提交，用户看到的是「面板打开 → 已经在画」。
调用完就可以告诉用户「已经开始了，在右侧面板看进度」，**不要**再去轮询或自己画。

## 参数

| 参数 | 说明 |
| --- | --- |
| `prompt` | 需求文本。**逐字传递用户说的话**，不要改写、扩写，不要替用户补风格词 |
| `auto` | `1`（默认）填完直接提交；`0` 只填不提交，留给用户自己按发送 |
| `session` | 会话 ID（如 `20261109-877482`）。带上它就是**接着调那张图**，不带就是开新的一张 |
| `len` | `prompt` 的字符数（按字符算，不是字节）。面板会比对，对不上就在需求气泡上挂一条「需求可能在传输中损坏」，**不拦截**，只是提醒用户核对 |

## 不要对中文做 percent 编码

`prompt` **原样拼进 query**。不要自己把中文转成 `%E6%A9%98` 这种形式。

宿主会自己完成编码：`橘猫趴在窗台上晒太阳` 原样传进去，地址栏会变成
`?prompt=%E6%A9%98%E7%8C%AB...`，页面解出来与原文完全一致。

手工编码是错字的主要来源：你没有 JS 引擎，只能凭记忆把每个字换算成 UTF-8 字节，
错一两个字页面上看不出任何异常，错字会一路画到交付。比如
`猫`(U+732B，应为 `E7 8C AB`) 被写成 `E7 8C AA` = `猪`(U+732A)，
需求就变成「橘猪趴在窗台上晒太阳」，整张图白画。

只有这 4 个 ASCII 字符必须编码——宿主不会替你转，它们会破坏 query 结构：

| 字符 | 写成 | 不编码的后果 |
| --- | --- | --- |
| `&` | `%26` | 后半截变成另一个参数，需求被截断 |
| `+` | `%2B` | 被解成空格 |
| `#` | `%23` | 变成 fragment，工具直接拒绝 |
| `%` | `%25` | 畸形百分号转义，工具直接拒绝 |

`=` 不用管，值里的 `=` 能完整保留。

## 三条纪律

1. **需求原文逐字传。** 流水线第一步就是规划，用户的话会被拆成 prompt；你先「帮忙润色」一遍，
   等于把用户的原意换掉，而且事后没人知道改了哪。缺信息（尺寸、张数、风格）就问用户，
   不要自己替他决定。

2. **可以先查资料，但只把需求说清楚，不要把资料塞进 prompt。**
   比如「把今天的天气预报画成一张四格漫画」：可以先 `web_search` 弄清今天的天气，
   然后传一句绘画需求进去（说明画什么、什么形式）。
   不要把新闻正文、检索结果整段拼进 `prompt`——那是规划器该消化的输入格式，不是给人写的。

3. **一次 `open` 就是一次作画。** 用户要四张图，流水线会自己拆成四张并锁定角色一致性，
   不要手动开四个会话，也不要分四次调用。

## 用户接着提修改

用户在聊天里说「把背景换成夜景」「再加一张」时，如果指的是刚才那张图，带上 `session`：

```js
miniapp({
  action: 'open',
  pluginId: 'h3-image-executor',
  path: '/dashboard?session=' + sessionId + '&prompt=' + 修改要求 + '&len=' + 字符数 + '&auto=1'
})
```

不带 `session` 会开成一张全新的图，用户会以为上一张白画了。

## 交付之后

面板里会出验收报告和每张图的 `request_id`。用户问「画得怎么样」「用的什么 prompt」
「为什么这张失败了」，去读会话目录：

```
<插件数据目录>/sessions/<sessionId>/session.json
```

- `turns[].events[]` —— 每个阶段的进展，带 `stage` 和 `requestId`
- `images[]` —— 每张图的 `id` / `status` / `failReason` / `requestId`
- `status` —— `delivered` / `failed` / `running` / `cancelled`

不要把 `request_id` 截断或省略，用户要拿它去查账。

## 分享页与公开链接

每次交付都会自动把一份自包含的分享页落到：

```
<插件数据目录>/sessions/<sessionId>/share/index.html
```

**面板上的「发布公开链接」按钮会自己完成发布，你不需要再手动部署。**
用户点一下，按钮变「发布中…」，服务端起一个 Agent turn 去调 `website_deploy`。
这次调用**必须由用户在面板上点「允许一次」**才会执行：面板不会替用户放行，你也不要替用户回答。
好了之后链接会自动写进剪贴板——用户直接粘给别人就行。按钮下面常驻一行
「发布后任何拿到链接的人都能打开……」，写明了页面会公开哪些内容，这是用户点下去之前能看到的告知，不要把它删掉。

为什么能这么做：Mini App 的 `context` 只有 `agent / capabilities / hostConnector /
listen / logger / tool`，没有任何 drive / upload / storage 能力，页面和服务端自己做不到部署；
而 `website_deploy` 是 Host 的顶层控制工具，只下发给 Agent turn。所以唯一通路就是
`context.agent.run`（见 `miniapp/node/lib/publish.mjs`）。

**你不要主动替用户发布。** 用户没点按钮、也没明确说要公开链接时，不要自己调
`website_deploy`——公开发布是不可逆的外向动作。

### 什么时候还需要你介入

- **按钮发布失败**，用户让你排查。看会话事件流里 `stage=share` 的记录，失败原因会写在
  `shareError` 上（`publish_timeout` / `publish_no_url` / `publish_turn_failed` / `publish_asked_question` /
  `publish_aborted` / `publish_not_permitted`）。`publish_timeout` 最常见的原因是用户没在面板上点「允许一次」。
- **用户要重新发布或换站点。** 这时你自己调 `website_deploy`：

  ```bash
  mkdir -p <工作区>/h3-share/<sessionId>
  cp <插件数据目录>/sessions/<sessionId>/share/index.html <工作区>/h3-share/<sessionId>/
  ```

  `website_deploy` 只接受当前工作目录下的路径，直接传插件数据目录会被拒：
  `Cannot deploy: '...' is outside the workspace or invalid`。
  要更新已有站点就传 `node_id`，那会**整体替换**线上内容；不传就是新建一个站点。
  这两种结果不对称，先问用户要哪个。

  部署前核一遍这份 HTML 不含绝对路径、Key 和远程资源，三项都必须是 0：

  ```bash
  python3 -c "import re;s=open('<路径>/index.html',encoding='utf8',errors='replace').read();\
  print('abs',len(re.findall(r'/Users/|[A-Za-z]:\\\\\\\\Users',s)),'key',len(re.findall(r'sk-[A-Za-z0-9_-]{16,}',s)),\
  'remote',len(re.findall(r'https?://[a-z]',s)))"
  ```

  拿到 URL 后直接告诉用户。面板只显示它自己发布出去的链接，不会显示你手动部署的这一个。

分享页体积通常 3–7 MB：内嵌图统一走 JPEG，每张交付图另带一份长边 2048px 的大图（点开时显示，
总量上限 4 MB，超出的几张点开仍是预览大小）。仍然偏大时告诉用户「这批图太多，分享页偏大」，不要闷头重试。

## 需要人工复核生成图时

流水线自己会做看图评审。确实需要你亲自看图时，用 `h3-image-review` skill 里的
`h3-review` 命令产出固定版式的看图材料，不要自己写裁图、拼图、量像素的脚本。
