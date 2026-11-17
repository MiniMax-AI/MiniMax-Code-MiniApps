// @ts-check
/**
 * Client for 插件上架材料工作台.
 *
 * The page owns presentation and input only. Every validation pass, the market
 * preview and the listing package are produced by the Node service.
 */

const form = /** @type {HTMLFormElement} */ (document.getElementById('draft-form'));
const manifestText = /** @type {HTMLTextAreaElement} */ (document.getElementById('manifest-text'));
const summaryInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('summary'));
const documentationInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('documentation'));
const marketNameInput = /** @type {HTMLInputElement} */ (document.getElementById('market-name'));
const categorySelect = /** @type {HTMLSelectElement} */ (document.getElementById('category'));
const operationSelect = /** @type {HTMLSelectElement} */ (document.getElementById('operation'));
const existingNameInput = /** @type {HTMLInputElement} */ (document.getElementById('existing-name'));
const previousVersionInput = /** @type {HTMLInputElement} */ (document.getElementById('previous-version'));
const updateFields = /** @type {HTMLElement} */ (document.getElementById('update-fields'));
const queryList = /** @type {HTMLElement} */ (document.getElementById('query-list'));
const addQueryButton = /** @type {HTMLButtonElement} */ (document.getElementById('add-query'));
const statusBanner = /** @type {HTMLElement} */ (document.getElementById('status-banner'));
const summaryBar = /** @type {HTMLElement} */ (document.getElementById('summary-bar'));
const missingList = /** @type {HTMLElement} */ (document.getElementById('missing-list'));
const issueList = /** @type {HTMLElement} */ (document.getElementById('issue-list'));
const previewBody = /** @type {HTMLElement} */ (document.getElementById('preview-body'));
const channelBody = /** @type {HTMLElement} */ (document.getElementById('channel-body'));
const packageBody = /** @type {HTMLElement} */ (document.getElementById('package-body'));
const validateButton = /** @type {HTMLButtonElement} */ (document.getElementById('validate-button'));
const packageButton = /** @type {HTMLButtonElement} */ (document.getElementById('package-button'));
const assetRole = /** @type {HTMLSelectElement} */ (document.getElementById('asset-role'));
const assetName = /** @type {HTMLInputElement} */ (document.getElementById('asset-name'));
const organizationInput = /** @type {HTMLInputElement} */ (document.getElementById('organization'));
const assetFile = /** @type {HTMLInputElement} */ (document.getElementById('asset-file'));
const assetUpload = /** @type {HTMLButtonElement} */ (document.getElementById('asset-upload'));
const assetList = /** @type {HTMLElement} */ (document.getElementById('asset-list'));

/** @type {import('./client-api.js').McodeClientAPI | undefined} */
const hostApi = window.mcode;

/**
 * @param {string} message
 * @param {'info' | 'success' | 'error'} [tone]
 */
function setBanner(message, tone = 'info') {
  statusBanner.textContent = message;
  statusBanner.dataset.tone = tone;
  statusBanner.hidden = message === '';
}

/**
 * @param {string} path
 * @param {RequestInit} [init]
 * @returns {Promise<any>}
 */
async function request(path, init) {
  const response = await fetch(path, init);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { message: text };
  }
  if (!response.ok && response.status !== 409) {
    const error = new Error(payload?.message ?? `请求失败（HTTP ${response.status}）`);
    throw error;
  }
  return payload;
}

/**
 * @returns {{ manifestText: string, marketName: string, summary: string, documentation: string, category: string, exampleQueries: string[], regions: string[], enabledEnds: string[], operation: string, existingName: string, previousVersion: string, submitEmail: string, submitAccount: string, organization: string }}
 */
function collectDraft() {
  const checkboxes = (name) =>
    Array.from(form.querySelectorAll(`input[name="${name}"]:checked`)).map((input) =>
      /** @type {HTMLInputElement} */ (input).value,
    );
  return {
    manifestText: manifestText.value,
    marketName: marketNameInput.value,
    summary: summaryInput.value,
    documentation: documentationInput.value,
    category: categorySelect.value,
    exampleQueries: Array.from(queryList.querySelectorAll('input'))
      .map((input) => /** @type {HTMLInputElement} */ (input).value)
      .filter((value) => value.trim() !== ''),
    regions: checkboxes('regions'),
    enabledEnds: checkboxes('enabledEnds'),
    operation: operationSelect.value,
    existingName: existingNameInput.value,
    previousVersion: previousVersionInput.value,
    submitEmail: /** @type {HTMLInputElement} */ (form.elements.namedItem('submitEmail')).value,
    submitAccount: /** @type {HTMLInputElement} */ (form.elements.namedItem('submitAccount')).value,
    organization: organizationInput.value,
  };
}

/** @param {string} value */
function addQueryRow(value = '') {
  if (queryList.querySelectorAll('input').length >= 3) return;
  const row = document.createElement('div');
  row.className = 'field-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.placeholder = '例：检索近期研究并总结主要结论';
  input.setAttribute('aria-label', '示例 query');
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'button button-quiet';
  remove.textContent = '移除';
  remove.addEventListener('click', () => {
    row.remove();
  });
  row.append(input, remove);
  queryList.append(row);
}

/**
 * @param {number} errors
 * @param {number} warnings
 * @param {number} infos
 * @param {number} missing
 */
function renderSummary(errors, warnings, infos, missing) {
  summaryBar.textContent = '';
  const chip = (level, label, value) => {
    const element = document.createElement('span');
    element.className = 'count-chip';
    element.dataset.level = level;
    const strong = document.createElement('strong');
    strong.textContent = String(value);
    element.append(strong, document.createTextNode(label));
    return element;
  };
  summaryBar.append(
    chip('error', ' 错误', errors),
    chip('warning', ' 警告', warnings),
    chip('info', ' 提示', infos),
    chip('missing', ' 缺失项', missing),
  );
}

/**
 * @param {any[]} issues
 */
function renderIssues(issues) {
  issueList.textContent = '';
  missingList.textContent = '';
  const missing = issues.filter((issue) => issue.missing);
  if (missing.length > 0) {
    const heading = document.createElement('p');
    heading.className = 'missing-heading';
    heading.textContent = `缺失项（${missing.length}）`;
    missingList.append(heading);
    for (const issue of missing) {
      const item = document.createElement('div');
      item.className = 'missing-item';
      const field = document.createElement('span');
      field.className = 'missing-field';
      field.textContent = issue.field ?? '-';
      const text = document.createElement('span');
      text.textContent = `${issue.title}：${issue.detail}`;
      item.append(field, text);
      missingList.append(item);
    }
  }
  if (issues.length === 0) {
    const hint = document.createElement('p');
    hint.className = 'empty-hint';
    hint.textContent = '未发现问题。';
    issueList.append(hint);
    return;
  }
  for (const issue of issues) {
    const element = document.createElement('div');
    element.className = 'issue';
    element.dataset.severity = issue.severity;
    const title = document.createElement('p');
    title.className = 'issue-title';
    const badge = document.createElement('span');
    badge.className = 'issue-badge';
    badge.textContent =
      issue.severity === 'error' ? '错误' : issue.severity === 'warning' ? '警告' : '提示';
    const text = document.createElement('span');
    text.textContent = issue.title;
    title.append(badge, text);
    const detail = document.createElement('p');
    detail.className = 'issue-detail';
    detail.textContent = issue.detail;
    const source = document.createElement('p');
    source.className = 'issue-source';
    source.textContent = `依据：${issue.source}`;
    element.append(title, detail, source);
    issueList.append(element);
  }
}

/**
 * @param {any} preview
 */
function renderPreview(preview) {
  previewBody.textContent = '';
  if (!preview) {
    const hint = document.createElement('p');
    hint.className = 'empty-hint';
    hint.textContent = '填写信息并运行检查后，这里显示市场卡片预览。';
    previewBody.append(hint);
    return;
  }
  const card = document.createElement('div');
  card.className = 'preview-card';

  const head = document.createElement('div');
  head.className = 'preview-head';
  const icon = document.createElement('div');
  icon.className = 'preview-icon';
  icon.textContent = (preview.marketName || '?').slice(0, 1).toUpperCase();
  const names = document.createElement('div');
  const name = document.createElement('p');
  name.className = 'preview-name';
  name.textContent = preview.marketName || '（未填写市场名称）';
  const meta = document.createElement('p');
  meta.className = 'preview-meta';
  meta.textContent = [preview.version, preview.category, preview.author]
    .filter(Boolean)
    .join(' · ');
  names.append(name, meta);
  head.append(icon, names);
  card.append(head);

  const body = document.createElement('p');
  body.className = 'preview-body-text';
  body.textContent = preview.summary || '（未填写简介）';
  card.append(body);

  const regions = document.createElement('div');
  regions.className = 'preview-section';
  const regionsTitle = document.createElement('h3');
  regionsTitle.textContent = '目标市场';
  const regionTags = document.createElement('div');
  regionTags.className = 'tag-row';
  for (const tag of [
    ...(preview.regions ?? []),
    ...(preview.enabledEnds ?? []).map((end) => (end === 'desktop' ? '桌面端' : '云端')),
  ]) {
    const element = document.createElement('span');
    element.className = 'tag';
    element.textContent = tag;
    regionTags.append(element);
  }
  regions.append(regionsTitle, regionTags);
  card.append(regions);

  if ((preview.exampleQueries ?? []).length > 0) {
    const queries = document.createElement('div');
    queries.className = 'preview-section';
    const title = document.createElement('h3');
    title.textContent = '示例 query';
    const list = document.createElement('ul');
    for (const query of preview.exampleQueries) {
      const item = document.createElement('li');
      item.textContent = query;
      list.append(item);
    }
    queries.append(title, list);
    card.append(queries);
  }

  const files = document.createElement('div');
  files.className = 'preview-section';
  const filesTitle = document.createElement('h3');
  filesTitle.textContent = `能力文件（${preview.capabilityFiles?.length ?? 0}）· 截图 ${preview.screenshotCount} 张`;
  const fileList = document.createElement('ul');
  const entries = preview.capabilityFiles ?? [];
  if (entries.length === 0) {
    const item = document.createElement('li');
    item.textContent = '清单未声明能力文件。';
    fileList.append(item);
  }
  for (const file of entries) {
    const item = document.createElement('li');
    item.textContent = `${file.path} — ${file.present ? '已上传' : '缺少素材'}`;
    fileList.append(item);
  }
  files.append(filesTitle, fileList);
  card.append(files);

  previewBody.append(card);
}

/**
 * @param {any} channel
 */
function renderChannel(channel) {
  channelBody.textContent = '';
  if (!channel) {
    const hint = document.createElement('p');
    hint.className = 'empty-hint';
    hint.textContent = '尚未探测提交通道。';
    channelBody.append(hint);
    return;
  }
  for (const finding of channel.findings ?? []) {
    const element = document.createElement('div');
    element.className = 'channel-finding';
    element.dataset.status = finding.status;
    const title = document.createElement('h3');
    title.textContent = `${finding.label}（${finding.status === 'available' ? '可用' : finding.status === 'unavailable' ? '不可用' : '未知'}）`;
    const detail = document.createElement('p');
    detail.textContent = finding.detail;
    const evidence = document.createElement('p');
    evidence.className = 'channel-evidence';
    evidence.textContent = `证据：${finding.evidence}`;
    element.append(title, detail, evidence);
    channelBody.append(element);
  }
  for (const permission of channel.requiredPermissions ?? []) {
    const row = document.createElement('div');
    row.className = 'permission-row';
    const state = document.createElement('span');
    state.className = 'permission-state';
    state.dataset.satisfied = String(permission.satisfied);
    state.textContent = permission.satisfied ? '已具备' : '未具备';
    const label = document.createElement('span');
    label.textContent = `${permission.label} —— ${permission.detail}`;
    row.append(state, label);
    channelBody.append(row);
  }
  const conclusion = document.createElement('p');
  conclusion.className = 'channel-conclusion';
  conclusion.textContent = channel.conclusion ?? '';
  channelBody.append(conclusion);
}

/**
 * @param {any} record
 */
function renderPackages(records) {
  packageBody.textContent = '';
  if (!records || records.length === 0) {
    const hint = document.createElement('p');
    hint.className = 'empty-hint';
    hint.textContent = '还没有生成材料包。';
    packageBody.append(hint);
    return;
  }
  for (const record of records) {
    const item = document.createElement('div');
    item.className = 'package-item';
    const title = document.createElement('h3');
    title.textContent = record.fileName;
    const meta = document.createElement('p');
    meta.className = 'package-meta';
    meta.textContent = `${record.size} 字节 · ${record.entries?.length ?? 0} 个条目 · ${new Date(record.createdAt).toLocaleString()}`;
    const digest = document.createElement('p');
    digest.className = 'package-meta';
    const code = document.createElement('code');
    code.textContent = `SHA256 ${record.sha256}`;
    digest.append(code);
    const link = document.createElement('a');
    link.className = 'download-link';
    link.href = `/api/package/download?id=${encodeURIComponent(record.id)}`;
    link.textContent = '下载材料包';
    const note = document.createElement('p');
    note.className = 'package-note';
    note.textContent =
      '材料包仅供人工审核与提交使用，尚未提交到官方市场，也不代表已上架。提交前请按官方表单逐项核对。';
    item.append(title, meta, digest, link, note);
    packageBody.append(item);
  }
}

/**
 * @param {any[]} assets
 */
function renderAssets(assets) {
  assetList.textContent = '';
  if (!assets || assets.length === 0) {
    const hint = document.createElement('li');
    hint.className = 'empty-hint';
    hint.textContent = '尚未上传素材。';
    assetList.append(hint);
    return;
  }
  for (const asset of assets) {
    const item = document.createElement('li');
    item.className = 'asset-item';
    const name = document.createElement('span');
    name.className = 'asset-name';
    name.textContent = asset.name;
    const role = document.createElement('span');
    role.className = 'asset-role';
    role.textContent = `${asset.role} · ${asset.size}B`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'button button-quiet';
    remove.textContent = '移除';
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try {
        await request(`/api/assets?id=${encodeURIComponent(asset.id)}`, { method: 'DELETE' });
        await refreshState();
        await runValidation();
      } catch (error) {
        setBanner(error instanceof Error ? error.message : '移除素材失败', 'error');
        remove.disabled = false;
      }
    });
    item.append(name, role, remove);
    assetList.append(item);
  }
}

async function refreshState() {
  const state = await request('/api/state');
  renderAssets(state.assets ?? []);
  renderPackages(state.packages ?? []);
}

/**
 * @param {boolean} busy
 */
function setBusy(busy) {
  validateButton.disabled = busy;
  packageButton.disabled = busy;
  assetUpload.disabled = busy;
  addQueryButton.disabled = busy;
}

async function runValidation() {
  setBusy(true);
  setBanner('正在检查……');
  try {
    const result = await request('/api/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(collectDraft()),
    });
    renderSummary(
      result.summary.errors,
      result.summary.warnings,
      result.summary.infos,
      result.summary.missing,
    );
    renderIssues(result.issues ?? []);
    renderPreview(result.preview);
    renderChannel(result.channel);
    renderAssets(result.assets ?? []);
    const errors = result.summary.errors;
    setBanner(
      errors > 0
        ? `检查完成：${errors} 项错误、${result.summary.warnings} 项警告、${result.summary.missing} 项缺失。修正后才能生成材料包。`
        : `检查完成：${result.summary.warnings} 项警告，无阻断错误，可以生成材料包。`,
      errors > 0 ? 'error' : 'success',
    );
  } catch (error) {
    setBanner(error instanceof Error ? error.message : '检查失败', 'error');
  } finally {
    setBusy(false);
  }
}

async function generatePackage() {
  setBusy(true);
  setBanner('正在生成上架材料包……');
  try {
    const result = await request('/api/package', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(collectDraft()),
    });
    if (result.error === 'not_ready') {
      renderSummary(
        result.summary.errors,
        result.summary.warnings,
        result.summary.infos,
        result.summary.missing,
      );
      renderIssues(result.issues ?? []);
      renderPreview(result.preview);
      renderChannel(result.channel);
      setBanner(result.message ?? '仍有错误，无法生成材料包。', 'error');
      return;
    }
    await refreshState();
    setBanner(
      `已生成上架材料包（${result.package.size} 字节）。材料尚未提交到官方市场，请按官方表单人工提交。`,
      'success',
    );
  } catch (error) {
    setBanner(error instanceof Error ? error.message : '生成失败', 'error');
  } finally {
    setBusy(false);
  }
}

async function uploadAsset() {
  const file = assetFile.files?.[0];
  if (!file) {
    setBanner('请先选择一个文件。', 'error');
    return;
  }
  const role = assetRole.value;
  const name = assetName.value.trim() || file.name;
  setBusy(true);
  setBanner('正在上传素材……');
  try {
    const buffer = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
    await request('/api/assets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        role,
        mime: file.type || 'application/octet-stream',
        contentBase64: btoa(binary),
      }),
    });
    assetFile.value = '';
    assetName.value = '';
    await refreshState();
    await runValidation();
  } catch (error) {
    setBanner(error instanceof Error ? error.message : '上传失败', 'error');
  } finally {
    setBusy(false);
  }
}

async function boot() {
  try {
    const meta = await request('/api/meta');
    for (const category of meta.categories ?? []) {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      categorySelect.append(option);
    }
    const state = await request('/api/state');
    const draft = state.draft ?? {};
    manifestText.value = draft.manifestText ?? '';
    marketNameInput.value = draft.marketName ?? '';
    summaryInput.value = draft.summary ?? '';
    documentationInput.value = draft.documentation ?? '';
    categorySelect.value = draft.category ?? '';
    operationSelect.value = draft.operation ?? 'new';
    existingNameInput.value = draft.existingName ?? '';
    previousVersionInput.value = draft.previousVersion ?? '';
    /** @type {HTMLInputElement} */ (form.elements.namedItem('submitEmail')).value = draft.submitEmail ?? '';
    /** @type {HTMLInputElement} */ (form.elements.namedItem('submitAccount')).value = draft.submitAccount ?? '';
    organizationInput.value = draft.organization ?? '';
    for (const query of draft.exampleQueries ?? []) addQueryRow(query);
    if ((draft.exampleQueries ?? []).length === 0) addQueryRow();
    for (const region of draft.regions ?? []) {
      const input = form.querySelector(`input[name="regions"][value="${region}"]`);
      if (input) /** @type {HTMLInputElement} */ (input).checked = true;
    }
    for (const end of draft.enabledEnds ?? []) {
      const input = form.querySelector(`input[name="enabledEnds"][value="${end}"]`);
      if (input) /** @type {HTMLInputElement} */ (input).checked = true;
    }
    updateFields.hidden = operationSelect.value !== 'update';
    renderAssets(state.assets ?? []);
    renderPackages(state.packages ?? []);
  } catch (error) {
    setBanner(error instanceof Error ? error.message : '初始化失败', 'error');
  }
}

operationSelect.addEventListener('change', () => {
  updateFields.hidden = operationSelect.value !== 'update';
});

addQueryButton.addEventListener('click', () => addQueryRow());
assetUpload.addEventListener('click', () => void uploadAsset());
validateButton.addEventListener('click', () => void runValidation());
packageButton.addEventListener('click', () => void generatePackage());

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    void request('/api/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(collectDraft()),
    }).catch(() => undefined);
  }
});

// Follow the Host theme when it exposes one; otherwise the page uses prefers-color-scheme.
const hostUi = hostApi?.miniapp?.host?.ui;
if (hostUi?.subscribe) {
  const subscription = hostUi.subscribe(
    ({ theme, language }) => {
      if (theme) document.documentElement.dataset.theme = theme;
      if (language) document.documentElement.lang = language === 'zh-Hans' ? 'zh-CN' : 'en';
    },
    { onError: () => undefined },
  );
  window.addEventListener('pagehide', () => subscription?.dispose(), { once: true });
}

void boot();
