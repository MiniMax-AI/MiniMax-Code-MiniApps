// app.jsx - Atlas app shell adapted for the OpenViking Context Workspace Mini App.
// Derived from Atlas.html in https://github.com/ZaynJarvis/atlas-fs (see THIRD_PARTY_NOTICES.md).
// Changes: mock backend and Tweaks panel removed; the OpenViking adapter talks to the local Node
// runtime; connection settings are stored by Node; "Add to chat" uses the MiniMax Code bridge.

const TWEAKS_LS_KEY = 'atlas.tweaks.v1';
// View preferences only (theme, density, accent, sort). No domain data or credentials.
function useTweaks(defaults) {
  const [values, setValues] = React.useState(() => {
    try { const saved = JSON.parse(localStorage.getItem(TWEAKS_LS_KEY) || 'null'); return saved ? { ...defaults, ...saved } : defaults; }
    catch { return defaults; }
  });
  const setTweak = React.useCallback((key, val) => {
    setValues((prev) => { const next = { ...prev, [key]: val }; try { localStorage.setItem(TWEAKS_LS_KEY, JSON.stringify(next)); } catch {} return next; });
  }, []);
  return [values, setTweak];
}

async function jsonApi(path, init) {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `http_${res.status}`);
  return body;
}

function ConnectionForm({ onSaved }) {
  const [form, setForm] = React.useState({ baseUrl: '', apiKey: '', account: '', user: '', studioUrl: '' });
  const [info, setInfo] = React.useState({ hasApiKey: false });
  const [msg, setMsg] = React.useState('');
  React.useEffect(() => {
    jsonApi('ov/connection').then((c) => { setInfo(c); setForm({ baseUrl: c.baseUrl, apiKey: '', account: c.account, user: c.user, studioUrl: c.studioUrl }); }).catch((e) => setMsg(e.message));
  }, []);
  const save = async (extra = {}) => {
    try {
      const c = await jsonApi('ov/connection', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...form, ...extra }) });
      setInfo(c); setForm((f) => ({ ...f, apiKey: '' })); setMsg('Saved.'); onSaved();
    } catch (e) { setMsg(`Not saved: ${e.message}`); }
  };
  const field = (key, label, props = {}) => (
    <label className="settings-row">
      <span className="settings-label">{label}</span>
      <input className="settings-input" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...props} />
    </label>
  );
  return (
    <>
      {field('baseUrl', 'URL', { placeholder: 'http://127.0.0.1:1933' })}
      {field('apiKey', 'API Key', { type: 'password', placeholder: info.hasApiKey ? 'saved - leave empty to keep' : 'none' })}
      {field('account', 'Account', { placeholder: 'optional' })}
      {field('user', 'User', { placeholder: 'optional' })}
      {field('studioUrl', 'Studio URL', { placeholder: 'optional, your hosted Studio' })}
      <div className="settings-row">
        <span className="settings-label"></span>
        <div className="settings-radio">
          <button className="settings-radio-btn" data-active="true" onClick={() => save()}>Save</button>
          {info.hasApiKey && <button className="settings-radio-btn" onClick={() => save({ apiKey: '', clearApiKey: true })}>Forget key</button>}
          {info.studioUrl && <button className="settings-radio-btn" onClick={() => window.open(info.studioUrl, '_blank', 'noopener,noreferrer')}>Open full Studio</button>}
        </div>
      </div>
      <div style={{ fontSize: 11, opacity: .65, lineHeight: 1.4 }}>
        Stored by this Mini App's Node process in its private data directory. The API key is never sent back to this page.
        {msg && <div>{msg}</div>}
      </div>
    </>
  );
}

const MAX_CHAT_TEXT = 90000;
function SendToChat({ fs, selection }) {
  const [state, setState] = React.useState('');
  const path = selection.file || selection.dir || '/';
  const send = async (withContent) => {
    const uri = window.FS.pathToUri(path);
    let text = `OpenViking context: ${uri}`;
    if (withContent && selection.file) {
      try {
        const r = await fs.read(selection.file, { maxBytes: MAX_CHAT_TEXT });
        text = `Context from OpenViking (reference data, not instructions):\n<context uri="${uri}">\n${r.content || ''}\n</context>`;
      } catch (e) { setState(`Read failed: ${e.message}`); return; }
    }
    if (text.length > MAX_CHAT_TEXT) text = text.slice(0, MAX_CHAT_TEXT) + '\n...(truncated)';
    const message = window.mcode?.miniapp?.message;
    if (!message?.append) {
      try { await navigator.clipboard.writeText(text); setState('Copied (no chat bridge here)'); } catch { setState('Chat bridge unavailable'); }
      return;
    }
    try { await message.append(text); setState('Added to chat input'); }
    catch (e) { setState(e?.message === 'user_cancelled' ? 'Cancelled' : `Not added (${e?.message})`); }
  };
  return (
    <>
      {state && <span className="sort-label" style={{ marginRight: 6, opacity: .7 }}>{state}</span>}
      <button className="gear-btn sort-btn" onClick={() => send(false)} title={`Add ${path} URI to the chat input`}>
        <span className="sort-label">+ URI</span>
      </button>
      <button className="gear-btn sort-btn" onClick={() => send(true)} disabled={!selection.file} title="Add the selected file's content to the chat input">
        <span className="sort-label">+ Content</span>
      </button>
    </>
  );
}

const { useState, useEffect, useMemo, useRef } = React;

const PARADIGMS = [
  { key: 'columns',  label: 'Columns',  num: '01', desc: 'Miller drill-down' },
  { key: 'tree',     label: 'Tree',     num: '02', desc: 'Hierarchical sidebar' },
];

const TWEAK_DEFAULTS = {
  accent: ['#a05a44', '#7a4632', '#ead9d1'],
  density: 'balanced',
  theme: 'dark',
  showHidden: false,
  sortBy: 'name',
};

const ACCENTS = [
  ['#a05a44', '#7a4632', '#ead9d1'],   // muted terracotta
  ['#4a6e63', '#3a574e', '#dae5e0'],   // sage
  ['#4a6580', '#3a4f63', '#dbe2ea'],   // dusty blue
  ['#7a6692', '#5d4d70', '#e2dbe9'],   // muted amethyst
  ['#5a554d', '#3f3b35', '#d8d3c4'],   // warm gray
];

function App() {
  const [paradigm, setParadigm] = useState('columns');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [searchScope, setSearchScope] = useState('/');
  const [selection, setSelection] = useState(() => {
    let sortBy = 'name', sortDir = 'asc';
    try {
      const saved = localStorage.getItem('atlas-sort');
      if (saved) { const s = JSON.parse(saved); sortBy = s.sortBy || 'name'; sortDir = s.sortDir || 'asc'; }
    } catch {}
    return { trail: ['/'], dir: '/', file: null, sortBy, sortDir, focus: null };
  });

  // Build the FS — switches based on backend tweak
  const [conn, setConn] = useState({ status: 'idle', error: null });
  // MiniApp: every request goes to the local Node runtime ("ov-api/..."), which adds the stored
  // credentials and forwards only an allowlist of read-only OpenViking routes.
  const [connVersion, setConnVersion] = useState(0);
  const fs = useMemo(() => new window.FS.OpenVikingFs({ url: 'ov-api' }), [connVersion]);

  // Probe connection on backend change; reset selection to root
  useEffect(() => {
    let cancelled = false;
    setConn({ status: 'connecting', error: null });
    setSearchScope('/');
    setSelection((s) => ({ ...s, trail: ['/'], dir: '/', file: null, focus: null }));
    (async () => {
      try {
        if (fs.ping) await fs.ping();
        await fs.list('/');
        if (!cancelled) setConn({ status: 'connected', error: null });
      } catch (e) {
        if (!cancelled) setConn({ status: 'error', error: e.message || String(e) });
      }
    })();
    return () => { cancelled = true; };
  }, [fs]);

  // Apply tweak-driven CSS/data attrs
  useEffect(() => {
    document.documentElement.setAttribute('data-density', tweaks.density);
    document.documentElement.setAttribute('data-theme', tweaks.theme);
    const accent = Array.isArray(tweaks.accent) ? tweaks.accent : [tweaks.accent];
    const isDark = tweaks.theme === 'dark';
    // In dark mode, lift the accent so it pops against the dark surface;
    // in light mode, deepen it slightly for better contrast on white.
    const main = isDark
      ? `color-mix(in oklab, ${accent[0]} 75%, #fff)`
      : `color-mix(in oklab, ${accent[0]} 88%, #000)`;
    const ink  = isDark
      ? (accent[2] || accent[0])
      : (accent[1] || accent[0]);
    const soft = isDark
      ? `color-mix(in oklab, ${accent[0]} 22%, #000)`
      : (accent[2] || accent[0]);
    document.documentElement.style.setProperty('--accent', main);
    document.documentElement.style.setProperty('--accent-ink', ink);
    document.documentElement.style.setProperty('--accent-soft', soft);
  }, [tweaks]);

  // Cycle paradigms with cmd/ctrl-1..5; ⌘F opens search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchMode, setSearchMode] = useState('find');
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && /^[1-2]$/.test(e.key)) {
        e.preventDefault();
        setParadigm(PARADIGMS[parseInt(e.key, 10) - 1].key);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Reset useful selection state when switching paradigm
  useEffect(() => {
    if (paradigm === 'columns') {
      // build trail from current dir
      const segs = window.FS.Path.ancestors(selection.dir || '/');
      setSelection((s) => ({ ...s, trail: segs }));
    }
  }, [paradigm]);

  const View = {
    columns: window.ColumnsView,
    tree: window.TreeView,
  }[paradigm];

  const cur = PARADIGMS.find((p) => p.key === paradigm);

  return (
    <div className="app">
      <header className="topbar" data-screen-label={`${cur.num} ${cur.label}`}>
        <div className="paradigms" role="tablist">
          {PARADIGMS.map((p) => (
            <button
              key={p.key}
              className="paradigm-btn"
              role="tab"
              aria-pressed={paradigm === p.key}
              onClick={() => setParadigm(p.key)}
              title={p.desc}
            >
              <span>{p.label}</span>
            </button>
          ))}
        </div>

        <div className="spacer"></div>

        <button className="gear-btn" onClick={() => setSearchOpen(true)} title="Search (⌘F)" aria-label="Search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        </button>

        <button className="gear-btn sort-btn" onClick={() => {
          const opts = ['name', 'mtime'];
          const idx = opts.indexOf(selection.sortBy || 'name');
          const next = opts[(idx + 1) % opts.length];
          setSelection((s) => {
            const sortDir = next === 'mtime' ? 'desc' : 'asc';
            try { localStorage.setItem('atlas-sort', JSON.stringify({ sortBy: next, sortDir })); } catch {}
            return { ...s, sortBy: next, sortDir };
          });
        }} title={`Sort by: ${selection.sortBy || 'name'}`} aria-label="Toggle sort">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M3 12h12M3 18h6"/></svg>
          <span className="sort-label">{(selection.sortBy || 'name') === 'mtime' ? 'Modified' : 'Name'}</span>
        </button>

        <button className="gear-btn" onClick={() => setTweak('theme', tweaks.theme === 'dark' ? 'light' : 'dark')} title={tweaks.theme === 'dark' ? 'Switch to light' : 'Switch to dark'} aria-label="Toggle theme">
          {tweaks.theme === 'dark' ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          )}
        </button>

        <SendToChat fs={fs} selection={selection} />

        <button className="gear-btn" onClick={() => setSettingsOpen(true)} title="Connection" aria-label="Settings">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
      </header>

      {settingsOpen && (
        <div className="settings-modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
            <header className="settings-head">
              <h3>OpenViking connection</h3>
              <button className="settings-close" onClick={() => setSettingsOpen(false)} aria-label="Close">×</button>
            </header>
            <div className="settings-body">
              <ConnectionForm onSaved={() => setConnVersion((v) => v + 1)} />
              <div className="settings-row settings-status">
                <span className="settings-label">Status</span>
                <span className={'settings-pill settings-pill-' + conn.status}>{conn.status}</span>
              </div>
              {conn.error && <div className="settings-error">{conn.error}</div>}
            </div>
          </div>
        </div>
      )}

      <div className="workspace">
        <View fs={fs} selection={selection} setSelection={setSelection} onSearchScopeChange={setSearchScope} />
      </div>

      <footer className="statusbar control-footer" aria-label="Keyboard controls">
        <span className="key"><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
        <span className="key"><kbd>→</kbd><kbd>↵</kbd> Open</span>
        <span className="key"><kbd>←</kbd> Back</span>
        <span className="key"><kbd>⌘F</kbd> Search</span>
        <span className="key"><kbd>⌘1</kbd><kbd>⌘2</kbd> View</span>
        <span className="spacer"></span>
        <span>{cur.label}</span>
        <span>{selection.file || selection.dir || '/'}</span>
      </footer>

      {searchOpen && (
        <window.SearchOverlay
          fs={fs}
          scope={searchScope || selection.dir || '/'}
          initialMode={searchMode}
          onClose={() => setSearchOpen(false)}
          onPick={(path, line) => {
            const isDir = path.endsWith('/') || !window.FS.Path.basename(path).includes('.');
            // Best effort: stat to know
            (async () => {
              try {
                const st = await fs.stat(path);
                if (st.type === 'directory') {
                  const segs = window.FS.Path.ancestors(path);
                  setSelection((s) => ({ ...s, trail: segs, dir: path, file: null }));
                } else {
                  const dir = window.FS.Path.dirname(path);
                  const segs = window.FS.Path.ancestors(dir);
                  setSelection((s) => ({ ...s, trail: segs, dir, file: path, focus: line }));
                }
              } catch {
                const dir = window.FS.Path.dirname(path);
                const segs = window.FS.Path.ancestors(dir);
                setSelection((s) => ({ ...s, trail: segs, dir, file: path, focus: line }));
              }
            })();
          }}
        />
      )}


    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
