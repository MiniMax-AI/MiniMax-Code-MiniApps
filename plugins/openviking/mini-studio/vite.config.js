// Builds the Client into miniapp/client: index.html + static/assets/* (no CDN, no inline scripts).
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '#': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    outDir: 'miniapp/client',
    emptyOutDir: true,
    assetsDir: 'static/assets',
    assetsInlineLimit: 4096,
    modulePreload: { polyfill: false },
    chunkSizeWarningLimit: 600,
  },
});
