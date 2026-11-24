# guide — 新手引导用的示例论文

一份「假装但自洽」的小论文。它**故意是红的**，而且只红在我们写明的两处。
这份文件随包发布：工作台点一次「打开示例论文」，它会被复制到
`~/.factscribe/samples/guide`（你的论文不受影响）。

在那个目录里跑：

```bash
cd ~/.factscribe/samples/guide
python3 -m factscribe check .    # exit 0  — 账是齐的
python3 -m factscribe audit .    # exit 1  — 2 红 7 黄
```

期望的审计读数：

```
numbers : 10（bound 4 / unbound 5 / unmatched 1）
cites   : 2 calls, 2 keys; bib 2 entries (1 used)
[red] 2
  UNMATCHED_NUMBER  sections/02-results.tex:17:17 → 47.3   (编出来的时延)
  MISSING_CITE      sections/02-results.tex:19:14 → ghost2024 (bib 里没有的引用)
[yellow] 7  — 表里的数字没绑定、main.tex 没进闭包、绑定率偏低
```

## 按顺序看

1. `facts/01-core.toml` — 三条事实。`A1 = 10/16`、`A3 = 8/16`，`A2` 由它们推算
   （`expr = "(A1.num + A3.num) / (A1.den + A3.den) * 100"`）。每条事实都用
   `source_sha256` 钉住 `results/swb16.md`（每次审计现算）。
2. `results/MANIFEST.toml` — 人签的清单。删掉它，`check` 转黄（`NO_MANIFEST`）；
   改 `results/swb16.md` 一个字节，两条命令都转红（sha 对不上）。
3. `sections/01-intro.tex` — 顺的路：`10\fact{A1}`、`8\fact{A3}`、`56.25\%\fact{A2}`。
   每一行的数字都绑在拥有它的那条事实上，所以这几行是绿的。
4. `sections/02-results.tex` — 两处埋好的坑：`47.3\,ms`（账里没有）和
   `\cite{ghost2024}`（bib 里没有）。表格里的数字是**没绑定**的（黄牌），
   区别就在「我们知道」和「我们希望」之间。
5. `refs.bib` — 每条都带 `doi` 或 `arxiv`；有一条没被引用（`UNUSED_BIB`，信息级）。

## 把它改绿（练习）

就地改，然后重跑 `audit`：

1. 给那个时延补一条事实（真实的 `source` + `source_sha256`），并把行绑上：
   `47.3\,ms\fact{A4}`。（或者删掉这句话。）
2. 删掉 `\cite{ghost2024}`，或者把这条加进 `refs.bib`。
3. 把表格里的数字绑上：行上放 `\fact{A1}` / `\fact{A3}`。
4. `main.tex` 在 `sections/*.tex` 之外，所以有 `UNSCANNED_TEX`；要么收窄 glob，
   要么接受这条黄牌。

`audit --strict` 是 CI 形态：任何黄牌都变成非零退出码。

## 走一遍报告链路（界面里的新手引导）

示例还自带一份可签的报告：`reports/guide.report.toml`，数字来自
`results/guide-summary.json`（`p95_ms = 12.5`）。

1. 打开「实验报告」页，选 `guide.report.toml`，依次点「检查」「封存」「签收」
   （签收人写你的名字）；
2. 点「导入」：账里会多出 `facts/guide.guide-1.toml`，事实 id 是
   `guide.guide-1.p95`；
3. 回到正文，把 `47.3\,ms` 改成 `12.5\,ms\fact{guide.guide-1.p95}`，
   删掉 `\cite{ghost2024}`；
4. 重跑审计：红牌清零（黄牌仍要人判断，退出码可能是 3）。

## 复制它当起点

```bash
cp -R ~/.factscribe/samples/guide my-paper
cd my-paper
python3 -m factscribe check .
```

然后把 `facts/`、`results/`、`sections/` 换成你自己的，并重写一份
`results/MANIFEST.toml`（`signed_by` 写你的名字）。不要沿用样例里的哈希。
