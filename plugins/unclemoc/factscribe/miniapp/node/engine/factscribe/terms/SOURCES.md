# 词表来源

这三份是**数据**，不是代码。本仓不实现制品导入器，也不解析 `termbank.tb` 的二进制格式。

## termbank-core.tsv

- 内容：词库核心层，`status = draft` 的 151 条，字段 `id/cn/en/aliases/slot/status`。
- 来源：`sia-harness/nomenclator/termbank.tb`（库版本 18，总条目 2,206,115）。
- 生成：在 `sia-harness` 侧用 Python 3.14 读制品后一次性导出；本仓只保留结果。
- 用途：术语表候选。**不自动进** `paper.tsv`，要人勾。

## cilin-groups.tsv.gz

- 内容：9,995 组同义词类，每行 `组号 \t 成员1|成员2|...`。
- 来源：`sia-harness/nomenclator/refsrc/CoreSynonym.txt`（哈工大《同义词词林》扩展版，HanLP 分发面）。
- 为什么不用 termbank：制品压缩时把组结构拍平成单词行，**组信息丢失**；只能回原料取。
- 用途：只做「疑似同义」提示。词林分的是**概念近义**，不是可互换；自动合并会重演 `成本` / `预算` 那类误报。

## 为什么不复制整个 termbank.tb

1. 13 MB 自研二进制，读取依赖 Python 3.14 的 `compression.zstd`；本仓最低支持 3.10。
2. 其中 179 万条是无词频、无词性的词面，分词价值低于 `jieba-dict`（34.9 万条，带词频与词性）。
3. 真正有增量的是核心层与同义词组，两者合计不到 260 KB。

需要更多词面时，复制 `jieba-dict.txt` 并另存一份来源说明，不要再引入二进制制品。

## seg.tsv.gz

- 内容：结巴分词自带词典，349,046 行，三列 `词 词频 词性`，UTF-8，gzip 后约 1.9 MB（1,904,875 字节）。
- 来源：`sia-harness/nomenclator/refsrc/jieba-dict.txt`（源文件 sha256 `7197c3211ddd98962b036cdf40324d1ea2bfaa12bd028e68faa70111a88e12a8`）。
- 许可：MIT／结巴分词（jieba）自带词典。本仓只复制数据，不引入 jieba 依赖。
- 生成命令（在仓根 `factscribe-dev/` 执行）：
  ```bash
  python3 - <<'PY'
  import gzip, pathlib
  src = pathlib.Path("../sia-harness/nomenclator/refsrc/jieba-dict.txt")
  dst = pathlib.Path("factscribe/terms/seg.tsv.gz")
  with open(src, "rb") as f, open(dst, "wb") as out:
      with gzip.GzipFile(filename="", mode="wb", fileobj=out,
                         mtime=0, compresslevel=9) as gz:
          gz.write(f.read())
  PY
  ```
  固定 `mtime=0` 且不写文件名，同一源文件生成的字节可复现。
- 为什么不复制 termbank 的 179 万词面：那一层**无词频、无词性**。分词器要在「同一位置多解」时按词频消歧、判据要按词性选名词，两者都拿不到依据；纯词面只会把 `南京市` 切成 `南京/市` 这类碎片。需要词频与词性时必须回原始 `jieba-dict`，不要把二进制制品引进来。
