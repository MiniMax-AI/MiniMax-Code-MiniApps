import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { productAssetsPlugin } from '../server/product-assets';

// 独立构建不读取供应商凭据，也不装配上游 Agent 服务。
export default defineConfig({
  plugins: [react(), tailwindcss(), productAssetsPlugin(), {
    name: 'miniapp-host-agent', enforce: 'pre',
    resolveId(source, importer) {
      if (source === '../agent/client' || source === '../client' && importer?.includes('/src/agent/tools/')) return resolve('src/agent/miniapp-client.ts');
      if (/(?:^|\/)vision(?:\.ts)?$/.test(source)) return resolve('src/agent/miniapp-vision.ts');
      if (/(?:^|\/)ChatPanel(?:\.tsx)?$/.test(source)) return resolve('src/components/chat/MiniAppChatPanel.tsx');
      if (/(?:^|\/)SettingsDialog(?:\.tsx)?$/.test(source)) return resolve('src/components/settings/MiniAppSettingsDialog.tsx');
    },
  }],
  define: { 'import.meta.env.VITE_MINIAPP_HOST_AGENT': 'true', __APP_VERSION__: JSON.stringify('0.2.16'), __CONFIGURED_CAPS__: JSON.stringify({}) },
  publicDir: false,
  build: { rollupOptions: { input: { main: resolve('index.html'), setup: resolve('setup.html') } }, outDir: 'miniapp-dist', chunkSizeWarningLimit: 2500 },
});
