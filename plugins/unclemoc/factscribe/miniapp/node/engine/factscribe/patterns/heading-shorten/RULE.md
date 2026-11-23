# heading-shorten｜压标题长度（保留对比对象与主语）

## 治的判据

- 错误码：HEADING_TOO_LONG
- 现象：中文标题超过 12 字，或英文标题超过 8 词。阈值见
  `style-rules.toml` 的 `heading_max_chars_zh` / `heading_max_words_en`。
- 只压长度，不改论证方向；与保结构的处方冲突时，保结构优先
  （见 `factscribe/patterns/priority.toml`）。

## 必做

1. 改写前先把标题里的对比对象、主语与关系词抄下来，改写后逐项核对。
2. 只删修饰语、解释性从句、括号补充与重复限定。
3. 压不下就换成更短的名词短语，不删论证对象。
4. 英文标题压到 8 词内，保留核心名词与关系词。
5. 被删掉的解释移到本节首句，不许连信息一起丢。

## 禁做（含反例）

- 禁删对比对象。反例：`提示词对机制` → `提示词`（压短后「机制」消失，
  论证对象被删）。
- 禁删主语，也禁把主语换成泛词（`本文`、`该方法`）。
- 禁把解释改写成括号或破折号塞回标题（会触发 HEADING_MALFORMED）。
- 禁替换关系词（versus→or、对→和）；长度不是改论证方向的理由。

## 改写示例（旧 → 新）

| 旧 | 新 | 说明 |
|---|---|---|
| `提示词对机制的可检验差异研究` | `提示词对机制的差异` | 删「可检验」「研究」，保留两个对象与关系词「对」 |
| `An empirical comparison of prompt versus mechanism under stress` | `Prompt versus mechanism under stress` | 删「An empirical comparison of」，保留 versus 与两个对象 |

旧 → 新只动标题，不动正文事实。被删掉的「可检验」写进本节首句。

## 验收命令

```bash
env PYTHONPATH=src python3 -m factscribe prescribe heading-shorten --json
```

改完把标题换进项目后再复核（占位符由人替换）：

```bash
env PYTHONPATH=src python3 -m factscribe style <项目> --diff <改前目录> --json
```
