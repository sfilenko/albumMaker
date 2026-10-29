import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // GitHub Pages serves the app under /<repository>/; the workflow sets BASE_PATH.
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    preact(),
    // An installable app whose shell opens offline. The development server has no service worker.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Конструктор альбому',
        short_name: 'Альбом',
        lang: 'uk',
        display: 'standalone',
        theme_color: '#f4efe6',
        background_color: '#f4efe6',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
