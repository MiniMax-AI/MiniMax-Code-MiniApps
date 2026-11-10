// Minimal, safe Markdown renderer: everything is HTML-escaped first, then a small set of
// constructs is turned into elements. Links only allow http(s) and mailto.

const escapeHtml = (text) =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function inline(text) {
  const codes = [];
  let out = escapeHtml(text).replace(/`([^`\n]+)`/g, (_, code) => {
    codes.push(`<code>${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out
    .replace(/\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, (_, label, href) => {
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    })
    .replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+)/g, (_, pre, href) => {
      return `${pre}<a href="${href}" target="_blank" rel="noopener noreferrer">${href}</a>`;
    })
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
    .replace(/(^|\s)(@[^\s@，。,.!?！？:：]{1,24})/g, '$1<span class="mention">$2</span>');
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

function table(lines) {
  const cells = (line) =>
    line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim());
  const head = cells(lines[0]);
  const body = lines.slice(2).map(cells);
  return (
    '<div class="md-table"><table><thead><tr>' +
    head.map((cell) => `<th scope="col">${inline(cell)}</th>`).join('') +
    '</tr></thead><tbody>' +
    body.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('') +
    '</tbody></table></div>'
  );
}

export function renderMarkdown(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^```\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      const body = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i += 1;
      const lang = fence[1] ? ` data-lang="${escapeHtml(fence[1])}"` : '';
      html.push(`<pre${lang}><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(6, heading[1].length + 2);
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }
    if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(line)) {
      html.push('<hr>');
      i += 1;
      continue;
    }
    if (/^\|.*\|\s*$/.test(line) && /^\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      const block = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) block.push(lines[i++]);
      html.push(table(block));
      continue;
    }
    if (/^>\s?/.test(line)) {
      const block = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) block.push(lines[i++].replace(/^>\s?/, ''));
      html.push(`<blockquote>${renderMarkdown(block.join('\n'))}</blockquote>`);
      continue;
    }
    const listMatch = /^(\s*)([-*+]|\d+[.)])\s+/.exec(line);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[2]);
      const items = [];
      while (i < lines.length) {
        const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (!item) {
          if (/^\s{2,}\S/.test(lines[i]) && items.length) {
            items[items.length - 1] += `\n${lines[i].trim()}`;
            i += 1;
            continue;
          }
          break;
        }
        items.push(item[3]);
        i += 1;
      }
      const tag = ordered ? 'ol' : 'ul';
      html.push(
        `<${tag}>${items
          .map((item) => {
            const task = /^\[([ xX])\]\s+(.*)$/s.exec(item);
            if (task) {
              const done = task[1] !== ' ';
              return `<li class="task"><span aria-hidden="true">${done ? '☑' : '☐'}</span> ${inline(task[2]).replace(/\n/g, '<br>')}</li>`;
            }
            return `<li>${inline(item).replace(/\n/g, '<br>')}</li>`;
          })
          .join('')}</${tag}>`,
      );
      continue;
    }
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(```|#{1,6}\s|>\s?|\s*([-*+]|\d+[.)])\s+|\|.*\|\s*$)/.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    if (para.length === 0) {
      para.push(lines[i++]);
    }
    html.push(`<p>${para.map(inline).join('<br>')}</p>`);
  }
  return html.join('');
}

export { escapeHtml };
