// Godot Web 不使用原生 TCP；fetch 流和 TextDecoder 保留 SSE 的 UTF-8 字符边界。
(() => {
  const streams = new Map();
  window.AIOfficeStream = {
    open(request, url, body, callback) {
      const controller = new AbortController();
      streams.set(request, controller);
      const emit = packet => {
        if (streams.get(request) === controller) callback(JSON.stringify({ request, ...packet }));
      };
      (async () => {
        if (url !== window.location.origin + '/api/chat') throw new Error('invalid_route');
        const response = await fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json' },
          body, signal:controller.signal, credentials:'same-origin' });
        if (!response.headers.get('content-type')?.includes('text/event-stream')) {
          const data = await response.json();
          const who = JSON.parse(body).who;
          emit({ data:'data: ' + JSON.stringify(data.ok ? { type:'delta', who, text:data.msg } :
            { type:'error', who, message:data.msg || '这次没连上，稍后再试' }) + '\n\n' });
          emit({ end:true }); return;
        }
        const reader = response.body.getReader(), decoder = new TextDecoder();
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            emit({ data:decoder.decode(part.value, { stream:true }) });
          }
          emit({ data:decoder.decode(), end:true });
        } finally { reader.releaseLock(); }
      })().catch(error => { if (error.name !== 'AbortError') emit({ error:true }); })
        .finally(() => { if (streams.get(request) === controller) streams.delete(request); });
    },
    cancel(request) { streams.get(request)?.abort(); streams.delete(request); }
  };
})();
