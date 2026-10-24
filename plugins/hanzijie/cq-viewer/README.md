# CadQuery Viewer

[简体中文](README.zh-CN.md) | English

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/cqviewer-lockup-dark.png">
  <img alt="CadQuery Viewer" src="docs/brand/cqviewer-lockup-light.png" width="420">
</picture>

A local 3D viewer for MiniMax Code. Opened in a conversation, it lists every STL and STEP model in that conversation's folder — STEP assemblies keep their part names, colours, and real CAD edges — and opens the ones you tick; it also shows models pushed from CadQuery scripts. Orbit around any point you press on, pan with two fingers or the right mouse button, then mark positions on the model and send them to the conversation in one click, so the AI knows exactly which face, hole, or edge you mean. One more click turns the current view into a finished product image: the Viewer captures a clean white model and a background Agent renders it with MiniMax image generation, following any description you add. The AI can register model folders and open models in the viewer through MCP tools, and the package bundles flowful-ai's CadQuery parametric-design skill.

Authors: [HanZijie](https://github.com/HanZijie) · [flowful-ai](https://github.com/flowful-ai) (bundled CadQuery skill) · Version: `1.4.0`

![CadQuery Viewer: a STEP assembly with three annotations ready to send](docs/preview.jpg)

## What it does

| Area | Detail |
| --- | --- |
| Viewer | Full-window canvas, orthographic camera, Z up (CadQuery convention). Seven preset views, fit, edges, grid, X/Y/Z section plane, axis gizmo. Follows the light/dark theme. |
| Navigation | Press on the model and drag: it orbits around the point you pressed (a ring marks it), nothing jumps. Trackpad: two fingers pan, pinch zooms towards the pointer. Mouse: the wheel zooms towards the cursor, right or middle drag pans. Shift + drag pans on both. **操作方式** (toolbar) tells trackpad and mouse apart on each scroll, or lets you fix one, and lists the gestures. |
| Conversation folder | Opened in a conversation, the Viewer lists every `.stl`, `.step`, `.stp` in that conversation's folder (recursive), hidden folders such as `~/.mavis/workspace` included, and opens nothing until you tick a file. Outside a conversation it lists nothing. Extra folders can be added to a conversation's list (and removed). Open files reload when they change on disk. |
| STEP | Converted locally into a mesh that keeps the assembly: part names, placements, colours, and B-rep edges (seam lines hidden). The "Opened" list shows how many parts a file has. Results are cached. |
| CadQuery push | `python/cqview.py` → `show(part_or_assembly, "name")` writes into `~/.cqview/scene/`; the files panel lists that folder like any other (tick to open). Assemblies are pushed as STEP so names and colours survive. |
| Annotate | Pick mode (`P`): click the first points on the surface and confirm them (`Enter`). Pick mode then stays on: every further click goes straight into the annotation list with its note box focused, so you can pick a point, write what you want there, and pick the next one. Each point records part, sub-part (for assemblies), coordinates, and surface normal; add a note per point plus one instruction for the AI. |
| Send to AI | One button sends the composed message to the conversation (see [Sending to the conversation](#sending-to-the-conversation)). Annotations are kept per conversation folder in `~/.cqview/selections/<folder id>.json`; the latest write is also in `~/.cqview/selection.json` for scripts. |
| White-model render | **渲染** captures the visible models from the current angle as a clay-white image, cropped to the model, and a background Agent turns it into a photorealistic image with MiniMax image generation (image-to-image). Pick a style (studio, in use, design render, 3D-printed part), an aspect ratio, whether part colours count, and add your own description. Progress, approvals the Agent asks for, and results (compare with the white model, copy, download) stay in the panel (see [White-model rendering](#white-model-rendering)). |
| AI tools (MCP) | `add_model_folder`, `add_model_file`, `list_model_folders` — the AI opens the models it just exported in its own conversation's viewer (it passes its working directory as `workspace`); an open viewer shows them at once, a closed one when it next opens (see [AI tools](#ai-tools-mcp)). |
| CadQuery skill | `parametric-3d-printing` from [flowful-ai/cad-skill](https://github.com/flowful-ai/cad-skill): requirements → phased CadQuery modelling → STL/STEP export → watertight check → multi-view preview, plus a tested Gridfinity generator (see [Bundled CadQuery skill](#bundled-cadquery-skill)). |

## Requirements

- MiniMax Code 3.1.4 or later: the Viewer reads which conversation it is open in (Agent access `session.read`). On a Host that cannot tell, the Viewer only lists a folder when it is opened with `/viewer?root=<folder>`.
- White-model rendering needs MiniMax Code 3.1.2 or later (Agent access) and the MiniMax image-generation tools of `mcode-tools` in your account. Each render is one image generation, billed like any other you start yourself.
- STL needs nothing else.
- STEP needs Python 3 with [CadQuery](https://github.com/CadQuery/cadquery) (`pip install cadquery`). The Viewer looks for `$CQVIEW_PYTHON`, `python3`, `python`, `/usr/bin/python3`, `/opt/homebrew/bin/python3`, `/usr/local/bin/python3` and uses the first one that can `import cadquery`.
- The bundled skill's scripts additionally need `trimesh`, `pyrender`, `Pillow`, `numpy`, and `lxml` (`skills/parametric-3d-printing/requirements.txt`); `outline_from_scan.py` also needs `shapely`.

## Install & use

Copy this directory into the active MiniMax Code data directory under `plugins/`. `<dataDir>` defaults to `~/.minimax`, so the default install path is:

```text
<dataDir>/plugins/cq-viewer/
```

Keep the hidden `.minimax-plugin/` directory. Restart MiniMax Code, then open "CadQuery Viewer" in a conversation from the plugin list, or ask the assistant, for example "打开 CadQuery Viewer 看一下这个项目里的模型". The MCP tools and the skill are available in conversations started after installation.

1. **Open models.** The folder icon on the left lists every folder of this conversation as a group you can fold: the conversation folder first, then the folders you added, then `~/.cqview/scene` when it holds pushed models. Tick the models to open (nothing opens on its own), or let the assistant call `add_model_file`. **+** adds another folder to this conversation (inside your home directory, not home itself, `~/Library`, or a hidden top-level folder); **−** on a folder removes it again. The search box filters every folder at once.
2. **Look around.** Press on the model and drag to orbit around that point; pan with two fingers (trackpad), the right or middle button (mouse), or Shift + drag; zoom by pinching or with the wheel. The toolbar has views, fit (`F`), edges, grid, section, and **操作方式**.
3. **Annotate.** Press **选点** (`P`), click points on the model, press **确认** (`Enter`). The panel opens and you stay in pick mode: write the note for a point, click the next point (it joins the list right away and its note box takes the focus), and so on. Write what you want the AI to do whenever you like. Press **完成** or `Esc` to stop picking; pressing **选点** again later continues the same list.
4. **Send.** Press **发送到对话** (`⌘/Ctrl + Enter` in the instruction box).
5. **Render.** Turn the model to the angle you want, press **渲染**, pick a style, optionally describe materials or setting, and press **开始渲染** (`⌘/Ctrl + Enter` in the description box). Keep working; a notice appears when it is done.

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
| `add_model_folder` | `{ path, select?, workspace? }` Adds a folder. With `workspace` (the AI's working directory) it becomes an extra folder of that conversation's viewer; a folder inside the conversation folder needs no adding. Outside the conversation folder the **+** rules apply (inside your home directory, not home itself, `~/Library`, or a hidden top-level folder). Returns the folder ID and up to 200 model paths. With `select` (default `true`) the viewer switches to it. |
| `add_model_file` | `{ path, workspace? }` Opens an `.stl` / `.step` / `.stp` in place. With `workspace`, only that conversation's viewer opens it: from the conversation folder when the file is inside it, otherwise its folder becomes an extra folder of that conversation (files outside the home directory need `copy_to_scene`). Without `workspace`, every viewer whose folders contain the file opens it. The viewer ticks it, fits the view, and reloads it whenever the file is re-exported. |
| | `{ path, copy_to_scene: true, name?, color?, opacity?, workspace? }` Copies the file into `~/.cqview/scene/<name>.<ext>` instead (like `cqview.show_file`), for files elsewhere such as `/tmp`. Later edits to the source are not followed. |
| `list_model_folders` | `{ folder? }` Lists registered folders and the pushed scene; with a folder ID or path (registered or a conversation folder), lists that folder's models (absolute paths, up to 200). Read-only. |

Requests are kept in `dataDir` for 24 hours (last 20), so a model the AI opens while the viewer is closed appears when you next open it in that conversation. A viewer carries out only its conversation's requests, each once, and the first time only those made since the conversation started (or in the last ten minutes when the Host gives no conversation info). Results include `viewer_connected`: with `workspace`, whether a viewer of that conversation folder is listening.

### Conversation folder

On start the page calls `window.mcode.miniapp.agent.session()`, which (with Agent access `session.read`, MiniMax Code 3.1.4 or later) returns the conversation the Viewer is open in. Only its `workspaceDir` and creation time are used; the title, model, and last reply in the same answer are ignored, and `agent.sessions()` (all conversations) is never called. The page then registers that folder with the Node side (`POST /viewer/api/workspace`), which checks it is an existing directory other than the home directory or a filesystem root. If the Host gives no conversation, the page uses `?root=<folder>` when present, otherwise it shows nothing. A `?root=` next to a conversation is added to that conversation's list as an extra folder.

Opened models, hidden parts, and the selected folder live only as long as the page; reopening the Viewer starts empty.

### White-model rendering

1. **Capture (in the page).** The visible models are drawn once more off screen: same camera direction, cropped to the model with a 10 % margin (never more than the window shows), one neutral clay material unless **保留零件颜色** is ticked, light grey background, no grid, axes, markers, or gizmo. The long side is 1600 px; **自动** picks the supported ratio (1:1, 4:3, 3:4, 16:9, 9:16) closest to the framed model. The panel previews exactly this picture.
2. **Job (Node).** The picture and options go to `POST /viewer/api/renders`. The Node side checks them (PNG/JPEG bytes, at most 16 MB; known style and ratio; description up to 800 characters) and writes the job folder: the picture and `args.json` for the image tool. The image prompt is a fixed instruction to keep geometry, holes, fillets, and framing, the chosen style, your description marked as the user's requirements, and the visible file names as context.
3. **Background Agent.** One Agent turn per render, in a session of its own (not in your session list), on the default model, at most two at a time and three in progress. Its instructions: load the `mcode-tools-master` skill, upload the picture with `mcode-tools upload_temp_url`, put that URL into `args.json`, call `connector__matrix__generate_image` (2K), fetch the result with `mcode-tools get_asset_url` and `curl`, save it as `cq-render-<id>.<ext>` in the job folder (or its own working directory if it cannot write there), and answer `RENDER_DONE <path>` or `RENDER_FAILED <reason>`. Your description is never part of these instructions; it only travels inside `args.json`.
4. **Approvals.** When the Agent needs approval for a command, the render shows the tool, the command, and the reason with **拒绝** / **允许一次**. Nothing is approved on its own; a render waits until you decide, cancel it, or the Viewer stops. **查看过程** opens the background session in the chat side panel (when the Viewer is open in a chat).
5. **Result.** A result counts only if it is a real JPEG / PNG / WebP of sane size with the job's file name, in the job folder or at the reported path (then copied in). Done renders can be viewed next to their white model, copied (as PNG), downloaded, retried with the same picture and settings, or deleted.

The last 30 renders are kept. A render that was still going when the Viewer stopped is reported as interrupted on the next start, or as done if its image arrived.

### Bundled CadQuery skill

`skills/parametric-3d-printing/` is the `parametric-3d-printing` skill from [flowful-ai/cad-skill](https://github.com/flowful-ai/cad-skill) (commit `fe42159`), listed in MiniMax Code as `cq-viewer:parametric-3d-printing`. It guides the agent through requirements, phased modelling with show-as-you-go previews, printability review, and slicer recommendations, and ships `run_cadquery_model.py`, `preview.py`, `gridfinity.py`, `stl_to_3mf.py`, and `outline_from_scan.py`. One section is appended to its `SKILL.md` telling the agent to open each exported model with `add_model_file` (passing its working directory as `workspace`); everything else is unchanged — see `skills/parametric-3d-printing/UPSTREAM.md`.

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

- The folder of the conversation the Viewer is open in, the extra folders added to it, and folders the AI registers: directory listings plus the contents of `.stl`, `.step`, and `.stp` files only. Hidden directories inside them, `node_modules`, `__pycache__`, `venv`, and `site-packages` are skipped; symbolic links are never followed; at most 10 levels, 50,000 entries, and 1,000 model files per folder. A conversation folder may be anywhere except the home directory itself or a filesystem root; any other folder must be inside your home directory, and cannot be the home directory itself, `~/Library`, or a hidden top-level folder.
- The conversation the page is open in, through `window.mcode.miniapp.agent.session()` (Agent access `session.read`): only its folder (`workspaceDir`) and creation time are used. The answer also carries the conversation title, model, and last reply; the page does not keep or send them. The list of all conversations (`agent.sessions()`) is never requested.
- `add_model_file` with `copy_to_scene`: the one model file the AI names, wherever it is (symbolic links resolved; `.stl`/`.step`/`.stp` regular files up to 512 MB).
- `~/.cqview/scene/` — models pushed by `python/cqview.py` or `copy_to_scene` (`.stl`, `.step`, `.stp`, `scene.json`).
- `~/.cqview/roots.json`, `~/.cqview/selections/<folder id>.json`, and `~/.cqview/selection.json` (its own files, see below).

**What it writes.** Outside `dataDir` it writes only its own exchange folder `~/.cqview/`, always atomically (uniquely named temp file in the same folder, then rename), one write at a time, keeping the existing file's permissions:

- `~/.cqview/roots.json` — registered folders outside conversation folders (when you add an extra folder, or the AI calls `add_model_folder` / `add_model_file` for one). Conversation folders are not written here.
- `~/.cqview/selections/<folder id>.json` — the annotations of one conversation folder: points, notes, instruction, and the absolute path of each annotated model. Rewritten on every change.
- `~/.cqview/selection.json` — a copy of the latest annotation write from any conversation folder (with its folder ID), for `cqview.selection()`; the last write wins.
- `~/.cqview/scene/<name>.<ext>` and `~/.cqview/scene/scene.json` — only for `add_model_file` with `copy_to_scene`: the copied model, its colour/opacity, and removal of the same name in the other model formats (as `cqview.py` does).
- It creates `~/.cqview/`, `~/.cqview/scene/`, and `~/.cqview/selections/` if missing. It never writes into your project folders.

Inside `dataDir` it keeps `step-cache/`, the converted STEP meshes keyed by file path, size, and modification time (deleting it is safe; on the first conversion after each start, entries unused for 30 days, entries beyond 1 GB (least recently used first), and temp files older than a day are removed), `open-requests.json`, the last 20 AI requests from the past 24 hours (folder ID, path relative to that folder, absolute path, the caller's conversation folder, or scene name), `workspaces.json` (the last 100 conversation folders and the extra folders added to each), and `renders/`: `jobs.json` (the last 30 renders: options, your description, status, background session ID, conversation folder ID) and one folder per render with the captured white model, `args.json`, and the result. Deleting a render in the panel removes its folder.

**Agent turns.** Each render runs one background Agent turn with the instructions in [White-model rendering](#white-model-rendering): upload the captured picture, call MiniMax image generation, download the result into the render's folder. The Agent has its normal tools and permission prompts; approvals it asks for are shown in the panel and sent only when you click **允许一次** or **拒绝**. The Viewer reads back only the result file, and only after checking its name, size, and image header.

**Processes.** Python is started only when a STEP file is opened, with arguments passed as an array (no shell), stdio ignored, and every child killed on shutdown:

- Probe, until one candidate works: `<python> -c "import cadquery"` (60 s timeout).
- Convert: `<python> <plugin>/miniapp/node/step_mesh.py <model.step> <dataDir>/step-cache/<hash>.cqvm.<pid>.tmp` (300 s timeout).
- Fallback if that fails: `<python> -c <inline STEP→STL script> <model.step> <dataDir>/step-cache/<hash>.stl.<pid>.tmp`. Not used when the conversion was stopped on purpose (time limit, shutdown) or killed outright (`SIGKILL`/`SIGTERM`); a native crash such as `SIGSEGV` still falls back. Once the Mini App is shutting down, no Python process is started.

The model path is validated first (registered folder, allowed extension, no symbolic link) and passed as a single argument.

**Request checks.** Every route, the page included, refuses a request whose `Host` is not this machine (`127.0.0.1`, `localhost`, `::1`) or whose `Origin`, when present, is not this listener itself, so a web page reached through DNS rebinding or another origin cannot register folders or read models. Writes accept JSON bodies only.

**MCP endpoint.** `POST /mcp/cq-viewer` on the Mini App's loopback listener, under the same checks. The tools apply the same folder rules as the page.

**Bundled skill.** The Mini App never runs it. When the agent follows the skill it runs the skill's Python scripts itself, through its normal shell tool and permission prompts: `run_cadquery_model.py` executes the model script in a child Python process and collects the files it wrote; `preview.py` renders PNGs offscreen. The scripts make no network requests; the skill asks the agent to look up real-world dimensions with web search, and its setup section installs the Python packages above with `pip` (or `conda`) if they are missing.

**Watching.** While the Viewer runs it watches `~/.cqview/scene/`, each registered folder, and the conversation folders (with their extra folders) of the pages that are open, recursively, for model changes.

**Browser storage** holds view preferences only: edge/grid toggles, render style / ratio / part-colour choice, trackpad/mouse mode, and, per conversation folder, the number of the last AI request carried out. Opened models and hidden parts are not stored.

**Host page bridge.** `agent.session()` once on start (see above); `message.append` on **Send**, as described above; `agent.open` when you press **查看过程** on a render.

**Network.** The Mini App itself makes no requests; Three.js is vendored. A render's Agent turn uses `mcode-tools`, which sends the captured picture to MiniMax temporary storage, runs MiniMax image generation, and downloads the result from the URL MiniMax returns.

## Tested environment

- MiniMax Code `3.1.4-preview.4773` on macOS 26 (Apple Silicon) for 1.4.0: a host probe (removed again) showed that with `agentAccess: ["session.run", "session.read"]` the page's `agent.session()` returns the conversation it is open in, with `workspaceDir`, and that a query string given to `open` reaches the page. Published and opened in a conversation: the page registered that conversation's folder by itself (it was in no registry before), and `list_model_folders` for that folder answered with `viewer_connected: true`.
- Same build for 1.3.0: published to the Host (runtime ready with `agentAccess`) and opened in the Mini App tab. The white-model render instructions, exactly as the Node entry writes them, were run cold by a fresh MiniMax Code Agent session: upload, `args.json` edit, `connector__matrix__generate_image`, `get_asset_url`, download into a folder whose path has spaces, `RENDER_DONE` reply; the result (2048 × 2048 PNG) passed the Viewer's own name/size/header check.
- MiniMax Code desktop `3.1.1-preview.4597` (Electron 42), macOS 26 (Apple Silicon); Python 3.9 with CadQuery 2.5.2 / OCP 7.7.2, trimesh 4.12, pyrender 0.1.45.
- In MiniMax Code (1.2.0): local install and open; continuous picking itself was exercised in headless Chrome (below). (1.1.1): local install; the page opened with `?root=` reads and registers folders under the new Host/Origin checks, and `list_model_folders` reports `viewer_connected: true` while the panel is open. (1.1.0): local install; a new conversation lists `mcp__cq-viewer__add_model_folder`, `mcp__cq-viewer__add_model_file`, `mcp__cq-viewer__list_model_folders` and the skill `cq-viewer:parametric-3d-printing`; `list_model_folders` and `add_model_folder` (`select: false`) called through the Host. Earlier (1.0.0): open, folder registration via `?root=`, and Host bridge detection (the `ui/initialize` handshake is not answered in this build, so the fallback path is used).
- `node --test plugins/hanzijie/cq-viewer/tests/*.test.mjs` — 35 tests against the real Node entry with a temporary home directory. `tests/workspace.test.mjs` (1.4.0): a conversation folder in a hidden top-level directory is accepted and listed, home, `/`, and missing folders are refused, conversation folders stay out of `roots.json`; extra folders belong to one conversation folder and can be removed; annotations kept per folder with the latest mirrored to `selection.json`; AI requests with `workspace` reach only that conversation, a file outside it adds its folder as an extra folder, requests without `workspace` follow the file's location, hidden subfolders stay unlisted; `viewer_connected` counts only pages of that folder; renders listed per folder. `tests/render.test.mjs` (1.3.0, fake `context.agent`): one Agent turn per render with the description kept out of its instructions and inside `args.json`; result served with the right type and download name; a result in the Agent's own folder is copied in only under the job's name; non-image results refused; `RENDER_FAILED` reasons shown; approvals shown with tool and command, relayed only on request (wrong request ID and `allowAlways` refused), never answered on their own; cancel; no deleting a running render; retry reuses picture and settings; input validation (ratio, style, image bytes vs. label, size, description length, JSON only, foreign Origin); no Agent access → 503; at most three in progress; restart turns unfinished renders into interrupted or done. `tests/mcp.test.mjs`: the three tools, folder rules, copy to scene with colour, request log across a restart, loopback/JSON checks. `tests/server.test.mjs`: 40 concurrent annotation saves and 8 concurrent folder registrations (page and MCP mixed) without errors or lost entries; with a fake Python, dispose during a STEP conversion kills it and starts no fallback, a killed conversion does not fall back, a `SIGSEGV` crash does; step-cache pruning; Host/Origin checks on every route; versions in sync.
- 1.4.0 in headless Chromium (Playwright) against the real Node entry: with no conversation the page lists nothing and says to open it from a conversation; with a simulated `agent.session()` it lists the conversation folder, an added folder, and `~/.cqview/scene` as foldable folder groups, opens nothing until a file is ticked, filters across folders, adds and removes an extra folder; the title chip shows the plugin icon. Pressing on the model leaves the picture unchanged (pixel diff: only anti-aliasing noise), dragging shows the orbit ring exactly at the pressed point; a trackpad-like scroll pans; **操作方式** recognises the trackpad and switches its gesture list to mouse. No console errors.
- Render panel end-to-end in headless Chromium (Playwright) against the real Node entry with a scripted Agent, light and dark at 1400 px, plus the panel at 760 px: open a model, preview of the white model, style / description, start, approval card scrolled into view, allow once, done with thumbnail and notice, viewer with white-model comparison, `Esc` closes it, second render cancelled; no console errors or failed requests. The captured 1600 px picture was checked by eye (clay material, cropped to the model, no grid or markers).
- End-to-end in headless Chrome against the same Node entry, at 1400 px and 800 px wide (19 checks each): the first points are confirmed and pick mode stays on; further clicks join the list directly while a note box or the instruction box is being edited, focus moves to the new point's note, notes already written are kept; 撤销上一个 / `Backspace` remove the last point of the session; `⌘Z` restores it and keeps notes edited in between; `Esc` twice and 完成 leave pick mode; pressing 选点 again continues without confirmation; a collapsed panel reopens on a new point; after 清空标注 the confirm step returns; `selection.json` has the points, notes, and instruction; the panel stays clear of the pick bar. From 1.1.0: the page switches folder and opens the file when the AI calls the tools; `copy_to_scene` shows the copied part in its colour; a file requested while the page is closed opens on the next visit, is not replayed after that, and stays closed once you untick it; `viewer_connected` turns false when the page goes away. From 1.0.0: STL and STEP opening (multi-level assemblies with names, colours, instances), live reload, pick → confirm → notes, the `ui/message` path against a simulated MCP Apps host, the fallback path against a simulated page bridge, and copy mode without a Host.
- Bundled skill: `run_cadquery_model.py --preview --strict` run from the installed plugin directory (model → STL → watertight check → preview PNG).
- Not verified: the `workspace` argument of the MCP tools through the Host (the conversation used for testing had the tool list from before 1.4.0); trackpad gestures on a real trackpad inside the Electron tab (headless Chromium only); a render started from the page inside MiniMax Code (the Host's background session, its permission prompts, and whether it can write into the Mini App's `dataDir` or falls back to its own folder); **下载** and **复制图片** inside the Electron Mini App tab; **查看过程** opening the side panel; Windows; `add_model_file` through the Host with the viewer panel open (the page side was verified in headless Chrome only); that the Send fallback actually fills the conversation input in this build; STEP files with face-level colours from other CAD tools; the skill's Gridfinity generator with CadQuery 2.5 (the skill asks for 2.6.1 or later).

## Third-party

- [three.js](https://threejs.org/) r170 (`three.module.min.js`, `OrbitControls.js`, `STLLoader.js`), MIT — see `miniapp/client/assets/vendor/LICENSE-three.txt`.
- `skills/parametric-3d-printing/` from [flowful-ai/cad-skill](https://github.com/flowful-ai/cad-skill), PolyForm Noncommercial 1.0.0 — see `skills/parametric-3d-printing/LICENSE` and `UPSTREAM.md`.
- STEP conversion uses the CadQuery / OCP installed on your machine; nothing from it is bundled.

## License

[MIT](LICENSE), except `skills/parametric-3d-printing/`, which keeps its own [PolyForm Noncommercial 1.0.0](skills/parametric-3d-printing/LICENSE) license.
