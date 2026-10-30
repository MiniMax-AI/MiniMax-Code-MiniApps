/* Atlas — shared UI helpers (icons, formatters, hooks, preview) */

const { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect } = React;

// ---------- Formatters ----------
function formatBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function formatRelTime(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  if (d < 30) return d + 'd ago';
  const mo = Math.floor(d / 30);
  if (mo < 12) return mo + 'mo ago';
  return Math.floor(mo / 12) + 'y ago';
}

function formatAbsTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts + 8 * 3600000);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const y = d.getUTCFullYear(), mo = d.getUTCMonth(), day = d.getUTCDate();
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  const date = `${months[mo]} ${day} ${y}`;
  if (h === 0 && m === 0) return date;
  return `${date}, ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function formatMode(mode) {
  if (mode == null) return '—';
  const flags = [
    (mode >> 8) & 1 ? 'r' : '-',
    (mode >> 7) & 1 ? 'w' : '-',
    (mode >> 6) & 1 ? 'x' : '-',
    (mode >> 5) & 1 ? 'r' : '-',
    (mode >> 4) & 1 ? 'w' : '-',
    (mode >> 3) & 1 ? 'x' : '-',
    (mode >> 2) & 1 ? 'r' : '-',
    (mode >> 1) & 1 ? 'w' : '-',
    (mode >> 0) & 1 ? 'x' : '-',
  ];
  return flags.join('');
}

// ---------- Icons ----------
function FolderIcon({ open = false, accent = false }) {
  const fill = accent ? 'var(--accent)' : 'var(--faint)';
  const stroke = accent ? 'var(--accent)' : 'var(--muted)';
  return (
    <span className="ficon">
      {open ? (
        <svg viewBox="0 0 16 16" fill="none">
          <path d="M1.5 4.5 A1 1 0 0 1 2.5 3.5 H6 L7.5 5 H13.5 A1 1 0 0 1 14.5 6 V12.5 A1 1 0 0 1 13.5 13.5 H2.5 A1 1 0 0 1 1.5 12.5 Z" fill={fill} fillOpacity="0.15" stroke={stroke}/>
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" fill="none">
          <path d="M1.5 4.5 A1 1 0 0 1 2.5 3.5 H6 L7.5 5 H13.5 A1 1 0 0 1 14.5 6 V12.5 A1 1 0 0 1 13.5 13.5 H2.5 A1 1 0 0 1 1.5 12.5 Z" fill={fill} fillOpacity="0.18" stroke={stroke}/>
        </svg>
      )}
    </span>
  );
}

const LANG_COLORS = {
  typescript: '#3178c6', tsx: '#3178c6',
  javascript: '#e6b91e', jsx: '#e6b91e',
  json: '#888',
  markdown: '#555',
  css: '#264de4', scss: '#cd6799',
  python: '#4b8bbe',
  rust: '#b7410e',
  go: '#00add8',
  bash: '#3e474a',
  yaml: '#888',
  html: '#e34c26',
  svg: '#b8482e',
};

function FileIcon({ entry }) {
  const lang = entry.language;
  const ext = entry.name.split('.').pop().toUpperCase().slice(0, 3);
  const color = LANG_COLORS[lang] || 'var(--muted)';
  return (
    <span className="ficon">
      <svg viewBox="0 0 16 16" fill="none">
        <path d="M3 1.5 H9.5 L13 5 V13.5 A1 1 0 0 1 12 14.5 H3 A1 1 0 0 1 2 13.5 V2.5 A1 1 0 0 1 3 1.5 Z" fill="var(--surface)" stroke="var(--line-2)"/>
        <path d="M9.5 1.5 V5 H13" stroke="var(--line-2)" fill="none"/>
        <rect x="3.5" y="9" width="6" height="3.5" rx="0.5" fill={color} fillOpacity="0.85"/>
      </svg>
    </span>
  );
}

function EntryIcon({ entry, open = false }) {
  if (entry.type === 'directory') return <FolderIcon open={open} />;
  if (entry.type === 'symlink') return (
    <span className="ficon"><svg viewBox="0 0 16 16"><path d="M5 3 H11 V9" stroke="var(--accent)" fill="none" strokeWidth="1.5"/><path d="M11 3 L5 9" stroke="var(--accent)" fill="none" strokeWidth="1.5"/></svg></span>
  );
  return <FileIcon entry={entry} />;
}

// ---------- Hooks ----------
function useFsList(fs, path, opts) {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);
  const key = path + '|' + JSON.stringify(opts || {});
  useEffect(() => {
    let cancelled = false;
    setError(null);
    fs.list(path, opts).then((e) => { if (!cancelled) setEntries(e); }).catch((e) => { if (!cancelled) setError(e); });
    return () => { cancelled = true; };
  }, [fs, key]);
  return { entries, error };
}

function useFsRead(fs, path) {
  // Loads stat first, then available preview levels. Each level is optional.
  const emptyBundle = () => ({ l0: null, l1: null, l2: null });
  const [stat, setStat] = useState(null);
  const [bundle, setBundle] = useState(emptyBundle);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!path) { setStat(null); setBundle(emptyBundle()); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setStat(null);
    setBundle(emptyBundle());
    (async () => {
      try {
        const s = await fs.stat(path);
        const out = emptyBundle();
        const readLevel = async (lv) => {
          let c = null;
          try {
            const r = await fs.read(path, { level: lv, isDirectory: s?.type === 'directory' });
            c = r?.content ?? null;
          } catch {}
          if (typeof c !== 'string') return;
          const t = c.trim();
          // OpenViking returns placeholder strings when overviews aren't generated yet.
          if (t && !/\[directory (overview|abstract) is not (generated|ready)\]/i.test(t)) {
            out[lv] = c;
          }
        };
        if (s?.type === 'directory') {
          if (!cancelled) setStat(s);
          if (path !== '/') {
            await readLevel('l0');
            if (!cancelled) setBundle({ ...out });
            if (!fs.hasPreviewLevel || fs.hasPreviewLevel(path, 'l1')) {
              await new Promise((resolve) => setTimeout(resolve, 350));
              if (cancelled) return;
              await readLevel('l1');
              if (!cancelled) setBundle({ ...out });
            }
          }
        } else {
          await readLevel('l2');
          if (cancelled) return;
          setStat(s);
          setBundle(out);
        }
      } catch (e) {
        if (!cancelled) setError(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fs, path]);
  return { stat, bundle, loading, error };
}

// ---------- Tiny markdown renderer (read-only display) ----------
// ---------- Tiny code highlighter ----------
function highlightCode(text, lang) {
  if (!text) return text;
  if (!['javascript','typescript','tsx','jsx','json','python','bash','rust','go','css','scss'].includes(lang)) return text;
  const keywords = {
    javascript: ['const','let','var','function','return','if','else','for','while','import','export','from','default','new','class','async','await','of','in','this'],
    typescript: ['const','let','var','function','return','if','else','for','while','import','export','from','default','new','class','async','await','of','in','this','interface','type','as','public','private','readonly'],
    tsx: ['const','let','var','function','return','if','else','for','while','import','export','from','default','new','class','async','await','of','in','this','interface','type','as'],
    jsx: ['const','let','var','function','return','if','else','for','while','import','export','from','default','new','class','async','await'],
    python: ['def','class','import','from','return','if','elif','else','for','while','in','not','and','or','None','True','False','as','with','try','except','raise','yield','lambda','async','await'],
    bash: ['if','then','fi','else','elif','for','do','done','while','case','esac','set','export','function','return','in'],
    rust: ['fn','let','mut','use','pub','struct','enum','impl','trait','match','if','else','for','while','return','self','mod','as','where','async','await'],
    go: ['func','var','const','type','struct','interface','if','else','for','range','return','package','import','go','defer','chan','map'],
    json: ['true','false','null'],
    css: [], scss: [],
  };
  const kws = keywords[lang] || [];
  const kwRe = kws.length ? new RegExp('\\b(' + kws.join('|') + ')\\b', 'g') : null;
  // tokenize line by line so React fragments stay manageable
  return text.split('\n').map((line, i) => {
    const segments = [];
    let rest = line;
    // comments
    let comment = '';
    if (lang === 'python' || lang === 'bash') {
      const m = rest.match(/(^|[^\\])(#.*)$/);
      if (m) { const idx = rest.indexOf(m[2]); comment = rest.slice(idx); rest = rest.slice(0, idx); }
    } else if (lang !== 'json' && lang !== 'css' && lang !== 'scss') {
      const m = rest.indexOf('//');
      if (m >= 0 && !inString(rest, m)) { comment = rest.slice(m); rest = rest.slice(0, m); }
    }
    function inString(s, idx) {
      let q = null; let esc = false;
      for (let k = 0; k < idx; k++) {
        if (esc) { esc = false; continue; }
        if (s[k] === '\\') { esc = true; continue; }
        if (q) { if (s[k] === q) q = null; }
        else if (s[k] === '"' || s[k] === "'" || s[k] === '`') q = s[k];
      }
      return !!q;
    }
    // Tokenize: strings, numbers, keywords, rest
    const tokens = [];
    const re = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)/g;
    let last = 0; let m;
    while ((m = re.exec(rest)) !== null) {
      if (m.index > last) tokens.push(['text', rest.slice(last, m.index)]);
      if (m[1]) tokens.push(['s', m[1]]);
      else if (m[2]) tokens.push(['n', m[2]]);
      last = re.lastIndex;
    }
    if (last < rest.length) tokens.push(['text', rest.slice(last)]);

    const rendered = tokens.map((t, ti) => {
      if (t[0] === 's') return <span key={ti} className="tok-s">{t[1]}</span>;
      if (t[0] === 'n') return <span key={ti} className="tok-n">{t[1]}</span>;
      if (kwRe) {
        const parts = t[1].split(kwRe);
        return parts.map((p, pi) => kws.includes(p)
          ? <span key={ti + ':' + pi} className="tok-k">{p}</span>
          : <React.Fragment key={ti + ':' + pi}>{p}</React.Fragment>);
      }
      return <React.Fragment key={ti}>{t[1]}</React.Fragment>;
    });
    return (
      <div key={i}>
        {rendered}
        {comment && <span className="tok-c">{comment}</span>}
        {'\n'}
      </div>
    );
  });
}

// ---------- Resize handle for preview width ----------
function PreviewResizer() {
  const [drag, setDrag] = useState(false);
  useEffect(() => {
    if (!drag) return;
    document.body.setAttribute('data-resizing', 'true');
    const onMove = (e) => {
      const w = Math.max(320, Math.min(window.innerWidth - 360, window.innerWidth - e.clientX));
      document.documentElement.style.setProperty('--preview-w', w + 'px');
      try { localStorage.setItem('atlas-preview-w', String(w)); } catch {}
    };
    const onUp = () => setDrag(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      document.body.removeAttribute('data-resizing');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag]);
  // Restore on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('atlas-preview-w');
      if (saved) document.documentElement.style.setProperty('--preview-w', saved + 'px');
    } catch {}
  }, []);
  return (
    <div
      className="resize-handle"
      data-dragging={drag}
      style={{ right: 'var(--preview-col-w)' }}
      onMouseDown={(e) => { e.preventDefault(); setDrag(true); }}
      title="Drag to resize preview"
    />
  );
}

// ---------- Resize handle for tree sidebar width ----------
function TreeResizer() {
  const [drag, setDrag] = useState(false);
  useEffect(() => {
    if (!drag) return;
    document.body.setAttribute('data-resizing', 'true');
    const onMove = (e) => {
      const w = Math.max(160, Math.min(600, e.clientX));
      document.documentElement.style.setProperty('--tree-w', w + 'px');
      try { localStorage.setItem('atlas-tree-w', String(w)); } catch {}
    };
    const onUp = () => setDrag(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      document.body.removeAttribute('data-resizing');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem('atlas-tree-w');
      if (saved) document.documentElement.style.setProperty('--tree-w', saved + 'px');
    } catch {}
  }, []);
  return (
    <div
      className="resize-handle"
      data-dragging={drag}
      style={{ left: 'var(--tree-w, 280px)' }}
      onMouseDown={(e) => { e.preventDefault(); setDrag(true); }}
      title="Drag to resize sidebar"
    />
  );
}

// ---------- Preview pane ----------
const LEVEL_META = {
  l0: { name: 'L0', label: 'Abstract', desc: '~100 token summary' },
  l1: { name: 'L1', label: 'Overview', desc: 'Structure & key points' },
  l2: { name: 'L2', label: 'Content',  desc: 'Full content' },
};

function Preview({ fs, path }) {
  const { stat, bundle, loading, error } = useFsRead(fs, path);
  // Which levels are present (have non-empty content)
  const available = ['l0','l1','l2'].filter((lv) => bundle[lv] != null && bundle[lv] !== '');
  // Selected levels — default to all available, preserved across path changes via key
  const [selected, setSelected] = useState(null); // null = "auto: all available"
  useEffect(() => { setSelected(null); }, [path]);
  const active = selected ?? available;

  const toggle = (lv) => {
    setSelected((prev) => {
      const cur = prev ?? available;
      if (cur.includes(lv)) {
        const next = cur.filter((x) => x !== lv);
        return next.length ? next : cur; // don't allow zero
      }
      return [...cur, lv].sort();
    });
  };

  if (!path) {
    return (
      <aside className="preview">
        <div className="preview-empty">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <rect x="10" y="6" width="22" height="32" rx="2" stroke="var(--faint)" strokeWidth="1"/>
            <path d="M22 6 v8 h8" stroke="var(--faint)" strokeWidth="1" fill="none"/>
            <line x1="14" y1="20" x2="28" y2="20" stroke="var(--faint)"/>
            <line x1="14" y1="24" x2="28" y2="24" stroke="var(--faint)"/>
            <line x1="14" y1="28" x2="22" y2="28" stroke="var(--faint)"/>
          </svg>
          <span>Select a file or folder to preview</span>
        </div>
      </aside>
    );
  }
  if (error) {
    return (
      <aside className="preview">
        <div className="preview-empty">
          <span>Preview unavailable</span>
        </div>
      </aside>
    );
  }
  if (!stat) return <aside className="preview"><div className="preview-empty">Loading…</div></aside>;

  return (
    <aside className="preview">
      <div className="preview-head">
        <EntryIcon entry={stat} />
        <div className="preview-title">
          <div className="name">{stat.name === '/' ? '/' : stat.name}</div>
          <div className="preview-head-modified">{formatAbsTime(stat.mtime)}</div>
        </div>
        {stat.language && <span className="lang-badge">{stat.language}</span>}
      </div>
      <div className="preview-meta">
        <div className="pair preview-modified"><span>modified</span><b>{formatAbsTime(stat.mtime)}</b></div>
        <div className="pair preview-path"><span>path</span><b style={{fontFamily:'var(--mono)', fontSize: 11}}>{stat.path}</b></div>
      </div>
      {available.length > 0 && (
        <div className="preview-levels">
          {available.map((lv) => {
            const m = LEVEL_META[lv];
            return (
              <button
                key={lv}
                className="level-chip"
                data-active={active.includes(lv)}
                onClick={() => toggle(lv)}
                title={m.desc}
              >
                <span className="level-name">{m.name}</span>
                <span className="level-label">{m.label}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="preview-body-multi scroll">
        {loading && available.length === 0 ? (
          <div className="preview-section-empty">Loading…</div>
        ) : available.length === 0 ? (
          <div className="preview-section-empty">No content available for this {stat.type === 'directory' ? 'folder' : 'file'}.</div>
        ) : active.map((lv, i) => {
          const c = bundle[lv];
          const meta = LEVEL_META[lv];
          const isL2File = lv === 'l2' && stat.type !== 'directory';
          const lang = (stat.language || '').toLowerCase();
          const ext = (stat.name || '').split('.').pop().toLowerCase();
          const isSvg = isL2File && stat.mime === 'image/svg+xml';
          const isJsonl = isL2File && (ext === 'jsonl' || ext === 'ndjson' || lang === 'jsonl');
          const isJson = isL2File && !isJsonl && (ext === 'json' || lang === 'json');
          const isMarkdown = !isL2File || lang === 'markdown' || ext === 'md' || ext === 'markdown';
          let body;
          if (isSvg) {
            body = <div className="preview-section-body" style={{display:'grid', placeItems:'center'}} dangerouslySetInnerHTML={{__html: c}} />;
          } else if (isJsonl) {
            body = <div className="preview-section-body jsonl">{window.renderJsonl(c)}</div>;
          } else if (isJson) {
            body = <div className="preview-section-body json">{window.renderJson(c)}</div>;
          } else if (isMarkdown) {
            body = <div className="preview-section-body markdown">{window.renderMarkdown(c)}</div>;
          } else {
            body = <div className="preview-section-body code">{window.renderPlainCode(c, lang)}</div>;
          }
          return (
            <section key={lv} className="preview-section">
              {i > 0 && <div className="preview-divider"></div>}
              <header className="preview-section-head">
                <span className="level-name">{meta.name}</span>
                <span className="level-label">{meta.label}</span>
                <span style={{flex:1}}></span>
                <span className="level-desc">{meta.desc}</span>
              </header>
              {body}
            </section>
          );
        })}
      </div>
    </aside>
  );
}

// ---------- Path utilities for UI ----------
function Breadcrumbs({ path, onPick }) {
  const segs = window.FS.Path.segments(path);
  const ancestors = window.FS.Path.ancestors(path);
  return (
    <nav className="crumbs" aria-label="path">
      <button className="crumb root" onClick={() => onPick('/')}>~</button>
      {segs.map((s, i) => (
        <React.Fragment key={i}>
          <span className="crumb-sep">/</span>
          <button className="crumb" onClick={() => onPick(ancestors[i + 1])}>{s}</button>
        </React.Fragment>
      ))}
    </nav>
  );
}

// ---------- Export everything ----------
Object.assign(window, {
  formatBytes, formatRelTime, formatAbsTime, formatMode,
  FolderIcon, FileIcon, EntryIcon,
  useFsList, useFsRead,
  highlightCode,
  Preview, PreviewResizer, TreeResizer, Breadcrumbs,
  LANG_COLORS,
});
