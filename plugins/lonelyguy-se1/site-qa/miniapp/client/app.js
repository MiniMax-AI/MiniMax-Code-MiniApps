const rootInput = document.querySelector('#root');
const siteMenu = document.querySelector('#site-menu');
const siteTrigger = document.querySelector('#site-trigger');
const siteLabel = document.querySelector('#site-label');
const siteList = document.querySelector('#site-list');
const statusNode = document.querySelector('#status');
const findingsNode = document.querySelector('#findings');
const emptyNode = document.querySelector('#empty');
const summaryCards = document.querySelector('#summary-cards');
const filtersNode = document.querySelector('#filters');
const metaNode = document.querySelector('#meta');
const scanButton = document.querySelector('#scan');
const summaryButton = document.querySelector('#summary');

/** @type {any} */
let report = null;
let filter = 'all';
/** @type {{ path: string, label: string, reason: string }[]} */
let sites = [];
/** @type {string} */
let selectedSite = '';
let checking = false;

document.querySelectorAll('input[name="filter"]').forEach((input) => {
  input.addEventListener('change', () => {
    if (input.checked) {
      filter = input.value;
      renderFindings();
    }
  });
});

scanButton.addEventListener('click', () => void checkSite());
summaryButton.addEventListener('click', () => void askAgentToFix());
siteTrigger.addEventListener('click', () => {
  if (siteTrigger.getAttribute('aria-expanded') === 'true') closeSiteMenu();
  else openSiteMenu();
});
document.addEventListener('click', (event) => {
  if (!siteMenu.contains(event.target)) closeSiteMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeSiteMenu();
});
rootInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void checkSite();
  }
});

void bootstrap();

async function bootstrap() {
  const state = await api('/api/state');
  if (state?.root) rootInput.value = state.root;
  if (state?.report) {
    report = state.report;
    paintReport();
  }
  const folder = await detectWorkspace();
  if (folder) {
    if (!rootInput.value) rootInput.value = folder;
    await loadSites(folder);
    if (!report && rootInput.value.trim()) {
      setStatus(`Project ready. Checking ${rootInput.value}...`, 'ok');
      await checkSite({ quietStart: true });
      return;
    }
    setStatus('Project ready. Pick a site root or press Check site.', 'ok');
  } else if (!rootInput.value) {
    setStatus('Open Site QA from a project chat, or paste a site path.', '');
  }
}

async function detectWorkspace() {
  const agent = window.mcode?.miniapp?.agent;
  if (!agent || typeof agent.session !== 'function') return '';
  try {
    const session = await Promise.race([
      agent.session(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
    ]);
    if (session && typeof session.workspaceDir === 'string' && session.workspaceDir.trim()) {
      return session.workspaceDir.trim();
    }
  } catch {
    // Host may deny session.read or the Mini App may be open outside a chat.
  }
  return '';
}

async function loadSites(folder) {
  const payload = await api('/api/sites', { path: folder });
  if (!payload?.sites) return;
  sites = payload.sites;
  renderSiteMenu();

  const preferred = payload.sites.find((site) => /public|dist|out|docs|www|_site/i.test(site.label))
    || payload.sites.find((site) => site.label !== 'Workspace root')
    || payload.sites[0];
  if (preferred && (!rootInput.value || rootInput.value === folder || rootInput.value === preferred.path)) {
    chooseSite(preferred.path, false);
  } else if (rootInput.value) {
    const match = sites.find((site) => site.path === rootInput.value);
    if (match) chooseSite(match.path, false);
    else {
      selectedSite = '';
      siteLabel.textContent = sites.length
        ? `${sites.length} suggested site root${sites.length === 1 ? '' : 's'}`
        : 'No site folders found';
    }
  }
}

function renderSiteMenu() {
  siteList.replaceChildren();
  if (sites.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'menu-option';
    empty.textContent = 'No site folders found';
    siteList.append(empty);
    return;
  }
  for (const site of sites) {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menu-option';
    button.setAttribute('aria-selected', site.path === selectedSite ? 'true' : 'false');
    button.innerHTML = '<strong></strong><small></small>';
    button.querySelector('strong').textContent = site.label;
    button.querySelector('small').textContent = site.reason;
    button.addEventListener('click', () => {
      chooseSite(site.path, true);
      closeSiteMenu();
    });
    li.append(button);
    siteList.append(li);
  }
}

function chooseSite(path, announce) {
  selectedSite = path;
  rootInput.value = path;
  const site = sites.find((item) => item.path === path);
  siteLabel.textContent = site ? `${site.label}: ${site.reason}` : path;
  renderSiteMenu();
  if (announce && site) setStatus(`Selected ${site.label}`, 'ok');
}

function openSiteMenu() {
  siteList.hidden = false;
  siteTrigger.setAttribute('aria-expanded', 'true');
}

function closeSiteMenu() {
  siteList.hidden = true;
  siteTrigger.setAttribute('aria-expanded', 'false');
}

async function checkSite(options = {}) {
  const path = rootInput.value.trim();
  if (!path) {
    setStatus('Choose a site root first.', 'bad');
    rootInput.focus();
    return false;
  }
  if (checking) return false;
  checking = true;
  let ok = false;
  await runBusy(scanButton, 'Checking...', async () => {
    const next = await api('/api/scan', { path });
    if (!next) return;
    report = next;
    paintReport();
    ok = true;
    const total = next.counts.error + next.counts.warning;
    if (options.quietStart && total === 0) {
      setStatus(`Checked ${next.filesScanned} HTML file${next.filesScanned === 1 ? '' : 's'}. No automated issues.`, 'ok');
      return;
    }
    setStatus(
      total === 0
        ? `Check finished. No automated issues in ${next.filesScanned} HTML file${next.filesScanned === 1 ? '' : 's'}.`
        : `Check finished. ${next.counts.error} error${next.counts.error === 1 ? '' : 's'}, ${next.counts.warning} warning${next.counts.warning === 1 ? '' : 's'}.`,
      total === 0 ? 'ok' : 'bad',
    );
  });
  checking = false;
  return ok;
}

async function askAgentToFix() {
  if (!report) {
    const scanned = await checkSite();
    if (!scanned || !report) return;
  }
  if (report.findings.length === 0) {
    setStatus('Nothing to send. The last check found no automated issues.', 'ok');
    return;
  }
  await sendPrompt('summary', undefined, summaryButton);
}

function paintReport() {
  if (!report) return;
  summaryCards.hidden = false;
  filtersNode.hidden = false;
  document.querySelector('#count-error').textContent = String(report.counts.error);
  document.querySelector('#count-warning').textContent = String(report.counts.warning);
  document.querySelector('#count-seo').textContent = String(report.counts.seo);
  document.querySelector('#count-a11y').textContent = String(report.counts.accessibility);
  document.querySelector('#count-files').textContent = String(report.filesScanned);
  const bits = [`${report.root}`];
  if (report.siteFiles?.robotsTxt) bits.push('robots.txt');
  if (report.siteFiles?.sitemapXml) bits.push('sitemap');
  if (report.truncated) bits.push('file cap reached');
  if (report.filesSkipped) bits.push(`${report.filesSkipped} skipped`);
  metaNode.textContent = bits.join(' · ');
  renderFindings();
}

function renderFindings() {
  findingsNode.replaceChildren();
  if (!report) {
    emptyNode.hidden = false;
    emptyNode.textContent = 'Check a site folder to list SEO and accessibility gaps.';
    return;
  }
  const items = report.findings.filter((item) => {
    if (filter === 'all') return true;
    if (filter === 'error' || filter === 'warning') return item.severity === filter;
    return item.category === filter;
  });
  if (items.length === 0) {
    emptyNode.hidden = false;
    emptyNode.textContent = report.findings.length === 0
      ? 'No automated SEO or accessibility gaps in the scanned HTML.'
      : 'No findings in this filter.';
    return;
  }
  emptyNode.hidden = true;
  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'finding';
    const badge = document.createElement('span');
    badge.className = `badge ${item.severity}`;
    badge.textContent = item.severity;
    const body = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = item.message;
    const detail = document.createElement('p');
    detail.textContent = [item.file, item.rule, item.detail].filter(Boolean).join(' · ');
    body.append(title, detail);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fix';
    button.textContent = 'Ask agent';
    button.addEventListener('click', () => void sendPrompt('finding', item.id, button));
    li.append(badge, body, button);
    findingsNode.append(li);
  }
}

async function sendPrompt(kind, id, button) {
  const payload = kind === 'summary' ? { kind: 'summary' } : { kind: 'finding', id };
  await runBusy(button || summaryButton, 'Preparing...', async () => {
    const result = await api('/api/prompt', payload);
    if (!result?.text) return;
    await appendToChat(result.text);
  });
}

async function appendToChat(text) {
  const message = window.mcode?.miniapp?.message;
  if (!message?.append) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied the fix prompt. Paste it into chat and press Send.', 'ok');
    } catch {
      setStatus('Could not reach chat or clipboard. Copy a finding manually.', 'bad');
    }
    return;
  }
  try {
    await message.append(text);
    setStatus('Added to the chat input. Review it there and press Send.', 'ok');
  } catch (error) {
    const code = error?.message;
    if (code === 'user_cancelled') setStatus('Cancelled. Nothing was added.', 'bad');
    else if (code === 'target_unavailable') setStatus('Open Site QA from a conversation so it knows which chat to use.', 'bad');
    else if (code === 'result_unknown') setStatus('Result unknown. Check the chat draft before trying again.', 'bad');
    else setStatus(`Could not add the prompt (${code || 'error'}).`, 'bad');
  }
}

async function api(path, body) {
  try {
    const response = await fetch(path, body
      ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : undefined);
    const payload = await response.json();
    if (!response.ok) {
      setStatus(payload.message || 'Request failed.', 'bad');
      return null;
    }
    return payload;
  } catch {
    setStatus('Site QA could not be reached. Reopen the Mini App if it was restarted.', 'bad');
    return null;
  }
}

async function runBusy(button, label, task) {
  if (!button) {
    await task();
    return;
  }
  const previous = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try {
    await task();
  } finally {
    button.disabled = false;
    button.textContent = previous;
  }
}

function setStatus(message, kind) {
  statusNode.textContent = message;
  statusNode.dataset.kind = kind || '';
}
