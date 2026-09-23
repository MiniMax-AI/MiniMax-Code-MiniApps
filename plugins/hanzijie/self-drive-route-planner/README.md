# Self-drive Route Planner (`self-drive-route-planner`)

A MiniMax Code Mini App for planning driving trips. It searches places, builds an itinerary with an origin, destination, and waypoints, calculates route alternatives, keeps the page synchronized with Agent actions, and exports a 3:4 Xiaohongshu itinerary image set.

The app works without credentials in **demo mode**. Real place search and driving routes use a user-provided Amap Web Service key.

## Install and open

Copy the complete plugin directory, including the hidden `.minimax-plugin/` directory, into the Host-provided plugins directory:

```text
<dataDir>/plugins/self-drive-route-planner/
```

`dataDir` is managed by MiniMax Code and its filesystem location is intentionally opaque. Restart MiniMax Code and ask the Agent to open **自驾规划** or use one of these example requests:

- `规划一条自驾路线并在地图中显示。`
- `优化当前行程的途经点顺序。`
- `把当前行程导出为小红书 3:4 图片。`

Open **设置** in the Mini App to choose demo mode or paste an Amap key. The key is optional for trying the local demo data.

## Features

- Search and select an origin, destination, and waypoints.
- Calculate and compare driving routes with Amap, or use clearly labelled local demo data.
- Edit waypoint order, notes, departure times, and route preferences.
- Synchronize changes made by the Agent through the local `route-planner` MCP endpoint.
- Export a PDF itinerary or prepare a Xiaohongshu 3:4 image request through the bundled `xhs-route-cards` skill.

## Tested environment

- Package checks: `npm run check` on Node.js 26.0.0 (the repository CI runs Node.js 22).
- Local runtime smoke test: the Node entry was started with a MiniMax Code-compatible context, the health/config/static routes were checked, and `dispose()` closed the server and database.
- The Mini App contract targets MiniMax Code 3.0.73. The desktop UI was not re-tested as part of this publication.

## Data & access

- **Files read:** the bundled files under `miniapp/client/`; the Node runtime reads and writes only its private `context.dataDir`.
- **Files written:** `<dataDir>/config.json` stores the user-provided Amap key and map mode with restrictive file permissions; `<dataDir>/trips.sqlite` stores trips and an audit log. No Host files are read or modified.
- **Network:** `https://restapi.amap.com/v5/place/text` and `https://restapi.amap.com/v5/direction/driving` when real Amap data is enabled. The optional `amap-apikey` skill opens `https://console.amap.com/` and verifies the key with `https://restapi.amap.com/v3/geocode/geo`. The optional Xiaohongshu skill downloads its pinned release from `github.com`, with `gh-proxy.com` and `ghfast.top` as fallbacks, then talks to the local `http://localhost:18060` service and the Xiaohongshu site referenced by its feed links (`www.xiaohongshu.com`).
- **Processes:** the Mini App Node entry starts one local HTTP server and SQLite database. The optional Xiaohongshu skill runs `skills/route-planning/scripts/start-xhs-mcp.sh`, which is a macOS ARM64 launcher that downloads and starts the pinned `xiaohongshu-mcp` binary outside the Mini App process. That service may remain running after the Mini App closes; stop it with the command documented in the skill. It stores its cookies, logs, and login QR under the skill's `~/.xhs-mcp/` data directory; the included launcher was not tested on Windows.
- **Credentials:** no API key, token, cookie, or other credential is included in this package. Amap credentials are entered by the user at runtime and remain in the private data directory; they are not written to HTML, client JavaScript, logs, or MCP responses.

## License

[MIT](./LICENSE)
