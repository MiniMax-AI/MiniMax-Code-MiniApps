/* Cutline — "Send to chat" references.
 *
 * The editor's right-click menus can hand the conversation a short, plain-text
 * reference to what the user is pointing at: a clip, a moment on the
 * timeline, a marker or a media file. The Host appends the text to the chat
 * input after its own confirmation; the user adds an instruction and sends.
 *
 * The reference names things the way the MCP tools address them — clip ids,
 * track ids, media ids, timeline seconds, the open sequence and composition,
 * the project revision — so the Agent can act on it without guessing. Labels
 * follow the interface language through the `T` the editor passes in; ids,
 * seconds, file names and user text are written exactly as stored.
 *
 * Pure functions, zero dependencies. Loaded by the editor as a plain script
 * (global `FableCutChat`) and required by the tests. */
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory();
  if (node) module.exports = api;
  else root.FableCutChat = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** Clips listed in one reference; the rest are counted. */
  const MAX_CLIPS = 20;
  /** Timeline placements listed for one media file; the rest are counted. */
  const MAX_USES = 12;
  /** Longest single value (a name, a caption line) kept in a reference. */
  const MAX_VALUE = 120;
  /** The Host accepts up to 100,000 UTF-16 code units; stay well inside it. */
  const MAX_TEXT = 8000;

  const identity = (s, vars) => (vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : String(s));

  /** One line of user text: no line breaks, no control characters, bounded. */
  function oneLine(value, max = MAX_VALUE) {
    // eslint-disable-next-line no-control-regex
    const s = String(value ?? "").replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  }

  function validFps(fps) {
    const n = Number(fps);
    return Number.isFinite(n) && n > 0 ? n : 30;
  }

  /** Whole frames at `fps`. A thousandth of a frame of tolerance keeps a
      frame start that was rounded a hair low (2 s → 59.99999 frames) on its
      own frame instead of the one before. */
  function frameOf(t, fps) {
    return Math.floor(Math.max(0, Number(t) || 0) * validFps(fps) + 1e-3);
  }

  /** The time a frame starts at. Rounded to the microsecond, not the
      millisecond: at 29.97 fps frame 30 starts at 1.001001 s, and 1.001 would
      read back as frame 29. */
  function snapToFrame(t, fps) {
    const f = validFps(fps);
    return Math.round((frameOf(t, f) / f) * 1e6) / 1e6;
  }

  /** "MM:SS:FF" — the same formula as the editor's `fmt()`, so the reference
      reads exactly like the timecode on screen. */
  function timecode(t, fps) {
    const f = validFps(fps);
    const x = Math.max(0, Number(t) || 0) + 1e-6;
    const m = Math.floor(x / 60), s = Math.floor(x % 60), ff = Math.floor((x % 1) * f);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(m)}:${p(s)}:${p(ff)}`;
  }

  /** Seconds with at most three decimals and no trailing zeros: "2", "2.5", "2.033". */
  function seconds(t) {
    const n = Math.round((Number(t) || 0) * 1000) / 1000;
    return String(Object.is(n, -0) ? 0 : n);
  }

  /** "00:02:00 (2s)" */
  function at(t, fps) {
    return `${timecode(t, fps)} (${seconds(t)}s)`;
  }

  /** "00:02:00 → 00:05:15 (2s → 5.5s, 3.5s)" */
  function span(start, duration, fps) {
    const s = Number(start) || 0, d = Math.max(0, Number(duration) || 0);
    return `${timecode(s, fps)} → ${timecode(s + d, fps)} (${seconds(s)}s → ${seconds(s + d)}s, ${seconds(d)}s)`;
  }

  /** The file name a media src points at, decoded, without query or folders. */
  function fileName(src) {
    const raw = String(src ?? "").split(/[?#]/)[0];
    const last = raw.split("/").pop() || "";
    try { return decodeURIComponent(last); } catch { return last; }
  }

  /** What a clip is called on the timeline. */
  function clipName(c, ctx) {
    if (!c) return "";
    if (c.kind === "text") return oneLine(String(c.props?.text ?? "").split("\n")[0]);
    if (c.kind === "comp") {
      const comp = ctx?.getComp ? ctx.getComp(c.compId) : null;
      return oneLine((comp && comp.name) || c.name || "");
    }
    return oneLine(c.name || "");
  }

  /** Where a clip's track sits on the timeline, top to bottom (`ctx.trackOrder`,
      e.g. ["V3","V2","V1","A1",…]). Without an order: video lanes from the
      highest number down, then audio lanes from A1 up — the default layout. */
  function trackRank(ctx) {
    const order = Array.isArray(ctx && ctx.trackOrder) ? ctx.trackOrder : null;
    if (order && order.length) {
      const at = new Map(order.map((id, i) => [String(id), i]));
      return (c) => (at.has(String(c.track)) ? at.get(String(c.track)) : order.length);
    }
    return (c) => {
      const m = /^([VA])(\d+)$/.exec(String(c.track));
      if (!m) return 1e6;
      return m[1] === "V" ? -Number(m[2]) : 1e3 + Number(m[2]);
    };
  }

  function header(T) {
    return [`[${T("Cutline reference")}]`];
  }

  /** The where-am-I lines every reference ends with. */
  function footer(ctx, T) {
    const out = [];
    if (ctx.sequence) out.push(`- ${T("Sequence")}: ${oneLine(ctx.sequence.name || ctx.sequence.id)} (id ${ctx.sequence.id})`);
    if (ctx.compPath && ctx.compPath.length) {
      const names = ctx.compPath.map((p) => `${oneLine(p.name || p.id)} (id ${p.id})`).join(" › ");
      out.push(`- ${T("Inside composition")}: ${names}`);
    }
    const proj = [oneLine(ctx.projectName || "")].filter(Boolean);
    if (ctx.revision != null) proj.push(T("revision {n}", { n: ctx.revision }));
    if (ctx.fps) proj.push(`${seconds(ctx.fps)} fps`);
    if (proj.length) out.push(`- ${T("Project")}: ${proj.join(" · ")}`);
    return out;
  }

  function clipLines(c, ctx, T) {
    const fps = ctx.fps;
    const name = clipName(c, ctx);
    const head = `${c.id} · ${c.kind || "clip"} · ${T("track")} ${c.track}` + (name ? ` · “${name}”` : "");
    const lines = [head, `  ${T("Timeline")}: ${span(c.start, c.duration, fps)}`];
    if (c.mediaId) {
      const m = ctx.getMedia ? ctx.getMedia(c.mediaId) : null;
      const file = m ? oneLine(m.name || fileName(m.src)) : "";
      lines.push(`  ${T("Source")}: ${file ? `“${file}” · ` : ""}id ${c.mediaId} · ${T("in point")} ${seconds(c.in || 0)}s`);
    }
    if (c.kind === "comp" && c.compId) lines.push(`  ${T("Composition")}: id ${c.compId}`);
    const flags = [];
    if (c.locked === true) flags.push(T("locked"));
    if (c.disabled === true) flags.push(T("disabled"));
    if (flags.length) lines.push(`  ${flags.join(" · ")}`);
    return lines;
  }

  /** Trim a finished reference to the size budget, on a line boundary. */
  function bounded(lines) {
    let text = lines.join("\n");
    if (text.length <= MAX_TEXT) return text + "\n";
    text = text.slice(0, MAX_TEXT);
    const cut = text.lastIndexOf("\n");
    return (cut > 0 ? text.slice(0, cut) : text) + "\n…\n";
  }

  /**
   * One or more clips, plus the moment the user right-clicked (optional).
   * @param {object[]} clips
   * @param {object} ctx  {fps, projectName, revision, sequence, compPath, getMedia, getComp, at?}
   * @param {Function} [T]
   */
  function clipsReference(clips, ctx, T = identity) {
    const rank = trackRank(ctx);
    const list = (clips || []).filter(Boolean).slice().sort((a, b) => (a.start - b.start) || rank(a) - rank(b));
    const lines = header(T);
    lines.push(list.length === 1 ? `- ${T("Clip")}: ` + clipLines(list[0], ctx, T).join("\n") :
      `- ${T("Clips ({n})", { n: list.length })}:`);
    if (list.length !== 1) {
      for (const c of list.slice(0, MAX_CLIPS)) {
        const [head, ...rest] = clipLines(c, ctx, T);
        lines.push(`  - ${head}`, ...rest.map((l) => "  " + l));
      }
      if (list.length > MAX_CLIPS) lines.push(`  - ${T("…and {n} more", { n: list.length - MAX_CLIPS })}`);
    }
    if (ctx.at != null && Number.isFinite(+ctx.at)) lines.push(`- ${T("Pointed at")}: ${at(ctx.at, ctx.fps)} · ${T("frame")} ${frameOf(ctx.at, ctx.fps)}`);
    lines.push(...footer(ctx, T));
    return bounded(lines);
  }

  /**
   * A moment on the timeline: the clips under it, and the track it was taken on.
   * @param {number} t
   * @param {object} ctx  {fps, …, clips, track?}
   * @param {Function} [T]
   */
  function timeReference(t, ctx, T = identity) {
    const lines = header(T);
    lines.push(`- ${T("Time")}: ${at(t, ctx.fps)} · ${T("frame")} ${frameOf(t, ctx.fps)}`);
    if (ctx.track) lines.push(`- ${T("Track")}: ${ctx.track}`);
    const rank = trackRank(ctx);
    const under = (ctx.clips || []).filter((c) => t >= c.start && t < c.start + c.duration)
      .sort((a, b) => rank(a) - rank(b) || a.start - b.start);
    if (under.length) {
      lines.push(`- ${T("Clips here")}:`);
      for (const c of under.slice(0, MAX_CLIPS)) {
        const name = clipName(c, ctx);
        lines.push(`  - ${c.id} · ${c.kind || "clip"} · ${T("track")} ${c.track}` + (name ? ` · “${name}”` : "") +
          ` · ${seconds(c.start)}s → ${seconds(c.start + c.duration)}s`);
      }
      if (under.length > MAX_CLIPS) lines.push(`  - ${T("…and {n} more", { n: under.length - MAX_CLIPS })}`);
    } else lines.push(`- ${T("Clips here")}: ${T("none")}`);
    lines.push(...footer(ctx, T));
    return bounded(lines);
  }

  /**
   * A marker on the ruler.
   * @param {{t:number, label?:string, color?:string}} mk
   * @param {object} ctx
   * @param {Function} [T]
   */
  function markerReference(mk, ctx, T = identity) {
    const lines = header(T);
    const label = oneLine(mk.label || "");
    lines.push(`- ${T("Marker")}: ${at(mk.t, ctx.fps)} · ${T("frame")} ${frameOf(mk.t, ctx.fps)}` +
      (label ? ` · “${label}”` : "") + ` · ${mk.color || "gold"}`);
    lines.push(...footer(ctx, T));
    return bounded(lines);
  }

  /**
   * A file in the project bin, with where the timeline uses it.
   * @param {object} m  the media entry
   * @param {object[]} uses  MediaLib.placements(doc, m.id)
   * @param {object} ctx
   * @param {Function} [T]
   */
  function mediaReference(m, uses, ctx, T = identity) {
    const lines = header(T);
    const name = oneLine(m.name || fileName(m.src));
    lines.push(`- ${T("Media")}: ${m.id} · ${m.kind || "media"}` + (name ? ` · “${name}”` : ""));
    const file = oneLine(fileName(m.src), 200);
    if (file) lines.push(`  ${T("File")}: ${file}`);
    const facts = [];
    if (Number(m.duration) > 0) facts.push(`${T("duration")} ${at(m.duration, m.fps || ctx.fps)}`);
    if (m.width && m.height) facts.push(`${m.width}×${m.height}`);
    if (Number(m.fps) > 0) facts.push(`${seconds(m.fps)} fps`);
    if (facts.length) lines.push(`  ${facts.join(" · ")}`);
    const list = uses || [];
    if (!list.length) lines.push(`  ${T("On the timeline")}: ${T("not used")}`);
    else {
      lines.push(`  ${T("On the timeline ({n})", { n: list.length })}:`);
      for (const u of list.slice(0, MAX_USES)) {
        const where = u.sequence ? ` · ${T("sequence")} ${oneLine(u.sequenceName || u.sequence)} (id ${u.sequence})`
          : u.comp ? ` · ${T("composition")} ${oneLine(u.compName || u.comp)} (id ${u.comp})` : "";
        lines.push(`  - ${u.clipId} · ${T("track")} ${u.track} · ${span(u.start, u.duration, ctx.fps)}${where}`);
      }
      if (list.length > MAX_USES) lines.push(`  - ${T("…and {n} more", { n: list.length - MAX_USES })}`);
    }
    lines.push(...footer(ctx, T));
    return bounded(lines);
  }

  return {
    MAX_CLIPS, MAX_USES, MAX_VALUE, MAX_TEXT,
    oneLine, frameOf, snapToFrame, timecode, seconds, fileName, clipName,
    clipsReference, timeReference, markerReference, mediaReference,
  };
});
