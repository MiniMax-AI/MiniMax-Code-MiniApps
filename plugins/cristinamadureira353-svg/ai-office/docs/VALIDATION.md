# AI Office validation

Package version: **0.5.10**. This contribution uses the already published runtime from [AI Office v0.5.10](https://github.com/cristinamadureira353-svg/ai-office/releases/tag/v0.5.10), with submission documentation, a synthetic preview and author attribution added. Runtime files are compared byte-for-byte with that release before submission.

## Environment and scope

Recorded development and host environment: macOS 26.4, MiniMax Code 3.0.73, Python 3.9.6, Node.js 22.23.2 and Godot 4.4.1. The host application metadata and operating-system version were rechecked on 2026-10-17.

Automated checks use headless Chromium, create temporary private state, replace employee responses with fixtures and block paid model network calls. No real keys, player saves or Host login credentials are used in those checks. They do not validate actual provider billing. Windows/Linux host play, Chinese IME behavior and long-term balance remain outside the recorded test coverage.

## Manual MiniMax Code play record

The project author confirmed on 2026-10-17 that the game had already been installed, opened and manually played in the real MiniMax Code desktop host on macOS. Existing development screenshots show AI Office running inside that host. The author's play reports include employee controls and chat access, rest seating, conflict-choice buttons and HUD visibility; these reports informed the corresponding fixes and regression coverage.

This is a record of prior author playtesting. The earlier submission documentation omitted that history and described only the isolated automated submission run. Both READMEs and the PR description now include the manual host play record. The table below keeps the recorded manual observations and the automated checks for the submitted 0.5.10 package explicit:

| Flow | Recorded evidence and result |
| --- | --- |
| Install, open and enter the game in MiniMax Code | Author-confirmed manual play; existing host screenshots show the game running |
| Employee controls/chat access, seating, conflict choices and HUD | Manual gameplay feedback identified interaction/layout problems; fixes have targeted regression coverage |
| First-run guided configuration, game entry, reopening and employee chat in the submitted package | Covered by the 34/34 automated package checks below; this total counts automated checks |

The manual observations above come from the author's development playtests. The automated submission results below apply to the submitted 0.5.10 package.

## Reproduce checks

From the official MiniApps repository root, with Node.js 22+:

```sh
npm run check
```

For the game's isolated backend, client and package interaction checks, use the [tagged source repository](https://github.com/cristinamadureira353-svg/ai-office/tree/v0.5.10) and follow its `docs/DEVELOPMENT.md`. The package includes `tests/` outside the runtime payload. With source development dependencies installed, its runner accepts a relocated complete package:

```sh
python tools/test_miniapp.py --plugin <complete-ai-office-directory> --chromium <chrome-or-chromium>
```

Browsers run headless. Package tests cover configuration and reopening, quota shutdown and manual reboot, worker chat, all four conflict choices, failed-request recovery, rest seating, layout and HiDPI behavior.

## Results

Checks run against the relocated contribution package:

| Check | Result |
| --- | --- |
| Official repository `npm run check` | 0 errors; 55/55 contract-checker tests passed |
| This package's validator diagnostics | `ai-office: OK`, no warnings |
| Full package interaction tests | 34/34 passed, no failures or skips |
| Runtime compared with the published v0.5.10 package | Byte-for-byte identical |
| Privacy review | No known real keys, credential formats, personal paths or PNG text/EXIF metadata found |

The official repository also reports four pre-existing `README_HEADING_MISSING` warnings in the unchanged `amszuidas/mcode-token-usage-board` and `yanhy2000/mcode-usage-monitor` packages, two headings each. This contribution does not modify those packages.

The source release's earlier results were 54 isolated backend tests and 415 Godot headless checks; see its validation record for their scope. The 34 package tests above were rerun against this contribution directory. These totals describe simulated/offline automated checks and do not establish provider account validity. The author's manual MiniMax Code play history is recorded separately above.
