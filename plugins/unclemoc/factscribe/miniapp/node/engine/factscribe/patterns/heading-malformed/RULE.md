# heading-malformed｜标题去标点但不许改关系

## 治的判据

- 错误码：HEADING_MALFORMED
- 错误码：HEADING_RELATION_CHANGED
- 现象：标题里出现冒号、问号、句号、破折号，或括号解释；或者改写时
  把对立关系词换掉、删掉。

## 必做

1. 去掉冒号、问号、句号、破折号与括号解释，标题只留名词短语。
2. 把被删掉的解释移到本节首句，别丢信息。
3. 保留主语与全部对比对象。
4. 关系词（versus / vs / 对 / not / 不是 / without / 而非）保留，
   或只在同义组内替换（versus ↔ vs ↔ 对）。
5. 英文标题不留句末标点；中文标题不用问号制造悬念。

## 禁做（含反例）

- 禁替换关系词。反例：`Prompt versus mechanism` → `Prompt or mechanism`：
  versus 是对立，or 是选择，论证方向被改掉。
- 禁删掉关系词把对比改成并列。反例：`提示词对机制` → `提示词和机制`
  （并列不是原来的对照）。
- 禁把括号解释改成破折号或第二个冒号（仍然是 malformed）。
- 禁为了去标点连第二个对象一起删。

## 改写示例（旧 → 新）

| 旧 | 新 | 说明 |
|---|---|---|
| `Prompt versus mechanism: a controlled test` | `Prompt versus mechanism under test` | 去冒号，保留 versus 与两个对象 |
| `提示词对机制：一次对照实验` | `提示词对机制的对照实验` | 去冒号，保留「对」与两个对象 |
| `为什么提示词会失效？` | `提示词失效的条件` | 去问号，把设问改成名词短语 |

旧 → 新只动标题标点；被删的解释写进首句。

## 验收命令

```bash
env PYTHONPATH=src python3 -m factscribe prescribe heading-malformed --json
```

改完把标题换进项目后再复核（占位符由人替换）：

```bash
env PYTHONPATH=src python3 -m factscribe style <项目> --diff <改前目录> --json
```
