# MiniMax Code MiniApps

English | [简体中文](README.zh-CN.md)

The official community repository for **MiniApps built for the MiniMax Code desktop app**. Discover useful tools, playful experiments, and apps you can make your own.

[Explore MiniApps](#miniapps) · [Get started](#getting-started) · [Contribute](CONTRIBUTING.md) · [Report an issue](https://github.com/MiniMax-AI/MiniMax-Code-MiniApps/issues)

## About

This repository is open to the community: anyone can contribute a MiniApp plugin by opening a pull request. MiniApps are interactive apps packaged as MiniMax Plugins. This repository brings together complete, self-contained plugin packages contributed by developers, with source files and usage instructions alongside each app.

Packages are organized by author under `plugins/<github-username>/<plugin-id>/`. You can download an app, install it manually in MiniMax Code, and use its source as a starting point for your own work.

## MiniApps

| MiniApp | What it does | Author |
| --- | --- | --- |
| [Token Usage Board](plugins/amszuidas/mcode-token-usage-board/) | Explore local Token usage by date, model, and session, including input, output, and cache usage | [amszuidas](https://github.com/amszuidas) |
| [Token Usage Board](plugins/yanhy2000/mcode-usage-monitor/) | Watch local Token usage, output speed, and cache hit rate in near real time; filter by time range, model, and session | [yanhy2000](https://github.com/yanhy2000) |
| [Model Manager](plugins/ocoomber/openrouter-model-manager/) | Browse, search, and enable/disable models in your `~/.minimax/config.yaml` with instant save, bulk actions, one-click undo, and automatic backups | [ocoomber](https://github.com/ocoomber) |
| [Self-drive Route Planner](plugins/hanzijie/self-drive-route-planner/) | 【Offical Plugin】Plan driving routes with place search, route alternatives, demo mode, and Xiaohongshu 3:4 itinerary cards | [HanZijie](https://github.com/HanZijie) |

<details>
<summary>Preview: Token Usage Board</summary>

![Token Usage Board showing usage trends with synthetic data](plugins/amszuidas/mcode-token-usage-board/docs/preview.png)

The preview uses synthetic data. The app interface is currently in Chinese. See its [README](plugins/amszuidas/mcode-token-usage-board/README.md) for data access, counting rules, and compatibility notes.

</details>

<details>
<summary>Preview: Token Usage Board (mcode-usage-monitor)</summary>

![Token Usage Board showing usage trends with synthetic data](plugins/yanhy2000/mcode-usage-monitor/docs/preview.png)

The preview uses synthetic data. The app interface is currently in Chinese. See its [README](plugins/yanhy2000/mcode-usage-monitor/README.md) for data access, counting rules, and compatibility notes.

</details>

## Getting started

### Requirements

Use a MiniMax Code desktop version that supports MiniApps. Check the app's README for tested client versions, operating systems, configuration, and known limitations. Compatibility is documented per app.

### 1. Download

Select **Code → Download ZIP** on this repository and extract the archive, or clone it:

```sh
git clone https://github.com/MiniMax-AI/MiniMax-Code-MiniApps.git
```

Find the app you want under `plugins/<github-username>/` and read its README, including which local files or network services it accesses.

### 2. Install

Copy the **entire plugin directory**, including the hidden `.minimax-plugin` directory, into `<dataDir>/plugins/`.

By default, `<dataDir>` is the `.minimax` directory in your home folder (`~/.minimax`), so plugins go in `~/.minimax/plugins/`. If you have configured a different data directory, use that directory instead.

For Token Usage Board:

```text
Repository: plugins/amszuidas/mcode-token-usage-board/
Install to: <dataDir>/plugins/mcode-token-usage-board/
```

The installed manifest must be at:

```text
<dataDir>/plugins/mcode-token-usage-board/.minimax-plugin/plugin.json
```

The author directory (`amszuidas/`) only groups contributions in the repository. Copy the plugin directory directly into the client's `plugins/` directory, without that extra author level.

These packages use **manual installation**. The client's GitHub plugin import feature does not support these MiniApp packages.

### 3. Open

Restart MiniMax Code, confirm that the plugin is recognized and enabled, and open the MiniApp following its README. For Token Usage Board, ask the Agent to open “Token 用量看板”.

To update an app, close it and exit MiniMax Code, then replace its complete plugin directory. Keep any backup outside `plugins/` and follow the app's instructions for preserving its data. To uninstall, close the app and exit the client before removing its plugin directory; separately stored app data may remain.

## Contributing

Tools, games, visualizations, and small experiments are all welcome. To share a MiniApp:

1. Fork the repository, copy `examples/hello-miniapp/` to `plugins/<your-github-username>/<plugin-id>/`, and build your app there. The package rules are in [`docs/`](docs/package-contract.md); AI coding agents read [`AGENTS.md`](AGENTS.md) automatically.
2. Include a README, a license, and any required runtime files. Document setup, data access, and what you have tested.
3. Add the app to the tables in both root READMEs, run `npm run check`, and open a pull request.

Use a lowercase GitHub username for the author directory. The plugin directory name must match `.minimax-plugin/plugin.json` → `name`, and **plugin IDs must be unique across the repository**, since the author directory is not part of the installed path.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contribution guide.

## Questions and feedback

Use [GitHub Issues](https://github.com/MiniMax-AI/MiniMax-Code-MiniApps/issues) to report a problem or suggest an app or improvement. For an app issue, include its ID and version, your MiniMax Code version, operating system, steps to reproduce, and the expected and actual behavior. Remove credentials and private session content from logs and screenshots.

To ask for a runtime capability that MiniApps do not have yet, such as a new `context` API or window behaviour, comment on the pinned [capability wishlist](https://github.com/MiniMax-AI/MiniMax-Code-MiniApps/issues/9) instead of opening a new issue.

## License

This repository is licensed under the [MIT License](LICENSE). Individual MiniApps are governed by the licenses included in their own directories.
