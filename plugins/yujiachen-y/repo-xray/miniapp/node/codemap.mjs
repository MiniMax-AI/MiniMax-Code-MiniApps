// @ts-check
/**
 * Code map: the HEAD tree laid out as nested regions, coloured by what history says about them.
 *
 * - size: files at HEAD ("what is the project made of") or modifications in the chosen range
 * - lenses: heat, bug share, owner, last change, knowledge loss, file type (all from one pass)
 * - co-change (logical coupling) between regions, using code-maat's default thresholds
 * - per-directory descriptions taken from the repository's own manifests and READMEs
 */

/** code-maat defaults: --max-changeset-size 30, --min-revs 5, --min-shared-revs 5, --min-coupling 30 */
export const COUPLE = Object.freeze({ maxChangeset: 30, minRevs: 5, minShared: 5, minDegree: 0.3 });
const RANGE_MONTHS = { 3: 3, 6: 6, 12: 12 };

export function minusMonths(sec, months) {
  const d = new Date(sec * 1000);
  d.setMonth(d.getMonth() - months);
  return Math.floor(d.getTime() / 1000);
}
const ym = (sec) => {
  const d = new Date(sec * 1000);
  return d.getFullYear() * 12 + d.getMonth();
};
const ymLabel = (n) => `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;

// ---------------------------------------------------------------------------
// Path classification
// ---------------------------------------------------------------------------
const TYPE_RULES = [
  ['config', /(^|\/)(cmakelists\.txt|requirements[^/]*\.txt|constraints\.txt|go\.(mod|sum|work)|codeowners)$/i],
  ['doc', /(^|\/)(readme|license|licence|changelog|changes|history|authors|contributing|notice|copying|code_of_conduct)([._-][\w.-]+)?$|\.(md|mdx|markdown|rst|txt|adoc|org|tex)$/i],
  ['ts', /\.(ts|tsx|mts|cts)$/i],
  ['js', /\.(js|jsx|mjs|cjs)$/i],
  ['py', /\.(py|pyi|pyx|ipynb)$/i],
  ['go', /\.go$/i],
  ['rs', /\.rs$/i],
  ['jvm', /\.(java|kt|kts|scala|groovy|clj|cljs|cljc)$/i],
  ['c', /\.(c|cc|cpp|cxx|h|hh|hpp|hxx|m|mm|cu|metal)$/i],
  ['swift', /\.swift$/i],
  ['rb', /\.(rb|rake|erb)$/i],
  ['php', /\.php$/i],
  ['dotnet', /\.(cs|fs|vb|razor|cshtml)$/i],
  ['style', /\.(css|scss|sass|less|styl|pcss)$/i],
  ['markup', /\.(html?|vue|svelte|astro|hbs|ejs|pug|jinja2?|j2|njk|liquid|twig|ftl|mustache|tmpl)$/i],
  ['shell', /\.(sh|bash|zsh|fish|ps1|psm1|bat|cmd|nsh|nsi)$/i],
  ['asset', /\.(png|jpe?g|gif|svg|webp|avif|heic|ico|icns|bmp|tiff?|woff2?|ttf|otf|eot|pfb|pfm|afm|bcmap|mp3|mp4|m4a|aac|flac|wav|ogg|webm|mov|pdf|docx?|xlsx?|pptx?|key|numbers|pages|zip|gz|tgz|bz2|xz|7z|rar|tar|dmg|pkg|deb|rpm|apk|ipa|jar|war|wasm|bin|exe|dll|so|dylib|node|pyc|class|psd|sketch|fig|ai|lottie)$/i],
  ['config', /\.(json|jsonc|json5|jsonl|ndjson|ya?ml|toml|ini|cfg|conf|properties|env|lock|xml|xsd|xsl|xslt|dtd|plist|csv|tsv|sql|graphql|gql|proto|thrift|tf|hcl|nix|gradle|cmake|mk|csproj|props|targets|sln|slnx)$|(^|\/)(dockerfile|makefile|procfile|gemfile|rakefile)$|(^|\/)\.[^/]+$/i],
];
export const CODE_TYPES = new Set(['ts', 'js', 'py', 'go', 'rs', 'jvm', 'c', 'swift', 'rb', 'php', 'dotnet', 'style', 'markup', 'shell']);
export function typeOf(path) {
  for (const [k, re] of TYPE_RULES) if (re.test(path)) return k;
  return 'other';
}
const TEST_SEG = /(^|\/)(test|tests|__tests__|spec|specs|e2e|testdata|__mocks__|fixtures?)(\/|$)/i;
const TEST_FILE = /[._-](test|spec)s?\.[a-z0-9]+$|^test_[^/]*\.py$/i;
export const isTestPath = (p) => TEST_SEG.test(p) || TEST_FILE.test(p.slice(p.lastIndexOf('/') + 1));
/** Bookkeeping that rides along with most changes: changelogs, release notes, lock files. */
const PROCESS = /(^|\/)(changelogs?|\.changeset|release-notes?)(\/|$)|(^|\/)(changelog|history|changes|news|releases?)(\.[a-z]+)?$|(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|cargo\.lock|go\.sum|poetry\.lock|gemfile\.lock|composer\.lock|uv\.lock|pdm\.lock)$/i;
export const isProcessPath = (p) => PROCESS.test(p);
const MANIFEST = /^(package\.json|cargo\.toml|go\.mod|pyproject\.toml|setup\.py|pom\.xml|build\.gradle(\.kts)?|composer\.json|gemfile|mix\.exs|pubspec\.yaml|deno\.jsonc?|.+\.csproj)$/i;

// ---------------------------------------------------------------------------
// HEAD index (cached per model)
// ---------------------------------------------------------------------------
function headIndex(model) {
  if (model._head) return model._head;
  const mk = (name, path, parent, file) => ({ name, path, parent, file, kids: new Map(), files: 0, code: 0, type: '', touches: 0 });
  const root = mk('', '', null, false);
  /** @type {Map<string, any>} */
  const dirs = new Map([['', root]]);
  /** @type {Map<string, any>} */
  const fileNodes = new Map();
  const pkgRoots = [];
  for (const t of model.tree) {
    const segs = t.path.split('/');
    let cur = root;
    for (let i = 0; i < segs.length; i++) {
      const file = i === segs.length - 1;
      const key = file ? segs[i] : `${segs[i]}/`;
      let k = cur.kids.get(key);
      if (!k) {
        k = mk(segs[i], file ? t.path : segs.slice(0, i + 1).join('/'), cur, file);
        cur.kids.set(key, k);
        if (!file) dirs.set(k.path, k);
      }
      cur = k;
    }
    cur.type = typeOf(t.path);
    cur.touches = model.pathCount[model.pathIdx.get(t.path) ?? -1] || 0;
    fileNodes.set(t.path, cur);
    const j = t.path.lastIndexOf('/');
    if (MANIFEST.test(t.path.slice(j + 1))) pkgRoots.push(j < 0 ? '' : t.path.slice(0, j));
  }
  const post = (n) => {
    if (n.file) {
      n.files = 1;
      n.code = CODE_TYPES.has(n.type) ? 1 : 0;
      return;
    }
    for (const k of n.kids.values()) {
      post(k);
      n.files += k.files;
      n.code += k.code;
    }
  };
  post(root);
  // Every historical path gets a "home": its HEAD file node, or the deepest directory that still exists.
  const P = model.paths.length;
  const home = new Array(P);
  const gone = new Uint8Array(P);
  for (let i = 0; i < P; i++) {
    const p = model.paths[i];
    const f = fileNodes.get(p);
    if (f) {
      home[i] = f;
      continue;
    }
    gone[i] = 1;
    let d = p;
    let n = null;
    while (!n) {
      const j = d.lastIndexOf('/');
      if (j < 0) {
        n = root;
        break;
      }
      d = d.slice(0, j);
      n = dirs.get(d) || null;
    }
    home[i] = n;
  }
  pkgRoots.sort((a, b) => b.length - a.length);
  const pkgOf = (p) => pkgRoots.find((r) => r === '' || p === r || p.startsWith(`${r}/`)) ?? '';
  model._head = { root, dirs, fileNodes, home, gone, pkgOf };
  return model._head;
}

function lastActivity(model, identity) {
  model._lastAct ??= {};
  if (model._lastAct[identity]) return model._lastAct[identity];
  const ident = model.ids[identity] || model.ids.merged;
  const arr = new Float64Array(ident.names.length);
  for (const c of model.commits) {
    if (c.merge) continue;
    const id = ident.idOf[c.a];
    if (c.ct > arr[id]) arr[id] = c.ct;
  }
  model._lastAct[identity] = arr;
  return arr;
}

/** "process" / "test" / "normal" for a co-change partner b of a. */
export function coKind(model, a, b) {
  if (isProcessPath(b)) return 'process';
  const H = headIndex(model);
  const ta = isTestPath(a);
  if (ta === isTestPath(b) || H.pkgOf(a) !== H.pkgOf(b)) return 'normal';
  return CODE_TYPES.has(typeOf(ta ? b : a)) ? 'test' : 'normal';
}

// ---------------------------------------------------------------------------
// Layout: adaptive expansion of the tree under the focus
// ---------------------------------------------------------------------------
/**
 * Children worth their own block are those ≥ 0.5% of the view; smaller ones fold into one "其他 N 项"
 * block. The focus opens first and shows all of its sizeable children (breadth first); then folders
 * bigger than an "average" block (total / 24) open largest-first while the block budget allows. A
 * split that does not fit is skipped, not the whole loop, so smaller folders can still open. A
 * folder that is a heap of tiny files stays whole.
 */
function layoutBlocks(fnode, weightOf, maxBlocks) {
  const total = weightOf(fnode);
  if (!(total > 0)) return [];
  const minKid = total * 0.005;
  const big = total / 24;
  const kidsOf = (n) => [...n.kids.values()].filter((k) => weightOf(k) > 0).sort((a, b) => weightOf(b) - weightOf(a) || b.touches - a.touches || (a.path < b.path ? -1 : 1));
  /** At most `cap` own blocks, plus one fold; `force` keeps `cap` children whatever their size. */
  const split = (n, cap, { force = false, focus = false } = {}) => {
    const kids = kidsOf(n);
    if (!kids.length) return null;
    const keep = [];
    let capped = false;
    for (const k of kids) {
      if (!force && keep.length && weightOf(k) < minKid) break;
      if (keep.length >= cap) {
        capped = true;
        break;
      }
      keep.push(k);
    }
    const rest = kids.slice(keep.length);
    if (rest.length === 1) keep.push(rest[0]);
    else if (rest.length) {
      const w = rest.reduce((s, k) => s + weightOf(k), 0);
      // A heap of tiny files stays whole: for the focus when nothing sizeable is in it (it then opens
      // forced), for any other folder when most of it would land in the fold anyway.
      if (!force && (focus ? w >= weightOf(n) * 0.85 && keep.length <= 1 : w >= weightOf(n) * 0.6)) return null;
      // A folder opens only when all of its sizeable children fit: a corner of it next to a big fold
      // says less than the folder's own name (and the user can always step into it).
      if (capped && !force && !focus) return null;
      keep.push({ other: true, parent: n, rest, w, path: n.path, kids: new Map(), file: false });
    }
    return keep;
  };
  // The focus itself always opens up, even when it is a heap of small files.
  let leaves = split(fnode, maxBlocks - 1, { focus: true }) || split(fnode, Math.max(4, Math.min(maxBlocks - 1, 24)), { force: true }) || [];
  const done = new Set();
  for (;;) {
    let best = null;
    for (const l of leaves) if (!l.other && !l.file && !done.has(l) && weightOf(l) > big && (!best || weightOf(l) > weightOf(best))) best = l;
    if (!best) break;
    done.add(best);
    const room = maxBlocks - leaves.length + 1; // blocks this split may use in place of `best`
    const kids = room >= 2 ? split(best, room - 1) : null;
    if (!kids || kids.length > room) continue;
    leaves = leaves.flatMap((l) => (l === best ? kids : [l]));
  }
  return leaves;
}

const walkFiles = (n, fn) => {
  if (n.file) return fn(n);
  for (const k of n.kids.values()) walkFiles(k, fn);
};
const topN = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const sumOf = (map) => {
  let s = 0;
  for (const v of map.values()) s += v;
  return s;
};

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------
/**
 * @param {any} model
 * @param {{ focus?: string, size?: string, range?: string, since?: number|null, identity?: string,
 *   maxBlocks?: number, lite?: boolean, risk?: Set<string>, descs?: Record<string, any>, now?: number }} o
 */
export function mapView(model, o = {}) {
  const H = headIndex(model);
  const focus = String(o.focus || '').replace(/^\/+|\/+$/g, '');
  const fnode = H.dirs.get(focus);
  if (!fnode) return null;
  const lite = Boolean(o.lite);
  const size = o.size === 'churn' ? 'churn' : 'files';
  const now = o.now ?? Math.floor(Date.now() / 1000);
  const commits = model.commits;
  let minCt = Infinity;
  let maxCt = -Infinity;
  for (const c of commits) {
    if (c.ct < minCt) minCt = c.ct;
    if (c.ct > maxCt) maxCt = c.ct;
  }

  // Range: same anchoring as the report window (now, or the last commit for dormant repositories).
  let since = -Infinity;
  let range = 'all';
  if (o.since !== undefined) {
    since = o.since ?? -Infinity;
    range = 'custom';
  } else if (RANGE_MONTHS[o.range]) {
    range = String(o.range);
    since = minusMonths(now, RANGE_MONTHS[o.range]);
    if (maxCt < since) since = minusMonths(maxCt, RANGE_MONTHS[o.range]);
  }
  const m0 = ym(Number.isFinite(since) ? Math.max(since, minCt) : minCt);
  const M = Math.max(1, ym(maxCt) - m0 + 1);

  // Modifications per historical path inside the range.
  const P = model.paths.length;
  const pc = new Int32Array(P);
  const pb = new Int32Array(P);
  for (const c of commits) {
    if (c.ct < since) continue;
    const f = c.files;
    for (let i = 0; i < f.length; i += 2) {
      pc[f[i]]++;
      if (c.fix) pb[f[i]]++;
    }
  }

  // Layout weights.
  let weightOf;
  if (size === 'churn') {
    const w = new Map();
    for (let i = 0; i < P; i++) {
      if (!pc[i]) continue;
      const chain = [];
      let x = H.home[i];
      while (x && x !== fnode) {
        chain.push(x);
        x = x.parent;
      }
      if (!x) continue;
      chain.push(fnode);
      for (const y of chain) w.set(y, (w.get(y) || 0) + pc[i]);
    }
    weightOf = (n) => (n.other ? n.w : w.get(n) || 0);
  } else weightOf = (n) => (n.other ? n.w : n.files);

  const raw = layoutBlocks(fnode, weightOf, Math.max(4, Math.min(80, o.maxBlocks || 44)));
  const B = raw.length;
  const F = B; // the focus as a whole
  const DEL = -2;
  const NONE = -1;
  const mark = new Map();
  raw.forEach((l, i) => {
    if (l.other) for (const r of l.rest) mark.set(r, i);
    else mark.set(l, i);
  });

  // Region of every historical path: a block, the deleted-in-focus bucket, or an outside region
  // (the focus' ancestors' siblings, e.g. focus packages/ui -> packages/daemon, changelogs).
  const fSegs = focus ? focus.split('/') : [];
  /** @type {{ path: string, node: any }[]} */
  const outs = [];
  const outIdx = new Map();
  const reg = new Int32Array(P).fill(-9);
  const regionOf = (i) => {
    let r = reg[i];
    if (r !== -9) return r;
    r = NONE;
    let inside = false;
    for (let x = H.home[i]; x; x = x.parent) {
      const b = mark.get(x);
      if (b !== undefined) {
        r = b;
        inside = true;
        break;
      }
      if (x === fnode) {
        r = H.gone[i] ? DEL : NONE;
        inside = true;
        break;
      }
    }
    if (!inside && !lite) {
      const s = model.paths[i].split('/');
      let k = 0;
      while (k < fSegs.length && k < s.length - 1 && s[k] === fSegs[k]) k++;
      const key = s.slice(0, k + 1).join('/');
      let id = outIdx.get(key);
      if (id === undefined) {
        const node = H.dirs.get(key) || H.fileNodes.get(key);
        id = node ? B + 1 + outs.length : NONE;
        if (node) outs.push({ path: key, node });
        outIdx.set(key, id);
      }
      r = id;
    }
    reg[i] = r;
    return r;
  };

  // One pass over the whole history.
  const R = B + 1;
  const ident = model.ids[o.identity] || model.ids.merged;
  const churn = new Int32Array(R);
  const bug = new Int32Array(R);
  const last = new Float64Array(R);
  const mC = lite ? [] : Array.from({ length: R }, () => new Int32Array(M));
  const mB = lite ? [] : Array.from({ length: R }, () => new Int32Array(M));
  const mO = lite ? [] : Array.from({ length: R }, () => new Map());
  const own = lite ? [] : Array.from({ length: R }, () => new Map());
  const all = lite ? [] : Array.from({ length: R }, () => new Map());
  const revs = new Map();
  const pairMap = new Map();
  const BIG = 2 ** 20;
  let delChurn = 0;
  let delBug = 0;
  let focusCommits = 0;
  for (const c of commits) {
    const f = c.files;
    if (!f.length) continue;
    const inRange = c.ct >= since;
    const mi = inRange && !lite ? ym(c.ct) - m0 : -1;
    const who = ident.idOf[c.a];
    const human = !c.merge && !ident.bot[who];
    const touched = new Set();
    let inFocus = false;
    for (let i = 0; i < f.length; i += 2) {
      const r = regionOf(f[i]);
      if (r === NONE) continue;
      const ins = r >= 0 && r < B;
      if (ins || r === DEL) inFocus = true;
      if (inRange && (ins || r === DEL)) {
        churn[F]++;
        if (c.fix) bug[F]++;
        if (ins) {
          churn[r]++;
          if (c.fix) bug[r]++;
        } else {
          delChurn++;
          if (c.fix) delBug++;
        }
        if (mi >= 0) {
          mC[F][mi]++;
          if (c.fix) mB[F][mi]++;
          if (ins) {
            mC[r][mi]++;
            if (c.fix) mB[r][mi]++;
          }
        }
      }
      if (r !== DEL) touched.add(r);
    }
    if (inFocus) {
      touched.add(F);
      if (inRange) focusCommits++;
    }
    for (const r of touched) {
      if (r > F) continue;
      if (c.ct > last[r]) last[r] = c.ct;
      if (lite || !human) continue;
      all[r].set(who, (all[r].get(who) || 0) + 1);
      if (!inRange) continue;
      own[r].set(who, (own[r].get(who) || 0) + 1);
      let mm = mO[r].get(mi);
      if (!mm) mO[r].set(mi, (mm = new Map()));
      mm.set(who, (mm.get(who) || 0) + 1);
    }
    if (lite || !inRange || c.merge || f.length / 2 > COUPLE.maxChangeset || !touched.size) continue;
    const arr = [...touched];
    for (const r of arr) revs.set(r, (revs.get(r) || 0) + 1);
    for (let x = 0; x < arr.length; x++) {
      for (let y = x + 1; y < arr.length; y++) {
        const a = Math.min(arr[x], arr[y]);
        const b = Math.max(arr[x], arr[y]);
        if (a > F || b === F) continue; // outside-outside, and block-inside-focus, carry no signal
        const k = a * BIG + b;
        pairMap.set(k, (pairMap.get(k) || 0) + 1);
      }
    }
  }

  // Per-block static facts from the HEAD tree.
  const risk = o.risk || new Set();
  const descs = o.descs || {};
  const facts = raw.map((l) => {
    const roots = l.other ? l.rest : [l];
    const types = new Map();
    let files = 0;
    let code = 0;
    let riskN = 0;
    for (const n of roots) {
      files += n.files;
      code += n.code;
      if (lite && !risk.size) continue;
      walkFiles(n, (fnn) => {
        if (!lite) types.set(fnn.type, (types.get(fnn.type) || 0) + 1);
        if (risk.has(fnn.path)) riskN++;
      });
    }
    return { files, code, types, risk: riskN };
  });
  const groupOf = (n) => {
    if (n === fnode) return '';
    let x = n;
    while (x.parent && x.parent !== fnode) x = x.parent;
    return x.file ? '' : x.path;
  };
  const firstFile = (n) => {
    let f = null;
    walkFiles(n, (x) => {
      f ??= x;
    });
    return f;
  };

  const blocks = raw.map((l, i) => {
    const single = !l.other && !l.file && l.files === 1 ? firstFile(l) : null;
    const node = l.other ? l.parent : single || l;
    const kind = l.other ? 'other' : node.file ? 'file' : 'dir';
    const b = {
      path: node.path,
      name: l.other ? `其他 ${l.rest.length} 项` : node.name,
      kind,
      group: groupOf(l.other ? l.parent : l),
      zoom: kind === 'dir' ? node.path : kind === 'other' && l.parent !== fnode ? l.parent.path : null,
      files: facts[i].files,
      churn: churn[i],
      bug: bug[i],
      risk: facts[i].risk,
    };
    if (l.other) b.items = l.rest.slice(0, 12).map((n) => [n.path, n.file ? 'file' : 'dir', n.files]);
    return b;
  });

  if (lite) {
    return { focus, size, since: Number.isFinite(since) ? since : null, totals: { files: fnode.files, churn: churn[F], bug: bug[F], delChurn }, blocks };
  }

  // ---- full view: owners, loss, monthly series, co-change -----------------
  const lastAct = lastActivity(model, o.identity || 'merged');
  const cutoff = minusMonths(now, 3);
  const aIdx = new Map();
  const authors = [];
  const A = (id) => {
    let k = aIdx.get(id);
    if (k === undefined) {
      k = authors.length;
      authors.push(ident.names[id]);
      aIdx.set(id, k);
    }
    return k;
  };
  const regPath = (r) => (r < B ? blocks[r].path : r === F ? focus : outs[r - B - 1].path);
  const regCode = (r) => {
    if (r < B) return facts[r].files ? facts[r].code / facts[r].files : 0;
    const n = r === F ? fnode : outs[r - B - 1].node;
    return n.files ? n.code / n.files : 0;
  };

  // Process regions: name-based (changelogs, lock files) or statistically "rides along with everything".
  // Outside regions only pair with in-view regions, so their bar is measured against in-view regions.
  let eligibleIn = 0;
  let eligibleAll = 0;
  for (const [r, n] of revs) {
    if (r === F || n < COUPLE.minRevs) continue;
    eligibleAll++;
    if (r < B) eligibleIn++;
  }
  const fans = new Map();
  for (const [k, n] of pairMap) {
    const a = Math.floor(k / BIG);
    const b = k % BIG;
    for (const [x, y] of [[a, b], [b, a]]) {
      if (x === F) continue;
      const rx = revs.get(x) || 0;
      if (rx >= COUPLE.minRevs && n / rx >= 0.5) fans.set(y, (fans.get(y) || 0) + 1);
    }
  }
  const process = new Set();
  for (const r of revs.keys()) {
    if (r === F) continue;
    const bar = Math.max(3, Math.ceil((r < B ? eligibleAll : eligibleIn) * 0.4));
    const statistical = (fans.get(r) || 0) >= bar && regCode(r) < 0.5;
    if (statistical || isProcessPath(regPath(r))) process.add(r);
  }
  const testOf = (r) => isTestPath(regPath(r));
  // "测试同步": a test region and a *code* region of the same package (docs next to tests are a real relation).
  const kindOf = (x, y) => {
    if (process.has(y)) return 'process';
    const tx = testOf(x);
    if (tx === testOf(y) || H.pkgOf(regPath(x)) !== H.pkgOf(regPath(y))) return 'normal';
    return regCode(tx ? y : x) >= 0.5 ? 'test' : 'normal';
  };

  const coupled = new Map();
  for (const [k, n] of pairMap) {
    if (n < COUPLE.minShared) continue;
    const a = Math.floor(k / BIG);
    const b = k % BIG;
    for (const [x, y] of [[a, b], [b, a]]) {
      if (x > F || (x === F && y < F)) continue;
      const rx = revs.get(x) || 0;
      if (rx < COUPLE.minRevs || n / rx < COUPLE.minDegree) continue;
      if (!coupled.has(x)) coupled.set(x, []);
      coupled.get(x).push({ y, n, d: n / rx });
    }
  }
  const coupleOut = (x) => {
    const list = (coupled.get(x) || []).sort((p, q) => q.d - p.d || q.n - p.n);
    const normal = list.filter((e) => !process.has(e.y)).slice(0, 8);
    return {
      couple: normal.map((e) => ({
        path: regPath(e.y),
        block: e.y < B ? e.y : -1,
        target: e.y < B ? blocks[e.y].kind : outs[e.y - B - 1]?.node.file ? 'file' : 'dir',
        degree: Math.round(e.d * 1000) / 1000,
        shared: e.n,
        kind: kindOf(x, e.y),
      })),
      processWith: list.filter((e) => process.has(e.y)).slice(0, 4).map((e) => ({ path: regPath(e.y), degree: Math.round(e.d * 100) / 100 })),
      revs: revs.get(x) || 0,
    };
  };

  // Top files inside the range per region.
  const tops = Array.from({ length: R }, () => []);
  for (let i = 0; i < P; i++) {
    if (!pc[i]) continue;
    const r = regionOf(i);
    if (r === NONE || r > F) continue;
    const row = [model.paths[i], pc[i], pb[i], H.gone[i] ? 0 : 1];
    if (r !== DEL) tops[r].push(row);
    tops[F].push(row);
  }

  const regionOut = (r, typesMap) => {
    const ownSum = sumOf(own[r]);
    const allSum = sumOf(all[r]);
    let lost = 0;
    const lostBy = new Map();
    for (const [id, n] of all[r]) if (lastAct[id] < cutoff) {
      lost += n;
      lostBy.set(id, n);
    }
    const mo = new Array(M).fill(-1);
    for (const [mi, mm] of mO[r]) {
      let best = -1;
      let bn = 0;
      for (const [id, n] of mm) if (n > bn) {
        bn = n;
        best = id;
      }
      if (best >= 0) mo[mi] = A(best);
    }
    const types = [...typesMap.entries()].sort((a, b) => b[1] - a[1]);
    return {
      last: last[r] || null,
      owners: topN(own[r], 5).map(([id, n]) => [A(id), n]),
      ownerSum: ownSum,
      loss: allSum ? Math.round((lost / allSum) * 1000) / 1000 : null,
      lossTop: topN(lostBy, 2).map(([id]) => A(id)),
      types,
      top: tops[r].sort((a, b) => b[1] - a[1] || b[2] - a[2]).slice(0, 5),
      m: Array.from(mC[r]),
      mb: Array.from(mB[r]),
      mo,
      ...coupleOut(r),
      test: testOf(r),
      process: process.has(r),
    };
  };

  blocks.forEach((b, i) => {
    Object.assign(b, regionOut(i, facts[i].types));
    b.code = facts[i].files ? Math.round((facts[i].code / facts[i].files) * 100) / 100 : 0;
    b.desc = b.kind === 'dir' ? descs[b.path] || null : null;
  });
  const focusTypes = new Map();
  for (const f of facts) for (const [k, n] of f.types) focusTypes.set(k, (focusTypes.get(k) || 0) + n);
  const focusInfo = {
    path: focus,
    name: focus ? fnode.name : '',
    kind: 'dir',
    files: fnode.files,
    churn: churn[F],
    bug: bug[F],
    risk: facts.reduce((s, f) => s + f.risk, 0),
    code: fnode.files ? Math.round((fnode.code / fnode.files) * 100) / 100 : 0,
    desc: descs[focus] || null,
    ...regionOut(F, focusTypes),
  };

  // Strongest relations between blocks of this view.
  const pairs = [];
  for (const [k, n] of pairMap) {
    const a = Math.floor(k / BIG);
    const b = k % BIG;
    if (a >= B || b >= B || n < COUPLE.minShared || process.has(a) || process.has(b)) continue;
    const da = n / (revs.get(a) || Infinity);
    const db = n / (revs.get(b) || Infinity);
    const [from, to, d] = da >= db ? [a, b, da] : [b, a, db];
    if ((revs.get(from) || 0) < COUPLE.minRevs || d < COUPLE.minDegree) continue;
    pairs.push({ from, to, degree: Math.round(d * 1000) / 1000, shared: n, kind: kindOf(from, to) });
  }
  pairs.sort((p, q) => q.degree - p.degree || q.shared - p.shared);

  return {
    focus,
    size,
    range,
    since: Number.isFinite(since) ? since : null,
    // Where the first frame really starts: the range start, or the first commit when that is later.
    start: Number.isFinite(minCt) ? (Number.isFinite(since) ? Math.max(since, minCt) : minCt) : null,
    latest: maxCt,
    cutoff,
    months: Array.from({ length: M }, (_, i) => ymLabel(m0 + i)),
    totals: { files: fnode.files, churn: churn[F], bug: bug[F], delChurn, delBug, commits: focusCommits },
    couple: COUPLE,
    process: [...process].map(regPath).slice(0, 6),
    authors,
    focusInfo,
    blocks,
    pairs: pairs.slice(0, 8),
  };
}

// ---------------------------------------------------------------------------
// Directory descriptions from the repository's own files
// ---------------------------------------------------------------------------
const DESC_NAME = /^(package\.json|plugin\.json|cargo\.toml|pyproject\.toml|skill\.md|readme(\.(md|markdown|rst|txt))?)$/i;
const DESC_SKIP = /(^|\/)(node_modules|vendor|dist|build|out|target|coverage|__pycache__|\.venv|venv|fixtures?|testdata|__tests__)\//;

/** README / manifest files that may describe a directory (depth ≤ 4), shallow first, so the cap drops the deepest. */
export function pickDescFiles(tree, { maxDepth = 4, limit = 600 } = {}) {
  const out = [];
  for (const t of tree) {
    if (DESC_SKIP.test(t.path)) continue;
    const j = t.path.lastIndexOf('/');
    const base = t.path.slice(j + 1);
    if (!DESC_NAME.test(base)) continue;
    let dir = j < 0 ? '' : t.path.slice(0, j);
    if (dir === '.claude-plugin') dir = '';
    else dir = dir.replace(/\/\.claude-plugin$/, '');
    const depth = dir ? dir.split('/').length : 0;
    if (depth > maxDepth) continue;
    const lower = base.toLowerCase();
    const rank = /^(package\.json|plugin\.json|cargo\.toml|pyproject\.toml)$/.test(lower) ? 0 : lower === 'skill.md' ? 1 : 2;
    out.push({ path: t.path, oid: t.oid, dir, rank, depth });
  }
  out.sort((a, b) => a.depth - b.depth || a.rank - b.rank);
  return out.slice(0, limit);
}

const JUNK = /^(todo|tbd|wip|n\/?a|none|description|test|\.\.\.|-)\.?$/i;
function cleanText(s) {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$|[，。,.!?])/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
function clipText(s, n = 160) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  // Prefer a full sentence; fall back to a clause, then to an ellipsis.
  for (const marks of [['。', '. ', '！', '？'], ['；', '; ']]) {
    const p = Math.max(...marks.map((m) => cut.lastIndexOf(m)));
    if (p > n * 0.25) return cut.slice(0, p + 1).trim();
  }
  return `${cut.trimEnd()}…`;
}
function skillDesc(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const lines = m[1].split(/\r?\n/);
  const i = lines.findIndex((l) => /^description\s*:/.test(l));
  if (i < 0) return null;
  let v = lines[i].replace(/^description\s*:\s*/, '').trim();
  if (!v || /^[|>][-+]?$/.test(v)) {
    const body = [];
    for (let j = i + 1; j < lines.length && (/^\s+\S/.test(lines[j]) || !lines[j].trim()); j++) if (lines[j].trim()) body.push(lines[j].trim());
    v = body.join(' ');
  }
  return v.replace(/^["']|["']$/g, '');
}
function readmeParagraph(text) {
  const lines = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').split(/\r?\n/);
  const para = [];
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^(```|~~~)/.test(l)) {
      fence = !fence;
      if (para.length) break;
      continue;
    }
    if (fence) continue;
    if (!l) {
      if (para.length) break;
      continue;
    }
    const next = (lines[i + 1] || '').trim();
    const underline = /^(=+|-+|~+)$/.test(next) && next.length >= 3;
    const skip = underline || /^(#|!\[|<|\||>|[-*+]\s|\d+[.)]\s|={3,}|-{3,}|\[!\[|\[[^\]]*\]:)/.test(l) || /^\[[^\]]+\]\([^)]*\)$/.test(l);
    if (skip) {
      if (para.length) break;
      if (underline) i++;
      continue;
    }
    para.push(l);
    if (para.join(' ').length > 400) break;
  }
  return para.join(' ');
}
function extractDesc(path, text) {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  let d = null;
  try {
    if (base === 'package.json' || base === 'plugin.json') d = JSON.parse(text)?.description;
    else if (base === 'cargo.toml' || base === 'pyproject.toml') d = text.match(/^\s*description\s*=\s*(?:"([^"\n]*)"|'([^'\n]*)')/m)?.slice(1).find(Boolean);
    else if (base === 'skill.md') d = skillDesc(text);
    else d = readmeParagraph(text);
  } catch {
    return null;
  }
  if (typeof d !== 'string') return null;
  d = cleanText(d);
  if (d.length < 4 || JUNK.test(d)) return null;
  return clipText(d);
}

/** @returns {Record<string, { text: string, source: string }>} dir -> description */
export function buildDescs(files, blobs) {
  const best = new Map();
  for (const f of files) {
    const prev = best.get(f.dir);
    if (prev && prev.rank <= f.rank) continue;
    const text = blobs.get(f.oid);
    if (!text) continue;
    const d = extractDesc(f.path, text);
    if (!d) continue;
    // A one-word manifest description ("Workspace") loses to any README / SKILL.md sentence.
    const rank = !/\s/.test(d) && d.length <= 16 ? 3 : f.rank;
    if (prev && prev.rank <= rank) continue;
    best.set(f.dir, { text: d, source: f.path.slice(f.path.lastIndexOf('/') + 1), rank });
  }
  return Object.fromEntries([...best].map(([k, v]) => [k, { text: v.text, source: v.source }]));
}
