import { note } from './dialogs.js';
export function installAgentResults({ modal, button, importFiles, status }) {
  const events = new EventSource('/api/agent/events');
  events.addEventListener('result', () => status('Agent 图片已返回，点击“Agent 图片”查看'));
  window.addEventListener('pagehide', () => events.close(), { once: true });
  return async function showResults() {
    const response = await fetch('/api/agent/requests');
    if (!response.ok) throw Error('读取 Agent 图片失败');
    const { requests } = await response.json();
    const rows = requests.map((record) => {
      const row = document.createElement('div');
      row.className = 'project-row';
      const label = document.createElement('span');
      label.textContent = record.prompt;
      label.title = record.prompt;
      row.append(label);
      if (record.status === 'ready')
        row.append(
          button('打开图片', async () => {
            const response = await fetch(`/api/agent/requests/${record.id}/result`);
            if (!response.ok) throw Error('读取返回图片失败');
            const file = new File([await response.blob()], record.name + ' — Agent.png', {
              type: 'image/png',
            });
            await importFiles([file]);
            document.querySelector('#dialog').close();
          }),
        );
      else row.append(note('等待 Agent 返回'));
      return row;
    });
    modal(
      'Agent 图片',
      rows.length ? rows : [note('还没有图片任务，点击“交给 Agent”创建。')],
      () => {},
      '关闭',
    );
  };
}
