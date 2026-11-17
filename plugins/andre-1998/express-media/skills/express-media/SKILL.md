---
name: express-media
description: 在本地把视频压到各平台能收的体积，并如实报告发不发得出去。当用户说视频太大发不出去、要压到某个大小、问微信/Telegram/Discord/邮件/小红书/抖音/B站的视频体积限制、要转 GIF 表情包、要裁剪视频、或压不进去要分段时使用。不处理字幕烧录、封面设计，也不递归批量处理整个目录。
---

# 急件 · 视频投递

本机视频处理工具。核心原则：**压完会真的去量，量完才告诉用户成没成。**

## 工具位置

可执行入口是插件根目录下的 `bin/express.mjs`：

```text
<插件根>/bin/express.mjs
<插件根>/src/*.js
<插件根>/data/platforms.json     # 平台限制表（带来源与置信度）
```

`<插件根>` 就是本 SKILL.md 所在目录的上两级。例如 SKILL.md 在
`.../plugins/express-media/skills/express-media/SKILL.md`，则插件根是
`.../plugins/express-media`。

把它拼成绝对路径再调用，不要假设当前工作目录：

```powershell
node <插件根绝对路径>\bin\express.mjs inspect "<视频文件路径>"
```

macOS / Linux 把 `\` 换成 `/` 即可，命令名与参数完全一致。

## 什么时候用

- 「这个视频发不到微信 / 发不出去 / 太大了」
- 「帮我压到 25MB / 20MB 以内」
- 「微信、Telegram、Discord 的视频限制是多少」
- 「转成 GIF / 做表情包」（表情包上限 1MB）
- 「视频太长，裁一段 / 切成几段」

## 什么时候不用（别硬套）

- 要**烧录字幕**、加片头片尾、改 BGM —— 这个工具只做「压缩 / 裁剪 / 转格式」
- 要**批量递归处理整个文件夹** —— 一次只处理一个文件，用户要批量就逐个调用
- 源文件不是视频（图片、音频、文档）
- 用户要的是「重新导出」而不是「压到能发」

## 标准流程

### 第 0 步：环境体检（只在第一次或用户报环境异常时跑）

```bash
node <插件根>/bin/express.mjs doctor
```

退出码 `0` 才说明 ffmpeg 可用。这个命令会同时报出**坏的候选**（例如 Windows 上
`WinGet\Links` 里的悬空符号链接：`where ffmpeg` 查得到、一执行就报找不到文件），
并自动绕开它去找能用的那个。看到 warn 行要如实转达给用户。

### 第 1 步：体检并判定（用户问「能不能发」时）

```bash
node <插件根>/bin/express.mjs inspect "<文件>"            # 人类可读表格
node <插件根>/bin/express.mjs inspect "<文件>" --json     # 结构化
```

会输出时长、体积、分辨率、码率、旋转、HDR，以及**每个平台的上限、超出多少、这个数字是谁说的**
（`官方` / `社区实测` / `口径不一`）。平台表在 `data/platforms.json`，每条都带来源 URL。

### 第 2 步：压（主力动作）

```bash
node <插件根>/bin/express.mjs fit "<文件>" --to <目标>
```

`<目标>` 可以是平台 id，也可以是自定义大小：

| 平台 id | 上限 | 置信度 |
| --- | --- | --- |
| `wechat-chat` | 25 MB + 限 5 分钟 | 口径不一（1 GB / 25 MB，取保守值） |
| `wechat-moments` | 10 MB + 限 30 秒 | 社区实测 |
| `telegram-bot` | 50 MB | **官方** |
| `discord-free` | 20 MB | 口径不一（25 MB / 20 MB，取保守值） |
| `discord-nitro` | 50 MB | 社区实测 |
| `gmail` | 25 MB | 社区实测 |
| `xiaohongshu` | 1 GB + 限 15 分钟 | 社区实测 |
| `douyin` | 72 MB + 限 15 分钟 | 社区实测 |
| `bilibili` | 8 GB + 限 10 小时 | 社区实测 |
| `shipinhao` | 1 GB + 限 30 分钟 | 社区实测 |

上表由 `data/platforms.json` 逐条生成，两处数字必须一致；改表时以 JSON 为准，同步更新本表。

自定义大小写 `25MB` / `500k` / `1.5g`，也可以直接给字节数。下限 16KB。

常用参数：

| 参数 | 用途 |
| --- | --- |
| `--preset keep` | 保画质，不降分辨率 |
| `--preset small` | 再小一档（分辨率再降一级） |
| `--out <路径>` | 指定输出（不带扩展名会自动补上） |
| `--dry-run` | 只看压缩计划，**不产生任何文件** |
| `--normalize` | 体积已达标也重编码一遍，把方向烤进像素 |
| `--card` | 压完顺便生成一张投递卡 HTML |
| `--max-passes <n>` | 最多试几档，默认 4 |
| `--speed veryfast` | 机器慢时提速，画质略降 |
| `--no-ledger` | 不写台账（`~/.express/ledger.jsonl`） |

退出码：`0` 达标 ｜ `1` 压了但仍超限 ｜ `2` 参数或环境问题。**脚本里可以靠退出码判断成败。**

### 第 3 步：压不进去时（工具会自己给出替代方案）

工具不会闷声交一个超限文件说「好了」。它会明确报「压不进去」，并给出裁剪秒数、
分段数、发链接等建议。**这时候要把这些建议如实转达，不要自己另想办法悄悄降质量。**

真要分段：

```bash
node <插件根>/bin/express.mjs split "<文件>" --to wechat-chat
```

## 其他命令

```bash
node <插件根>/bin/express.mjs trim "<文件>" --start 0:10 --end 1:20   # 裁一段
node <插件根>/bin/express.mjs gif "<文件>" --width 320 --square       # 转 GIF/表情包
node <插件根>/bin/express.mjs card "<文件>" --to wechat-chat          # 只生成投递卡
node <插件根>/bin/express.mjs ledger                                  # 压缩台账与节省报告
node <插件根>/bin/express.mjs platforms                               # 看完整限制表和来源
node <插件根>/bin/express.mjs help                                    # 全部命令
```

## 向用户汇报时

**要给的数字**：原始体积 → 产出体积、压缩比、省下多少、目标上限、实际耗时。

**必须转达的三件事**：

1. **压不进去就说压不进去**，并把替代方案（裁多少秒 / 分几段 / 发链接）一起给出。
2. **平台限制是带来源的**。如果用户问「凭什么微信是 25MB」，要说明这是社区实测值，
   厂商客服口径是 1GB，工具取了更保守的那个；`platforms` 命令能看全部来源。
3. **体积达标但文件带旋转元数据**时，工具会提示「个别客户端会横着显示，加 `--normalize` 可烤进像素」。
   这条要转达，因为它是「文件没问题但对方看着是横的」这类问题的唯一线索。

**质量预期要诚实**：压到 25MB 的一分钟 1080p 录屏，画质一定有损失。
工具的策略是「优先降分辨率和帧率，尽量保住编码质量」，但如果用户对画质有硬要求，
建议先 `--preset keep` 试一次看体积够不够。

**不要**替用户承诺「画质无损」或「肯定能发上去」——平台规则会变，
本工具的判定基于 `data/platforms.json` 里的静态表（带 `updatedAt`）。
