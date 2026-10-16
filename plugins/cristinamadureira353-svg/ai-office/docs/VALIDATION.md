# AI Office validation

Package version: **0.5.10**. This contribution uses the already published runtime from [AI Office v0.5.10](https://github.com/cristinamadureira353-svg/ai-office/releases/tag/v0.5.10), with submission documentation, a synthetic preview and author attribution added. Runtime files are compared byte-for-byte with that release before submission.

## Environment and scope

Preparation uses macOS 26.4, Python 3.9.6, Node.js 22.23.2, Godot 4.4.1 and headless Chromium. Tests create temporary private state, replace employee responses with fixtures and block paid model network calls. No real keys, player saves or Host login credentials are used.

The official repository documents its runtime contract against MiniMax Code 3.0.73. Host-context fixtures exercise that contract but are not a real MiniMax Code installation. This contribution does not claim fresh manual host acceptance. Real provider responses/billing, Windows/Linux host play, Chinese IME behavior and long-term balance remain unverified.

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

The source release's earlier results were 54 isolated backend tests and 415 Godot headless checks; see its validation record for their scope. The 34 package tests above were rerun against this contribution directory. All of these are simulated/offline results and do not establish provider account validity or real host acceptance.
