# CadQuery Viewer

[简体中文](README.zh-CN.md) | English

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/cqviewer-lockup-dark.png">
  <img alt="CadQuery Viewer" src="docs/brand/cqviewer-lockup-light.png" width="420">
</picture>

A local 3D viewer for MiniMax Code. Open STL and STEP models from your project folder — STEP assemblies keep their part names, colours, and real CAD edges — watch models pushed live from CadQuery scripts, then mark positions on the model and send them to the conversation in one click, so the AI knows exactly which face, hole, or edge you mean. The AI can register model folders and open models in the viewer through MCP tools, and the package bundles flowful-ai's CadQuery parametric-design skill.

Authors: [HanZijie](https://github.com/HanZijie) · [flowful-ai](https://github.com/flowful-ai) (bundled CadQuery skill) · Version: `1.2.1`

![CadQuery Viewer: a STEP assembly with three annotations ready to send](docs/preview.jpg)

## What it does

| Area | Detail |
| --- | --- |
| Viewer | Full-window canvas, orthographic camera, Z up (CadQuery convention). Seven preset views, fit, edges, grid, X/Y/Z section plane, axis gizmo. Follows the light/dark theme. |
| Project folders | Lists every `.stl`, `.step`, `.stp` in a folder (recursive); tick a file to open it. Open files reload when they change on disk. |
| STEP | Converted locally into a mesh that keeps the assembly: part names, placements, colours, and B-rep edges (seam lines hidden). The "Opened" list shows how many parts a file has. Results are cached. |
| CadQuery push | `python/cqview.py` → `show(part_or_assembly, "name")` writes into `~/.cqview/scene/`; the Viewer shows it immediately. Assemblies are pushed as STEP so names and colours survive. |
| Annotate | Pick mode (`P`): click the first points on the surface and confirm them (`Enter`). Pick mode then stays on: every further click goes straight into the annotation list with its note box focused, so you can pick a point, write what you want there, and pick the next one. Each point records part, sub-part (for assemblies), coordinates, and surface normal; add a note per point plus one instruction for the AI. |
| Send to AI | One button sends the composed message to the conversation (see [Sending to the conversation](#sending-to-the-conversation)). The same data is kept in `~/.cqview/selection.json` for agents and scripts. |
| AI tools (MCP) | `add_model_folder`, `add_model_file`, `list_model_folders` — the AI registers folders and opens the models it just exported; an open viewer switches to them at once, a closed one does so when it next opens (see [AI tools](#ai-tools-mcp)). |
| CadQuery skill | `parametric-3d-printing` from [flowful-ai/cad-skill](https://github.com/flowful-ai/cad-skill): requirements → phased CadQuery modelling → STL/STEP export → watertight check → multi-view preview, plus a tested Gridfinity generator (see [Bundled CadQuery skill](#bundled-cadquery-skill)). |

## Requirements

- MiniMax Code with Mini App support.
- STL needs nothing else.
- STEP needs Python 3 with [CadQuery](https://github.com/CadQuery/cadquery) (`pip install cadquery`). The Viewer looks for `$CQVIEW_PYTHON`, `python3`, `python`, `/usr/bin/python3`, `/opt/homebrew/bin/python3`, `/usr/local/bin/python3` and uses the first one that can `import cadquery`.
- The bundled skill's scripts additionally need `trimesh`, `pyrender`, `Pillow`, `numpy`, and `lxml` (`skills/parametric-3d-printing/requirements.txt`); `outline_from_scan.py` also needs `shapely`.

## Install & use

Copy this directory into the active MiniMax Code data directory under `plugins/`. `<dataDir>` defaults to `~/.minimax`, so the default install path is:

```text
<dataDir>/plugins/cq-viewer/
```

Keep the hidden `.minimax-plugin/` directory. Restart MiniMax Code, then open "CadQuery Viewer" from the plugin list or ask the assistant, for example "打开 CadQuery Viewer 看一下这个项目里的模型". The MCP tools and the skill are available in conversations started after installation.

1. **Pick a folder.** Click the folder icon on the left, then **+** to add a folder (any folder inside your home directory). The assistant can also do this with `add_model_folder`, or open the page with `/viewer?root=<absolute folder path>`.
2. **Open models.** Tick files in the list, or let the assistant call `add_model_file`. Use the toolbar at the bottom for views, fit (`F`), edges, grid, and section.
3. **Annotate.** Press **选点** (`P`), click points on the model, press **确认** (`Enter`). The panel opens and you stay in pick mode: write the note for a point, click the next point (it joins the list right away and its note box takes the focus), and so on. Write what you want the AI to do whenever you like. Press **完成** or `Esc` to stop picking; pressing **选点** again later continues the same list.
4. **Send.** Press **发送到对话** (`⌘/Ctrl + Enter` in the instruction box).

| Key | Action |
| --- | --- |
| `P` | Enter / leave pick mode |
| `Enter` | Confirm the first picked points (later points need no confirmation) |
| `Backspace` | Remove the last point picked since 选点 was pressed (not while typing) |
| `Esc` | Leave a text box → close popover → leave pick mode → close panel |
| `⌘/Ctrl + Z` | Undo the last added / removed annotation (notes written since are kept) |
| `F` | Fit the view |

### AI tools (MCP)

The Mini App serves an MCP server named `cq-viewer` (Streamable HTTP, `POST /mcp/cq-viewer` on its own loopback listener). MiniMax Code starts the Mini App when a tool is called.

| Tool | What it does |
| --- | --- |
| `add_model_folder` | `{ path, select? }` Registers a folder (same rules as **+**: inside your home directory, not home itself, `~/Library`, or a hidden top-level folder). Returns the folder ID and up to 200 model paths. With `select` (default `true`) the viewer switches to it. |
| `add_model_file` | `{ path }` Opens an `.stl` / `.step` / `.stp` in place: the closest registered folder that lists the file is used, otherwise the file's own folder is registered. The viewer ticks it, fits the view, and reloads it whenever the file is re-exported. The file must be inside your home directory. |
| | `{ path, copy_to_scene: true, name?, color?, opacity? }` Copies the file into `~/.cqview/scene/<name>.<ext>` instead (like `cqview.show_file`), for files elsewhere such as `/tmp`. Later edits to the source are not followed. |
| `list_model_folders` | `{ folder? }` Lists registered folders and the pushed scene; with a folder ID or path, lists that folder's models (absolute paths, up to 200). Read-only. |

Requests are kept in `dataDir` for 24 hours (last 20), so a model the AI opens while the viewer is closed appears when you next open it. Each browser carries out a request once; closing a file yourself is not undone on reload. Results include `viewer_connected`, which tells the AI whether a viewer window is currently listening.

### Bundled CadQuery skill

`skills/parametric-3d-printing/` is the `parametric-3d-printing` skill from [flowful-ai/cad-skill](https://github.com/flowful-ai/cad-skill) (commit `fe42159`), listed in MiniMax Code as `cq-viewer:parametric-3d-printing`. It guides the agent through requirements, phased modelling with show-as-you-go previews, printability review, and slicer recommendations, and ships `run_cadquery_model.py`, `preview.py`, `gridfinity.py`, `stl_to_3mf.py`, and `outline_from_scan.py`. One section is appended to its `SKILL.md` telling the agent to open each exported model with `add_model_file`; everything else is unchanged — see `skills/parametric-3d-printing/UPSTREAM.md`.

The skill is licensed under the [PolyForm Noncommercial License 1.0.0](skills/parametric-3d-printing/LICENSE), not MIT: noncommercial use only. Required Notice: Copyright Nicolas Chourrout (https://github.com/nchourrout).

### Push models from CadQuery

```python
import sys; sys.path.insert(0, "path/to/cq-viewer/python")
import cadquery as cq
from cqview import show, show_file, clear, selection

bracket = cq.Workplane("XY").box(80, 40, 6).edges("|Z").fillet(6)
show(bracket, "bracket")                     # STL, fast
show(my_assembly, "mount")                   # cq.Assembly -> STEP, keeps names and colours
show_file("scans/housing.stl", "scan", opacity=0.35, edges=False)
print(selection())                           # the annotations you made in the Viewer
clear()                                      # empty the pushed scene
```

`python3 python/demo_viewer.py` pushes a small coloured assembly to try it out.

### Sending to the conversation

The page first performs the standard MCP Apps handshake (`ui/initialize` over `postMessage`). If the Host grants the `message` capability, **Send** issues a `ui/message` request with the composed text. If the Host does not answer the handshake, **Send** falls back to the MiniMax Code page bridge `window.mcode.miniapp.message.append`, which places the text in the conversation input; press Enter there to send. Outside MiniMax Code the button becomes **复制内容** and copies the text instead.

## Data & access

**What it reads**

- Folders you or the AI register: directory listings plus the contents of `.stl`, `.step`, and `.stp` files only. Hidden directories, `node_modules`, `__pycache__`, `venv`, and `site-packages` are skipped; symbolic links are never followed; at most 10 levels, 50,000 entries, and 1,000 model files per folder. A folder must be inside your home directory, and cannot be the home directory itself, `~/Library`, or a hidden top-level folder.
- `add_model_file` with `copy_to_scene`: the one model file the AI names, wherever it is (symbolic links resolved; `.stl`/`.step`/`.stp` regular files up to 512 MB).
- `~/.cqview/scene/` — models pushed by `python/cqview.py` or `copy_to_scene` (`.stl`, `.step`, `.stp`, `scene.json`).
- `~/.cqview/roots.json` and `~/.cqview/selection.json` (its own files, see below).

**What it writes.** Outside `dataDir` it writes only its own exchange folder `~/.cqview/`, always atomically (uniquely named temp file in the same folder, then rename), one write at a time, keeping the existing file's permissions:

- `~/.cqview/roots.json` — the registered folders (when you add one, the page is opened with `?root=`, or the AI calls `add_model_folder` / `add_model_file`).
- `~/.cqview/selection.json` — the current annotations: points, notes, instruction, and the absolute path of each annotated model. Rewritten on every change; the last write wins.
- `~/.cqview/scene/<name>.<ext>` and `~/.cqview/scene/scene.json` — only for `add_model_file` with `copy_to_scene`: the copied model, its colour/opacity, and removal of the same name in the other model formats (as `cqview.py` does).
- It creates `~/.cqview/` and `~/.cqview/scene/` if missing. It never writes into your project folders.

Inside `dataDir` it keeps `step-cache/`, the converted STEP meshes keyed by file path, size, and modification time (deleting it is safe; on the first conversion after each start, entries unused for 30 days, entries beyond 1 GB (least recently used first), and temp files older than a day are removed), and `open-requests.json`, the last 20 AI requests from the past 24 hours (folder ID, path relative to that folder, or scene name).

**Processes.** Python is started only when a STEP file is opened, with arguments passed as an array (no shell), stdio ignored, and every child killed on shutdown:

- Probe, until one candidate works: `<python> -c "import cadquery"` (60 s timeout).
- Convert: `<python> <plugin>/miniapp/node/step_mesh.py <model.step> <dataDir>/step-cache/<hash>.cqvm.<pid>.tmp` (300 s timeout).
- Fallback if that fails: `<python> -c <inline STEP→STL script> <model.step> <dataDir>/step-cache/<hash>.stl.<pid>.tmp`. Not used when the conversion was stopped on purpose (time limit, shutdown) or killed outright (`SIGKILL`/`SIGTERM`); a native crash such as `SIGSEGV` still falls back. Once the Mini App is shutting down, no Python process is started.

The model path is validated first (registered folder, allowed extension, no symbolic link) and passed as a single argument.

**Request checks.** Every route, the page included, refuses a request whose `Host` is not this machine (`127.0.0.1`, `localhost`, `::1`) or whose `Origin`, when present, is not this listener itself, so a web page reached through DNS rebinding or another origin cannot register folders or read models. Writes accept JSON bodies only.

**MCP endpoint.** `POST /mcp/cq-viewer` on the Mini App's loopback listener, under the same checks. The tools apply the same folder rules as the page.

**Bundled skill.** The Mini App never runs it. When the agent follows the skill it runs the skill's Python scripts itself, through its normal shell tool and permission prompts: `run_cadquery_model.py` executes the model script in a child Python process and collects the files it wrote; `preview.py` renders PNGs offscreen. The scripts make no network requests; the skill asks the agent to look up real-world dimensions with web search, and its setup section installs the Python packages above with `pip` (or `conda`) if they are missing.

**Watching.** While the Viewer runs it watches `~/.cqview/scene/` and each registered folder (recursively) for model changes.

**Browser storage** holds view preferences only: selected folder, opened files, hidden parts, edge/grid toggles, and the number of the last AI request this browser carried out.

**Host page bridge.** On **Send** only, as described above.

**Network.** None. Three.js is vendored.

## Tested environment

- MiniMax Code desktop `3.1.1-preview.4597` (Electron 42), macOS 26 (Apple Silicon); Python 3.9 with CadQuery 2.5.2 / OCP 7.7.2, trimesh 4.12, pyrender 0.1.45.
- In MiniMax Code (1.2.0): local install and open; continuous picking itself was exercised in headless Chrome (below). (1.1.1): local install; the page opened with `?root=` reads and registers folders under the new Host/Origin checks, and `list_model_folders` reports `viewer_connected: true` while the panel is open. (1.1.0): local install; a new conversation lists `mcp__cq-viewer__add_model_folder`, `mcp__cq-viewer__add_model_file`, `mcp__cq-viewer__list_model_folders` and the skill `cq-viewer:parametric-3d-printing`; `list_model_folders` and `add_model_folder` (`select: false`) called through the Host. Earlier (1.0.0): open, folder registration via `?root=`, and Host bridge detection (the `ui/initialize` handshake is not answered in this build, so the fallback path is used).
- `node --test plugins/hanzijie/cq-viewer/tests/*.test.mjs` — 19 tests against the real Node entry with a temporary home directory. `tests/mcp.test.mjs`: the three tools, folder rules, copy to scene with colour, request log across a restart, loopback/JSON checks. `tests/server.test.mjs`: 40 concurrent annotation saves and 8 concurrent folder registrations (page and MCP mixed) without errors or lost entries; with a fake Python, dispose during a STEP conversion kills it and starts no fallback, a killed conversion does not fall back, a `SIGSEGV` crash does; step-cache pruning; Host/Origin checks on every route; versions in sync.
- End-to-end in headless Chrome against the same Node entry, at 1400 px and 800 px wide (19 checks each): the first points are confirmed and pick mode stays on; further clicks join the list directly while a note box or the instruction box is being edited, focus moves to the new point's note, notes already written are kept; 撤销上一个 / `Backspace` remove the last point of the session; `⌘Z` restores it and keeps notes edited in between; `Esc` twice and 完成 leave pick mode; pressing 选点 again continues without confirmation; a collapsed panel reopens on a new point; after 清空标注 the confirm step returns; `selection.json` has the points, notes, and instruction; the panel stays clear of the pick bar. From 1.1.0: the page switches folder and opens the file when the AI calls the tools; `copy_to_scene` shows the copied part in its colour; a file requested while the page is closed opens on the next visit, is not replayed after that, and stays closed once you untick it; `viewer_connected` turns false when the page goes away. From 1.0.0: STL and STEP opening (multi-level assemblies with names, colours, instances), live reload, pick → confirm → notes, the `ui/message` path against a simulated MCP Apps host, the fallback path against a simulated page bridge, and copy mode without a Host.
- Bundled skill: `run_cadquery_model.py --preview --strict` run from the installed plugin directory (model → STL → watertight check → preview PNG).
- Not verified: Windows; `add_model_file` through the Host with the viewer panel open (the page side was verified in headless Chrome only); that the Send fallback actually fills the conversation input in this build; STEP files with face-level colours from other CAD tools; the skill's Gridfinity generator with CadQuery 2.5 (the skill asks for 2.6.1 or later).

## Third-party

- [three.js](https://threejs.org/) r170 (`three.module.min.js`, `OrbitControls.js`, `STLLoader.js`), MIT — see `miniapp/client/assets/vendor/LICENSE-three.txt`.
- `skills/parametric-3d-printing/` from [flowful-ai/cad-skill](https://github.com/flowful-ai/cad-skill), PolyForm Noncommercial 1.0.0 — see `skills/parametric-3d-printing/LICENSE` and `UPSTREAM.md`.
- STEP conversion uses the CadQuery / OCP installed on your machine; nothing from it is bundled.

## License

[MIT](LICENSE), except `skills/parametric-3d-printing/`, which keeps its own [PolyForm Noncommercial 1.0.0](skills/parametric-3d-printing/LICENSE) license.
