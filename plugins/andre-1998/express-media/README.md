# Express Media (`express-media`)

English | [简体中文](README.zh-CN.md)

A video that is too big to send is a problem you cannot solve by wishing harder. Express Media
measures your clip against the size each platform actually accepts, compresses it locally until
it fits, and tells you the truth when it cannot fit.

**Everything runs on your machine. No file is uploaded anywhere.**

## What you get

- **A Mini App that looks up the limits.** One page listing every supported platform: the size
  cap, the duration cap, how trustworthy that number is, and the source it came from.
- **A bundled skill.** Ask for it in plain language: "this video is 90MB and WeChat refuses it,
  shrink it to something that fits" or "what is the WeChat / Telegram / Discord video limit".
- **A local CLI.** The same work without the chat: inspect, fit, split, trim, GIF, and a delivery
  card for the result.

## The Mini App

Open it from the Mini App entry in the right panel, or ask the Agent to open
"急件 · 平台限制速查". The page reads the bundled `data/platforms.json` — the same table the skill
and the CLI use — and never touches the network.

![The platform limit lookup page](docs/screenshot-limits.png)

## The skill

```text
这个视频发不到微信 / 发不出去 / 太大了
帮我压到 25MB / 20MB 以内
微信、Telegram、Discord 的视频限制是多少
视频太长，裁一段 / 切成几段
```

The skill drives the CLI under the plugin root. Every compression pass is measured with
`ffprobe` afterwards, so "it fits" means the file on disk really is that small. When the target
cannot be reached, the tool says so and offers the next step instead of handing you a file that
still fails.

## The CLI

```bash
node bin/express.mjs doctor            # check ffmpeg and report broken candidates
node bin/express.mjs inspect clip.mp4   # size, duration, and what each platform accepts
node bin/express.mjs fit clip.mp4 --to wechat-chat
node bin/express.mjs split clip.mp4 --to wechat-chat
node bin/express.mjs trim clip.mp4 --start 0:10 --end 1:20
node bin/express.mjs gif clip.mp4 --width 320 --square
node bin/express.mjs card clip.mp4 --from clip.mp4
```

Exit codes: `0` fits, `1` compressed but still over the limit, `2` bad arguments or environment.

## Install

Copy this directory, including the hidden `.minimax-plugin/`, into the MiniMax Code plugins
directory as `express-media/` (`~/.minimax/plugins/express-media/` by default; see the root
README's Install section). Restart MiniMax Code, then open "急件 · 平台限制速查" from the
Mini App entry in the right panel.

From MiniMax Code 3.1.11 you can import it instead of copying it: on the Plugins page, choose
**Create**, then **Import from a Git repository** under Mini App, and paste the URL of this
directory:

```text
https://github.com/MiniMax-AI/MiniMax-Code-MiniApps/tree/main/plugins/andre-1998/express-media
```

Compressing needs Node.js 20.11 or later and an ffmpeg build with `libx264`, `aac`, `gif` and
the `sidedata` filter. The limits page needs neither.

## Tested environment

- Windows 11, Node.js 24, ffmpeg 9.0.2 (`libx264`, `aac`, `gif`, `sidedata` all reported usable
  by `express doctor`).
- The CLI and the skill were exercised on real video: 96 unit tests and 63 end-to-end tests pass,
  every compressed output was measured with `ffprobe`, and the split path was checked by summing
  the real duration of every segment.
- The Mini App was published and opened inside the MiniMax Code Host (MiniMax Code 3.1.14 Insider,
  Windows 11): the page rendered the full table of 10 platforms, typing 微信 in the search box
  narrowed it to the 3 WeChat entries, and the page console reported no errors and no warnings.
  The Node entry was also exercised against a stub Host context, where `/limits` and
  `/api/platforms` returned the platform table and an unknown route returned 404.

## Data & access

- **Reads** the bundled `data/platforms.json`, and the video file you name. Nothing else.
- **Writes** the compressed file next to the source (or wherever `--out` points) and, unless
  `--no-ledger` is given, one ledger line per run in `~/.express/ledger.jsonl`.
- **Network**: none. The plugin never uploads a file, and the limits page loads nothing remote.
- **Permissions**: the Mini App declares no agent, tool, device or host access. It reads no
  microphone, camera or notification.
- **Accounts**: none. Nothing is signed in, and no usage data leaves the machine.

## License

MIT