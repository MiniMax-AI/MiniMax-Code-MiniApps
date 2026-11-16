# 急件 · 视频投递 (`express-media`)

[English](README.md) | 简体中文

视频太大发不出去，不是靠想想就能解决的。急件先量一遍你的片子在各平台到底能收多大，再在本机压到
刚好能发的大小；实在压不进去，它会直说，并给出下一步该怎么处理。

**全部在本机处理，文件不上传任何服务器。**

## 里面有什么

- **一个查上限的 Mini App**：一页列出所有支持平台的体积上限、时长上限、这个数字有多可信，以及它来自哪里。
- **一个内置 skill**：用大白话说就行 —— 「这个视频 90MB，微信发不出去，帮我压到能发的大小」、
  「微信、Telegram、Discord 的视频限制分别是多少」。
- **一个本地命令行工具**：同样的活儿，不用聊天也能做 —— 体检、压、分段、裁剪、转 GIF、出投递卡。

## Mini App

在右侧面板的 Mini App 入口打开，或直接让 Agent 打开「急件 · 平台限制速查」。页面读的是插件自带的
`data/platforms.json` —— 和 skill、命令行用的是同一份表，全程不联网。

## skill

```text
这个视频发不到微信 / 发不出去 / 太大了
帮我压到 25MB / 20MB 以内
微信、Telegram、Discord 的视频限制是多少
视频太长，裁一段 / 切成几段
```

skill 会驱动插件根目录下的命令行工具。每压一档都用 `ffprobe` 量真实体积，所以「达标」说的是磁盘上
那个文件真的那么大。真压不进去时，工具会明说，并给出替代方案，而不是丢一个仍然发不出去的文件给你。

## 命令行

```bash
node bin/express.mjs doctor            # 体检环境（先跑这个）
node bin/express.mjs inspect clip.mp4   # 多大、多长、能不能发
node bin/express.mjs fit clip.mp4 --to wechat-chat
node bin/express.mjs split clip.mp4 --to wechat-chat
node bin/express.mjs trim clip.mp4 --start 0:10 --end 1:20
node bin/express.mjs gif clip.mp4 --width 320 --square
node bin/express.mjs card clip.mp4 --from clip.mp4
```

退出码：`0` 达标 ｜ `1` 压了但仍超限 ｜ `2` 参数或环境问题。

## 安装

把这个目录（含隐藏的 `.minimax-plugin/`）整个复制进 MiniMax Code 的插件目录，命名为
`express-media/`（默认是 `~/.minimax/plugins/express-media/`；见根 README 的 Install 一节）。
重启 MiniMax Code 后，在右侧面板的 Mini App 入口打开「急件 · 平台限制速查」。

MiniMax Code 3.1.11 起也可以直接导入：在插件页选 **创建** → Mini App 下的 **从 Git 仓库导入**，
粘贴本目录地址：

```text
https://github.com/MiniMax-AI/MiniMax-Code-MiniApps/tree/main/plugins/andre-1998/express-media
```

压缩需要 Node.js 20.11 及以上，以及带 `libx264`、`aac`、`gif` 和 `sidedata` 滤镜的 ffmpeg；
只查上限的话两者都不需要。

## 实测环境

- Windows 11，Node.js 24，ffmpeg 9.0.2（`express doctor` 报告 `libx264`、`aac`、`gif`、`sidedata` 均可用）。
- 命令行与 skill 用真实视频跑过：96 个单测、63 个端到端测试全过；每个产物都用 `ffprobe` 独立量过体积，
  分段结果逐段核对了真实时长。
- Mini App 用桩 Host 上下文在本机跑过：Node 入口能起来，`/limits` 与 `/api/platforms` 都正常返回平台表。
  **尚未在 MiniMax Code 宿主里打开过**，宿主内的实际观感未经验证。

## 数据与权限

- **读取**：插件自带的 `data/platforms.json`，以及你指定的那个视频文件。没有别的。
- **写入**：压好的文件放在源文件旁边（或 `--out` 指定的位置）；除非加 `--no-ledger`，
  每次运行会在 `~/.express/ledger.jsonl` 追加一行台账。
- **网络**：无。插件不上传任何文件，上限页也不加载任何远程资源。
- **权限**：Mini App 没有声明 agent、tool、设备、宿主权限，不碰麦克风、摄像头和通知。
- **账号**：无。不需要登录，也没有任何使用数据离开本机。

## 许可

MIT