---
name: usage-query
description: 查询本机 MiniMax Code 的 token 用量——总量、输入/输出/缓存、缓存命中率、调用次数、平均速度，可按时间范围、模型、会话筛选，也给出最近调用明细、项目分布与工具调用统计。当用户问"用了多少 token""这个对话消耗多少""哪个模型用得多""缓存命中率多少""最近调用情况""统计一下用量"等与本机用量有关的问题时使用。需要看趋势图或自己切筛选时，再引导用户打开「Token 用量看板」页面。
---

# Token 用量查询

本插件自带一个一次性的数据后端 `api.py`：它只读打开本机运行时数据库的快照，去重、聚合后把结果以单行 JSON 写到 stdout。查询不需要打开看板页面，也不会锁库或干扰正在运行的 MiniMax Code。

## 1. 定位脚本

数据后端在本 skill 目录向上两级：

```
<本 skill 目录>/../../miniapp/node/api.py
```

拿不到 skill 绝对路径时，用插件的默认安装位置：

| 系统 | 路径 |
| --- | --- |
| Windows | `%USERPROFILE%\.minimax\plugins\mcode-usage-monitor\miniapp\node\api.py` |
| macOS / Linux | `~/.minimax/plugins/mcode-usage-monitor/miniapp/node/api.py` |

数据目录被 `MINIMAX_DATA_DIR` 覆盖时，把其中的 `.minimax` 换成该变量指向的目录。调用前先确认文件存在；两处都不存在时，说明插件未装在该位置，请用户确认安装路径。

## 2. 调用

```bash
python "<api.py 路径>" --range today
```

Windows 上按本机情况使用 `python` 或 `py -3`。

| 参数 | 取值 | 说明 |
| --- | --- | --- |
| `--range` | `today` / `1h` / `12h` / `24h` / `7d` / `30d` / `all` / `<N>h` | 时间范围；`<N>h` 为自定义整数小时（1–8760） |
| `--models` | 逗号分隔模型名 | 省略即全部 |
| `--sessions` | 逗号分隔会话 id | 省略即全部；`mvs_` 开头的 id |
| `--db` | 数据库路径 | 一般不用，默认指向本机运行时数据库 |

常用组合：

```bash
# 本对话的用量（session id 用当前会话的）
python "<api.py>" --range all --sessions <当前 session id>
# 最近 7 天，只看某个模型
python "<api.py>" --range 7d --models glm-5.3
# 全部历史概览
python "<api.py>" --range all
```

## 3. 输出结构

stdout 是一行 JSON；出错时只有一个 `{"error": "..."}`。

| 字段 | 内容 |
| --- | --- |
| `generated_at` / `range` | 取数时间与本查询范围 |
| `overview` | 汇总：`calls` 调用次数、`sessions` 会话数、`input_tokens`、`output_tokens`、`cache_read_tokens`、`total_tokens`、`hit_rate_pct` 缓存命中率、`avg_tok_s` 加权输出速度、`sum_dur_s` 累计生成时长 |
| `available_models` | 范围内的模型清单（`model` / `calls` / `output`） |
| `available_sessions` | 会话清单（`session_id` / `title` / `calls` / `tokens` / `last_ts`） |
| `models` | 逐模型明细，含 `hit_rate`、`avg_dur_ms`、`tok_s` |
| `series` | 按时间跨度自动分桶的时序（`input` / `output` / `cache_read` / `calls` / `tok_s`） |
| `recent` | 最近 60 条调用明细（`time` / `model` / `session` / `input` / `output` / `cache_read` / `dur_ms` / `tok_s`） |
| `projects` | 按会话工作区目录汇总的 Top 8 |
| `tools` | 工具调用次数 Top 10 |

## 4. 口径

- Token 消耗 = 输入 + 缓存读取 + 输出；缓存命中率 = 缓存读取 ÷（缓存读取 + 输入）。
- 按 `msg_id` 跨会话去重：会话重建时历史消息会被复制进新会话，同一批调用只计一次。
- 一个会话通常只用一个模型；模型清单与会话清单互相牵制，筛选一侧会同时收窄另一侧。
- 这是本机近实时观测，计费与额度以产品内「用量」页为准（服务端统计有延迟，口径也可能不同）。报数字时如果用户关心准确性，说明这一差异。

## 5. 怎么回答

- 问概览就报 `overview` 的关键数字；问"哪个模型/会话用得多"就读 `models`、`available_sessions` 排序后回答；问"最近在忙什么"可读 `recent` 里的 `session` 与 `model`。
- "本对话"指当前会话：把当前 session id 传给 `--sessions`；不确定时先不带筛选跑一次，再从 `available_sessions` 的标题里匹配。
- 用户想看趋势图、想自己切换筛选或调整布局时，引导打开「Token 用量看板」页面（在 Mini App 面板中打开，或直接说"打开 Token 用量看板"）。

## 6. 故障

- `python` 找不到：本插件需要本机 Python 3.8+，只用标准库，无需 `pip install`。
- `{"error": "database not found: ..."}`：本机还没有运行时数据，或数据目录被 `MINIMAX_DATA_DIR` 改过。
- `{"error": "sqlite JSON1 extension not enabled ..."}`：本机 Python 自带的 SQLite 未启用 JSON1 扩展，属环境问题。
- 每次调用会启动一个新进程（实测几十到几百毫秒），不要循环高频调用。
