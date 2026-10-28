/* ═══════════════════════════════════════════════════════════════════════════
   FableCut MCP server — connects Claude (Code / Desktop) to the video editor.
   Zero-dependency stdio JSON-RPC (Model Context Protocol).

   Register once for all Claude Code sessions:
     claude mcp add -s user fablecut -- npx -y fablecut mcp
   or, from a clone:
     claude mcp add -s user fablecut -- node "<path-to>/fablecut/mcp-server.js"

    Tools: fablecut_status, fablecut_docs, fablecut_get_project,
           fablecut_set_project, fablecut_patch_project, fablecut_import_media,
           fablecut_analyze_reference, fablecut_frame, fablecut_encode_profiles,
           fablecut_normalize_audio, fablecut_auto_duck, fablecut_export,
           fablecut_scopes
   ═══════════════════════════════════════════════════════════════════════════ */
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn, spawnSync } = require("./processes.js");
const { loadEncodeProfiles, listProfilesPublic, resolveProfile, profileSummary } = require("./encode-profiles");

const {
  APP_DIR, DATA_DIR, MEDIA_DIR, EXPORTS_DIR, ANALYSIS_DIR, LIBRARY_DIR, PROJECT_FILE, PROXIES_DIR, ensureDirs, readSaved, writeSaved,
} = require("./paths");
const { downloadImportUrl, maybeFaststart } = require("./import-url");
const { kindFromName, isMediaName, isManagedName, refuseMessage, refuseLibraryMessage } = require("./media-types");
const FX = require("./audio-fx");
const EditOps = require("./edit-ops");
const ProjectOps = require("./project-ops");
const Denoise = require("./denoise");
const { createProjects } = require("./projects");
const { createHistory } = require("./history");
const Color = require("./color");
const FrameStats = require("./frame-stats");
const Mask = require("./mask");
const Tracker = require("./tracker");
const Motion = require("./motion");
const CompLib = require("./comp");
const SeqLib = require("./sequences");
const Templates = require("./templates");
const Delivery = require("./delivery");
const { probeFile, infoForEntry } = require("./media-probe");
const { findProxies } = require("./proxy");
/** The user's saved presets / templates (library/presets, library/templates), validated; bad files skipped. */
const savedItems = (kind) => readSaved(kind).map((x) => (kind === "presets" ? Templates.normalizePreset(x.data) : Templates.normalizeTemplate(x.data))).filter(Boolean);

/* ROOT is where the code lives (server.js, CLAUDE.md); the user's timeline and
   media live under DATA_DIR. Identical unless FABLECUT_DATA_DIR is set. */
const ROOT = APP_DIR;
ensureDirs();
const PORT = process.env.FABLECUT_PORT || 7777;
const BASE = `http://localhost:${PORT}`;
// Requests go to the address the server binds: on Node 18, "localhost" can
// resolve to ::1 first and is not retried on 127.0.0.1.
const API = `http://${process.env.HOST === "::1" ? "[::1]" : "127.0.0.1"}:${PORT}`;

/* Where the editor's page is, as the tools describe it.
   Upstream prints its own loopback URL, so the user can open the editor in a
   browser. A host that serves the page itself has no such URL to print: the
   user opens that host's app, and served files are relative to the editor's
   own origin. The host replaces these three strings. */
let EDITOR_URL = BASE;
let EDITOR_OPEN = `open ${BASE} in a browser to watch edits live`;
let EDITOR_WHERE = `the editor UI (if open at ${BASE})`;
/** @param {{url?: string, open?: string, where?: string}} [location] */
function setEditorLocation(location = {}) {
  if (typeof location.url === "string") EDITOR_URL = location.url;
  if (typeof location.open === "string") EDITOR_OPEN = location.open;
  if (typeof location.where === "string") EDITOR_WHERE = location.where;
}

/* MCP initialize must echo a version we actually speak. Echoing an unknown
   client version (or crashing) fails handshake with stock SDK clients. */
const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2024-11-05"];
const MCP_DEFAULT_PROTOCOL_VERSION = MCP_PROTOCOL_VERSIONS[0];
function negotiateProtocolVersion(requested) {
  return MCP_PROTOCOL_VERSIONS.includes(requested) ? requested : MCP_DEFAULT_PROTOCOL_VERSION;
}

/* ── Helpers ── */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function readProject() {
  const raw = fs.readFileSync(PROJECT_FILE, "utf8").replace(new RegExp("^\\uFEFF"), "");
  return JSON.parse(raw);
}
function writeProject(doc) {
  require("./processes.js").assertRunning();
  // atomic tmp+rename so the UI's file watcher never sees a half-written doc
  const tmp = PROJECT_FILE + ".mcp.tmp";
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2));
  fs.renameSync(tmp, PROJECT_FILE);
}
/* Transport to the editor.
   Upstream runs the editor as a separate process and reaches it over HTTP on
   127.0.0.1:7777. A host that runs both in one process installs a transport
   instead (setTransport): the tools then call the editor's own request
   handler in-process, with no socket, no port and no credential. */
let transport = null;
/** Install an in-process transport: {json(method, path, body, headers),
 *  ok(url)}. Pass null to go back to HTTP. */
function setTransport(next) { transport = next || null; }
function httpOk(url) {
  if (transport) return transport.ok(url);
  return new Promise((resolve) => {
    const req = http.get(url, (r) => { r.resume(); resolve(r.statusCode < 500); });
    req.on("error", () => resolve(false));
    req.setTimeout(1200, () => { req.destroy(); resolve(false); });
  });
}
/** JSON request to the editor server → {status, body}. Extra headers are for
 *  endpoints that gate on them — /api/frame?path= needs X-FableCut-Client. */
function apiJSON(method, urlPath, payload, headers) {
  if (transport) return transport.json(method, urlPath, payload, headers);
  return new Promise((resolve, reject) => {
    const req = http.request(API + urlPath, { method, headers: { "Content-Type": "application/json", ...headers } }, (r) => {
      let data = "";
      r.setEncoding("utf8");
      r.on("data", (d) => { data += d; });
      r.on("end", () => {
        let body = null;
        try { body = JSON.parse(data); } catch { body = { error: data }; }
        resolve({ status: r.statusCode, body });
      });
    });
    req.on("error", reject);
    req.setTimeout(15_000, () => req.destroy(new Error("editor server did not answer")));
    req.end(payload === undefined ? undefined : JSON.stringify(payload));
  });
}
async function ensureUIServer() {
  /* An in-process transport is the editor itself: it is always there. */
  if (transport) return true;
  if (await httpOk(API + "/api/project")) return true;
  /* Tests (and nothing else) may set FABLECUT_NO_AUTOSTART=1: the auto-start
     below spawns a detached server.js the test harness cannot stop — it
     inherits the test's port and data dir and keeps running after the test.
     With the flag set, report the missing server instead of starting one. */
  if (process.env.FABLECUT_NO_AUTOSTART === "1") return false;
  spawn(process.execPath, [path.join(ROOT, "server.js")],
    { cwd: ROOT, detached: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 12; i++) {
    await sleep(300);
    if (await httpOk(API + "/api/project")) return true;
  }
  return false;
}
function ffprobeDuration(file) {
  try {
    const r = spawnSync("ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
      { encoding: "utf8", timeout: 10_000 });
    const d = parseFloat((r.stdout || "").trim());
    return isNaN(d) ? undefined : Math.round(d * 1000) / 1000;
  } catch { return undefined; }
}
const uid = () => Math.random().toString(36).slice(2, 9);

/* ── Tool definitions ── */
const TOOLS = [
  {
    name: "fablecut_status",
    description: "Report editor URL, open project and media. Call first.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "fablecut_docs",
    description: "Read the Cutline manual: schema, clips, tracks, props, keyframes, transitions, recipes. Fetch one part with `section`.",
    inputSchema: {
      type: "object",
      properties: { section: { type: "string", description: "The '## ' sections whose heading matches this" } },
    },
  },
  {
    name: "fablecut_get_project",
    description: "Read the project; `compact:true` gives one line per clip.",
    inputSchema: {
      type: "object",
      properties: { compact: { type: "boolean", description: "A compact summary instead of the JSON" } },
    },
  },
  {
    name: "fablecut_patch_project",
    description: "Apply edit ops in one revision bump. Op shapes: `fablecut_docs` ({section:\"MCP connection\"}, {section:\"schema\"}). `baseRevision` turns a UI change into a CONFLICT.",
    inputSchema: {
      type: "object",
      properties: {
        ops: {
          type: "array",
          items: { type: "object" },
          description: "Edit ops in order; force:true overrides a lock",
        },
        baseRevision: {
          type: "integer",
          description: "The planned revision; a newer project gives CONFLICT",
        },
      },
      required: ["ops"],
    },
  },
  {
    name: "fablecut_set_project",
    description: "Replace the whole project document, with `baseRevision` the revision it was based on; another revision refuses the save with CONFLICT.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "object", description: "The whole project document (`revision` ignored)" },
        baseRevision: { type: "integer", description: "REQUIRED. The revision it was based on" },
        force: { type: "boolean", description: "Save anyway when the project moved on; only on request" },
      },
      required: ["project", "baseRevision"],
    },
  },
  {
    name: "fablecut_frame",
    description: "Return an image of the footage or the composed timeline; needs a vision model, or `text:true` for measurements. With `path` one frame or a contact sheet.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Source clip: an absolute file path or '/media/…'/'/library/…' src; read in place, never copied" },
        t: { type: "number", description: "Seconds into the clip (default 0)" },
        time: { type: "number", description: "Timeline seconds (default: the playhead)" },
        frames: { type: "number", description: "Contact sheet: moments, 2–60 (default 12)" },
        cols: { type: "number", description: "Contact-sheet columns" },
        from: { type: "number", description: "Contact sheet start (default 0)" },
        to: { type: "number", description: "Contact sheet end (default: clip duration)" },
        width: { type: "number", description: "Pixel width (default 768, or 320 per cell)" },
        text: { type: "boolean", description: "Text measurements instead of the image" },
        where: { type: "string", enum: ["auto", "tab", "headless"], description: "auto (default) or tab; headless is refused here" },
        timeout: { type: "number", description: "Seconds to wait (default 60)" },
      },
    },
  },
  {
    name: "fablecut_analyze_reference",
    description: "Analyze a reference video into an edit blueprint: shot cuts with energy, beats/BPM, loudness, the drop and its music; external local paths must be audio/video.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "An absolute file path (copied into media/) or '/media/…' src" },
        threshold: { type: "number", description: "Scene-cut sensitivity 0–1 (default adaptive)" },
        registerMusic: { type: "boolean", description: "Extract the music (default true)" },
      },
      required: ["path"],
    },
  },
  {
    name: "fablecut_import_media",
    description: "Import video, audio, image or SVG from a user-authorized local path, or video/audio/image from an https URL; remote SVG is refused. Local files are copied and originals stay unchanged.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Local file path, or an https:// URL" } },
      required: ["path"],
    },
  },
  {
    name: "fablecut_encode_profiles",
    description: "List the delivery presets and raw ffmpeg encoding profiles the export uses; `{preset}` or `{profile}` returns one in full.",
    inputSchema: {
      type: "object",
      properties: {
        detail: { type: "boolean", description: "Full ffmpeg args array" },
        profile: { type: "string", description: "One encoding profile by id" },
        preset: { type: "string", description: "One delivery preset's full spec" },
      },
    },
  },
  {
    name: "fablecut_normalize_audio",
    description: "Measure each clip's source loudness and set `props.gain` to the target; linked stems share one gain. Needs ffmpeg on PATH.",
    inputSchema: {
      type: "object",
      properties: {
        clipIds: { type: "array", items: { type: "string" }, description: "Clips to normalize" },
        mode: { type: "string", enum: ["lufs", "peak"], description: "Loudness (default) or sample peak" },
        target: { type: "number", description: "LUFS for lufs (default -14), dBFS for peak (default -1)" },
        force: { type: "boolean", description: "Also change locked clips" },
      },
      required: ["clipIds"],
    },
  },
  {
    name: "fablecut_auto_duck",
    description: "Duck music under dialogue by writing `duck` keyframes where the voice tracks have sound; a dip of `amount` dB ramps down and up.",
    inputSchema: {
      type: "object",
      properties: {
        clipIds: { type: "array", items: { type: "string" }, description: "The music clips to duck" },
        under: { type: "array", items: { type: "string" }, description: "Voice tracks" },
        amount: { type: "number", description: "Dip depth dB, -40…0 (default -12; 0 clears)" },
        threshold: { type: "number", description: "Voice level dBFS (default -40)" },
        attack: { type: "number", description: "Ramp-down seconds (default 0.3)" },
        release: { type: "number", description: "Ramp-up seconds (default 0.6)" },
        force: { type: "boolean", description: "Also change locked clips" },
      },
      required: ["clipIds"],
    },
  },
  {
    name: "fablecut_silence",
    description: "Find the silences in speech and, with `cut:true`, cut them out, keeping `padding` of quiet beside each phrase.",
    inputSchema: {
      type: "object",
      properties: {
        clipIds: { type: "array", items: { type: "string" }, description: "The speech clips to listen to" },
        threshold: { type: "number", description: "Below this dBFS is silence, -80…-10 (default -40)" },
        minSilence: { type: "number", description: "Shortest silence, 0.1…10 s (default 0.5)" },
        padding: { type: "number", description: "Quiet beside a phrase, 0…2 s (default 0.15)" },
        cut: { type: "boolean", description: "Cut the silences out (default false)" },
        tracks: { type: "array", items: { type: "string" }, description: "cut: the lanes to cut on" },
        force: { type: "boolean", description: "cut: also cut locked clips" },
      },
      required: ["clipIds"],
    },
  },
  {
    name: "fablecut_denoise",
    description: "Reduce background noise on audio clips: ffmpeg's denoiser renders a cleaned copy the clip switches to; 'off' restores the original.",
    inputSchema: {
      type: "object",
      properties: {
        clipIds: { type: "array", items: { type: "string" }, description: "Audio clips, or video clips with stems" },
        amount: { type: "string", enum: ["light", "medium", "strong", "off"], description: "Noise strength (default medium); off = original" },
        force: { type: "boolean", description: "Also change locked clips" },
      },
      required: ["clipIds"],
    },
  },
  {
    name: "fablecut_projects",
    description: "Manage the projects in this Cutline (list, open, new, duplicate, update, archive, delete, templates); opening or deleting changes the user's view.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "open", "new", "duplicate", "update", "archive", "unarchive", "delete", "templates", "save_template", "delete_template"], description: "What to do (default list)" },
        id: { type: "string", description: "The project (p_…)" },
        name: { type: "string", description: "The project's or template's name" },
        template: { type: "string", description: "Template to start from, or its id" },
        fps: { type: "number", description: "Frame rate (template default)" },
        width: { type: "integer", description: "Canvas width (template default)" },
        height: { type: "integer", description: "Canvas height (template default)" },
        notes: { type: "string", description: "Free-text notes" },
        tags: { type: "array", items: { type: "string" }, description: "Labels (replaces the list)" },
        open: { type: "boolean", description: "Open it after (new: true, duplicate: false)" },
        archived: { type: "string", enum: ["exclude", "only", "all"], description: "list: archived projects too, or only them" },
      },
    },
  },
  {
    name: "fablecut_versions",
    description: "A project's version history (list, save, diff, restore, update, delete); restoring puts a version back after saving the current state.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "save", "diff", "restore", "update", "delete"], description: "What to do (default list)" },
        project: { type: "string", description: "The project (p_…); default the open one" },
        version: { description: "Its number (3) or \"v3\"", anyOf: [{ type: "integer" }, { type: "string" }] },
        to: { description: "diff: compare to this version", anyOf: [{ type: "integer" }, { type: "string" }] },
        name: { type: "string", description: "The version's name (default \"Version NN\")" },
        note: { type: "string", description: "What this version is" },
        final: { type: "boolean", description: "Mark it the final cut (one per project)" },
      },
    },
  },
  {
    name: "fablecut_proxy",
    description: "Report or make light H.264 copies of heavy footage (540p by default) for smooth playback; exports read the original.",
    inputSchema: {
      type: "object",
      properties: {
        mediaIds: { type: "array", items: { type: "string" }, description: "Video media ids (default: all)" },
        create: { type: "boolean", description: "Make proxies for these files" },
        delete: { type: "boolean", description: "Delete their proxies" },
        height: { type: "number", enum: [540, 720, 1080], description: "Proxy height in pixels (default 540)" },
        wait: { type: "boolean", description: "With create: wait for every proxy (default true)" },
        timeout: { type: "number", description: "Seconds to wait with create (default 900)" },
      },
    },
  },
  {
    name: "fablecut_export",
    description: "Render the timeline to a video file in exports/, with the editor's own compositor and encoding. It runs in the open editor tab, so the Mini App has to be open.",
    inputSchema: {
      type: "object",
      properties: {
        range: { type: "string", enum: ["entire", "in-out"], description: "Whole timeline, or inPoint→outPoint; default in-out when either marker is set, otherwise entire" },
        preset: { type: "string", description: "Delivery preset id (fablecut_encode_profiles lists them)" },
        delivery: { type: "object", description: "Over the preset: {width, height, fps, reframe, container, video, audio, color, filename, metadata}" },
        outputs: { description: "true = the project's batch outputs, or a list of preset ids", anyOf: [{ type: "boolean" }, { type: "array", items: { anyOf: [{ type: "string" }, { type: "object" }] } }] },
        profile: { type: "string", description: "Encoding profile id (raw ffmpeg args), not with preset, delivery or outputs" },
        where: { type: "string", enum: ["auto", "tab", "headless"], description: "auto (default) or tab; headless is refused here" },
        wait: { type: "boolean", description: "Block until the file is written (default true)" },
        timeout: { type: "number", description: "Seconds to wait before the status (default 900)" },
        job: { type: "string", description: "Report on an export started earlier" },
        cancel: { type: "string", description: "Cancel this export job" },
      },
    },
  },
  {
    name: "fablecut_scopes",
    description: "Measure the graded picture at one moment with the editor's scopes: luma, crushed/clipped shares, mean RGB, saturation and colour cast; same compositor as export, playhead stays put.",
    inputSchema: {
      type: "object",
      properties: {
        time: { type: "number", description: "Timeline seconds (default: the playhead)" },
        matte: {
          type: "object",
          description: "Measure what one grade layer selects: {clip, layer}",
          properties: { clip: { type: "string" }, layer: { type: "integer", minimum: 0 } },
          required: ["clip", "layer"],
        },
        mask: {
          type: "object",
          description: "Measure a clip's masks: {clip}",
          properties: { clip: { type: "string" } },
          required: ["clip"],
        },
        where: { type: "string", enum: ["auto", "tab", "headless"], description: "auto (default) or tab; headless is refused here" },
        timeout: { type: "number", description: "Seconds to wait (default 60)" },
      },
    },
  },
  {
    name: "fablecut_track",
    description: "Track a detailed region in a video clip frame by frame, store a named track, and let a mask or another clip follow it; reports match quality.",
    inputSchema: {
      type: "object",
      properties: {
        clip: { type: "string", description: "The video clip to track in" },
        region: { type: "object", description: "The area to follow at `at`: x, y centre and w, h, fractions", properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }, required: ["x", "y", "w", "h"] },
        point: { type: "object", description: "A spot to follow at `at`, in fractions", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] },
        size: { type: "number", description: "With point: region width as a fraction (default 0.08)" },
        at: { type: "number", description: "Timeline seconds where the region is as given" },
        direction: { type: "string", enum: ["forward", "backward", "both"], description: "Forward (default), backward or both" },
        to: { type: "number", description: "Timeline seconds to stop at" },
        scale: { type: "boolean", description: "Also follow the region's size" },
        rotation: { type: "boolean", description: "Also follow the region's rotation" },
        name: { type: "string", description: "The track's name (default: the mask's name, or Track n); an existing name is extended or replaced over the tracked range" },
        apply: {
          type: "object",
          description: "Bake the track into keys: {mask} or {clip, scale?, rotation?, at?}",
          properties: { mask: { type: ["integer", "string"] }, clip: { type: "string" }, scale: { type: "boolean" }, rotation: { type: "boolean" }, at: { type: "number" } },
        },
        force: { type: "boolean", description: "Allow changing locked clips, when asked" },
        where: { type: "string", enum: ["auto", "tab", "headless"], description: "auto (default) or tab; headless is refused here" },
        timeout: { type: "number", description: "Seconds to wait (default 300)" },
      },
      required: ["clip"],
    },
  },
  {
    name: "fablecut_import_project",
    description: "Import a Cutline project folder (project.json plus media/); referenced media are copied into this installation's library and originals stay untouched. Missing, escaping or unsupported files refuse the import.",
    inputSchema: {
      type: "object",
      properties: {
        folder: { type: "string", description: "The data folder holding project.json and media/" },
        project: { type: "string", description: "Which project to import from that folder" },
      },
      required: ["folder"],
    },
  },
];

/* ── Loudness normalize (fablecut_normalize_audio) ──
   Decodes each clip's source window with ffmpeg and measures it with the same
   loudness.js the editor uses, so agent and UI land on identical gains. */
const DEFAULT_TRACKS = [
  { id: "V3", kind: "video" }, { id: "V2", kind: "video" }, { id: "V1", kind: "video" },
  { id: "A1", kind: "audio" }, { id: "A2", kind: "audio" }, { id: "A3", kind: "audio" }, { id: "A4", kind: "audio" },
];
const NORM_SR = 48000;
function mediaFile(src) {
  const p = decodeURIComponent(String(src || "").split("?")[0]);
  const [root, rel] = p.startsWith("/media/") ? [MEDIA_DIR, p.slice(7)]
    : p.startsWith("/library/") ? [LIBRARY_DIR, p.slice(9)] : [null, null];
  if (!root) return null;
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(path.normalize(root + path.sep))) return null;
  const actualRoot = realPath(root);
  const actualFile = realPath(file);
  return actualRoot && actualFile && within(actualFile, actualRoot) && fs.statSync(actualFile).isFile()
    ? actualFile : null;
}
/** Source seconds a clip consumes: duration × speed, integrating speed keyframes. */
function clipSourceLen(c) {
  const base = Math.min(8, Math.max(0.1, +c.props?.speed || 1));
  const kf = c.keyframes?.speed;
  if (!Array.isArray(kf) || !kf.length) return c.duration * base;
  const at = (t) => {
    if (t <= kf[0].t) return kf[0].v;
    for (let i = 1; i < kf.length; i++)
      if (t <= kf[i].t) return kf[i - 1].v + (kf[i].v - kf[i - 1].v) * (t - kf[i - 1].t) / ((kf[i].t - kf[i - 1].t) || 1);
    return kf[kf.length - 1].v;
  };
  let sum = 0;
  const n = Math.max(2, Math.ceil(c.duration * 60));
  for (let i = 0; i < n; i++) sum += Math.min(8, Math.max(0.1, at((i + 0.5) * c.duration / n))) * c.duration / n;
  return sum;
}
function probeChannels(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels",
    "-of", "csv=p=0", file], { encoding: "utf8" });
  if (r.error) throw new Error("ffprobe not found on PATH — needed to measure audio");
  const n = parseInt(String(r.stdout).trim(), 10);
  return n > 0 ? n : 0;
}
/** Decode a clip's source window with ffmpeg and hand each chunk to
 *  `onChunk(channels)`. Resolves to the channel count (0 = no audio stream). */
function streamClipAudio(proj, c0, onStart, onChunk) {
  const media = proj.media.find((m) => m.id === c0.mediaId);
  const file = media && mediaFile(media.src);
  if (!file) return Promise.reject(new Error(`clip ${c0.id}: media file not found`));
  const nCh = probeChannels(file);
  if (!nCh || onStart(nCh) === false) return Promise.resolve(0);
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", ["-v", "error", "-ss", String(Math.max(0, +c0.in || 0)),
      "-t", String(Math.max(0.01, clipSourceLen(c0))), "-i", file, "-vn", "-map", "0:a:0",
      "-ar", String(NORM_SR), "-f", "f32le", "-acodec", "pcm_f32le", "-"]);
    let rest = Buffer.alloc(0), err = "";
    const frameBytes = 4 * nCh;
    proc.stdout.on("data", (chunk) => {
      const buf = rest.length ? Buffer.concat([rest, chunk]) : chunk;
      const frames = Math.floor(buf.length / frameBytes);
      rest = buf.subarray(frames * frameBytes);
      if (!frames) return;
      const chs = Array.from({ length: nCh }, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++)
        for (let c = 0; c < nCh; c++) chs[c][i] = buf.readFloatLE((i * nCh + c) * 4);
      onChunk(chs);
    });
    proc.stderr.on("data", (d) => { err += d; });
    proc.on("error", () => reject(new Error("ffmpeg not found on PATH — needed to read audio")));
    proc.on("close", (code) => code === 0 ? resolve(nCh)
      : reject(new Error(`ffmpeg failed reading ${c0.id}: ${err.trim().split("\n").pop() || code}`)));
  });
}
/** Measure clips that play together (one linked group: same file + window). */
async function measureClipGroup(proj, clips) {
  const L = require("./loudness.js");
  let meter = null;
  await streamClipAudio(proj, clips[0], (nCh) => {
    const routedCount = clips.reduce((n, c) =>
      n + L.routeChannels(Array.from({ length: nCh }, () => new Float32Array(0)), c.props || {}).length, 0);
    if (!routedCount) return false;
    meter = new L.LoudnessMeter(routedCount, NORM_SR);
  }, (chs) => meter.push(clips.flatMap((c) => L.routeChannels(chs, c.props || {}))));
  return meter ? meter.result() : null;
}
/** Timeline spans with sound on these voice clips (ducking.js pipeline). */
async function voiceRegions(proj, voices, threshold, minLen, heard) {
  const L = require("./loudness.js"), D = require("./ducking.js");
  const lists = [];
  for (const v of voices) {
    let env = null;
    await streamClipAudio(proj, v, (nCh) => { env = new D.EnvelopeMeter(nCh, NORM_SR); },
      (chs) => env.push(L.routeChannels(chs, v.props || {})));
    if (!env) continue;   // no audio stream
    if (heard) heard.add(v.id);
    const sp = Math.min(8, Math.max(0.1, +v.props?.speed || 1));
    const gain = Math.pow(10, (+v.props?.gain || 0) / 20) * Math.min(2, Math.max(0, +(v.props?.volume ?? 1)));
    lists.push(D.activeRegions(env.result(), { t0: v.start, speed: sp, gain, threshold, ...(minLen != null ? { minLen } : {}) }));
  }
  return D.mergeRegions(lists, minLen != null ? 0 : undefined);
}
/** The clips that carry a selection's sound, one list per linked group: its
 *  audio stems, else the clip itself (audio, or a video without stems). */
function speechGroups(proj, ids) {
  const groups = new Map();
  for (const id of ids) {
    const c = proj.clips.find((x) => x.id === id);
    if (!c) throw new Error("no clip " + id);
    if (c.kind !== "audio" && c.kind !== "video") throw new Error(`clip ${id} is ${c.kind} — no sound to listen to`);
    const key = c.linkGroup || c.id;
    if (groups.has(key)) continue;
    const members = c.linkGroup ? proj.clips.filter((x) => x.linkGroup === c.linkGroup) : [c];
    const stems = members.filter((x) => x.kind === "audio");
    groups.set(key, stems.length ? stems : [c]);
  }
  return [...groups.values()];
}
const fmtClock = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;
const fmtDur = (s) => { const t = Math.round(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
/* fablecut_silence: silence.js on the clips' sound, then (cut:true) its extract ops. */
async function silenceTool(args) {
  const S = require("./silence.js");
  const ids = Array.isArray(args.clipIds) ? args.clipIds.map(String) : [];
  if (!ids.length) throw new Error("`clipIds` must list the speech clip(s) to listen to");
  const opts = S.options(args);
  const doc = readProject();
  const readRev = doc.revision || 0;
  const groups = speechGroups(doc, ids);
  const disabled = new Set(Array.isArray(doc.disabledTracks) ? doc.disabledTracks : []);
  const enabled = groups.map((g) => g.filter((x) => !disabled.has(x.track) && x.disabled !== true)).filter((g) => g.length);
  if (!enabled.length) throw new Error("those clips are disabled (or on disabled tracks) — nothing to listen to");
  // a speed ramp moves the sound along the timeline unevenly: those clips are left alone
  const live = enabled.filter((g) => !g.some(S.ramped));
  const rampedN = enabled.length - live.length;
  if (!live.length) throw new Error("those clips have a speed ramp (speed keyframes) — silence removal works on clips at a steady speed");
  const heard = new Set();
  const sound = await voiceRegions(doc, live.flat(), opts.threshold, S.MIN_SOUND, heard);
  // only time that was actually listened to can be silent: a clip with no audio stream is left alone
  const usable = live.filter((g) => g.every((x) => heard.has(x.id)));
  if (!usable.length) throw new Error("those clips have no audio stream — nothing to listen to");
  const ranges = usable.map((g) => [Math.min(...g.map((x) => x.start)), Math.max(...g.map((x) => x.start + x.duration))]);
  const spans = S.silentSpans(sound, ranges, { ...opts, fps: doc.fps });
  const listen = S.union(ranges).reduce((n, [a, b]) => n + b - a, 0);
  const head = `${spans.length} silence${spans.length === 1 ? "" : "s"}, ${S.total(spans).toFixed(1)} s of ${fmtDur(listen)} ` +
    `(threshold ${opts.threshold} dBFS, at least ${opts.minSilence} s, ${opts.padding} s kept beside speech` +
    (usable.length < live.length ? `; ${live.length - usable.length} clip(s) with no audio stream left alone` : "") +
    (rampedN ? `; ${rampedN} clip(s) with a speed ramp left alone` : "") + ")";
  const list = spans.slice(0, 60).map((s) => `  ${fmtClock(s.from)} → ${fmtClock(s.to)}  (${(s.to - s.from).toFixed(2)} s)`)
    .concat(spans.length > 60 ? [`  … +${spans.length - 60} more`] : []);
  if (args.cut !== true) return [head + (spans.length ? ":" : "."), ...list,
    ...(spans.length ? ["Nothing cut yet: call again with cut:true to remove them (lock the music bed first if it should keep running)."] : [])].join("\n");
  if (!spans.length) return head + " — nothing to cut.";
  // the timeline must be the one that was listened to
  const proj = readProject();
  if ((proj.revision || 0) !== readRev)
    throw new Error(`the project changed while listening (revision ${readRev} → ${proj.revision}) — nothing cut; run fablecut_silence again`);
  const end = (p) => p.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
  const before = end(proj);
  ProjectOps.applyPatch(proj, S.cutOps(spans, { tracks: args.tracks, force: args.force === true }), { savedItems });
  // a cut this size always keeps the project as it was, not once per session like other edits
  let verWarn = "";
  try { createHistory({ projects: createProjects({ dataDir: DATA_DIR, projectFile: PROJECT_FILE, libraryDir: LIBRARY_DIR }) }).beforeAgent("Before cutting silences"); }
  catch (e) { verWarn = ` Warning: no version was saved before the cut (${e.message}).`; }
  let diskRev = readRev;
  try { diskRev = readProject().revision || 0; } catch {}
  if (diskRev !== readRev) throw new Error(`the project changed while cutting (revision ${readRev} → ${diskRev}) — nothing cut; run fablecut_silence again`);
  proj.revision = readRev + 1;
  writeProject(proj);
  return `Cut ${head} — timeline ${fmtDur(before)} → ${fmtDur(end(proj))} (revision ${proj.revision}). UI hot-reloaded.` +
    (verWarn || ` The project as it was is kept as a version (fablecut_versions lists it; restore undoes the cut).`);
}
/** The clips that sound for a selection: a linked group's audio stems, else the clip. */
function normalizeGroups(proj, ids) {
  const groups = new Map();
  for (const id of ids) {
    const c = proj.clips.find((x) => x.id === id);
    if (!c) throw new Error("no clip " + id);
    if (c.kind !== "audio" && c.kind !== "video") throw new Error(`clip ${id} is ${c.kind} — no audio to normalize`);
    const key = c.linkGroup || c.id;
    if (groups.has(key)) continue;
    const members = c.linkGroup ? proj.clips.filter((x) => x.linkGroup === c.linkGroup) : [c];
    const stems = members.filter((x) => x.kind === "audio");
    groups.set(key, stems.length ? stems : members);
  }
  return [...groups.values()];
}

/* ── Noise reduction (fablecut_denoise) — denoise.js, as the editor's Noise control ── */
async function denoiseTool(args) {
  const ids = Array.isArray(args.clipIds) ? args.clipIds.map(String) : [];
  if (!ids.length) throw new Error("`clipIds` must list at least one clip");
  const amount = args.amount == null ? "medium" : String(args.amount);
  if (amount !== "off" && !Denoise.AMOUNT_IDS.includes(amount)) throw new Error(`amount must be one of ${Denoise.AMOUNT_IDS.join(", ")}, off`);
  let doc = readProject();
  const picked = ids.map((id) => {
    const c = doc.clips.find((x) => x.id === id);
    if (!c) throw new Error("no clip " + id);
    return c;
  });
  const targets = Denoise.denoiseTargets(doc, picked);
  const lockedTracks = new Set(Array.isArray(doc.lockedTracks) ? doc.lockedTracks : []);
  const isLocked = (c) => (c.linkGroup ? doc.clips.filter((x) => x.linkGroup === c.linkGroup) : [c])
    .some((x) => x.locked === true || lockedTracks.has(x.track));
  if (args.force !== true && targets.some(isLocked))
    throw new Error(`${targets.filter(isLocked).map((c) => c.id).join(", ")} locked — the user locked it. Leave it alone, or pass force:true if they asked you to change it`);
  const bases = [...new Set(targets.map((c) => Denoise.baseMediaId(doc, c.mediaId)))];
  const rendered = new Map(); // base id → {r, base}
  if (amount !== "off") {
    for (const id of bases) {
      const base = doc.media.find((m) => m.id === id);
      const file = base && mediaFile(base.src);
      if (!file) throw new Error(`media ${id}: file not found`);
      rendered.set(id, { base, r: await Denoise.denoiseFile(file, MEDIA_DIR, amount) });
    }
  }
  // Re-read after the (slow) render so concurrent UI edits are kept.
  const proj = readProject();
  const report = [];
  const swap = new Map();
  for (const id of bases) {
    if (amount === "off") { swap.set(id, id); continue; }
    const { base, r } = rendered.get(id);
    const src = "/media/" + encodeURIComponent(r.name);
    let m = proj.media.find((x) => x.src === src);
    if (!m) {
      m = { id: "m_" + uid(), name: r.name, kind: "audio", src, duration: r.duration, folderId: base.folderId || null,
        derivedFrom: base.id, denoise: amount };
      proj.media.push(m);
    }
    swap.set(id, m.id);
    report.push(`${id} → ${m.id} "${r.name}"${r.cached ? " (already rendered)" : ""}`);
  }
  let changed = 0;
  for (const t of targets) {
    const c = proj.clips.find((x) => x.id === t.id);
    if (!c) continue;
    const next = swap.get(Denoise.baseMediaId(proj, c.mediaId));
    if (next && next !== c.mediaId) { c.mediaId = next; changed++; }
  }
  proj.revision = (proj.revision || 0) + 1;
  writeProject(proj);
  return `Noise reduction ${amount} on ${targets.map((c) => c.id).join(", ")} (revision ${proj.revision}, ${changed} clip${changed === 1 ? "" : "s"} switched)` +
    (report.length ? ":\n" + report.join("\n") : "");
}

/* ── Export (fablecut_export) ── */
/** Saved delivery presets (library/delivery/), as the server lists them. */
function savedDeliveryPresets() { return Delivery.savedPresets(readSaved("delivery")); }
function describeExportJob(j) {
  const pct = Math.round((j.progress || 0) * 100);
  if (j.status === "done") {
    const file = path.join(EXPORTS_DIR, path.basename(decodeURIComponent(j.src || "")));
    let size = "";
    try { size = ` (${(fs.statSync(file).size / 1048576).toFixed(1)} MB)`; } catch {}
    const outs = j.result && Array.isArray(j.result.outputs) ? j.result.outputs : null;
    if (outs && outs.length > 1) {
      return `Export ${j.id} done — ${outs.filter((o) => o.ok).length} of ${outs.length} files:\n` + outs.map((o) => o.ok
        ? `✓ ${path.join(EXPORTS_DIR, o.file)}${o.summary ? ` — ${o.summary}` : ""}${o.report ? `\n    ${o.report.ok ? "checks passed" : "CHECK"}: ${o.report.line}` : ""}`
        : `✗ ${o.file}: ${o.error}`).join("\n");
    }
    const rep = outs && outs[0] && outs[0].report;
    return `Export ${j.id} done → ${file}${size}${j.result && j.result.summary ? `\n${j.result.summary}` : ""}` +
      `${rep ? `\n${rep.ok ? "Checks passed" : "CHECK"}: ${rep.line}` : ""}\nServed at ${EDITOR_URL}${j.src}`;
  }
  if (j.status === "failed" || j.status === "cancelled") return `Export ${j.id} ${j.status}: ${j.error || "no reason given"}`;
  return `Export ${j.id} ${j.status}${j.status === "running" ? ` — ${pct}%` : ""} (in ${j.via === "headless" ? "a headless browser" : "the open editor tab"}). ` +
    `Check again with fablecut_export {job:"${j.id}"}, or stop it with {cancel:"${j.id}"}.`;
}
/* fablecut_proxy: the server makes proxies (proxy.js); this asks it, and waits. */
/* fablecut_projects: through the editor server, so it is the only process that
   switches ./project.json and its tabs hear about it at once. */
function describeProject(p) {
  const dur = p.duration == null ? "?" : `${Math.floor(p.duration / 60)}:${String(Math.round(p.duration % 60)).padStart(2, "0")}`;
  return `${p.id} "${p.name}"${p.active ? " (OPEN)" : ""}${p.archived ? " [archived]" : ""} — ` +
    (p.unreadable ? "project file unreadable" : `${p.width}x${p.height}@${p.fps} ${dur}, ${p.clips} clip(s), ${p.media} media`) +
    (p.modified ? `, modified ${p.modified.slice(0, 16).replace("T", " ")}` : "") +
    (p.tags?.length ? " " + p.tags.map((t) => "#" + t).join(" ") : "") +
    (p.notes ? `\n    notes: ${p.notes.length > 300 ? p.notes.slice(0, 300) + "…" : p.notes}` : "");
}
const describeTemplate = (t) => `${t.id} "${t.name}" ${t.width}x${t.height}@${t.fps}${t.builtin ? " (built-in)" : ` — ${t.clips} clip(s)`}`;
async function projectsTool(args) {
  if (!(await ensureUIServer())) throw new Error(`the editor server is not running and could not be started on port ${PORT}`);
  const action = args.action || "list";
  if (action === "list") {
    const r = await apiJSON("GET", "/api/projects?archived=" + encodeURIComponent(args.archived || "exclude"));
    if (r.status !== 200) throw new Error(r.body?.error || `projects request failed (${r.status})`);
    const { projects, templates } = r.body;
    return [`${projects.length} project(s):`, ...projects.map(describeProject),
      `Templates (action:"new", template): ${templates.map((t) => t.id).join(", ")}`].join("\n");
  }
  const r = await apiJSON("POST", "/api/projects", { ...args, action });
  if (r.status !== 200) throw new Error(r.body?.error || `projects request failed (${r.status})`);
  const out = r.body;
  if (action === "templates") return out.templates.map(describeTemplate).join("\n");
  if (action === "save_template") return `Saved template ${describeTemplate(out.template)}. Start a project from it: {action:"new", template:"${out.template.id}", name}.`;
  if (action === "delete_template") return `Deleted template ${out.template}.`;
  if (action === "delete") return `Deleted project ${out.id} (its media stay in media/).`;
  if (out.already) return `${describeProject(out.project)}\nAlready open.`;
  if (out.from) return `Opened ${describeProject(out.project)}\nThe editor switched to it (${out.from} was saved first). Read it with fablecut_get_project {compact:true} before editing.`;
  return describeProject(out.project);
}
/* fablecut_versions: through the editor server, like fablecut_projects. */
const KIND_LABEL = { manual: "", auto: " (auto)", agent: " (before agent edits)", restore: " (before a restore)" };
function describeVersion(e) {
  const when = e.created ? e.created.slice(0, 16).replace("T", " ") : "?";
  return `v${e.v}${e.final ? " FINAL" : ""} "${e.name}"${KIND_LABEL[e.kind] || ""} — ${when}, ${e.clips} clip(s), ` +
    `${Math.floor(Math.round(e.duration) / 60)}:${String(Math.round(e.duration) % 60).padStart(2, "0")}, revision ${e.revision}` +
    (e.note ? `\n    note: ${e.note.length > 300 ? e.note.slice(0, 300) + "…" : e.note}` : "");
}
async function versionsTool(args) {
  if (!(await ensureUIServer())) throw new Error(`the editor server is not running and could not be started on port ${PORT}`);
  const action = args.action || "list";
  const r = action === "list"
    ? await apiJSON("GET", "/api/versions" + (args.project ? "?project=" + encodeURIComponent(args.project) : ""))
    : await apiJSON("POST", "/api/versions", { ...args, action });
  if (r.status !== 200) throw new Error(r.body?.error || `versions request failed (${r.status})`);
  const out = r.body;
  if (action === "list") return out.versions.length
    ? [`${out.versions.length} version(s) of ${out.project}, newest first:`, ...out.versions.map(describeVersion)].join("\n")
    : `No versions of ${out.project} yet. {action:"save", name, note} keeps one.`;
  if (action === "save") return `Saved ${describeVersion(out.version)}`;
  if (action === "update") return describeVersion(out.version);
  if (action === "delete") return `Deleted v${out.deleted}.`;
  if (action === "restore") return `Restored v${out.restored.v} "${out.restored.name}". What was there is kept as v${out.saved.v} "${out.saved.name}" (restore it to undo). ` +
    (out.open === false
      ? `${out.project} is not the open project, so the editor didn't change; open it (fablecut_projects {action:"open", id:"${out.project}"}) before reading or editing it.`
      : `The editor reloaded; re-read the project (fablecut_get_project {compact:true}) before editing.`);
  if (action === "diff") return out.same
    ? `No difference between ${out.from === "current" ? "now" : "v" + String(out.from).replace(/^v/, "")} and ${out.to === "current" ? "now" : "v" + String(out.to).replace(/^v/, "")}.`
    : [`From v${String(out.from).replace(/^v/, "")} to ${out.to === "current" ? "now" : "v" + String(out.to).replace(/^v/, "")}:`, ...out.lines.map((l) => "- " + l)].join("\n");
  return JSON.stringify(out);
}
/* Before an agent changes the project: a version to go back to. Once per session start
   (or after 10 quiet minutes), and before every whole-document rewrite. */
let lastAgentVersion = 0;
/** "" when the version was kept (or wasn't due), else a warning for the tool's answer:
 *  a version is a safety net, so the edit itself goes ahead either way. */
function versionBeforeAgent(rewrite) {
  if (!rewrite && Date.now() - lastAgentVersion < 10 * 60_000) return "";
  try {
    const pj = createProjects({ dataDir: DATA_DIR, projectFile: PROJECT_FILE, libraryDir: LIBRARY_DIR });
    createHistory({ projects: pj }).beforeAgent(rewrite ? "Before an agent rewrote the project" : "Before agent edits");
    lastAgentVersion = Date.now();
    return "";
  } catch (e) {
    return ` Warning: no version was saved before this edit (${e.message}) — fablecut_versions {action:"save"} keeps one.`;
  }
}
async function proxyTool(args) {
  if (!(await ensureUIServer())) throw new Error(`the editor server is not running and could not be started on port ${PORT}`);
  const proj = readProject();
  const ids = Array.isArray(args.mediaIds) && args.mediaIds.length ? args.mediaIds : proj.media.filter((m) => m.kind === "video").map((m) => m.id);
  const list = ids.map((id) => {
    const m = proj.media.find((x) => x.id === id);
    if (!m) throw new Error(`no media ${id}`);
    if (m.kind !== "video") throw new Error(`${id} is ${m.kind === "audio" || m.kind === "image" ? "an" : "a"} ${m.kind} — only video gets a proxy`);
    return m;
  });
  if (!list.length) return "No video in the project.";
  const srcs = list.map((m) => m.src);
  if (args.delete) {
    const r = await apiJSON("POST", "/api/proxy/delete", { srcs });
    if (r.status !== 200) throw new Error(r.body?.error || "delete failed");
    return list.map((m) => `${m.id} "${m.name}": ${r.body.deleted[m.src] ? "proxy deleted" : "had no proxy"}`).join("\n");
  }
  let r = await apiJSON("POST", args.create ? "/api/proxy" : "/api/proxy/status", { srcs, height: args.height });
  if (r.status !== 200) throw new Error(r.body?.error || `proxy request failed (${r.status})`);
  let status = r.body.status;
  const busy = () => Object.values(status).some((s) => s && (s.state === "queued" || s.state === "running"));
  if (args.create && args.wait !== false) {
    const deadline = Date.now() + 1000 * (Number.isFinite(args.timeout) && args.timeout > 0 ? args.timeout : 900);
    while (busy() && Date.now() < deadline) {
      await sleep(1000);
      r = await apiJSON("POST", "/api/proxy/status", { srcs });
      if (r.status === 200) status = r.body.status;
    }
  }
  const line = (m) => {
    const s = status[m.src];
    if (!s) return `${m.id} "${m.name}": OFFLINE — the file is missing`;
    if (s.state === "ready") return `${m.id} "${m.name}": proxy ready — ${s.width ? s.width + "×" + s.height : s.height + "p"}, ${(s.size / 1048576).toFixed(1)} MB (${s.src})`;
    if (s.state === "running" || s.state === "queued") return `${m.id} "${m.name}": proxy ${s.state}${s.state === "running" ? ` ${Math.round(s.progress * 100)}%` : ""} (${s.height}p)`;
    if (s.state === "failed") return `${m.id} "${m.name}": proxy FAILED — ${s.error}`;
    return `${m.id} "${m.name}": no proxy${m.height ? ` (source ${m.width}×${m.height})` : ""}`;
  };
  return list.map(line).join("\n") + (busy() ? "\nStill working — call fablecut_proxy again (without create) to check." : "");
}
async function exportTool(args) {
  if (!(await ensureUIServer())) throw new Error(`the editor server is not running and could not be started on port ${PORT}`);
  let startNote = "";
  if (args.cancel) {
    const r = await apiJSON("POST", "/api/export/job/cancel?id=" + encodeURIComponent(args.cancel));
    if (r.status !== 200) throw new Error(r.body?.error || "cancel failed");
    return describeExportJob(r.body);
  }
  let job;
  if (args.job) {
    const r = await apiJSON("GET", "/api/export/job?id=" + encodeURIComponent(args.job));
    if (r.status !== 200) throw new Error(r.body?.error || "no such export job");
    job = r.body;
  } else {
    const r = await apiJSON("POST", "/api/export/request", { range: args.range, profile: args.profile, preset: args.preset, delivery: args.delivery, outputs: args.outputs, where: args.where || "auto" });
    if (r.status !== 200) throw new Error(r.body?.error || `export request failed (${r.status})`);
    job = r.body;
    if (job.notes && job.notes.length) startNote = `Settings adjusted: ${job.notes.join("; ")}\n`;
    if (args.wait === false) return (job.delivery ? `Output: ${job.delivery}\n` : "") + startNote + describeExportJob(job);
  }
  const deadline = Date.now() + 1000 * (Number.isFinite(args.timeout) && args.timeout > 0 ? args.timeout : 900);
  while (job.status === "pending" || job.status === "running") {
    if (args.job && args.wait !== true) break; // a status check answers right away
    if (Date.now() > deadline) break;
    await sleep(1000);
    const r = await apiJSON("GET", "/api/export/job?id=" + encodeURIComponent(job.id));
    if (r.status !== 200) throw new Error(r.body?.error || "lost track of the export job");
    job = r.body;
  }
  return startNote + describeExportJob(job);
}

/* ── Frames (fablecut_frame) ──
   The tool is the only one that answers with an image, so it returns content
   blocks rather than a string. Text comes FIRST: it carries the coordinates of
   what is in the picture (src, timestamp, dimensions), which is the part an
   agent would otherwise have to guess at, and it keeps the existing
   content[0].text reading in the test harness valid. */

/** {mimeType, data:Buffer} → an MCP image content block. */
function imageBlock(mimeType, buf) {
  return { type: "image", data: buf.toString("base64"), mimeType };
}
/** A data: URL from the compositor → an image content block, or null. */
function imageBlockFromDataUrl(url) {
  const m = /^data:(image\/\w+);base64,(.+)$/.exec(String(url || ""));
  return m ? { type: "image", data: m[2], mimeType: m[1] } : null;
}

/** Raw GET to the editor server → {status, headers, buffer}.
 *  Sends the MCP client header: /api/frame?path= only answers requests that
 *  carry it, so a web page in the user's browser can neither render frames of
 *  arbitrary files nor probe which ones exist. */
function apiBytes(urlPath) {
  if (transport) return transport.bytes(urlPath);
  return new Promise((resolve, reject) => {
    const req = http.request(API + urlPath, { method: "GET", headers: { "X-FableCut-Client": "mcp" } }, (r) => {
      const chunks = [];
      r.on("data", (c) => chunks.push(c));
      r.on("end", () => resolve({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.setTimeout(60_000, () => req.destroy(new Error("the editor server did not answer")));
    req.end();
  });
}

async function frameTool(args) {
  /* Timeline mode: no path. The compositor lives in the browser, so this rides
     the same job queue the scopes reading uses, with image:true. Text mode
     needs no image at all here — the scopes reading already measures the frame,
     and those numbers describe the composed picture. */
  if (!args.path) {
    if (!(await ensureUIServer())) throw new Error(`the editor server is not running and could not be started on port ${PORT}`);
    const body = { where: args.where || "auto", image: true };
    if (args.time != null) body.time = args.time;
    const r = await apiJSON("POST", "/api/scopes/request", body);
    if (r.status !== 200) throw new Error(r.body?.error || `frame request failed (${r.status})`);
    let job = r.body;
    const deadline = Date.now() + 1000 * (Number.isFinite(args.timeout) && args.timeout > 0 ? args.timeout : 60);
    while (job.status === "pending" || job.status === "running") {
      if (Date.now() > deadline) {
        await apiJSON("POST", "/api/export/job/cancel?id=" + encodeURIComponent(job.id));
        throw new Error("timed out waiting for the editor to render the frame");
      }
      await sleep(300);
      const q = await apiJSON("GET", "/api/export/job?id=" + encodeURIComponent(job.id));
      if (q.status !== 200) throw new Error(q.body?.error || "lost track of the frame render");
      job = q.body;
    }
    if (job.status !== "done") throw new Error(`frame render ${job.status}: ${job.error || "no reason given"}`);
    const res = job.result || {};
    const onScreen = (res.clips || []).map((c) => `${c.id} ${c.track} ${c.kind}`).join(", ") || "nothing";
    const head = `Timeline at ${res.time}s (${res.frame?.w}x${res.frame?.h}) — on screen: ${onScreen}`;

    /* Text mode: the scopes reading measured this exact frame already, and its
       numbers are the same family as the source-frame measurements — so a
       text-only agent gets the composed picture described, not nothing. */
    if (args.text) {
      const st = res.stats, st_ = st ? describeScopeLines(st) : null;
      return [{ type: "text", text: head + "\n" + (st_ || "The editor returned no measurements for this frame.") + "\n\n" + TEXT_ONLY_NOTE }];
    }
    const img = imageBlockFromDataUrl(res.image);
    if (!img) throw new Error("the editor rendered the frame but could not encode it as an image (a cross-origin source taints the canvas)");
    return [{ type: "text", text: head }, img];
  }

  /* Source mode: ffmpeg on the server. Looking must not have side effects, so
     the file is read where it is — an absolute path is passed through as
     `path`, and a /media/… or /library/… src is passed through as `src`. The
     server never copies anything into media/ on our behalf. */
  if (!(await ensureUIServer())) throw new Error(`the editor server is not running and could not be started on port ${PORT}`);
  const raw = String(args.path);
  const served = /^\/(media|library)\//i.test(raw);
  // A served src is resolved by the server against its own data dir, which may
  // be somewhere this process cannot see (FABLECUT_DATA_DIR) — so let it decide
  // and report the 404. A filesystem path we can check ourselves is checked.
  if (!served && (!fs.existsSync(raw) || !fs.statSync(raw).isFile()))
    throw new Error("File not found: " + raw);

  const q = new URLSearchParams(served ? { src: raw } : { path: path.resolve(raw) });
  if (args.frames != null) {
    q.set("frames", String(Math.round(Number(args.frames))));
    // No cols → the server picks the squarest layout (6 frames give 3×2).
    if (args.cols != null) q.set("cols", String(Math.round(Number(args.cols))));
    if (args.from != null) q.set("from", String(args.from));
    if (args.to != null) q.set("to", String(args.to));
    q.set("w", String(args.width || 320));
  } else {
    q.set("t", String(Number.isFinite(args.t) ? args.t : 0));
    q.set("w", String(args.width || 768));
  }
  if (args.quality != null) q.set("q", String(args.quality));

  /* text mode asks the server for measurements instead of the picture, in the
     one request — not the picture and then a second call for the numbers. */
  if (args.text) {
    q.set("text", "1");
    const j = await apiJSON("GET", "/api/frame?" + q.toString(), undefined, { "X-FableCut-Client": "mcp" });
    if (j.status !== 200) throw new Error(j.body?.error || `frame description failed (${j.status})`);
    const st = j.body.stats, b = j.body;
    const where = b.frames > 1
      ? `${b.frames} moments across ${b.source || raw}, left→right then top→bottom, at ${(b.times || []).join("s, ")}s.`
      : `Frame at ${(b.times || [])[0] ?? 0}s of ${b.source || raw}.`;
    const body = !st
      ? "The server returned no measurements for this frame (does it have a video track?)."
      : b.frames > 1 ? FrameStats.gridLines(st).join("\n") : FrameStats.frameLines("Frame", st).join("\n");
    return [{ type: "text", text: where + "\n" + body + "\n\n" + TEXT_ONLY_NOTE }];
  }

  const res = await apiBytes("/api/frame?" + q.toString());
  if (res.status !== 200) {
    let msg = `frame request failed (${res.status})`;
    try { msg = JSON.parse(res.body.toString("utf8")).error || msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  const times = (res.headers["x-fablecut-frame-times"] || "").split(",").filter(Boolean);
  const type = res.headers["content-type"] || "image/jpeg";
  const source = decodeURI(res.headers["x-fablecut-frame-source"] || "") || raw;
  const head = args.frames != null
    ? `Contact sheet — ${times.length} moments across ${source}, left→right then top→bottom, at ${times.join("s, ")}s.`
    : `Frame at ${times[0] ?? 0}s of ${source}.`;

  if (res.body.length < 4 || res.body[0] !== 0xff || res.body[1] !== 0xd8)
    throw new Error("the server did not return a JPEG");
  return [{ type: "text", text: head }, imageBlock(type, res.body)];
}

/* Appended to every text: true answer, because a measurement is not a caption:
   it says what the picture is made of, never what is in it. */
const { TEXT_ONLY_NOTE, describeScopeLines, describeScopes } = ProjectOps;

async function scopesTool(args) {
  if (!(await ensureUIServer())) throw new Error(`the editor server is not running and could not be started on port ${PORT}`);
  const body = { where: args.where || "auto" };
  if (args.time != null) body.time = args.time;
  if (args.matte != null) body.matte = args.matte;
  if (args.mask != null) body.mask = args.mask;
  const r = await apiJSON("POST", "/api/scopes/request", body);
  if (r.status !== 200) throw new Error(r.body?.error || `scope request failed (${r.status})`);
  let job = r.body;
  const deadline = Date.now() + 1000 * (Number.isFinite(args.timeout) && args.timeout > 0 ? args.timeout : 60);
  while (job.status === "pending" || job.status === "running") {
    if (Date.now() > deadline) {
      await apiJSON("POST", "/api/export/job/cancel?id=" + encodeURIComponent(job.id));
      throw new Error("timed out waiting for the editor to measure the frame");
    }
    await sleep(300);
    const q = await apiJSON("GET", "/api/export/job?id=" + encodeURIComponent(job.id));
    if (q.status !== 200) throw new Error(q.body?.error || "lost track of the scope reading");
    job = q.body;
  }
  if (job.status !== "done") throw new Error(`scope reading ${job.status}: ${job.error || "no reason given"}`);
  return describeScopes(job);
}

/* ── Tracking (fablecut_track): runs in the editor, which saves the result ── */
async function trackTool(args) {
  if (typeof args.clip !== "string") throw new Error("fablecut_track needs clip");
  const proj = readProject(), c = proj.clips.find((x) => x.id === args.clip);
  if (!c) throw new Error("no clip " + args.clip);
  if (c.kind !== "video") throw new Error(`${c.id} is a ${c.kind} clip — tracking follows a video clip's picture`);
  for (const k of ["region", "point"]) if (args[k] != null && (typeof args[k] !== "object" || !(k === "region" ? ["x", "y", "w", "h"] : ["x", "y"]).every((q) => Number.isFinite(args[k][q])))) throw new Error(`${k} needs numbers x, y${k === "region" ? ", w, h" : ""} (fractions of the picture)`);
  if (args.apply != null && (typeof args.apply !== "object" || (args.apply.mask == null && args.apply.clip == null))) throw new Error("apply must be {mask: index | name} or {clip: id}");
  if (!(await ensureUIServer())) throw new Error(`the editor server is not running and could not be started on port ${PORT}`);
  const track = {};
  for (const k of ["clip", "region", "point", "size", "at", "direction", "to", "scale", "rotation", "name", "apply", "force"]) if (args[k] != null) track[k] = args[k];
  const r = await apiJSON("POST", "/api/track/request", { where: args.where || "auto", track });
  if (r.status !== 200) throw new Error(r.body?.error || `track request failed (${r.status})`);
  let job = r.body;
  const deadline = Date.now() + 1000 * (Number.isFinite(args.timeout) && args.timeout > 0 ? args.timeout : 300);
  while (job.status === "pending" || job.status === "running") {
    if (Date.now() > deadline) {
      await apiJSON("POST", "/api/export/job/cancel?id=" + encodeURIComponent(job.id));
      throw new Error("timed out waiting for the editor to track — try a shorter range (to), or a larger timeout");
    }
    await sleep(500);
    const q = await apiJSON("GET", "/api/export/job?id=" + encodeURIComponent(job.id));
    if (q.status !== 200) throw new Error(q.body?.error || "lost track of the tracking job");
    job = q.body;
  }
  if (job.status !== "done") throw new Error(`tracking ${job.status}: ${job.error || "no reason given"}`);
  return ProjectOps.describeTrack(job.result || {});
}

/* ── Importing a project folder ──
   A project document is not portable on its own: its media entries point at
   /media/… paths that belong to the data folder it was made in. Importing a
   document without its files would open a project whose footage is all
   offline. So an import travels with the folder: the files are COPIED into
   this installation's library, the entries point at the copies, and the
   originals are never touched. */
/* The real path of a file, with every symbolic link and junction resolved.
   Null when the path is not there. */
function realPath(file) {
  try { return fs.realpathSync.native(file); } catch { return null; }
}
/* A path as it is compared here: no UNC prefix, and on Windows the case of
   a letter does not matter. */
function pathKey(p) {
  const s = String(p || "");
  const plain = s.startsWith("\\\\?\\") ? s.slice(4) : s;
  return process.platform === "win32" ? plain.toLowerCase() : plain;
}
/* Is a path inside a folder? */
function within(child, parent) {
  const c = pathKey(child), p = pathKey(parent);
  if (!c || !p) return false;
  if (c === p) return true;
  return c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}
/* The id of a project in a folder: a plain name, never a path. */
function plainProjectId(wanted) {
  const id = String(wanted ?? "").trim();
  if (!id || id.length > 64 || !/^[A-Za-z0-9._-]+$/.test(id) || id.includes(".."))
    throw new Error(`project ${JSON.stringify(wanted)} is not a plain project id — the projects of that folder are named like "p_1a2b3c"`);
  return id;
}
/* The path a /media/ or /library/ entry names, decoded and checked: a plain
   relative path inside that folder, never a way out of it. */
function entryRel(src, prefix) {
  let rel;
  try { rel = decodeURIComponent(String(src).slice(prefix.length)); }
  catch { throw new Error(`media path ${JSON.stringify(src)} is not a readable URL path`); }
  if (!rel) throw new Error(`media path ${JSON.stringify(src)} names no file`);
  if (path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel))
    throw new Error(`media path ${JSON.stringify(src)} must be inside ${prefix}`);
  const norm = path.normalize(rel);
  if (norm === ".." || norm.startsWith(".." + path.sep))
    throw new Error(`media path ${JSON.stringify(src)} points outside ${prefix}`);
  /* The path as the document writes it — the tools show it that way — while
     the file itself is looked up through the normalized path. */
  return rel;
}
/* A file of a folder, with links resolved: a link that points out of the
   folder is not inside it, and is refused. */
function folderFile(folder, file, label) {
  const realRoot = realPath(folder);
  if (!realRoot) return null;          // the folder itself is not there
  const real = realPath(file);
  if (!real) return null;              // the file is not there
  if (!within(real, realRoot)) throw new Error(`${label} points outside ${folder} — refusing to read it`);
  return real;
}
/* The document of one project in the folder. */
function projectDocFile(root, id) {
  return folderFile(root, path.join(root, "projects", id, "project.json"), `project ${JSON.stringify(id)}`);
}
/* The document to import: a file inside the folder the user pointed at. */
function sourceProjectFile(root, wanted) {
  if (wanted) {
    const id = plainProjectId(wanted);
    const file = projectDocFile(root, id);
    if (!file) throw new Error(`no project ${JSON.stringify(id)} in ${path.join(root, "projects")}`);
    return file;
  }
  const open = path.join(root, "project.json");
  if (fs.existsSync(open)) {
    const file = folderFile(root, open, "project.json");
    if (file) return file;
  }
  const index = path.join(root, "projects", "index.json");
  let active = null;
  try { active = String(JSON.parse(fs.readFileSync(index, "utf8")).active || ""); } catch { }
  if (active && /^[A-Za-z0-9._-]+$/.test(active) && !active.includes("..")) {
    const file = projectDocFile(root, active);
    if (file) return file;
  }
  let ids = [];
  try {
    ids = fs.readdirSync(path.join(root, "projects"))
      .filter((d) => /^[A-Za-z0-9._-]+$/.test(d) && !d.includes("..") && fs.existsSync(path.join(root, "projects", d, "project.json")));
  } catch { }
  if (ids.length === 1) {
    const file = projectDocFile(root, ids[0]);
    if (file) return file;
  }
  throw new Error(`no project to import in ${root} — pass {project: "<id>"} (the folder holds ${ids.length || "no"} projects)`);
}
/* A file name for a copy: plain, without a path, without leading dots. */
function safeBaseName(name) {
  let out = path.basename(String(name || "")).replace(/[^\w.\- ()[\]]+/g, "_").trim();
  while (out.startsWith(".")) out = out.slice(1);
  if (!out) out = "media";
  return out.slice(0, 120);
}
/* Copy a file into this installation's media folder under a free name. The
   copy is exclusive, so it can never overwrite anything — not even when two
   imports pick the same name at the same time.
   Only a media file is copied: media/ holds media (video, audio, image, SVG)
   and nothing else. It is served from the editor's own origin, so a file a
   browser would run there must never land in it — and a font has no business
   being media either. */
function copyToMedia(from, base) {
  if (!isMediaName(from))
    throw new Error(refuseMessage(path.basename(from), "the file"));
  const name = safeBaseName(base);
  const ext = path.extname(name);
  const stem = path.basename(name, ext) || "media";
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  let target = path.join(MEDIA_DIR, name);
  let i = 1;
  for (;;) {
    if (path.dirname(path.resolve(target)) !== path.resolve(MEDIA_DIR))
      throw new Error(`the copy of ${base} would land outside ${MEDIA_DIR}`);
    try {
      fs.copyFileSync(from, target, fs.constants.COPYFILE_EXCL);
      return target;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      target = path.join(MEDIA_DIR, `${stem}_${i++}${ext}`);
    }
  }
}
/* Copy a file into this installation's library under a free name. The copy is
   exclusive, so it can never overwrite the file that is already there. Returns
   the path relative to the library folder, with forward slashes. */
function copyToLibrary(from, rel) {
  const ext = path.extname(rel);
  const stem = path.basename(rel, ext) || "asset";
  const dir = path.dirname(rel);
  fs.mkdirSync(path.join(LIBRARY_DIR, dir), { recursive: true });
  let i = 0;
  for (;;) {
    const name = i === 0 ? path.basename(rel) : `${stem}_${i}${ext}`;
    i++;
    const target = path.join(LIBRARY_DIR, dir, name);
    if (!within(path.resolve(target), path.resolve(LIBRARY_DIR)))
      throw new Error(`library asset ${rel} would land outside ${LIBRARY_DIR}`);
    try {
      fs.copyFileSync(from, target, fs.constants.COPYFILE_EXCL);
      return path.relative(LIBRARY_DIR, target).split(path.sep).join("/");
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  }
}
/* Two files with the same content? The library is shared by name, so a file
   with the same name but different content is a different asset. */
function sameContent(a, b) {
  try {
    const sa = fs.statSync(a), sb = fs.statSync(b);
    if (sa.size !== sb.size) return false;
    if (sa.size > 16 * 1024 * 1024) return false;      // too big to compare: assume different
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch { return false; }
}
/* What the import has to do, worked out before anything is written: the
   files it copies, the library assets it brings over, the entries it leaves
   alone. A file that is missing, or that points out of the source folder,
   stops the import here — with nothing changed. */
function importPlan(doc, root) {
  const media = [], library = [], kept = [], problems = [];
  const mediaRoot = path.join(root, "media");
  const libraryRoot = path.join(root, "library");
  for (const m of doc.media) {
    const src = String(m.src || "");
    if (!src) { kept.push(m); continue; }
    try {
      if (src.startsWith("/media/")) {
        const rel = entryRel(src, "/media/");
        const from = folderFile(mediaRoot, path.join(mediaRoot, rel), `media ${JSON.stringify(rel)}`);
        if (!from) { problems.push(`media file ${JSON.stringify(rel)} is not in the source folder's media/`); continue; }
        if (!fs.statSync(from).isFile()) { problems.push(`media ${JSON.stringify(rel)} is not a file`); continue; }
        /* Only media travels into media/: an HTML page or a script in the
           source folder would be copied into a folder the page can read and
           the browser would run it there, and a font is not media either.
           The import stops before a single file is copied. */
        if (!isMediaName(from)) { problems.push(refuseMessage(rel, "media file")); continue; }
        media.push({ entry: m, from, rel, base: path.basename(rel) });
      } else if (src.startsWith("/library/")) {
        const rel = entryRel(src, "/library/");
        const from = folderFile(libraryRoot, path.join(libraryRoot, rel), `library asset ${JSON.stringify(rel)}`);
        const ours = folderFile(LIBRARY_DIR, path.join(LIBRARY_DIR, rel), `library asset ${JSON.stringify(rel)}`);
        if (!from && !ours) { problems.push(`library asset ${JSON.stringify(rel)} is in neither the source folder nor this installation`); continue; }
        /* A library asset is media or a font — nothing that a browser would
           execute. The file that is kept is this installation's own copy, so
           that one is checked too. */
        if ((from && !isManagedName(from)) || (ours && !isManagedName(ours))) {
          problems.push(refuseLibraryMessage(rel));
          continue;
        }
        library.push({ entry: m, rel, from, ours });
      } else {
        /* Not a path of this installation's library: it cannot point at
           anything here, but it must not try to climb out either. */
        if (src.includes("..")) { problems.push(`media path ${JSON.stringify(src)} points outside the library`); continue; }
        kept.push(m);
      }
    } catch (e) {
      problems.push(e.message);
    }
  }
  if (problems.length) {
    const shown = problems.slice(0, 6).join("; ");
    throw new Error(`the project was not imported (nothing was changed): ${shown}${problems.length > 6 ? `; … and ${problems.length - 6} more` : ""}`);
  }
  return { media, library, kept };
}
/* What the open project looks like, so the import can tell whether it moved
   on while the files were being copied. */
function projectSnapshot() {
  try {
    const doc = readProject();
    return { revision: doc.revision || 0, identity: JSON.stringify(doc), doc };
  } catch { return null; }
}
function sameProject(a, b) {
  if (!a || !b) return a === b;
  return a.revision === b.revision && a.identity === b.identity;
}
/* The copies of a call that did not go through: only files this call created
   are removed, and only while they are still the ones it wrote. */
function undoCopies(files) {
  for (const f of files) {
    try {
      const st = fs.statSync(f.file);
      if (st.size === f.size && st.mtimeMs === f.mtimeMs) fs.unlinkSync(f.file);
    } catch { }
  }
}
async function importProjectTool(args) {
  const raw = String(args.folder || "").trim();
  if (!raw) throw new Error("`folder` is required: the Cutline data folder to import from");
  const root = path.resolve(raw);
  if (!fs.existsSync(root)) throw new Error("Folder not found: " + root);
  /* What the open project looks like now: the import replaces it, so it has
     to be looked at again after the copying — if it moved on, the import is
     refused instead of overwriting the newer work. */
  const before = projectSnapshot();
  const file = sourceProjectFile(root, args.project ? String(args.project) : null);
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, "utf8").replace(new RegExp("^\\uFEFF"), "")); }
  catch (e) { throw new Error(`${file} can't be read (${e.message})`); }
  if (!doc || !Array.isArray(doc.clips) || !Array.isArray(doc.media))
    throw new Error(`${file} is not a Cutline project document`);
  /* Everything the import needs is worked out first: a missing file or one
     that points out of the source folder stops it here, before a single file
     is copied. */
  const plan = importPlan(doc, root);
  /** The files this call copied — taken away again when the import does not
      go through, so a refused import leaves nothing behind. */
  /** @type {{file: string, size: number, mtimeMs: number}[]} */
  const copied = [];
  const note = (file) => {
    try { const st = fs.statSync(file); copied.push({ file, size: st.size, mtimeMs: st.mtimeMs }); } catch { }
  };
  let saved = false;
  try {
    /* The media files travel with the project: they are copied into this
       installation's media folder under a free name, and the entries point at
       the copies. A file in a subfolder of the source media folder is fine —
       the copy lands directly in media/. */
    const copies = new Map();
    for (const item of plan.media) {
      let target = copies.get(item.from);
      if (!target) {
        target = copyToMedia(item.from, item.base);
        copies.set(item.from, target);
        note(target);
      }
      item.target = target;
      item.entry.src = "/media/" + encodeURIComponent(path.basename(target));
    }
    /* A /library/ entry names an asset of the library folder, which every
       installation has its own copy of: the reference is kept when this
       installation has the same asset, the source folder's copy is brought
       over when it has none, and a different file under that name is never
       used. */
    const libraryNotes = [];
    for (const item of plan.library) {
      if (!item.from) { libraryNotes.push(`${item.rel} (only this installation has it)`); continue; }
      if (item.ours && sameContent(item.from, item.ours)) { libraryNotes.push(`${item.rel} (this installation has the same asset)`); continue; }
      if (!item.ours) {
        const target = path.join(LIBRARY_DIR, item.rel);
        if (!within(path.resolve(target), path.resolve(LIBRARY_DIR)))
          throw new Error(`library asset ${item.rel} would land outside ${LIBRARY_DIR}`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        try {
          fs.copyFileSync(item.from, target, fs.constants.COPYFILE_EXCL);
          note(target);
          libraryNotes.push(`${item.rel} (copied into this installation's library)`);
        } catch (e) {
          if (e.code !== "EEXIST") throw e;
          libraryNotes.push(`${item.rel} (already in this installation's library)`);
        }
        continue;
      }
      /* This installation has a different file under that name: the source
         folder's copy is brought over. A media file goes into media/; a font
         (a library asset that is not media) stays in the library under a free
         name — media/ holds media only. */
      if (isMediaName(item.from)) {
        const target = copyToMedia(item.from, path.basename(item.rel));
        note(target);
        item.entry.src = "/media/" + encodeURIComponent(path.basename(target));
        libraryNotes.push(`${item.rel} (a different file had that name here — the source folder's copy is in media/)`);
      } else {
        const rel = copyToLibrary(item.from, item.rel);
        note(path.join(LIBRARY_DIR, ...rel.split("/")));
        item.entry.src = "/library/" + rel.split("/").map(encodeURIComponent).join("/");
        libraryNotes.push(`${item.rel} (a different file had that name here — the source folder's copy is in the library)`);
      }
    }
    /* The copies are probed like any imported file. */
    for (const item of plan.media) {
      const m = item.entry;
      const info = await probeFile(item.target);
      if (!info) continue;
      if (info.duration > 0 && m.kind !== "image" && m.kind !== "svg") m.duration = info.duration;
      if (info.width > 0) { m.width = info.width; m.height = info.height; }
      const extra = infoForEntry(info, m);
      for (const k of Object.keys(extra)) m[k] = extra[k];
    }
    ProjectOps.checkProject(doc);
    /* Somebody saved while the files were being copied: the import would
       drop their work, so it is refused. */
    const after = projectSnapshot();
    if (!sameProject(before, after))
      throw new Error(`the project changed while the import was running (revision ${before?.revision ?? 0} → ${after?.revision ?? 0}) — nothing was imported; read the project again and retry`);
    /* The project that is open now is kept as a version before it is
       replaced: an import is a rewrite, and the old project has to be
       recoverable. */
    const verWarn = versionBeforeAgent(true);
    const cur = (before && before.doc) || {};
    /* The imported document is written at the actual current revision, so the
       editor and the tools agree on what is open. */
    doc.revision = (cur.revision || 0) + 1;
    if (!(doc.panSchema >= 1) && (cur.panSchema >= 1)) doc.panSchema = 1;
    writeProject(doc);
    saved = true;
    const mediaList = plan.media.map((item) => `${item.rel} → ${path.basename(item.target)}`);
    return [
      `Imported "${doc.name || "Untitled Project"}" from ${file} — saved as the open project (revision ${doc.revision}).`,
      `Media copied into this library: ${mediaList.length ? mediaList.join(", ") : "none"}.`,
      libraryNotes.length ? `Library assets: ${libraryNotes.join(", ")}.` : "",
      plan.kept.length ? `${plan.kept.length} media entry/entries name no file of this installation and were left as they are.` : "",
      `The originals in ${root} were not touched.${verWarn}`,
    ].filter(Boolean).join("\n");
  } catch (e) {
    if (!saved) undoCopies(copied);
    throw e;
  }
}

/* ── Tool implementations ── */
async function callTool(name, args, attempt = 0) {
  switch (name) {
    case "fablecut_import_project":
      return importProjectTool(args);
    case "fablecut_track":
      return trackTool(args);
    case "fablecut_export":
      return exportTool(args);
    case "fablecut_scopes":
      return scopesTool(args);
    case "fablecut_frame":
      return frameTool(args);
    case "fablecut_silence":
      return silenceTool(args);
    case "fablecut_denoise":
      return denoiseTool(args);
    case "fablecut_proxy":
      return proxyTool(args);
    case "fablecut_projects":
      return projectsTool(args);
    case "fablecut_versions":
      return versionsTool(args);
    case "fablecut_status": {
      const up = await ensureUIServer();
      const proj = readProject();
      const dur = proj.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
      const files = fs.existsSync(MEDIA_DIR)
        ? fs.readdirSync(MEDIA_DIR).filter((f) => fs.statSync(path.join(MEDIA_DIR, f)).isFile())
        : [];
      const libSummary = ["sfx", "elements", "svg", "fonts"].map((d) => {
        const dir = path.join(LIBRARY_DIR, d);
        const n = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
        return `${d}: ${n}`;
      }).join(", ");
      const cap = (arr, n) => arr.length > n ? arr.slice(0, n).concat(`… +${arr.length - n} more`) : arr;
      let encLine = "";
      try {
        const cfg = loadEncodeProfiles();
        const describe = (id) => {
          const p = cfg.profiles[id];
          return p ? `${id} (${p.label}) — ${profileSummary(p)}` : null;
        };
        const pinned = proj.encodeProfile;
        if (pinned && !cfg.profiles[pinned]) {
          /* a project pinning a since-deleted profile must not read as "nothing
             configured" — the bad id and the fallback are two separate facts */
          encLine = `Export profile: project encodeProfile "${pinned}" is NOT DEFINED in encoding-profiles.json` +
            ` — falling back to default ${describe(cfg.default) || `"${cfg.default}"`}`;
        } else {
          encLine = `Export profile: ${describe(pinned || cfg.default) || `server default "${cfg.default}"`}`;
        }
      } catch { encLine = "Export profile: (encoding-profiles.json unavailable)"; }
      if (proj.delivery) {
        try {
          const { spec } = Delivery.normalize(proj.delivery, { presets: savedDeliveryPresets() });
          encLine = `Export: project.delivery — ${spec.preset} · ${Delivery.describe(spec)} (fablecut_export uses it unless you pass profile or preset)`;
        } catch { }
      }
      if (Array.isArray(proj.outputs) && proj.outputs.length) {
        const on = proj.outputs.filter((o) => o.on !== false);
        encLine += `\nBatch outputs (fablecut_export {outputs:true}): ${on.length} of ${proj.outputs.length} checked — ` +
          on.map((o) => Delivery.projectFilename(o, proj)).join(", ");
      }
      return [
        `Editor server: ${up ? `RUNNING — ${EDITOR_OPEN}` : "FAILED TO START (check node / port " + PORT + ")"}`,
        `Project: "${proj.name}" — ${proj.width}x${proj.height} @ ${proj.fps}fps, ${proj.clips.length} clip(s), ${dur.toFixed(2)}s, revision ${proj.revision}`,
        ...(SeqLib.entries(proj).length > 1 ? [`Sequences (${SeqLib.entries(proj).length}; the numbers above are the open one's): ${SeqLib.list(proj).map(SeqLib.describe).join(" · ")}`] : []),
        encLine,
        `Registered media: ${cap(proj.media.map((m) => `${m.id} (${m.kind}, ${m.name}${m.duration ? ", " + m.duration + "s" : ""})`), 25).join("; ") || "none"}`,
        ...(() => {
          const off = proj.media.filter((m) => /^\/(media|library)\//.test(m.src || "") && !mediaFile(m.src));
          return off.length ? [`OFFLINE media (file missing — find it and relinkMedia): ${cap(off.map((m) => `${m.id} ${m.src}`), 25).join("; ")}`] : [];
        })(),
        `Files in media/: ${cap(files, 25).join(", ") || "none"}`,
        `Library assets (./library): ${libSummary}`,
        ...(() => {
          try {
            const pj = createProjects({ dataDir: DATA_DIR, projectFile: PROJECT_FILE, libraryDir: LIBRARY_DIR });
            if (!pj.peekActive()) return [];
            const { projects: all } = pj.list();
            const nv = createHistory({ projects: pj }).list(pj.peekActive()).versions.length;
            return [`Projects: ${all.length} (fablecut_projects lists, opens and creates them; this one is ${pj.peekActive()}, with ${nv} saved version(s): fablecut_versions)`];
          } catch { return []; }
        })(),
        `Project file: ${PROJECT_FILE}`,
        `Tips: fablecut_docs (use \`section\`) for the schema · fablecut_get_project {compact:true} to see the timeline · fablecut_patch_project for edits (cheapest) · fablecut_encode_profiles for export presets.`,
      ].join("\n");
    }
    case "fablecut_docs": {
      const md = fs.readFileSync(path.join(ROOT, "CLAUDE.md"), "utf8");
      if (!args.section) return md;
      const q = args.section.toLowerCase();
      const parts = md.split(/^(?=## )/m);
      const hits = parts.filter((s) => s.startsWith("## ") && s.slice(0, s.indexOf("\n")).toLowerCase().includes(q));
      return hits.length ? hits.join("\n") :
        `No '## ' section matches "${args.section}". Headings: ` +
        parts.filter((s) => s.startsWith("## ")).map((s) => s.slice(3, s.indexOf("\n"))).join(" · ");
    }
    case "fablecut_get_project": {
      const doc = readProject();
      if (!args.compact) return JSON.stringify(doc);
      return ProjectOps.compactView(doc, {
        offline: (m) => /^\/(media|library)\//.test(m.src || "") && !mediaFile(m.src),
        proxy: (m) => { const f = mediaFile(m.src); const p = f && findProxies(PROXIES_DIR, f)[0]; return p ? p.height : null; },
      });
    }
    case "fablecut_patch_project": {
      if (!Array.isArray(args.ops) || !args.ops.length) throw new Error("`ops` must be a non-empty array");
      const base = args.baseRevision;
      if (base != null && !Number.isInteger(base))
        throw new Error("`baseRevision` must be an integer revision (from fablecut_get_project, fablecut_status or the last patch result)");
      // ops get filled in as they apply (auto ids …); a retry must start from the originals
      const ops = structuredClone(args.ops);
      const proj = readProject();
      const readRev = proj.revision || 0;
      const conflict = (rev) => new Error(
        `CONFLICT — not saved. project.json is at revision ${rev}, but this patch was based on ` +
        `revision ${base ?? readRev}: the project changed in between (the user probably edited in the UI). ` +
        `Re-read the clips you touch (fablecut_get_project {compact:true}), then retry with baseRevision:${rev} — ` +
        `or omit baseRevision to apply on top of the latest anyway.`);
      if (base != null && readRev !== base) throw conflict(readRev);
      /* The ops are applied synchronously, but the file details they read come
         from ffprobe, which is asynchronous. A Promise here would look like a
         file with no details: a replaced media entry would keep no duration
         and no width, and its clips would never be trimmed to fit. So the
         files the ops name are probed first, and the op reads a plain value. */
      /** @type {Map<string, any>} */
      const probed = new Map();
      for (const op of ops) {
        if (op.op !== "relinkMedia" && op.op !== "replaceMedia") continue;
        const src = String(op.src || "");
        if (!src || probed.has(src)) continue;
        const f = mediaFile(src);
        probed.set(src, f ? await probeFile(f) : null);
      }
      const { notes, toSave } = ProjectOps.applyPatch(proj, ops, {
        savedItems,
        audioChannels: (m) => { const f = mediaFile(m.src); return f ? probeChannels(f) || 0 : null; },
        checkProfile: resolveProfile,
        deliveryPresets: savedDeliveryPresets(),
        mediaInfo: (src) => (probed.has(src) ? probed.get(src) : null),
      });
      // a version of the project as it was, kept before the last check so the write follows that check at once
      const verWarn = versionBeforeAgent(false);
      // Someone else saved while the ops ran: writing now would drop their change.
      // Without a baseRevision the ops just re-apply on the newer document.
      let diskRev = readRev;
      try { diskRev = readProject().revision || 0; } catch {}
      if (diskRev !== readRev) {
        if (base == null && attempt < 3) return callTool(name, args, attempt + 1);
        throw conflict(diskRev);
      }
      proj.revision = readRev + 1;
      writeProject(proj);
      for (const [kind, item] of toSave) writeSaved(kind, item.id, item);
      return `Patched (revision ${proj.revision}): ${notes.join(" ")}. Now ${proj.clips.length} clip(s), ${proj.media.length} media. UI hot-reloaded.${verWarn}`;
    }
    case "fablecut_set_project": {
      const doc = args.project;
      if (!doc || typeof doc !== "object") throw new Error("`project` must be an object");
      if (!Array.isArray(doc.clips) || !Array.isArray(doc.media))
        throw new Error("project must contain `clips` and `media` arrays");
      /* The base revision is the caller's own claim: the revision the
         document was read at. It is never taken from the submitted document —
         a caller could put any number in there — and it is not a
         process-global either: with several MCP sessions in one process
         another session's read would answer for this write, and a stale
         document would slip through. */
      const base = args.baseRevision;
      if (base == null)
        throw new Error("`baseRevision` is required: the integer revision the document was based on " +
          "(from fablecut_get_project, fablecut_status or the last patch result)");
      if (!Number.isInteger(base))
        throw new Error(`\`baseRevision\` must be an integer revision, not ${JSON.stringify(base)} ` +
          "(from fablecut_get_project, fablecut_status or the last patch result)");
      ProjectOps.checkProject(doc);
      const verWarn = versionBeforeAgent(true);   // before the conflict check, so the write follows it at once
      let cur = { revision: 0 };
      try { cur = readProject(); } catch {}
      const curRev = cur.revision || 0;
      if (base !== curRev && !args.force) {
        throw new Error(
          `CONFLICT — not saved. project.json is at revision ${curRev}, but this edit was based on ` +
          `revision ${base}: the project changed in between ` +
          `(the user probably tweaked something in the editor UI). ` +
          `Call fablecut_get_project, re-apply your edit on top of the latest document, then save again ` +
          `with baseRevision:${curRev}. ` +
          `Pass force:true only if the user explicitly wants those changes discarded.`);
      }
      // the revision is the server's to give: the document is stored one step
      // above what is on disk, never at a number the caller chose
      doc.revision = curRev + 1;
      // Agents often omit top-level flags they don't know about. Keep panSchema
      // once established so a rewrite that drops pan:0 cannot re-trigger L/R migration.
      if (!(doc.panSchema >= 1) && (cur.panSchema >= 1)) doc.panSchema = 1;
      writeProject(doc);
      return `Saved (revision ${doc.revision}). ${doc.clips.length} clip(s). ${EDITOR_WHERE} has hot-reloaded.${verWarn}`;
    }
    case "fablecut_normalize_audio": {
      const ids = Array.isArray(args.clipIds) ? args.clipIds.map(String) : [];
      if (!ids.length) throw new Error("`clipIds` must list at least one clip");
      const mode = args.mode === "peak" ? "peak" : "lufs";
      const target = Number.isFinite(args.target) ? args.target : mode === "peak" ? -1 : -14;
      if (mode === "lufs" && (target < -60 || target > 0)) throw new Error("target LUFS must be -60…0");
      if (mode === "peak" && (target < -60 || target > 0)) throw new Error("target peak must be -60…0 dBFS");
      const L = require("./loudness.js");
      const groups = normalizeGroups(readProject(), ids);
      const measured = [];
      for (const g of groups) measured.push({ ids: g.map((c) => c.id), m: await measureClipGroup(readProject(), g) });
      // Re-read after the (slow) measuring so concurrent UI edits are kept.
      const proj = readProject();
      const locked = new Set(Array.isArray(proj.lockedTracks) ? proj.lockedTracks : []);
      const report = [];
      let changed = 0;
      for (const { ids: gIds, m } of measured) {
        const clips = gIds.map((id) => proj.clips.find((x) => x.id === id)).filter(Boolean);
        const lockedBy = clips.find((c) => c.locked === true || locked.has(c.track));
        if (lockedBy && args.force !== true) {
          report.push(`${gIds.join("+")}: skipped — ${lockedBy.id} is locked (pass force:true if the user asked)`);
          continue;
        }
        const db = m && L.normalizeGainDb(m, { mode, value: target });
        if (db == null) { report.push(`${gIds.join("+")}: silent — left alone`); continue; }
        const gain = Math.round(Math.min(24, Math.max(-60, db)) * 10) / 10;
        for (const c of clips) { c.props = c.props || {}; c.props.gain = gain; }
        changed++;
        const level = mode === "peak" ? `${m.peakDb.toFixed(1)} dBFS peak` : `${m.lufs.toFixed(1)} LUFS`;
        report.push(`${gIds.join("+")}: ${level} → gain ${gain > 0 ? "+" : ""}${gain} dB`);
      }
      if (changed) {
        proj.revision = (proj.revision || 0) + 1;
        writeProject(proj);
      }
      return `Normalize to ${target} ${mode === "peak" ? "dBFS peak" : "LUFS"}${changed ? ` (revision ${proj.revision})` : " — nothing changed"}:\n` + report.join("\n");
    }
    case "fablecut_auto_duck": {
      const ids = Array.isArray(args.clipIds) ? args.clipIds.map(String) : [];
      if (!ids.length) throw new Error("`clipIds` must list the music clip(s) to duck");
      const amount = args.amount == null ? -12 : +args.amount;
      if (!Number.isFinite(amount) || amount < -40 || amount > 0) throw new Error("amount must be -40…0 dB");
      const threshold = args.threshold == null ? -40 : +args.threshold;
      const attack = args.attack == null ? 0.3 : Math.max(0, +args.attack || 0);
      const release = args.release == null ? 0.6 : Math.max(0, +args.release || 0);
      const D = require("./ducking.js");
      const doc = readProject();
      const musicGroups = [];
      const seen = new Set();
      for (const id of ids) {
        const c = doc.clips.find((x) => x.id === id);
        if (!c) throw new Error("no clip " + id);
        if (c.kind !== "audio" && c.kind !== "video") throw new Error(`clip ${id} is ${c.kind} — no audio to duck`);
        const key = c.linkGroup || c.id;
        if (seen.has(key)) continue;
        seen.add(key);
        const members = c.linkGroup ? doc.clips.filter((x) => x.linkGroup === c.linkGroup) : [c];
        const stems = members.filter((x) => x.kind === "audio");
        if (stems.length) musicGroups.push(stems.map((x) => x.id));
      }
      if (!musicGroups.length) throw new Error("none of those clips carry audio on an A-track");
      const musicIds = new Set(musicGroups.flat());
      const musicClips = doc.clips.filter((x) => musicIds.has(x.id));
      const own = new Set(musicClips.map((x) => x.track));
      const lanes = Array.isArray(args.under) && args.under.length ? args.under.map(String)
        : [...new Set(doc.clips.filter((x) => x.kind === "audio").map((x) => x.track))].filter((t) => !own.has(t));
      const t0 = Math.min(...musicClips.map((x) => x.start));
      const t1 = Math.max(...musicClips.map((x) => x.start + x.duration));
      const disabled = new Set(Array.isArray(doc.disabledTracks) ? doc.disabledTracks : []);
      const voices = doc.clips.filter((x) => x.kind === "audio" && lanes.includes(x.track) && !musicIds.has(x.id) &&
        !disabled.has(x.track) && x.disabled !== true && x.start + x.duration > t0 && x.start < t1);
      const regions = amount && voices.length ? await voiceRegions(doc, voices, threshold) : [];
      if (amount && !voices.length) throw new Error(`no audio clips on ${lanes.join(", ") || "other tracks"} under the music — nothing to duck for`);
      // Re-read after the (slow) analysis so concurrent UI edits are kept.
      const proj = readProject();
      const locked = new Set(Array.isArray(proj.lockedTracks) ? proj.lockedTracks : []);
      const report = [];
      let changed = 0;
      for (const g of musicGroups) {
        const clips = g.map((id) => proj.clips.find((x) => x.id === id)).filter(Boolean);
        if (!clips.length) continue;
        const lockedBy = clips.find((c) => c.locked === true || locked.has(c.track));
        if (lockedBy && args.force !== true) {
          report.push(`${g.join("+")}: skipped — ${lockedBy.id} is locked (pass force:true if the user asked)`);
          continue;
        }
        const keys = amount ? D.duckKeyframes(regions, clips[0], { amount, attack, release }) : [];
        for (const c of clips) {
          if (keys.length) { c.keyframes = c.keyframes || {}; c.keyframes.duck = keys.map((k) => ({ ...k })); }
          else if (c.keyframes && c.keyframes.duck) {
            delete c.keyframes.duck;
            if (!Object.keys(c.keyframes).length) delete c.keyframes;
          }
        }
        changed++;
        const dips = keys.filter((k, i) => k.v === amount && (i === 0 || keys[i - 1].v !== amount)).length;
        report.push(`${g.join("+")}: ${amount ? `${dips} dip${dips === 1 ? "" : "s"} of ${amount} dB` : "ducking removed"}`);
      }
      if (changed) {
        proj.revision = (proj.revision || 0) + 1;
        writeProject(proj);
      }
      const head = amount ? `Auto-duck under ${lanes.join(", ")} — ${regions.length} voice span${regions.length === 1 ? "" : "s"}` : "Ducking cleared";
      return `${head}${changed ? ` (revision ${proj.revision})` : " — nothing changed"}:\n` + report.join("\n");
    }
    case "fablecut_analyze_reference": {
      let src = args.path || "";
      let file = /^\/media\//i.test(src)
        ? folderFile(MEDIA_DIR, path.join(MEDIA_DIR, entryRel(src, "/media/")), "managed media reference")
        : src;
      file = realPath(file);
      if (!file || !fs.statSync(file).isFile())
        throw new Error("File not found: " + src);
      const ext = path.extname(file).toLowerCase();
      const referenceKinds = new Set([".mp4", ".webm", ".mov", ".mkv", ".m4v", ".avi", ".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"]);
      if (!referenceKinds.has(ext)) throw new Error(`Unsupported reference media extension ${ext || "(none)"}`);
      // Keep the reference inside media/ so the user can preview it in the UI.
      // Exclusive copy prevents concurrent same-name imports from overwriting.
      if (!within(realPath(file), realPath(MEDIA_DIR))) {
        file = copyToMedia(file, path.basename(file));
      }
      const { analyze } = require("./analyze.js");
      const bp = await analyze(file, {
        threshold: args.threshold,
        music: args.registerMusic !== false,
        musicDir: MEDIA_DIR,
        srcUrl: "/media/" + encodeURIComponent(path.basename(file)),
      });
      let musicNote = "Reference has no audio track — no music extracted.";
      if (bp.music) {
        bp.music.src = "/media/" + encodeURIComponent(bp.music.name);
        // merge-safe append, same protocol as fablecut_import_media
        const entry = {
          id: "m_" + uid(), name: bp.music.name, kind: "audio",
          src: bp.music.src, duration: bp.duration,
        };
        const proj = readProject();
        proj.media.push(entry);
        proj.revision = (proj.revision || 0) + 1;
        writeProject(proj);
        bp.music.mediaId = entry.id;
        musicNote = `Music extracted and registered as media "${entry.id}" — place it on A1 (in:0, duration:${bp.duration}).`;
      }
      const dir = ANALYSIS_DIR;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, path.basename(file, path.extname(file)) + ".json"),
        JSON.stringify(bp, null, 2));
      return JSON.stringify(bp, null, 2) + "\n\n" + [
        musicNote,
        `REMAKE RECIPE: 1) set project width/height/fps to ${bp.width}x${bp.height} @ ${bp.fps} — 2) write beats[] into project markers — 3) extracted music on A1 — 4) one clip per shots[] entry at the same start/duration on V1 (hard cuts; footage energy should track each shot's energy value) — 5) biggest moment on drop (${bp.drop}s)${bp.bpm ? ` — tempo ${bp.bpm} BPM` : ""}. Full recipe: fablecut_docs → "Remake a reference video".`,
      ].join("\n");
    }
    case "fablecut_import_media": {
      const src = args.path;
      if (!src) throw new Error("path is required");
      let target, kind;
      if (/^https?:\/\//i.test(src)) {
        if (!/^https:\/\//i.test(src)) throw new Error("URL must be https");
        const got = await downloadImportUrl(src, MEDIA_DIR);
        target = got.target;
        kind = kindFromName(got.name);
        await maybeFaststart(target);
      } else {
        const file = realPath(src);
        if (!file || !fs.statSync(file).isFile())
          throw new Error("File not found: " + src);
        const ext = path.extname(file).toLowerCase();
        /* The kind is detected from the real path BEFORE anything is copied:
           a media-looking symlink cannot smuggle a non-media target into
           media/. Fonts, scripts and other non-media files are refused too. */
        kind = kindFromName(file);
        if (!kind) throw new Error(`Unsupported extension ${ext} — only media files ` +
          `(video, audio, image, SVG) can be imported`);
        target = copyToMedia(file, path.basename(src));
      }
      if (!kind) throw new Error("Unsupported media type");
      const entry = {
        id: "m_" + uid(),
        name: path.basename(target),
        kind,
        src: "/media/" + encodeURIComponent(path.basename(target)),
        duration: kind === "image" || kind === "svg" ? undefined : ffprobeDuration(target),
      };
      Object.assign(entry, infoForEntry(await probeFile(target), entry));
      const proj = readProject();
      // import only appends a media entry (never touches clips), so it merges
      // into the live document
      proj.media.push(entry);
      proj.revision = (proj.revision || 0) + 1;
      writeProject(proj);
      return `Imported → ${JSON.stringify(entry)}\n` +
        (entry.duration == null && kind !== "image"
          ? "Note: duration unknown (no ffprobe). The browser UI will probe and fill it in; re-read the project before trimming this media."
          : "Ready to use in clips via mediaId.");
    }
    case "fablecut_encode_profiles": {
      if (args.preset) {
        const saved = savedDeliveryPresets();
        const id = String(args.preset);
        if (!Delivery.PRESETS[id] && !saved[id]) throw new Error(`no delivery preset "${id}" — built-in: ${Delivery.PRESET_IDS.join(", ")}${Object.keys(saved).length ? "; saved: " + Object.keys(saved).join(", ") : ""}`);
        const { spec } = Delivery.normalize(id, { presets: saved });
        const p = Delivery.PRESETS[id] || saved[id];
        return JSON.stringify({ preset: id, label: p.label, note: p.note || "", summary: Delivery.describe(spec), spec }, null, 2);
      }
      if (args.profile) {
        const p = resolveProfile(String(args.profile));
        return JSON.stringify({
          default: loadEncodeProfiles().default,
          profile: args.profile,
          label: p.label,
          description: p.description,
          jpegQuality: p.jpegQuality,
          extension: p.extension,
          color: p.color,
          args: p.args,
        }, null, 2);
      }
      const saved = savedDeliveryPresets();
      let encoders = null;
      try { const r = await apiJSON("GET", "/api/export/presets"); if (r.status === 200) encoders = r.body.encoders; } catch {}
      const presets = {};
      for (const id of [...Delivery.PRESET_IDS, ...Object.keys(saved)]) {
        const p = Delivery.PRESETS[id] || saved[id];
        presets[id] = { label: p.label, ...(saved[id] ? { saved: true } : {}), summary: Delivery.describe(Delivery.normalize(id, { presets: saved }).spec) };
      }
      // the encoding-profile fields stay at the top level, as they always were
      return JSON.stringify({
        ...listProfilesPublic(!!args.detail),
        deliveryPresets: presets,
        encoders: encoders || "(start the editor server to list them)",
      }, null, 2);
    }
    default:
      throw new Error("Unknown tool: " + name);
  }
}

/* ── MCP JSON-RPC dispatch ──
   Upstream drives this over stdio (newline-delimited JSON-RPC 2.0). A host
   that serves the tools over HTTP installs its own transport and calls
   handleMessage() per request, so the dispatcher answers with the response
   object instead of writing it to a stream. */
async function handleMessage(msg) {
  try {
    const { id, method, params } = msg ?? {};
    const isRequest = id !== undefined && id !== null;
    if (method === "initialize") {
      return {
        jsonrpc: "2.0", id,
        result: {
          protocolVersion: negotiateProtocolVersion(params?.protocolVersion),
          capabilities: { tools: {} },
          serverInfo: { name: "cutline", version: "1.16.0" },
        },
      };
    }
    if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    if (method === "tools/call") {
      try {
        const out = await callTool(params.name, params.arguments || {});
        /* A tool may answer with ready-made content blocks (fablecut_frame
           returns an image); everything else answers with a string. */
        const content = Array.isArray(out) ? out : [{ type: "text", text: String(out) }];
        return { jsonrpc: "2.0", id, result: { content } };
      } catch (e) {
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "Error: " + e.message }], isError: true } };
      }
    }
    if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
    if (!isRequest) return undefined; // ignore other notifications (e.g. notifications/initialized)
    return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found: " + method } };
  } catch (e) {
    if (isRequest) return { jsonrpc: "2.0", id, error: { code: -32603, message: String(e) } };
    return undefined;
  }
}

module.exports = {
  TOOLS,
  callTool,
  handleMessage,
  setTransport,
  setEditorLocation,
  negotiateProtocolVersion,
  MCP_PROTOCOL_VERSIONS,
  MCP_DEFAULT_PROTOCOL_VERSION,
};
