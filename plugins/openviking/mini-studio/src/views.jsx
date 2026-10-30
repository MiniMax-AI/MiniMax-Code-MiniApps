/* Atlas — five navigation paradigms (v2) */
/* All views consume only the read-only FS API */

const { useState: useS, useEffect: useE, useLayoutEffect: useLE, useMemo: useM, useRef: useR, useCallback: useCB } = React;

function sortEntries(entries, sortBy = 'name', sortDir = 'asc') {
  return entries.slice().sort((a, b) => {
    if (a.type !== b.type) {
      if (a.type === 'directory') return -1;
      if (b.type === 'directory') return 1;
    }
    let cmp = 0;
    if (sortBy === 'mtime') cmp = (a.mtime || 0) - (b.mtime || 0);
    else if (sortBy === 'size') cmp = (a.size || 0) - (b.size || 0);
    else cmp = a.name.localeCompare(b.name, undefined, { numeric: true });
    return sortDir === 'desc' ? -cmp : cmp;
  });
}

// ============================================================
// 1. COLUMNS (Miller / NeXT browser)
// ============================================================
const COLUMN_W = 240;

function ColumnsView({ fs, selection, setSelection, onSearchScopeChange }) {
  const trail = selection.trail;
  const [rawCols, setRawCols] = useS({});
  const wrapRef = useR();
  const innerRef = useR();
  const prevTrailRef = useR(trail);
  const [exitCols, setExitCols] = useS([]);
  const scrollRef = useR();
  const animTimerRef = useR(null);
  const animFrameRef = useR(null);
  const lastScrollRef = useR(0);
  const pendingTrailAnimRef = useR(null);
  const [trailReloadKey, setTrailReloadKey] = useS(0);
  const prevFsForLoadRef = useR(fs);
  useE(() => {
    let alive = true;
    const fsChanged = prevFsForLoadRef.current !== fs;
    prevFsForLoadRef.current = fs;
    const active = trail[trail.length - 1] || '/';
    const paths = fsChanged ? trail : trail.filter((p) => p === active || !rawCols[p]);
    Promise.all(paths.map((p) => fs.list(p).then((entries) => [p, entries]).catch(() => [p, []])))
      .then((pairs) => {
        if (!alive) return;
        setRawCols((prev) => {
          const next = fsChanged ? {} : { ...prev };
          for (const [p, entries] of pairs) next[p] = entries;
          return next;
        });
        if (fs.prefetchTree) fs.prefetchTree(active).catch(() => {});
      });
    return () => { alive = false; };
  }, [fs, trail.join('|'), trailReloadKey]);

  const cols = useM(() => {
    const sorted = {};
    for (const p of Object.keys(rawCols)) {
      sorted[p] = sortEntries(rawCols[p], selection.sortBy, selection.sortDir);
    }
    return sorted;
  }, [rawCols, selection.sortBy, selection.sortDir]);

  const readInnerTranslateX = () => {
    const inner = innerRef.current;
    if (!inner) return 0;
    const transform = window.getComputedStyle(inner).transform;
    if (!transform || transform === 'none') return 0;
    try {
      return new DOMMatrixReadOnly(transform).m41 || 0;
    } catch {
      return 0;
    }
  };

  const readVisualScrollLeft = () => {
    const el = scrollRef.current;
    if (!el) return lastScrollRef.current;
    // A running wrapper transform visually changes the scroll position without
    // changing scrollLeft; fold it in before starting a new trail animation.
    return el.scrollLeft - readInnerTranslateX();
  };

  const cancelColumnAnimation = () => {
    if (animTimerRef.current) {
      clearTimeout(animTimerRef.current);
      animTimerRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    const el = scrollRef.current;
    const inner = innerRef.current;
    if (el) el.style.scrollBehavior = '';
    if (inner) {
      inner.style.transition = '';
      inner.style.transform = '';
    }
  };

  const prepareTrailAnimation = (nextTrail) => {
    const oldVisualScroll = readVisualScrollLeft();
    cancelColumnAnimation();
    const el = scrollRef.current;
    const targetScroll = el ? Math.max(0, nextTrail.length * COLUMN_W - el.clientWidth) : 0;

    if (nextTrail.length === trail.length) {
      pendingTrailAnimRef.current = null;
      setExitCols([]);
      return;
    }

    pendingTrailAnimRef.current = { oldScroll: oldVisualScroll, targetScroll };
    if (nextTrail.length < trail.length) {
      setExitCols(trail.slice(nextTrail.length).map((p) => ({ path: p, entries: cols[p] || [] })));
    } else {
      setExitCols([]);
    }
  };

  // Use useLayoutEffect so the FLIP runs before the browser paints —
  // prevents a single-frame flash of the jumped position.
  useLE(() => {
    const prev = prevTrailRef.current;
    const el = scrollRef.current;
    const inner = innerRef.current;

    if (trail.length !== prev.length) {
      const pending = pendingTrailAnimRef.current;
      pendingTrailAnimRef.current = null;

      if (el && inner) {
        const oldScroll = pending?.oldScroll ?? lastScrollRef.current;
        const targetScroll = pending?.targetScroll ?? Math.max(0, trail.length * COLUMN_W - el.clientWidth);
        const delta = targetScroll - oldScroll;

        // Instantly jump scroll to the target position (no smooth behavior)
        el.style.scrollBehavior = 'auto';
        el.scrollLeft = targetScroll;
        lastScrollRef.current = el.scrollLeft;

        // Compensate with translateX so it visually appears nothing moved yet
        inner.style.transition = 'none';
        inner.style.transform = `translate3d(${delta}px, 0, 0)`;

        // Force the browser to commit the above styles before we animate
        void inner.getBoundingClientRect();

        animFrameRef.current = requestAnimationFrame(() => {
          animFrameRef.current = null;
          if (!inner) return;
          inner.style.transition = 'transform 300ms ease-out';
          inner.style.transform = 'translate3d(0, 0, 0)';
        });
      }

      animTimerRef.current = setTimeout(() => {
        animTimerRef.current = null;
        animFrameRef.current = null;
        setExitCols([]);
        if (el) el.style.scrollBehavior = '';
        if (inner) { inner.style.transition = ''; inner.style.transform = ''; }
      }, 340);
      prevTrailRef.current = trail;
      return;
    }

    pendingTrailAnimRef.current = null;
    setExitCols([]);
    prevTrailRef.current = trail;
  }, [trail.join('|')]);

  useE(() => () => cancelColumnAnimation(), []);

  const onPick = (colIdx, entry) => {
    const next = trail.slice(0, colIdx + 1);
    if (entry.type === 'directory') {
      next.push(entry.path);
      prepareTrailAnimation(next);
      setTrailReloadKey((k) => k + 1);
      setSelection({ ...selection, trail: next, file: null, dir: entry.path, focus: null });
    } else {
      prepareTrailAnimation(next);
      setSelection({ ...selection, trail: next, file: entry.path, dir: window.FS.Path.dirname(entry.path), focus: null });
    }
  };

  const selectedPath = selection.file || selection.dir || '/';
  const selectedParent = selectedPath !== '/' ? window.FS.Path.dirname(selectedPath) : null;
  const activeColIdx = trail.length - 1;
  const activeColPath = trail[activeColIdx];
  const activeEntries = cols[activeColPath] || [];
  const selectedChildPath = selectedParent === activeColPath ? selectedPath : null;
  const activeIdx = selectedChildPath ? activeEntries.findIndex((e) => e.path === selectedChildPath) : -1;
  const searchScope = selectedPath;
  const previewPath = selectedPath;

  useE(() => {
    if (onSearchScopeChange) onSearchScopeChange(searchScope || '/');
  }, [searchScope, onSearchScopeChange]);

  useE(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
      if (document.querySelector('.search-overlay')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!activeEntries.length) return;
        e.preventDefault();
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        const next = activeIdx < 0
          ? (e.key === 'ArrowDown' ? 0 : activeEntries.length - 1)
          : Math.max(0, Math.min(activeEntries.length - 1, activeIdx + dir));
        const entry = activeEntries[next];
        const newTrail = trail.slice(0, activeColIdx + 1);
        if (entry.type === 'directory') {
          setSelection({ ...selection, trail: newTrail, file: null, dir: entry.path, focus: null });
        } else {
          setSelection({ ...selection, trail: newTrail, file: entry.path, dir: window.FS.Path.dirname(entry.path), focus: null });
        }
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        const entry = activeIdx >= 0 ? activeEntries[activeIdx] : null;
        if (!entry) return;
        e.preventDefault();
        if (entry.type === 'directory') {
          const next = trail.slice(0, activeColIdx + 1);
          next.push(entry.path);
          prepareTrailAnimation(next);
          setTrailReloadKey((k) => k + 1);
          setSelection({ ...selection, trail: next, file: null, dir: entry.path, focus: null });
        } else {
          setSelection({ ...selection, file: entry.path, dir: window.FS.Path.dirname(entry.path), focus: null });
        }
      } else if (e.key === 'ArrowLeft') {
        if (trail.length <= 1) {
          if (selectedPath === '/') return;
          e.preventDefault();
          prepareTrailAnimation(['/']);
          setSelection({ ...selection, trail: ['/'], dir: '/', file: null, focus: null });
          return;
        }
        e.preventDefault();
        const leaving = trail[trail.length - 1];
        const newTrail = trail.slice(0, -1);
        prepareTrailAnimation(newTrail);
        setSelection({ ...selection, trail: newTrail, dir: leaving, file: null, focus: null });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeEntries, activeIdx, selectedPath, trail.join('|'), selection.file, selection.dir]);

  useE(() => {
    const selectedRows = wrapRef.current?.querySelectorAll('.col .fs-row[data-selected="true"]');
    const el = selectedRows?.[selectedRows.length - 1];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [selectedPath, trail.length]);

  useE(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e) => {
      const delta = e.deltaX || (e.shiftKey ? e.deltaY : 0);
      if (!delta) return;
      const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
      if (!maxScroll) return;
      const next = Math.max(0, Math.min(maxScroll, el.scrollLeft + delta));
      if (next === el.scrollLeft) return;
      if (e.cancelable) e.preventDefault();
      el.scrollLeft = next;
      lastScrollRef.current = next;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div className="view-columns" ref={wrapRef}>
      <div
        className="columns-scroll scroll"
        ref={scrollRef}
        onScroll={(e) => { lastScrollRef.current = e.currentTarget.scrollLeft; }}
      >
        <div className="columns-inner" ref={innerRef}>
        {trail.map((path, i) => {
          const entries = cols[path] || [];
          const selectedChild = trail[i + 1] || (selectedParent === path ? selectedPath : null);
          return (
            <div className="col" key={path + ':' + i} style={{zIndex: trail.length - i}}>
              <div className="col-head">
                <span>{path === '/' ? '/' : window.FS.Path.basename(path)}</span>
                <span className="count">{entries.length}</span>
              </div>
              <div className="col-body scroll">
                {entries.map((e) => (
                  <div key={e.path} className="fs-row" data-selected={e.path === selectedChild} onClick={() => onPick(i, e)}>
                    <EntryIcon entry={e} />
                    <span className="name">{e.name}</span>
                    {e.type === 'directory' && <span className="chev">▸</span>}
                  </div>
                ))}
                {entries.length === 0 && <div style={{padding: '12px', color: 'var(--faint)', fontStyle: 'italic', fontFamily: 'var(--serif)', fontSize: 13}}>empty</div>}
              </div>
            </div>
          );
        })}
        {exitCols.map(({ path, entries }) => (
          <div className="col col-exit" key={'exit:' + path} style={{zIndex: 0}}>
            <div className="col-head">
              <span>{path === '/' ? '/' : window.FS.Path.basename(path)}</span>
              <span className="count">{entries.length}</span>
            </div>
            <div className="col-body scroll">
              {entries.map((e) => (
                <div key={e.path} className="fs-row">
                  <EntryIcon entry={e} />
                  <span className="name">{e.name}</span>
                  {e.type === 'directory' && <span className="chev">▸</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
        </div>
      </div>
      <ColumnsSplitResizer />
      <PreviewResizer />
      <Preview fs={fs} path={previewPath} />
    </div>
  );
}

function ColumnsSplitResizer() {
  const [drag, setDrag] = useS(false);

  useE(() => {
    try {
      const saved = localStorage.getItem('atlas-columns-browser-h');
      if (saved) document.documentElement.style.setProperty('--columns-browser-h', saved);
    } catch {}
  }, []);

  useE(() => {
    if (!drag) return;
    document.body.setAttribute('data-resizing-y', 'true');
    const onMove = (e) => {
      if (e.cancelable) e.preventDefault();
      const view = document.querySelector('.view-columns');
      if (!view) return;
      const rect = view.getBoundingClientRect();
      const y = (e.touches && e.touches[0] ? e.touches[0].clientY : e.clientY) - rect.top;
      const ratio = Math.max(0.34, Math.min(0.72, y / Math.max(1, rect.height)));
      const value = `${Math.round(ratio * 100)}%`;
      document.documentElement.style.setProperty('--columns-browser-h', value);
      try { localStorage.setItem('atlas-columns-browser-h', value); } catch {}
    };
    const onUp = () => setDrag(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    window.addEventListener('touchcancel', onUp);
    return () => {
      document.body.removeAttribute('data-resizing-y');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
      window.removeEventListener('touchcancel', onUp);
    };
  }, [drag]);

  const startMouseDrag = (e) => {
    e.preventDefault();
    setDrag(true);
  };

  const startTouchDrag = () => {
    setDrag(true);
  };

  return (
    <div
      className="columns-split-handle"
      data-dragging={drag}
      onMouseDown={startMouseDrag}
      onTouchStart={startTouchDrag}
      title="Drag to resize browser and reader"
    />
  );
}

function TreeSplitResizer() {
  const [drag, setDrag] = useS(false);

  useE(() => {
    try {
      const saved = localStorage.getItem('atlas-tree-browser-h');
      if (saved) document.documentElement.style.setProperty('--tree-browser-h', saved);
    } catch {}
  }, []);

  useE(() => {
    if (!drag) return;
    document.body.setAttribute('data-resizing-y', 'true');
    const onMove = (e) => {
      if (e.cancelable) e.preventDefault();
      const view = document.querySelector('.view-tree');
      if (!view) return;
      const rect = view.getBoundingClientRect();
      const y = (e.touches && e.touches[0] ? e.touches[0].clientY : e.clientY) - rect.top;
      const ratio = Math.max(0.34, Math.min(0.72, y / Math.max(1, rect.height)));
      const value = `${Math.round(ratio * 100)}%`;
      document.documentElement.style.setProperty('--tree-browser-h', value);
      try { localStorage.setItem('atlas-tree-browser-h', value); } catch {}
    };
    const onUp = () => setDrag(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    window.addEventListener('touchcancel', onUp);
    return () => {
      document.body.removeAttribute('data-resizing-y');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
      window.removeEventListener('touchcancel', onUp);
    };
  }, [drag]);

  const startMouseDrag = (e) => {
    e.preventDefault();
    setDrag(true);
  };

  const startTouchDrag = () => {
    setDrag(true);
  };

  return (
    <div
      className="tree-split-handle"
      data-dragging={drag}
      onMouseDown={startMouseDrag}
      onTouchStart={startTouchDrag}
      title="Drag to resize tree and reader"
    />
  );
}

// ============================================================
// 2. TREE + DETAIL
// ============================================================
const TREE_EXPANDED_KEY = 'atlas-tree-expanded-v1';

function readStoredTreeExpanded() {
  try {
    const raw = localStorage.getItem(TREE_EXPANDED_KEY);
    const paths = raw ? JSON.parse(raw) : null;
    if (Array.isArray(paths) && paths.every((p) => typeof p === 'string')) {
      return new Set(['/', ...(paths.length ? paths : [])]);
    }
  } catch {}
  return new Set(['/']);
}

function TreeView({ fs, selection, setSelection, onSearchScopeChange }) {
  const [expanded, setExpanded] = useS(readStoredTreeExpanded);
  const [childCache, setChildCache] = useS({});
  const treeWrapRef = useR();
  const prevFsRef = useR(fs);
  const listReqRef = useR(new Map());
  const loadingPathsRef = useR(new Set());

  const preloadTree = useCB((path) => {
    if (fs.prefetchTree) fs.prefetchTree(path).catch(() => {});
  }, [fs]);

  const loadChildren = useCB((path, opts = {}) => {
    const { refresh = false, clear = false, preload = true } = opts;
    const seq = (listReqRef.current.get(path) || 0) + 1;
    listReqRef.current.set(path, seq);
    loadingPathsRef.current.add(path);
    if (clear) {
      setChildCache((prev) => {
        if (!(path in prev)) return prev;
        const next = { ...prev };
        delete next[path];
        return next;
      });
    }
    fs.list(path, refresh ? { refresh: true } : {})
      .then((children) => {
        if (listReqRef.current.get(path) !== seq) return;
        setChildCache((prev) => ({ ...prev, [path]: children }));
        loadingPathsRef.current.delete(path);
        if (preload) preloadTree(path);
      })
      .catch(() => {
        if (listReqRef.current.get(path) !== seq) return;
        setChildCache((prev) => ({ ...prev, [path]: [] }));
        loadingPathsRef.current.delete(path);
      });
  }, [fs, preloadTree]);

  useE(() => {
    const fsChanged = prevFsRef.current !== fs;
    prevFsRef.current = fs;
    const paths = [...expanded];
    const need = fsChanged ? paths : paths.filter((p) => !childCache[p]);
    if (!need.length) return;
    Promise.all(need.map((p) => fs.list(p).then((c) => [p, c]).catch(() => [p, []])))
      .then((pairs) => {
        setChildCache((prev) => {
          const next = fsChanged ? {} : { ...prev };
          for (const [p, c] of pairs) {
            next[p] = c;
          }
          return next;
        });
        for (const [p] of pairs) preloadTree(p);
      });
  }, [fs]);

  useE(() => {
    try { localStorage.setItem(TREE_EXPANDED_KEY, JSON.stringify([...expanded])); } catch {}
  }, [[...expanded].join('|')]);

  const openDirectory = useCB((p) => {
    setExpanded((prev) => {
      if (prev.has(p)) return prev;
      return new Set([...prev, p]);
    });
    loadChildren(p, { preload: true });
  }, [loadChildren]);

  const closeDirectory = useCB((p) => {
    setExpanded((prev) => {
      if (!prev.has(p)) return prev;
      const next = new Set(prev);
      next.delete(p);
      return next;
    });
  }, []);

  const toggle = useCB((p) => {
    if (expanded.has(p)) closeDirectory(p);
    else openDirectory(p);
  }, [expanded, closeDirectory, openDirectory]);

  const flatVisible = useM(() => {
    const out = [];
    const walk = (entries, depth) => {
      for (const e of entries) {
        out.push({ entry: e, depth });
        if (e.type === 'directory' && expanded.has(e.path)) {
          walk(childCache[e.path] || [], depth + 1);
        }
      }
    };
    walk(childCache['/'] || [], 0);
    return out;
  }, [expanded, childCache]);

  const currentPath = selection.file || selection.dir;
  const currentIdx = Math.max(0, flatVisible.findIndex((n) => n.entry.path === currentPath));
  const currentNode = flatVisible.find((n) => n.entry.path === currentPath);
  const highlightedDirectory = currentNode?.entry.type === 'directory'
    ? currentNode.entry.path
    : (selection.dir || '/');

  useE(() => {
    if (onSearchScopeChange) onSearchScopeChange(highlightedDirectory || '/');
  }, [highlightedDirectory, onSearchScopeChange]);

  useE(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
      if (document.querySelector('.search-overlay')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!flatVisible.length) return;

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        const next = Math.max(0, Math.min(flatVisible.length - 1, currentIdx + dir));
        const node = flatVisible[next];
        if (node.entry.type === 'directory') {
          setSelection({ ...selection, dir: node.entry.path, file: null });
        } else {
          setSelection({ ...selection, file: node.entry.path, dir: window.FS.Path.dirname(node.entry.path) });
        }
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        const node = flatVisible[currentIdx];
        if (!node) return;
        if (node.entry.type === 'directory') {
          e.preventDefault();
          if (!expanded.has(node.entry.path)) {
            openDirectory(node.entry.path);
          } else {
            const kids = childCache[node.entry.path] || [];
            if (kids.length) {
              const k = kids[0];
              if (k.type === 'directory') setSelection({ ...selection, dir: k.path, file: null });
              else setSelection({ ...selection, file: k.path, dir: window.FS.Path.dirname(k.path) });
            }
          }
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const node = flatVisible[currentIdx];
        if (!node) return;
        if (node.entry.type === 'directory' && expanded.has(node.entry.path)) {
          closeDirectory(node.entry.path);
        } else {
          const parent = window.FS.Path.dirname(node.entry.path);
          if (parent && parent !== '/') {
            setSelection({ ...selection, dir: parent, file: null });
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flatVisible, currentIdx, expanded, childCache, selection.file, selection.dir, openDirectory, closeDirectory]);

  useE(() => {
    const el = treeWrapRef.current?.querySelector('.tree-node[data-selected="true"]');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [currentPath]);

  const renderNode = (entry, depth) => {
    if (entry.type !== 'directory') {
      return (
        <div key={entry.path} className="tree-node" data-selected={selection.file === entry.path} style={{ paddingLeft: 6 + depth * 14 }}
          onClick={() => setSelection({ ...selection, file: entry.path, dir: window.FS.Path.dirname(entry.path) })}>
          <span className="twirl"></span><EntryIcon entry={entry} /><span className="name">{entry.name}</span>
        </div>
      );
    }
    const open = expanded.has(entry.path);
    return (
      <React.Fragment key={entry.path}>
        <div className="tree-node" data-selected={selection.dir === entry.path && !selection.file} style={{ paddingLeft: 6 + depth * 14 }}
          onClick={() => { toggle(entry.path); setSelection({ ...selection, dir: entry.path, file: null }); }}>
          <span className="twirl" data-open={open}>▶</span>
          <FolderIcon open={open} />
          <span className="name">{entry.name}</span>
        </div>
        {open && (childCache[entry.path] || []).map((c) => renderNode(c, depth + 1))}
      </React.Fragment>
    );
  };

  const rootChildren = childCache['/'] || [];

  return (
    <div className="view-tree" ref={treeWrapRef}>
      <div className="tree-pane">
        <div className="tree-head">Workspace</div>
        <div className="tree-body scroll">
          {rootChildren.map((c) => renderNode(c, 0))}
        </div>
      </div>
      <TreeResizer />
      <TreeSplitResizer />
      <Preview fs={fs} path={selection.file || selection.dir} />
    </div>
  );
}

// ============================================================
// 3. DUAL-PANE (Norton / Total Commander)
// ============================================================
function DualPaneView({ fs, selection, setSelection }) {
  const dual = selection.dual || { left: '/', right: '/src', active: 'left', leftSel: null, rightSel: null };
  const setDual = (patch) => setSelection({ ...selection, dual: { ...dual, ...patch } });

  const Pane = ({ side }) => {
    const path = dual[side];
    const sel = dual[side + 'Sel'];
    const { entries } = useFsList(fs, path, { sortBy: 'name' });
    const totalSize = (entries || []).reduce((a, b) => a + (b.type === 'file' ? b.size : 0), 0);
    return (
      <div className="dual-pane" data-active={dual.active === side} onClick={() => setDual({ active: side })}>
        <div className="dual-head">
          <Breadcrumbs path={path} onPick={(p) => setDual({ [side]: p, [side + 'Sel']: null, active: side })} />
        </div>
        <div className="dual-body scroll">
          <table className="dual-table">
            <tbody>
              {path !== '/' && (
                <tr onClick={() => setDual({ [side]: window.FS.Path.dirname(path), [side + 'Sel']: null, active: side })}>
                  <td colSpan={3}><div className="name-cell"><span className="ficon"><svg viewBox="0 0 16 16"><path d="M9 4 L4 8 L9 12" stroke="var(--muted)" fill="none" strokeWidth="1.5"/></svg></span><span style={{color:'var(--muted)'}}>..</span></div></td>
                </tr>
              )}
              {(entries || []).map((e) => (
                <tr key={e.path} data-selected={sel === e.path}
                  onClick={(ev) => { ev.stopPropagation(); setDual({ [side + 'Sel']: e.path, active: side }); if (e.type === 'file') setSelection((s) => ({ ...s, file: e.path, dual: { ...dual, [side + 'Sel']: e.path, active: side } })); }}
                  onDoubleClick={() => { if (e.type === 'directory') setDual({ [side]: e.path, [side + 'Sel']: null, active: side }); }}>
                  <td><div className="name-cell"><EntryIcon entry={e} /><span>{e.name}</span></div></td>
                  <td className="muted-cell" style={{textAlign: 'right', width: 70}}>{e.type === 'directory' ? '<DIR>' : formatBytes(e.size)}</td>
                  <td className="muted-cell" style={{width: 90}}>{formatRelTime(e.mtime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="dual-foot">
          <span><b>{(entries || []).length}</b> entries</span>
          <span><b>{formatBytes(totalSize)}</b> total</span>
          {sel && <span style={{marginLeft: 'auto'}}>↦ <b>{window.FS.Path.basename(sel)}</b></span>}
        </div>
      </div>
    );
  };

  return (
    <div className="view-dual">
      <Pane side="left" />
      <Pane side="right" />
    </div>
  );
}

// ============================================================
// 4. TREEMAP (proportional rectangles by size)
// ============================================================
function TreemapView({ fs, selection, setSelection }) {
  const [tree, setTree] = useS(null);
  const root = selection.dir || '/';

  useE(() => {
    let alive = true;
    const build = async (path) => {
      try {
        const stat = await fs.stat(path);
        if (stat.type !== 'directory') return { ...stat, value: stat.size || 1 };
        const entries = await fs.list(path);
        const children = await Promise.all(entries.map((e) => build(e.path)));
        const value = children.reduce((a, b) => a + (b.value || 0), 0);
        return { ...stat, children, value };
      } catch { return null; }
    };
    build(root).then((t) => { if (alive) setTree(t); });
    return () => { alive = false; };
  }, [root]);

  const canvasRef = useR(null);
  const [size, setSize] = useS({ w: 800, h: 600 });
  React.useLayoutEffect(() => {
    if (!canvasRef.current) return;
    const measure = () => {
      const r = canvasRef.current.getBoundingClientRect();
      setSize({ w: Math.max(200, r.width - 24), h: Math.max(200, r.height - 24) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, []);

  // squarified treemap layout (simplified)
  const layout = useM(() => {
    if (!tree || !tree.children) return [];
    const cells = [];
    const place = (node, x, y, w, h, depth) => {
      if (w < 4 || h < 4) return;
      if (node.type === 'directory') {
        cells.push({ ...node, x, y, w, h, depth, isContainer: true });
        const labelH = depth === 0 ? 0 : Math.min(18, h * 0.18);
        const pad = 1;
        const ix = x + pad, iy = y + labelH + pad;
        const iw = Math.max(0, w - pad * 2), ih = Math.max(0, h - labelH - pad * 2);
        const kids = (node.children || []).filter((c) => c.value > 0).sort((a, b) => b.value - a.value);
        const total = kids.reduce((a, b) => a + b.value, 0);
        if (!total || iw < 4 || ih < 4) return;
        // squarified strip layout
        let cx = ix, cy = iy, cw = iw, ch = ih;
        let i = 0;
        while (i < kids.length) {
          const horiz = cw >= ch;
          const stripLen = horiz ? cw : ch;
          const stripDepth = horiz ? ch : cw;
          const remaining = kids.slice(i).reduce((a, b) => a + b.value, 0);
          if (!remaining) break;
          // add to strip while aspect improves
          let strip = [];
          let stripSum = 0;
          let bestRatio = Infinity;
          while (i < kids.length) {
            const next = kids[i];
            const nextSum = stripSum + next.value;
            const stripArea = (nextSum / remaining) * stripLen * stripDepth;
            const stripWidth = stripArea / stripLen;
            const worst = Math.max(...[...strip, next].map((k) => {
              const a = (k.value / nextSum) * stripLen * stripWidth;
              const side = a / stripWidth;
              return Math.max(stripWidth / side, side / stripWidth);
            }));
            if (worst > bestRatio) break;
            bestRatio = worst;
            strip.push(next);
            stripSum = nextSum;
            i++;
            if (i >= kids.length) break;
            // recompute bestRatio with current strip
            const w2 = ((stripSum / remaining) * stripLen * stripDepth) / stripLen;
            bestRatio = Math.max(...strip.map((k) => {
              const a = (k.value / stripSum) * stripLen * w2;
              const side = a / w2;
              return Math.max(w2 / side, side / w2);
            }));
          }
          if (!strip.length) { strip = [kids[i]]; stripSum = kids[i].value; i++; }
          const stripWidth = ((stripSum / remaining) * stripLen * stripDepth) / stripLen;
          let off = 0;
          for (const k of strip) {
            const a = (k.value / stripSum) * stripLen * stripWidth;
            const side = a / stripWidth;
            if (horiz) place(k, cx + off, cy, side, stripWidth, depth + 1);
            else place(k, cx, cy + off, stripWidth, side, depth + 1);
            off += side;
          }
          if (horiz) { cy += stripWidth; ch -= stripWidth; }
          else { cx += stripWidth; cw -= stripWidth; }
          if (ch < 1 || cw < 1) break;
        }
      } else {
        cells.push({ ...node, x, y, w, h, depth, isContainer: false });
      }
    };
    place(tree, 0, 0, size.w, size.h, 0);
    return cells;
  }, [tree, size.w, size.h]);

  return (
    <div className="view-treemap">
      <div className="treemap-stage">
        <div className="treemap-toolbar">
          <Breadcrumbs path={root} onPick={(p) => setSelection({ ...selection, dir: p, file: null })} />
          <span style={{marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)'}}>
            {tree ? `${formatBytes(tree.value)} across ${layout.filter(c => !c.isContainer).length} files` : 'building…'}
          </span>
        </div>
        <div className="treemap-canvas" ref={canvasRef}>
          {layout.map((c, i) => {
            if (c.isContainer && c.depth === 0) return null;
            const langColor = LANG_COLORS[c.language] || '#aaa';
            const isFile = !c.isContainer;
            const tone = isFile ? 0.18 + Math.min(0.55, c.value / (tree?.value || 1) * 8) : 0;
            return (
              <div key={c.path + i}
                className="tm-cell"
                data-type={c.type}
                data-selected={selection.file === c.path}
                style={{
                  left: c.x, top: c.y, width: c.w, height: c.h,
                  background: isFile ? `color-mix(in oklch, ${langColor} ${tone * 100}%, var(--surface))` : 'var(--surface-2)',
                }}
                onClick={() => isFile ? setSelection({ ...selection, file: c.path }) : null}
                onDoubleClick={() => c.isContainer ? setSelection({ ...selection, dir: c.path, file: null }) : null}
                title={`${c.path} — ${formatBytes(c.value)}`}
              >
                {c.isContainer ? (
                  <>
                    <div className="tm-dir-label">
                      <FolderIcon />
                      <span>{c.name}</span>
                      <span className="sz">{formatBytes(c.value)}</span>
                    </div>
                  </>
                ) : c.w > 60 && c.h > 24 ? (
                  <>
                    <div className="tm-file-name">{c.name}</div>
                    <div className="tm-file-meta">{formatBytes(c.value)}</div>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <PreviewResizer />
      <Preview fs={fs} path={selection.file} />
    </div>
  );
}

// ============================================================
// 5. GRAPH (radial nodes/edges of folder structure)
// ============================================================
function GraphView({ fs, selection, setSelection }) {
  const center = selection.dir || '/';
  const [data, setData] = useS({ nodes: [], links: [] });

  useE(() => {
    let alive = true;
    (async () => {
      const nodes = []; const links = [];
      const centerStat = await fs.stat(center).catch(() => null);
      if (!centerStat) return;
      const centerNode = { ...centerStat, id: center, role: 'center' };
      nodes.push(centerNode);

      // children of center
      let children = [];
      try { children = await fs.list(center); } catch {}
      for (const c of children) {
        nodes.push({ ...c, id: c.path, role: 'child' });
        links.push({ source: center, target: c.path });
      }

      // parent + siblings (context)
      if (center !== '/') {
        const parent = window.FS.Path.dirname(center);
        const parentStat = await fs.stat(parent).catch(() => null);
        if (parentStat) {
          nodes.push({ ...parentStat, id: parent, role: 'parent' });
          links.push({ source: parent, target: center });
          let sibs = [];
          try { sibs = await fs.list(parent); } catch {}
          for (const s of sibs) {
            if (s.path === center) continue;
            nodes.push({ ...s, id: s.path, role: 'sibling' });
            links.push({ source: parent, target: s.path });
          }
        }
      }
      if (alive) setData({ nodes, links });
    })();
    return () => { alive = false; };
  }, [center]);

  const stageRef = useR(null);
  const svgRef = useR(null);
  const [size, setSize] = useS({ w: 800, h: 600 });
  React.useLayoutEffect(() => {
    if (!svgRef.current) return;
    const measure = () => {
      const r = svgRef.current.getBoundingClientRect();
      const w = Math.max(200, r.width);
      const h = Math.max(200, r.height);
      setSize((s) => (s.w === w && s.h === h) ? s : { w, h });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(svgRef.current);
    return () => ro.disconnect();
  }, []);

  // Deterministic radial layout
  const positioned = useM(() => {
    const cx = size.w / 2, cy = size.h / 2;
    const byId = {};
    const nodes = data.nodes.map((n) => ({ ...n }));
    nodes.forEach((n) => byId[n.id] = n);
    const centerN = byId[center];
    const parent = nodes.find((n) => n.role === 'parent');
    const children = nodes.filter((n) => n.role === 'child');
    const sibs = nodes.filter((n) => n.role === 'sibling');

    if (centerN) { centerN.x = cx; centerN.y = cy; centerN.r = 28; }
    if (parent) { parent.x = cx; parent.y = cy - 180; parent.r = 22; }

    const childR = Math.min(cx, cy) - 80;
    children.forEach((c, i) => {
      const ang = (i / Math.max(1, children.length)) * Math.PI * 2 - Math.PI / 2;
      c.x = cx + Math.cos(ang) * childR;
      c.y = cy + Math.sin(ang) * childR;
      c.r = c.type === 'directory' ? 18 : 14;
    });
    const sibR = 80;
    sibs.forEach((s, i) => {
      const ang = ((i + 0.5) / Math.max(1, sibs.length)) * Math.PI * 2 - Math.PI / 2;
      if (parent) {
        s.x = parent.x + Math.cos(ang) * sibR;
        s.y = parent.y + Math.sin(ang) * sibR;
      } else {
        s.x = cx + Math.cos(ang) * sibR;
        s.y = cy + Math.sin(ang) * sibR;
      }
      s.r = 10;
    });

    return { nodes, links: data.links.map((l) => ({ source: byId[l.source], target: byId[l.target] })).filter((l) => l.source && l.target) };
  }, [data, size.w, size.h, center]);

  return (
    <div className="view-graph">
      <div className="graph-stage" ref={stageRef}>
        <div className="graph-toolbar">
          <Breadcrumbs path={center} onPick={(p) => setSelection({ ...selection, dir: p, file: null })} />
          <span style={{marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)'}}>
            {data.nodes.length} nodes · click to drill
          </span>
        </div>
        <svg ref={svgRef} className="graph-svg" width="100%" height="100%" viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="xMidYMid meet">
          {positioned.links.map((l, i) => (
            <line key={i} className="graph-link"
              data-active={l.source.id === center || l.target.id === center}
              x1={l.source.x} y1={l.source.y} x2={l.target.x} y2={l.target.y} />
          ))}
          {positioned.nodes.map((n) => (
            <g key={n.id} className="graph-node" data-type={n.type} data-active={n.id === center}
              transform={`translate(${n.x},${n.y})`}
              onClick={() => {
                if (n.type === 'directory') setSelection({ ...selection, dir: n.id, file: null });
                else setSelection({ ...selection, file: n.id, dir: window.FS.Path.dirname(n.id) });
              }}>
              <circle className="graph-node-bg" r={n.r} />
              {n.type === 'directory' && (
                <text textAnchor="middle" dy={3} fontSize={10} fontFamily="var(--mono)"
                  fill={n.id === center ? 'var(--bg)' : 'var(--ink-2)'}>
                  {n.id === '/' ? '/' : '◗'}
                </text>
              )}
              <text className="graph-node-label" textAnchor="middle" dy={n.r + 12}>
                {n.name === '' ? '/' : (n.name.length > 16 ? n.name.slice(0, 14) + '…' : n.name)}
              </text>
            </g>
          ))}
        </svg>
        <div className="graph-legend">
          <div><b>center</b> — current location</div>
          <div><b>↑</b> parent · <b>○</b> sibling · <b>●</b> child</div>
          <div>click any node to recenter</div>
        </div>
      </div>
      <PreviewResizer />
      <Preview fs={fs} path={selection.file} />
    </div>
  );
}

Object.assign(window, { ColumnsView, TreeView, DualPaneView, TreemapView, GraphView });
