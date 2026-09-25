# Git Commit Tree

[简体中文](README.zh-CN.md) | English

Inspect a local Git repository's commit history from MiniMax Code: swim-lane commit graph, branches and tags, commit detail and per-file change stats, with optional auto-refresh and persisted filter preferences.

Author: [Microbiosis](https://github.com/Microbiosis) · Version: `1.1.0`

![Git commit tree preview](docs/preview.jpg)

## Install & use

Copy this directory into the active MiniMax Code data directory under `plugins/`. `<dataDir>` defaults to `~/.minimax`, so the default install path is:

```text
<dataDir>/plugins/git-tree/
```

Keep the hidden `.minimax-plugin/` directory. Restart MiniMax Code with Mini App support, confirm the plugin is recognized, then open "Git 提交树" — either from the plugin list or by asking the assistant.

The page loads the first 200 commits of the active repo. 200 is a fixed page size on the client, not a setting in `repos.json`; narrow the result set with the ref dropdown (branch or tag), the search box (commit subject), and the author box, or use "Auto refresh" to keep the view in sync with new pushes.

## What it shows

| Area | Source | Detail |
|---|---|---|
| Stats grid | `git rev-list --all --count`, `for-each-ref`, `tag --list`, `status --porcelain` | Total commits, branches, tags, working-tree changes |
| Worktree chips | `git status --porcelain` | Current branch + the first 6 changed paths |
| Commit graph | `git log --topo-order` + custom lane algorithm (ported from `zai-org/ZCode`) | Single SVG canvas: paths, dots, selection ring, hover highlight |
| Commit rows | `git log` + `git tag --contains` | 4-column grid (subject / date / author / hash) |
| Inline detail (toggle) | server-side `/api/commit` | Subject, branches/tags chips, file changes table, body — appears below the list and can be collapsed |
| Right detail (always on) | server-side `/api/commit` | Same payload as inline; selection and inline are independent |

## Data sources & caching

- **Repos**: `repos.json` ships with the plugin empty by design. Each install must declare its own local paths — either by listing them in the `repos` array or by setting `scanRoots` to one or more directories whose direct children contain `.git`. The Node entry walks up from the plugin root and process cwd, then one directory level of every `scanRoots` entry, and validates each candidate by checking for a `.git` directory. **Portability fallback**: when neither `repos.json` nor the walk-up produced any scan base, the registry also looks under `~/Code`, `~/Projects`, `~/repos`, `~/workspace`, `~/src`, `~/source`, `~/dev`, `~/work`, `~/Documents`, `~/git` (case-insensitive on Windows/macOS). On Windows it additionally walks every mounted drive root (`A:\` … `Z:\`) because developers routinely keep projects on a non-OS drive. Windows system hives (`Program Files`, `Windows`, `Users`, `ProgramData`, `$Recycle.Bin`, …) and macOS resource dirs (`Library`, `Applications`, `System`) are filtered out so widening to drive roots cannot recurse into `%ProgramFiles%`. When a first-level entry under any scan base looks like a dev parent (`github`, `code`, `projects`, `workspace`, `src`, `dev`, `work`, `git`, `repos`, …) but does not itself contain `.git`, the scanner recurses one level into it — this surfaces layouts like `D:\Github\<repo>\` where projects live two levels under the drive root. The fallback only kicks in when there is no other discovery source, so users with an explicit `repos.json` are unaffected.
- **Stats**: 7 parallel `git` commands (`log -n 1`, `rev-list --all --count`, two `for-each-ref`, `tag --list`, `status`, `log -n 1 --format=%D`), cached for **30 s** per repo.
- **Graph**: `git log <ref> --topo-order` with optional `--grep` and `--author` filters, capped at **400** rows per call. Layout result is server-validated; the client renders it as a single SVG.
- **Commit detail**: `git show -s` + `git show --numstat` + `branch --contains` + `tag --contains`, cached **60 s** per `(repo, sha)`. The client mirrors this cache for 60 s as well, so re-clicking a row is free.
- **Tags for graph**: `git log --all --simplify-by-decoration --format=%H %D`, cached 60 s per repo.
- **Compression**: API responses ≥ 256 bytes are gzipped when the client advertises `Accept-Encoding: gzip`.
- **Timeouts**: quick reads (for-each-ref, tag --list, contains checks) 10 s; medium reads (log -n 1, status, git show) 15 s; heavy reads (log --topo-order --all, rev-list --all --count) 30 s. Client `api()` caps at 35 s by default and 60 s for graph requests, using `AbortController`.

## Preferences

Filter state and theme are written to `<dataDir>/prefs.json` and restored on the next open:

| Key | Type | Default | Notes |
|---|---|---|---|
| `theme` | `auto` \| `light` \| `dark` | `auto` | `auto` follows `prefers-color-scheme` |
| `repo` | absolute path | first repo | Falls back to the registry default if the saved path is no longer present |
| `ref` | string | `all` | `all`, branch name, or tag name |
| `q` | string | `""` | substring search on commit subject |
| `author` | string | `""` | matches author name or email |
| `interval` | `0` \| `5` \| `10` \| `30` \| `60` | `0` | Auto-refresh interval in seconds |

The `/api/prefs` endpoint is GET for read, POST for merge-write (never wipes sibling fields). Writes are debounced 400 ms on the client side.

## Auto refresh

Set "Auto refresh" to 5 / 10 / 30 / 60 seconds. The page re-fetches overview and graph in place, keeping the user's selected commit, scroll position, and inline-detail state. A countdown chip next to the refresh button shows the time until the next tick; manual refresh is still available at any time.

## Source & verification

The Client is at `miniapp/client/index.html` — single HTML file, single SVG canvas, inline script. The Node entry is at `miniapp/node/server.mjs`. The lane-assignment algorithm is at `miniapp/node/git-graph.mjs`.

No build step.

## Data & access

**What the plugin reads.** Every read is a local `git` invocation against a repository you declared in `repos.json` or one the scanner found on this machine. Git reads `.git` internals and working-tree metadata (for example `git status`) inside those repositories only.

**How repositories are discovered.** Discovery enumerates *directory names* and checks each candidate for a `.git` entry; it never reads the contents of files it is not already pointed at. The scan surface is wider than `repos.json`:

- Your home development directories (`~/Code`, `~/Projects`, `~/repos`, `~/workspace`, `~/src`, `~/source`, `~/dev`, `~/work`, `~/Documents`, `~/git`), plus the plugin root and process cwd walk-up.
- On Windows, the root of every mounted drive letter (`A:\` … `Z:\`), which includes mapped network drives. System directories are filtered out.
- On macOS and Linux, the parent of your home directory (`/Users`, `/home`), which lists the *names* of other local user accounts' home directories.

This only runs when neither `repos.json` nor the walk-up produced a scan base.

**What the plugin writes.** The only write is `<dataDir>/prefs.json`, which stores just the filter and theme keys listed under Preferences.

**Network.** Nothing is uploaded, and the plugin makes no outbound network requests.

## Tested environment

MiniMax Code desktop `3.0.73.166`, Windows 10.0.26200 (x64). macOS and Linux not verified.

## License

[Apache-2.0](LICENSE).

The git-graph layout algorithm in `miniapp/node/git-graph.mjs` is a JavaScript port of [`zai-org/ZCode`](https://github.com/zai-org/ZCode)'s `packages/ui/src/git-graph/layoutAlgorithm.ts` and `packages/ui/src/git-graph/layout.ts`, which are licensed under Apache-2.0 by Z.ai / zai-org contributors.
