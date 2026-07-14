import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

const githubPagesBasePath = '/planibly/';

function developmentStyleCsp(isDevelopment: boolean) {
  return {
    name: 'planibly-development-style-csp',
    enforce: 'pre' as const,
    transformIndexHtml(html: string) {
      return html.replace('__PLANIBLY_DEV_STYLE__', isDevelopment ? "'unsafe-inline'" : '');
    },
  };
}

export default defineConfig(({ command }) => {
  const isPreview = process.argv.includes('preview');
  const isDevelopment = command === 'serve' && !isPreview;
  const base = isDevelopment ? '/' : githubPagesBasePath;

  return {
    base,
    plugins: [
      developmentStyleCsp(isDevelopment),
      react(),
      VitePWA({
        base,
        scope: githubPagesBasePath,
        registerType: 'prompt',
        injectRegister: false,
        includeAssets: [
          'favicon.svg',
          'icons/apple-touch-icon.png',
          'icons/icon-192.png',
          'icons/icon-512.png',
          'icons/icon-maskable-192.png',
          'icons/icon-maskable-512.png',
        ],
        manifest: {
          id: githubPagesBasePath,
          name: 'Planibly',
          short_name: 'Planibly',
          description: 'A private, calm, offline-first personal planner.',
          start_url: githubPagesBasePath,
          scope: githubPagesBasePath,
          display: 'standalone',
          orientation: 'portrait-primary',
          background_color: '#F7F7F4',
          theme_color: '#5B67C8',
          categories: ['productivity', 'lifestyle'],
          icons: [
            {
              src: 'icons/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'icons/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'icons/icon-maskable-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: 'icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          navigateFallback: 'index.html',
          globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.mode === 'navigate',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'planibly-pages',
                networkTimeoutSeconds: 3,
                expiration: { maxEntries: 10 },
              },
            },
            {
              urlPattern: ({ request, sameOrigin }) =>
                sameOrigin && ['script', 'style', 'image', 'font'].includes(request.destination),
              handler: 'CacheFirst',
              options: {
                cacheName: 'planibly-static-assets',
                expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
          ],
        },
        devOptions: { enabled: false },
      }),
    ],
    test: {
      environment: 'jsdom',
      globals: true,
      exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
      setupFiles: ['./src/test/setup.ts'],
      css: true,
      coverage: { reporter: ['text', 'html'] },
    },
  };
});
