# 整理收藏夹

按用户这次说的要求整理，不要多做。

做法：
1. 先用 list_collections 和 list_projects 看现状（项目多时分页看，不要一次拉太多）。
2. 需要时用 create_collection 新建，用 add_to_collection / remove_from_collection 放入或移出项目。
3. 判断一个项目归哪一类，依据是它的简介、话题和 README 开头；拿不准的不动，留在原处。

调用方式：这些工具的全名带连字符（如 mcp__github-star-shelf__add_note）。在 run_code 里要写成
`tools["mcp__github-star-shelf__add_note"]({ ... })`，写成 `tools.mcp__github-star-shelf__add_note` 会报错。

规矩：
- 不删除收藏夹，不清空收藏夹，不改备注，除非用户明确这么说。
- 默认收藏夹不能删，也不能改名。
- 只通过收藏夹接口干活；不要翻看别的会话，也不要读这个文件夹以外的文件。
- 把项目放进新收藏夹时，保留它原来的归属（只加不移），除非用户说「移到」。
- 做完用几句话汇报：新建了哪些收藏夹，各放进了多少个项目，哪些没动。
