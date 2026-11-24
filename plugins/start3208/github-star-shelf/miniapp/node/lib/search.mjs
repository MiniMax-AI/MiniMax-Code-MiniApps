/** 在名称/简介、README、备注里搜索；多个关键词是「且」 */
const WEIGHT = { name: 5, notes: 4, readme: 2 };

export function parseTerms(q) {
  return String(q ?? '')
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((t) => t.slice(0, 60));
}

function cleanForSnippet(md) {
  return md
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`*_>#|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mergeRanges(ranges) {
  const out = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

export function snippetOf(text, terms, radius = 70) {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return null;
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + radius + 24);
  const shown = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
  const lo = shown.toLowerCase();
  const ranges = [];
  for (const t of terms) {
    let i = 0;
    while ((i = lo.indexOf(t, i)) >= 0 && ranges.length < 16) {
      ranges.push([i, i + t.length]);
      i += t.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  return { text: shown, ranges: mergeRanges(ranges) };
}

const starKey = (p) => Date.parse(p.starredAt || p.addedAt || 0) || 0;
const SORTERS = {
  starred: (a, b) => starKey(b) - starKey(a) || b.stars - a.stars,
  stars: (a, b) => b.stars - a.stars,
  pushed: (a, b) => String(b.pushedAt || '').localeCompare(String(a.pushedAt || '')),
  name: (a, b) => a.fullName.localeCompare(b.fullName),
  recent: (a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')),
};

export async function searchProjects(store, options = {}) {
  const terms = parseTerms(options.q);
  const scopes = {
    name: options.scopes?.name !== false,
    readme: options.scopes?.readme !== false,
    notes: options.scopes?.notes !== false,
  };
  let list = Object.values(store.state.projects);
  if (options.collection && options.collection !== 'all') {
    list = list.filter((p) => p.collections.includes(options.collection));
  }

  const langCount = new Map();
  for (const p of list) {
    const lang = p.language || '';
    if (lang) langCount.set(lang, (langCount.get(lang) || 0) + 1);
  }
  const languages = [...langCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);

  if (options.language) list = list.filter((p) => (p.language || '') === options.language);
  const explained = (p) => Boolean(p.explain?.cloud || p.explain?.local);
  if (options.status === 'explained') list = list.filter(explained);
  else if (options.status === 'unexplained') list = list.filter((p) => !explained(p));
  else if (options.status === 'noted') list = list.filter((p) => p.notes.length > 0);

  const sorter = SORTERS[options.sort] || SORTERS.starred;
  let hits;
  if (terms.length === 0) {
    hits = list.slice().sort(sorter).map((p) => ({ p, score: 0, match: null }));
  } else {
    if (scopes.readme) await store.ensureReadmeIndex();
    hits = [];
    for (const p of list) {
      const nameText = (p.fullName + ' ' + (p.description || '') + ' ' + (p.topics || []).join(' ')).toLowerCase();
      const fullLower = p.fullName.toLowerCase();
      const notesText = p.notes.map((n) => n.text).join('\n').toLowerCase();
      const readmeText = scopes.readme ? store.readmeIndex.get(p.key) || '' : '';
      let score = 0;
      const where = { name: false, notes: false, readme: false };
      let ok = true;
      for (const t of terms) {
        let best = 0;
        if (scopes.name && nameText.includes(t)) {
          best = Math.max(best, fullLower.includes(t) ? WEIGHT.name + 3 : WEIGHT.name);
          where.name = true;
        }
        if (scopes.notes && notesText.includes(t)) {
          best = Math.max(best, WEIGHT.notes);
          where.notes = true;
        }
        if (readmeText && readmeText.includes(t)) {
          best = Math.max(best, WEIGHT.readme);
          where.readme = true;
        }
        if (!best) {
          ok = false;
          break;
        }
        score += best;
      }
      if (ok) hits.push({ p, score, match: { where } });
    }
    hits.sort((a, b) => b.score - a.score || sorter(a.p, b.p));
  }

  const total = hits.length;
  const offset = Math.max(0, options.offset | 0);
  const limit = Math.min(200, Math.max(1, options.limit | 0 || 50));
  const page = hits.slice(offset, offset + limit);

  if (terms.length) {
    for (const h of page) {
      const where = h.match.where;
      let snippet = null;
      if (where.notes) {
        const text = h.p.notes.map((n) => n.text).join(' / ');
        const s = snippetOf(text, terms);
        if (s) snippet = { scope: 'notes', ...s };
      }
      if (!snippet && where.readme) {
        const raw = await store.readReadme(h.p.key);
        if (raw) {
          const s = snippetOf(cleanForSnippet(raw), terms);
          if (s) snippet = { scope: 'readme', ...s };
        }
      }
      h.match.snippet = snippet;
    }
  }
  return { total, items: page, languages, terms };
}
