// Apply the saved/system theme before React mounts (inline scripts are blocked by the page CSP).
try {
  const m = JSON.parse(localStorage.getItem('atlas-studio-prefs') || '{}').theme || 'system';
  document.documentElement.classList.toggle('dark', m === 'dark' || (m === 'system' && matchMedia('(prefers-color-scheme: dark)').matches));
} catch {}
import './styles.css';
import './legacy/renderers.css';
// Atlas data layer (unchanged): Path utils + OpenViking adapter publish window.FS.
import './legacy/fs-api.js';
import './legacy/openviking-adapter.js';
import { renderMarkdown, renderJson, renderJsonl, renderPlainCode } from './legacy/renderers.jsx';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';

window.AtlasRenderers = { renderMarkdown, renderJson, renderJsonl, renderPlainCode };
createRoot(document.getElementById('app')).render(<App />);
