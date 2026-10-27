# Contributing MiniApps

English | [简体中文](CONTRIBUTING.zh-CN.md)

We welcome tools, games, and other interesting apps you have built for MiniMax Code.

1. Fork this repository and add your complete plugin package under `plugins/<your-github-username>/<plugin-id>/`. Use a lowercase GitHub username for the author directory.
2. Start from `examples/hello-miniapp/`. Include the hidden `.minimax-plugin/` directory, `package.json`, `miniapp/`, and all required runtime assets. The plugin must work when copied on its own, without depending on other directories in this repository. The exact rules are in `docs/package-contract.md`, `docs/runtime.md`, `docs/client.md`, `docs/agent.md`, `docs/tool.md`, and `docs/security.md`.
3. Add a short English `README.md`. You may also include `README.zh-CN.md` with links between the two versions. Explain what the app does, how to install and use it, tested client versions and operating systems, required configuration, file access, network requests, any Agent turns it runs, conversations it reads, tools it calls, and microphone use. Screenshots or GIFs are welcome. Declare in `miniapp/miniapp.json` exactly the access the code uses; `npm run check` reports calls without a declaration. If the app uses a feature that needs a newer client, such as `agentAccess`, `toolAccess`, `deviceAccess`, or `surface.window`, name a MiniMax Code version at or above its minimum under `## Tested environment` (see "Minimum client version" in `docs/package-contract.md`).
4. Include a `LICENSE` you are entitled to use, and preserve required attribution for third-party code and assets.
5. Add an entry to the app tables in both root READMEs, run `npm run check` (Node.js 22 or later) until it reports no errors, and open a pull request.

The plugin directory name must match `name` in `.minimax-plugin/plugin.json`. **Plugin IDs must be unique across the repository**, since the author directory is not kept during installation. If a name is already taken, consider adding an author prefix.

Submit ready-to-run files. If the app requires a build step, include its source and build instructions. Do not commit `node_modules/`, credentials, real session records, personal data, or runtime caches. Use synthetic or thoroughly anonymized data in screenshots and examples.

Before submitting, install the app in MiniMax Code, open it, and check its main features. Include your test environment and results in the pull request, and state any unverified behavior. When updating an existing app, keep its plugin ID and update the version and usage instructions as appropriate.

## Plugin tests

Tests for a plugin are optional and live inside the plugin's own directory (for example `plugins/<author>/<plugin-id>/tests/`). They run through the `test` script in the plugin's `package.json`, i.e. `npm test` from the plugin directory.

- Tests must not reach external network hosts and must not depend on the MiniMax Code host app. A server the test starts on `127.0.0.1` is fine.
- Install any dependencies only inside the plugin directory (commit a `package-lock.json` if you have dependencies); never add them to the root `package.json`. Delete the plugin's `node_modules` before running `npm run check`: the check rejects any `node_modules` directory inside a package, ignored by Git or not.
- The root `test/` directory is reserved for repository-wide Mini App rule checks. It must not import or run plugin tests.
- The `Plugin tests` workflow runs only for plugins changed by a pull request, separately from the rules CI (`npm run check`). It runs on macOS with Node.js 22 and Git and nothing else: a test that needs another tool, such as FFmpeg or a browser, must skip itself when the tool is missing.

Working with an AI coding agent? It reads `AGENTS.md` automatically; `docs/` holds the same rules for people.
