// 入口：套上主题、画出界面、读取数据、接上实时推送
import { S, loadPrefs } from './state.js';
import * as A from './actions.js';
import { mountMain } from './view-main.js';
import { tickElapsed } from './view-detail.js';

function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
}
const hostUi = window.mcode?.miniapp?.host?.ui;
try {
  hostUi?.subscribe?.(({ theme }) => applyTheme(theme), { onError: () => {} });
} catch {
  /* 宿主不提供就跟随系统 */
}

async function boot() {
  loadPrefs();
  const app = document.getElementById('app');
  mountMain(app);
  setInterval(tickElapsed, 1000);
  await A.loadState();
  const listing = A.loadList();
  if (S.sel) A.selectProject(S.sel, undefined, { keepPane: true });
  await listing;
  A.startRealtime();
}
boot().catch((error) => {
  console.error(error);
  document.getElementById('app').textContent = '页面出错了：' + error.message;
});
