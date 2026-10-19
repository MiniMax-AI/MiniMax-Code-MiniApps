import init, { miniapp_call } from './photocraft.js';
const allowed = new Set([
  'inspect',
  'language',
  'commands',
  'execute',
  'batch',
  'preview',
  'export',
  'open',
]);
let ready = false,
  fontData;
window.addEventListener('message', async (event) => {
  if (event.source !== parent || !event.data || event.data.type !== 'photo-request') return;
  const { id, token, method, args, expectedVersion } = event.data;
  if (!ready || !allowed.has(method)) return;
  try {
    const value = JSON.parse(await miniapp_call(JSON.stringify({ method, args, expectedVersion })));
    if (method === 'language' && fontData)
      await miniapp_call(JSON.stringify({ method: 'font', args: { data: fontData } }));
    parent.postMessage({ type: 'photo-response', id, token, value }, '*');
  } catch (error) {
    parent.postMessage({ type: 'photo-response', id, token, error: String(error) }, '*');
  }
});
try {
  await init();
  for (let i = 0; i < 300; i++) {
    try {
      await miniapp_call('{"method":"inspect"}');
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  if (!ready) throw Error('Image editor startup timed out');
  const response = await fetch('./cjk-ui.otf');
  if (!response.ok) throw Error('Could not load the offline UI font');
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    response.blob().then((blob) => reader.readAsDataURL(blob), reject);
  });
  fontData = data;
  await miniapp_call(JSON.stringify({ method: 'font', args: { data } }));
  parent.postMessage({ type: 'photo-ready' }, '*');
} catch (error) {
  parent.postMessage({ type: 'photo-failed', error: String(error) }, '*');
}
