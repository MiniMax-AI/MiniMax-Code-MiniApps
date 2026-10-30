/* SearchOverlay — ⌘F triggered search across find / grep / glob modes.
 * Tab cycles through modes. Esc / click-out closes.
 * Each mode renders its own results shape. */

const { useState: _uS, useEffect: _uE, useRef: _uR, useMemo: _uM } = React;

const SEARCH_MODES = [
  {
    key: 'find',
    label: 'Find',
    desc: 'Semantic search by query',
    placeholder: 'What are you looking for?',
    hint: 'Natural language query — searches names + abstracts',
  },
  {
    key: 'grep',
    label: 'Grep',
    desc: 'Regex content match',
    placeholder: 'Regex pattern, e.g. TODO|FIXME',
    hint: 'Tip: scope to a folder via the breadcrumb (root scans nothing).',
  },
  {
    key: 'glob',
    label: 'Glob',
    desc: 'Name pattern',
    placeholder: 'Pattern, e.g. **/*.md',
    hint: '* = any chars in segment · ** = any depth · ? = single char',
  },
];

function normalizeSearchScope(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) return '/';
  return window.FS.Path.normalize(path);
}

function SearchOverlay({ fs, scope: initialScope, onPick, onClose, initialMode = 'find' }) {
  const initialScopePath = _uM(() => normalizeSearchScope(initialScope), [initialScope]);
  const [mode, setMode] = _uS(initialMode);
  const [query, setQuery] = _uS('');
  const [results, setResults] = _uS([]);
  const [status, setStatus] = _uS('idle'); // idle, loading, error, empty, ok
  const [error, setError] = _uS(null);
  const [active, setActive] = _uS(0);
  const inputRef = _uR();
  const listRef = _uR();

  // Scope: default to the active browser highlight, but keep root dirs in the cycle.
  const [dirs, setDirs] = _uS([initialScopePath]);
  const [scope, setScope] = _uS(initialScopePath);
  _uE(() => {
    let alive = true;
    (async () => {
      try {
        const entries = await fs.list('/');
        if (!alive) return;
        const rootDirs = ['/', ...entries.filter((e) => e.type === 'directory').map((e) => e.path)];
        const d = rootDirs.includes(initialScopePath)
          ? rootDirs
          : [initialScopePath, ...rootDirs];
        setDirs(d);
        setScope((cur) => d.includes(cur) ? cur : initialScopePath);
      } catch {}
    })();
    return () => { alive = false; };
  }, [fs, initialScopePath]);

  const cycleScope = (dir) => {
    setScope((cur) => {
      const idx = dirs.indexOf(cur);
      const next = (idx + dir + dirs.length) % dirs.length;
      return dirs[next];
    });
  };

  // autofocus on mount + on mode change
  _uE(() => { inputRef.current?.focus(); inputRef.current?.select(); }, [mode]);

  // debounced search
  _uE(() => {
    if (!query.trim()) { setResults([]); setStatus('idle'); setError(null); return; }
    setStatus('loading');
    const t = setTimeout(async () => {
      try {
        let r = [];
        if (mode === 'find')      r = await fs.find(query, { root: scope, limit: 50 });
        else if (mode === 'grep') r = await fs.grep(query, { root: scope, limit: 100 });
        else                       r = await fs.glob(query, { root: scope, limit: 200 });
        setResults(r);
        setStatus(r.length ? 'ok' : 'empty');
        setActive(0);
        setError(null);
      } catch (e) {
        setStatus('error');
        setError(e.message || String(e));
        setResults([]);
      }
    }, mode === 'grep' ? 250 : 180);
    return () => clearTimeout(t);
  }, [query, mode, scope]);

  // keep active item visible
  _uE(() => {
    const el = listRef.current?.querySelector('[data-active="true"]');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      const idx = SEARCH_MODES.findIndex((m) => m.key === mode);
      const next = e.shiftKey
        ? SEARCH_MODES[(idx - 1 + SEARCH_MODES.length) % SEARCH_MODES.length]
        : SEARCH_MODES[(idx + 1) % SEARCH_MODES.length];
      setMode(next.key);
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); cycleScope(1); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); cycleScope(-1); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[active];
      if (r) selectResult(r);
      return;
    }
  };

  const selectResult = (r) => {
    let path = null, line = null;
    if (mode === 'find') { path = r.path; line = r.line; }
    else if (mode === 'grep') { path = r.uri; line = r.line; }
    else if (mode === 'glob') path = typeof r === 'string' ? r : (r.path || r.uri || '');
    if (path) { onPick(path, line); onClose(); }
  };

  const curMode = SEARCH_MODES.find((m) => m.key === mode);

  return (
    <div className="search-overlay" onClick={onClose} role="dialog" aria-label="Search">
      <div className="search-panel" onClick={(e) => e.stopPropagation()}>
        <div className="search-modes">
          {SEARCH_MODES.map((m) => (
            <button
              key={m.key}
              className="search-mode-btn"
              data-active={mode === m.key}
              onClick={() => setMode(m.key)}
              title={m.desc}
            >
              <span className="search-mode-label">{m.label}</span>
              <span className="search-mode-desc">{m.desc}</span>
            </button>
          ))}
          <div className="search-tab-hint"><kbd>tab</kbd> next mode</div>
        </div>

        <div className="search-input-wrap">
          <span className="search-mode-marker">{curMode.label.toLowerCase()}</span>
          <span className="search-scope-marker" title="↑↓ to change scope">{scope === '/' ? '/' : window.FS.Path.basename(scope)}</span>
          <input
            ref={inputRef}
            className="search-input"
            type="text"
            placeholder={curMode.placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
          />
          <span className="search-status">
            {status === 'loading' && <span className="search-spin">⋯</span>}
            {status === 'ok' && <span className="search-count">{results.length}</span>}
            {status === 'empty' && <span className="search-count search-count-empty">no results</span>}
            {status === 'error' && <span className="search-count search-count-err">error</span>}
          </span>
        </div>

        <div className="search-meta">
          <span className="search-hint">{curMode.hint}</span>
        </div>

        <div className="search-results scroll" ref={listRef}>
          {status === 'idle' && <SearchEmpty mode={mode} />}
          {status === 'error' && <div className="search-error">{error}</div>}
          {status === 'empty' && (
            <div className="search-empty-msg">
              No matches. {mode === 'grep' && scope === '/' && (
                <span>Try scoping into a subfolder — root grep scans 0 files.</span>
              )}
            </div>
          )}
          {results.map((r, i) => (
            <SearchResultRow
              key={i + ':' + (r.path || r.uri || r)}
              mode={mode}
              result={r}
              query={query}
              active={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => selectResult(r)}
            />
          ))}
        </div>

        <div className="search-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> scope</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>tab</kbd> mode</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

function SearchEmpty({ mode }) {
  const examples = {
    find: ['UI components', 'authentication', 'README files'],
    grep: ['TODO|FIXME', '\\bclass\\s+\\w+', 'import.*react'],
    glob: ['**/*.md', 'src/**/*.{js,ts}', '**/test/**/*.spec.*'],
  }[mode] || [];
  return (
    <div className="search-empty-msg">
      <div style={{ marginBottom: 10, color: 'var(--muted)' }}>Try:</div>
      <div className="search-examples">
        {examples.map((ex) => <code key={ex}>{ex}</code>)}
      </div>
    </div>
  );
}

function SearchResultRow({ mode, result, query, active, onMouseEnter, onClick }) {
  if (mode === 'find') {
    const path = result.path || '';
    return (
      <div className="search-row" data-active={active} onMouseEnter={onMouseEnter} onClick={onClick}>
        <span className="search-row-path">
          <span className="search-row-name">{window.FS.Path.basename(path)}</span>
          <span className="search-row-dir">{window.FS.Path.dirname(path)}</span>
        </span>
        {result.snippet && <span className="search-row-snip">{result.snippet}</span>}
        {result.score != null && <span className="search-row-score">{result.score.toFixed(2)}</span>}
      </div>
    );
  }
  if (mode === 'grep') {
    return (
      <div className="search-row" data-active={active} onMouseEnter={onMouseEnter} onClick={onClick}>
        <span className="search-row-path">
          <span className="search-row-name">{window.FS.Path.basename(result.uri)}</span>
          <span className="search-row-dir">{window.FS.Path.dirname(result.uri)}</span>
          <span className="search-row-line">:{result.line}</span>
        </span>
        <pre className="search-row-code">{highlightMatch(result.content, query)}</pre>
      </div>
    );
  }
  const path = typeof result === 'string' ? result : (result.path || result.uri || '');
  return (
    <div className="search-row" data-active={active} onMouseEnter={onMouseEnter} onClick={onClick}>
      <span className="search-row-path">
        <span className="search-row-name">{window.FS.Path.basename(path)}</span>
        <span className="search-row-dir">{window.FS.Path.dirname(path)}</span>
      </span>
    </div>
  );
}

function highlightMatch(text, pattern) {
  if (!text || !pattern) return text;
  let re;
  try { re = new RegExp(pattern, 'g'); }
  catch { return text; }
  const parts = [];
  let last = 0;
  let m;
  // bounded iterations to avoid pathological regex
  let n = 0;
  while ((m = re.exec(text)) && n++ < 200) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<mark key={n}>{m[0]}</mark>);
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : text;
}

window.SearchOverlay = SearchOverlay;
window.SEARCH_MODES = SEARCH_MODES;
