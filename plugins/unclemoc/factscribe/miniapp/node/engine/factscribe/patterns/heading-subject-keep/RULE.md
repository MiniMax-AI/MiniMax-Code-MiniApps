# heading-subject-keep｜对比结构改写后对象必须在场

## 治的判据

- 错误码：HEADING_SUBJECT_LOST
- 错误码：HEADING_RELATION_CHANGED
- 现象：旧标题是对比结构（A 对 B / A versus B / A 而非 B），改写后
  第二个对象在新标题与新首句里都消失；或关系词被换掉。

## 必做

1. 改写前列出旧标题的全部对比对象与关系词。
2. 改写后逐个核对：每个对象必须出现在新标题或本节首句里。
3. 新标题只留一个对象时，首句必须交代另一个对象以及两者的关系。
4. 关系词保留，或只在同义组内替换
   （versus / vs / 对；not / 不是；without / 而非）。
5. 对比对象可以换措辞，但必须能被读者认回同一个对象。

## 禁做（含反例）

- 禁只留一个对象。反例：`提示词对机制` → `提示词`
  （「机制」在新标题与新首句里都没有）。
- 禁把第二个对象挪到下一节或很远的位置，充作「已出现」。
- 禁把关系词换成并列连接（对→和/与），那会把对照改成并列。
- 禁把对象换成泛词（`两者`、`双方`）而不给所指。

## 改写示例（旧 → 新）

| 旧 | 新 | 说明 |
|---|---|---|
| `提示词对机制的可检验差异` | 标题 `提示词对机制的差异`；首句 `本文在十六次运行里比较提示词与机制的差异。` | 标题保留两个对象；首句再点一次「机制」 |
| `Prompt versus mechanism under stress` | 标题 `Prompt versus mechanism under stress`；首句 `We compare prompt versus mechanism in sixteen runs.` | 不改关系词，首句复述两个对象 |

旧 → 新只改标题与首句；正文事实、数字、引用不动。

## 验收命令

```bash
env PYTHONPATH=src python3 -m factscribe prescribe heading-subject-keep --json
```

改完把标题与首句换进项目后再复核（占位符由人替换）：

```bash
env PYTHONPATH=src python3 -m factscribe style <项目> --diff <改前目录> --json
```
