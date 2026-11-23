# shift-to-implication｜把「我们做了 X」改成「X 意味着 Y」

## 治的判据

- 错误码：WE_ACTION_DENSITY
- 现象：主语是 we/我们、谓语是动作动词（跑/做/试/改/加/删/测/查/记；
  ran/did/tried/changed/added/removed/tested/looked）的句子占比超过 15%。
  动作句只说明做过什么，不说明结果意味着什么。`we propose` / 「我们提出」
  这类修辞或认知动词不计入。

## 必做

1. 把主语从「我们」换成**对象或结论**：`We ran three comparisons.` →
   `Three comparisons separate the two cases.`
2. 补出「所以呢」：动作句后面那句结论如果是隐含的，把它写成主句。
   例：`We tested 9 sets.` → `Nine sets, and the gate's recall rose across them.`
3. 一段最多留一句「我们做了」：方法节需要交代操作时保留，讨论节改成
   「这意味着」。
4. 保留动作句里的事实、数字、条件与引用；只换主语和谓语，不加新结论。
5. 中文同样处理：`我们跑了三次实验` → `三次实验给出同一条曲线`。

## 禁做（含反例）

- 禁把「我们提出」也算成动作句来硬改——它本来不是动作句，不需要改。
- 禁把动作句改成没有主语的残句。反例：`We tested nine sets.` → `测试了九组。`
- 禁为了换主语删掉施动者该承担的责任。反例：`We did not patch the defects.`
  → `The defects were not patched.`（谁没修，读者看不出来。）
- 禁把「我们」换成「本文」就算改完。反例：`我们跑了三次实验` → `本文跑了三次实验`
  （主语换了，还是在说做了什么。）
- 禁新增原文没有的因果结论。反例：`We changed the parser.` →
  `The parser change caused the gain.`（因果没证据。）

## 改写示例（旧 → 新）

| 旧 | 新 | 说明 |
|---|---|---|
| `We ran three comparisons.` | `Three comparisons separate the two cases.` | 主语换成对象，补出含义 |
| `We tested nine sealed sets.` | `Nine sealed sets, and recall rose from 0/12 to 11/12.` | 保留读数，动作变结果 |
| `我们改了判卷脚本。` | `判卷脚本的改动把误报从 8 条压到 2 条。` | 动作变结果，数字不丢 |

旧 → 新不删数字、不删限定、不新增因果。

## 验收命令

```bash
env PYTHONPATH=src python3 -m factscribe prescribe shift-to-implication --json
```

改完把正文换进项目后再复核：

```bash
env PYTHONPATH=src python3 -m factscribe style <项目目录> --json
```

看 `WE_ACTION_DENSITY` 的读数是否回到 15% 以内；再看 `review` 的保护面是否
仍然全绿。
