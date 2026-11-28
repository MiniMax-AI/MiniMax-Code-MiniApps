# 道闸运维知识助手

A local-model operations console for barrier-gate / access-control after-sales teams.

Feed it your own manuals, rule sheets and contracts and it builds a searchable local knowledge
base. Ask a question and it returns a **standard answer with its analysis, a confidence score and
the exact source chunks it used**. Ask it to change a piece of code in plain language and it
returns a reviewable `SEARCH`/`REPLACE` patch plus a unified diff — the file is backed up before
anything is written, and any change can be rolled back from the same panel.

Everything that needs understanding, judgement or generation calls a real model. There are no
canned answers, no keyword matching and no fixed scoring: the local model does the work, and the
page only renders what the model returned.

## What it does

| Panel | What it does |
| --- | --- |
| 知识库 / Knowledge base | Ingests `.txt`, `.md`, `.docx`, `.xlsx` and `.pdf` files, tags each with a category (知识点 / 规则 / 合同 / 其他), asks the model for a title, a summary and the key points, splits the text into chunks and stores one `bge-m3` embedding per chunk. |
| 运维问答 / Ops Q&A | Embeds the question, retrieves the top-k chunks by cosine similarity, and asks the model for a standard answer, an analysis, a confidence score and the gaps the material does not cover. Returns every retrieved source with its score. |
| AI 改代码 / AI code edit | Locates the region to change, asks the model for `SEARCH`/`REPLACE` blocks, requires each `SEARCH` block to match the file **exactly once**, and shows a unified diff before anything is written. Files above 12 000 characters go through a two-stage flow (model locates the region, then the patch is generated inside a bounded window). |
| 部署 / Deploy | Runs a deployment command that you saved in the settings, in a working directory that must sit inside an allowed write root, and keeps the exit code, stdout and stderr of every run. |
| 路由与设置 / Routing & settings | Switches the routing mode, and holds the allowed write roots, the material directories, the backup root and the deployment commands. |

## Model routing

The app can run entirely on your own machine, entirely on the Host's online model, or mix the
two. Four modes are available in **路由与设置**:

| Mode | Behaviour |
| --- | --- |
| `auto` | Picks a route per request from the size of the prompt and the local model's context window. If the request is too large for the local window it starts with the online model and degrades back to local; otherwise it starts local and degrades to online. |
| `local_first` | Always tries the local model first, degrades to the online model when the local call fails. |
| `local_only` | Local only. Never calls the online model. |
| `online_only` | Online only. Never calls the local model. |

Degradation works in both directions and is always reported: every answer and every patch shows
the route that was requested, the route that was actually used, the model that served it and the
reason. `local_only` and `online_only` never degrade.

Local models come from [Ollama](https://ollama.com) on `http://127.0.0.1:11434` (the base URL is
configurable). The app prefers a chat model whose name starts with `qwen3:14b`; otherwise it
picks the largest available chat model, or falls back to the first one. The context window is
fixed by the model's size: **14B-class models get 8 192 tokens, smaller models get 16 384**.

The embedding model is always `bge-m3` and never participates in routing — retrieval quality does
not depend on which chat model answered the question.

The "online" route is the Host's own Agent channel (`context.agent`). It is used for a single
scoped JSON reply, with no file, tool or network access of its own.

## Install and open it

1. Install the plugin package (this directory) in MiniMax Code.
2. Start [Ollama](https://ollama.com) and pull the models you want to use:
   ```bash
   ollama pull qwen3:14b
   ollama pull bge-m3
   ```
3. Open the app and go to **路由与设置**:
   - **允许写入的目录** — the roots the AI code editor may write to. Nothing outside these roots
     can be modified; a target outside them is rejected with an explicit error.
   - **资料目录** — the roots that may be browsed and ingested from disk.
   - **备份根目录** — where backups are written. Each patch application creates
     `<backup root>/<timestamp>/` holding the original file, a `manifest.json` that maps the backup
     file name to its original path, and a `record.json` with the patch and hash details.
   - **部署命令** — the commands the deploy panel may run.
4. Pick a routing mode and start ingesting material.

The panel headings are in Chinese because this is the app's original product language; the
README, the plugin manifest and the code comments are in English.

## Backup and rollback

Applying a patch never overwrites a file silently:

1. The original file is copied into a new timestamped directory under the backup root.
2. `manifest.json` maps `<backup file name>` → `<original absolute path>`.
3. `record.json` stores the patch, the unified diff, the SHA-256 of the file before and after,
   and the status.
4. The new content is written atomically.

The backup list in the **AI 改代码** panel lists every recorded operation. **回滚** restores the
file from its backup and verifies the result against the stored hash. Backups written by an
earlier tool with the same `manifest.json` layout are listed and can be rolled back too.

## Safety properties

- Writes are confined to the configured write roots. The check resolves the real path, so a
  symlink cannot be used to escape a root.
- Only text formats on the editable-extension list can be patched.
- A patch is applied only when every `SEARCH` block matches the current file **exactly once**; a
  non-unique or stale match is refused and the model is asked again.
- The deploy panel can only run commands that are already saved in the settings — there is no
  free-text command field on a single request — and each command's working directory must be
  inside an allowed write root.
- Secrets never reach the page: the page talks to the Node service over narrow business routes
  and no model call happens in the browser.

## Tested environment

- MiniMax Code 3.1.19 on Windows 11 (build 26300).
- The package declares `agentAccess: ["session.run"]` and `surface.window`, so it needs
  **MiniMax Code 3.1.2 or later**.
- Client acceptance exercised in the in-app Browser: ingesting a `.txt` operations manual
  (model summary, `bge-m3` index, 1 chunk), asking a warranty-period question (standard answer,
  analysis, confidence, cited source with its similarity score, routing decision), previewing a
  patch (unique `SEARCH` match and a correct unified diff), applying it (backup directory with
  `manifest.json`, before/after SHA-256), rolling it back (file restored, status updated),
  running a deployment command (exit code and output captured), switching the routing mode
  (persisted and restored), and rejecting a write outside the allowed roots. The console reported
  no errors and no failed requests.
- The Node-side test suite additionally covered `.docx`, `.xlsx`, `.pdf` (ASCII and Chinese text
  via `ToUnicode`), GBK-encoded text and a corrupt file, all against a real local Ollama.

## Data & access

- **Files read** — files the user uploads in the page (`.txt`, `.md`, `.docx`, `.xlsx`, `.pdf`),
  files browsed under the configured material directories, and the target source file of a patch
  request (which must sit inside an allowed write root).
- **Files written** — the patched target file; the backup copy, `manifest.json` and `record.json`
  under the configured backup root; and the Mini App's own state (see below).
- **Network hosts** — the local Ollama server at `http://127.0.0.1:11434` (configurable base URL),
  used for `/api/tags`, `/api/chat` and `/api/embed`. No other outbound request is made by this
  package.
- **Spawned processes** — the deployment commands the user saved in the settings, each started with
  `shell: true` in its configured working directory; on Windows the process tree is terminated with
  `taskkill` when the app is disposed.
- **Agent turns** — `context.agent.run` is used for the "online" route, one scoped JSON reply per
  request, with no file, tool or network access granted to that turn.
- **Conversations read** — none. The package does not declare `session.read` and never lists or
  observes the user's conversations.
- **Tools called** — none. The package does not declare `toolAccess` and never calls a Connector
  or MCP tool.
- **Microphone / camera / notifications** — none. `deviceAccess` is not declared and the page
  requests no browser permission.
- **Host navigation read** — none. `hostAccess` is not declared; the page only follows the Host's
  light/dark theme, which needs no grant.
- **Where state is stored** — in the Host's private `context.dataDir`: `kb/` holds the ingested
  chunks, their embeddings and the document records, `patches/` holds the pending patch payloads,
  `settings.json` holds the routing mode, the roots, the backup root and the deployment commands,
  and `deploy-logs.json` holds the recent deployment logs. The page keeps only its current view
  state in `localStorage`. The package reads no Host file and no runtime state outside
  `context.dataDir`.

## License

MIT. See [LICENSE](LICENSE).
