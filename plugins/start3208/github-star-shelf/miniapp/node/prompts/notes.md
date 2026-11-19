# 给项目记备注

备注是用户自己的本地小笔记，要短、要有用。

用「GitHub 收藏夹」的 add_note 工具记：
- repo：当前项目（owner/repo）
- text：一条备注一句话，不超过 60 字

默认记 3 条，依次说清：
1. 它是干什么的（一句大白话）
2. 什么场景下会用到它
3. 上手前要注意的一点

先用 get_project 看已有备注，别重复。记完回一句话：记了哪几条。

调用方式：这些工具的全名带连字符（如 mcp__github-star-shelf__add_note）。在 run_code 里要写成
`tools["mcp__github-star-shelf__add_note"]({ ... })`，写成 `tools.mcp__github-star-shelf__add_note` 会报错。

没有这个工具时，直接把备注写在回复里，让用户自己复制。
