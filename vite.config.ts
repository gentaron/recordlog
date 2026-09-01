import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': r('./src'),
      '@shared': r('./shared'),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // React changes far less often than the app does; give it its own
        // long-lived chunk so a normal deploy doesn't re-download the runtime.
        manualChunks: (id: string) =>
          /node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id) ? 'react' : undefined,
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // `npm run dev` serves the UI; `npm run dev:worker` serves the API on 8787.
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['icons/*.png', 'icons/*.svg', 'worklets/*.js'],
      manifest: {
        id: '/',
        name: 'RecordLog — 話した端から積み上がるメモ',
        short_name: 'RecordLog',
        description: '話すだけでメモが残り、1日1回 AI がその日ぶんを整理して積み上げる音声メモ。',
        lang: 'ja',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        orientation: 'portrait',
        background_color: '#07070c',
        theme_color: '#07070c',
        categories: ['productivity', 'utilities', 'lifestyle'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: '録音をはじめる', short_name: '録音', url: '/?action=record' },
          { name: '今日のダイジェスト', short_name: 'ダイジェスト', url: '/?view=digest' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
        // The API is never cached as a navigation; the app is offline-first via IndexedDB.
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
            options: {
              backgroundSync: {
                name: 'recordlog-api-queue',
                options: { maxRetentionTime: 60 * 24 },
              },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
});
