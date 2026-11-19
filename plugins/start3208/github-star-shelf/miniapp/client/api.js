// 和 Node 服务通信：普通请求 + 实时事件（断线自动重连）
export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    const e = new Error('连不上 Mini App 的后台，稍后重试');
    e.code = 'offline';
    throw e;
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const e = new Error(data?.error?.message || (res.status === 401 ? '登录状态过期了，请重新打开这个 Mini App' : '请求失败（' + res.status + '）'));
    e.code = data?.error?.code || 'http_' + res.status;
    e.status = res.status;
    throw e;
  }
  return data;
}

export function connectEvents(handler, onStatus) {
  let es = null;
  let retry = 0;
  let closed = false;
  const open = () => {
    if (closed) return;
    es = new EventSource('/api/events');
    es.onopen = () => {
      retry = 0;
      onStatus(true);
    };
    es.onmessage = (ev) => {
      try {
        handler(JSON.parse(ev.data));
      } catch (error) {
        console.error('bad event', error);
      }
    };
    es.onerror = () => {
      onStatus(false);
      es.close();
      retry += 1;
      setTimeout(open, Math.min(10000, 1000 * retry));
    };
  };
  open();
  return () => {
    closed = true;
    es?.close();
  };
}
