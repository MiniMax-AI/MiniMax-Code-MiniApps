import { t } from './photo-i18n.js';
export function createRecovery({ call, status }) {
  const documents = new Map();
  let saving = false, failed = false;
  async function snapshot(state) {
    if (saving || !state.document) return;
    const docId = state.version.split(':')[0];
    let entry = documents.get(docId);
    if (!entry) { entry = { id: 'document-' + crypto.randomUUID(), revision: 0 }; documents.set(docId, entry); }
    if (entry.version === state.version) return;
    saving = true;
    try {
      const result = await call('export', { format: 'pcraft' }, state.version);
      const response = await fetch('/api/recovery/' + entry.id, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: entry.revision, value: { name: state.document.name || 'OpenPhotoShop', data: result.data } }),
      });
      if (!response.ok) throw Error('save');
      const record = await response.json();
      entry.revision = record.revision; entry.version = state.version; failed = false;
    } catch { failed = true; status('自动备份失败，请保存工程文件', {}, true); }
    finally { saving = false; }
  }
  async function show() {
    let dialog = document.querySelector('#recovery-dialog');
    if (dialog) dialog.remove();
    dialog = document.createElement('dialog'); dialog.id = 'recovery-dialog';
    const heading = document.createElement('h2'); heading.textContent = t('恢复作品');
    const close = document.createElement('button'); close.textContent = t('关闭'); close.onclick = () => dialog.close();
    dialog.append(heading, close); document.body.append(dialog); dialog.showModal();
    try {
      const response = await fetch('/api/recovery'); if (!response.ok) throw Error('list');
      const { snapshots } = await response.json();
      if (!snapshots.length) { const p = document.createElement('p'); p.textContent = t('暂无备份'); dialog.append(p); }
      for (const item of snapshots) {
        const button = document.createElement('button'); button.textContent = item.name;
        button.onclick = async () => {
          button.disabled = true;
          try {
            const response = await fetch('/api/recovery/' + item.id); if (!response.ok) throw Error('read');
            const record = await response.json();
            const opened = await call('open', { name: record.value.name.replace(/\.pcraft$/i, '') + '.pcraft', data: record.value.data });
            documents.set(opened.state.version.split(':')[0], { id: item.id, revision: record.revision, version: opened.state.version });
            dialog.close();
          } catch { status('恢复失败，请重试', {}, true); button.disabled = false; }
        };
        dialog.append(button);
      }
    } catch { const retry = document.createElement('button'); retry.textContent = t('读取结果失败，请点击重试'); retry.onclick = show; dialog.append(retry); }
  }
  return { snapshot, show, get pending() { return saving || failed; } };
}
