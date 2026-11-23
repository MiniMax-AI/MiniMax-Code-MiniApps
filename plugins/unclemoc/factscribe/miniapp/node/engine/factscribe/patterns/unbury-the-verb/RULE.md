# unbury-the-verb｜把埋进名词的动作挖回动词

## 治的判据

- 错误码：LIGHT_VERB_NOMINALIZATION
- 现象：轻动词（make / perform / conduct / carry out / give / take…）后面
  跟着一个 `-tion / -sion / -ment / -ance / -ence / -ity / -ness / -sis`
  名词，动词本身不承载动作，动作藏在名词里。判据与词表见
  `docs/design/SPEC-SYNTAX.md` §1。

## 必做

1. 先找出名词背后的动作：`make a distinction` 的动作是 distinguish，
   `perform an analysis` 的动作是 analyze。
2. 把动作直接写成动词，去掉轻动词与名义化名词：
   `make a distinction` → `distinguish`。
3. 把施动者放回主语：谁做这个动作，谁就作主语；不要留「由……进行」。
4. 一句话只保留一个主要动作；原句有两个动作时拆成两句，先写主动作。
5. 改写只动措辞，事实、数字、条件、引用保持原样。

## 禁做（含反例）

- 禁换成另一个轻动词。反例：`make a decision` → `take a decision`
  （动作仍在 decision 里）。
- 禁把名义化名词换成另一个抽象名词。反例：
  `perform an evaluation` → `conduct an assessment`（还是没挖出动作）。
- 禁为了去掉名词而删掉宾语或限定。反例：
  `We make a distinction between the two paths.` → `We distinguish.`
  （丢掉「两条路径」这个区分对象）。
- 禁把 `-ity / -ness` 状态名词硬改成动词。反例：
  `establish superiority` → `superior`（不成句；这类由乙组精度边界挡在
  判据外，处方也不该硬改）。
- 禁改动词时态或主语数导致与上下文不一致。

## 改写示例（旧 → 新）

| 旧 | 新 | 说明 |
|---|---|---|
| `We make a distinction between the two runtime paths.` | `We distinguish the two runtime paths.` | make a distinction → distinguish |
| `The team performed an analysis of the failing runs.` | `The team analyzed the failing runs.` | perform an analysis → analyze |
| `We carried out an evaluation of the gate.` | `We evaluated the gate.` | carry out an evaluation → evaluate |

旧 → 新不删数字、条件与引用，也不改论证对象。

## 验收命令

```bash
env PYTHONPATH=src python3 -m factscribe prescribe unbury-the-verb --json
```

改完把正文换进项目后再复核（文档模式）：

```bash
env PYTHONPATH=src python3 -m factscribe style --doc <文件> --json
```

`LIGHT_VERB_NOMINALIZATION` 不再出现即闭合；只把轻动词换掉不算改完。
