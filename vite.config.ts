import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const base = normalizeBase(env.VITE_BASE_URL || './');
  const manifestBase = base === './' ? '.' : base;

  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'apple-touch-icon.png',
          'favicon-64x64.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
        ],
        manifest: {
          id: manifestBase,
          name: 'FSRS Flashcards',
          short_name: 'FSRS Cards',
          description: 'A note-first FSRS flashcard app with cloze cards, reversible cards, and spaced repetition.',
          theme_color: '#0f766e',
          background_color: '#f8fafc',
          display: 'standalone',
          scope: manifestBase,
          start_url: manifestBase,
          orientation: 'portrait',
          lang: 'zh-CN',
          categories: ['education', 'productivity'],
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
            },
            {
              src: 'pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          navigateFallback: 'index.html',
          globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg,jpeg,webp,json,woff2}'],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/api\.fontshare\.com\/.*/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'fontshare-styles',
                cacheableResponse: {
                  statuses: [0, 200],
                },
                expiration: {
                  maxEntries: 8,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.fontshare\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'fontshare-fonts',
                cacheableResponse: {
                  statuses: [0, 200],
                },
                expiration: {
                  maxEntries: 16,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
              },
            },
            {
              urlPattern: ({ request, sameOrigin }) =>
                sameOrigin && (request.destination === 'image' || request.destination === 'audio'),
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'study-media',
                expiration: {
                  maxEntries: 64,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          suppressWarnings: true,
          type: 'module',
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify; file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});

function normalizeBase(value: string) {
  if (!value || value === '.') return './';
  if (value === './' || value === '../') return value;
  const withSlashes = value.startsWith('/') ? value : `/${value}`;
  return withSlashes.endsWith('/') ? withSlashes : `${withSlashes}/`;
}
