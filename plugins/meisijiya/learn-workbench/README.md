# Learn Workbench

A teach-method learning workbench for MiniMax Code. You pick a learning folder; the workbench keeps its mission, curriculum, lessons, references, learning records and notes, and gives every lesson its own branch conversation with the Agent.

The page is in Chinese, like the learning method it follows (Matt Pocock's teach approach).

## What it does

- **Setup**: a setup conversation interviews you and writes `MISSION.md`, `RESOURCES.md`, `GLOSSARY.md` and `NOTES.md` into the folder you chose.
- **Curriculum**: the main conversation writes a 3–6 module curriculum into `.workbench/curriculum.json` plus a human-readable `CURRICULUM.md`. Regenerating it keeps existing lesson titles, claimed files and statuses.
- **Lessons**: each lesson has a branch conversation that writes one self-contained HTML lesson into `lessons/`. Every lesson is required to stand alone: when it needs earlier knowledge, it recaps it in one or two sentences and links back.
- **Annotations and notes**: select text in a lesson to annotate it; a note conversation distils chosen lessons and annotations into Markdown under `notes/`.
- **Code links**: a file link inside a lesson (`main.py:608`, `main.py:46–48`) opens a floating code panel at that line, without leaving the app.
- **Workspace management**: create or import learning folders, regenerate a lesson, clean generated artifacts, and switch models.

## Install

- **From Git (MiniMax Code 3.1.11 or later)**: in the plugin marketplace choose **Create → Mini App → Import from Git repository**, then enter `https://github.com/meisijiya/learn-workbench-miniapp`.
- **Manual copy**: copy this folder to `~/.minimax/plugins/learn-workbench/` (`%USERPROFILE%\.minimax\plugins\learn-workbench\` on Windows), restart MiniMax Code, and make sure the plugin is enabled.

The package declares `agentAccess`, `agentConcurrency` and `surface.window`, whose minimum client is MiniMax Code 3.1.2.

## Use

1. Open 学习工作台 from the plugin list.
2. Choose or create a learning folder.
3. Finish the setup conversation, then generate the curriculum from the main conversation.
4. Open a lesson; its branch conversation writes and revises that lesson.
5. Annotate the text you care about, and distil notes when you want them.

## Tested environment

- MiniMax Code 3.1.19 on Windows 11 (10.0.26200), using the Node runtime provided by the app.
- Tested: setup; curriculum generation and regeneration; lesson generation, rewrite and clean-then-regenerate; annotations and highlights; note extraction; the code-link panel; workspace create, import and remove.
- Not tested: macOS, Linux, clients older than 3.1.19, and very long conversations.

## Data & access

- **Files read and written**: only the learning folder you choose. The app creates and edits `MISSION.md`, `RESOURCES.md`, `GLOSSARY.md`, `NOTES.md`, `CURRICULUM.md`, `lessons/*.html`, `reference/*.html`, `learning-records/*.md`, `notes/*.md`, `assets/course.css`, and the `.workbench/` state folder (`workspace.json`, `curriculum.json`, `curriculum.backup.json`, `sessions.json`, `annotations.json`, `notes.json`, `rules/teach.md`, `context/`).
- **Where state is stored**: the workspace folder above, plus a workspace registry (`registry.json`) in the Host-provided `context.dataDir`.
- **Network**: the Mini App makes no external network requests. The page talks only to its own local Node service on the Host-assigned port. Agent turns it starts may use the Host's own tools and network under the Host's permissions.
- **Agent turns**: it starts Agent sessions for setup, the main conversation (curriculum), each lesson branch, and note extraction. It reads and writes only its own session records inside the selected folder; it does not read other conversations.
- **Tools**: no MCP endpoints; it declares `agentAccess: ["session.run"]`.
- **Processes**: it does not spawn processes beyond the Host starting its own Node entry.
- **Microphone, camera, notifications**: not used.
- **Host navigation read**: no. It does not read which MiniMax Code page you are on.
- **Code files**: clicking a file link reads a text or code file inside the learning folder (no `..`, 512 KB limit) and shows it in a panel.

## License

MIT — see `LICENSE`.
