import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['deck.svg', 'deck-192.png', 'deck-512.png'],
      manifest: {
        name: 'Deck',
        short_name: 'Deck',
        description: 'Your Deck, anywhere.',
        start_url: '/app',
        scope: '/',
        theme_color: '#19191c',
        background_color: '#19191c',
        display: 'standalone',
        icons: [
          { src: '/deck-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/deck-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 6000000,
      },
    }),
  ],
  server: {
    proxy: { '/api': 'http://localhost:3001' },
    port: 1432,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  clearScreen: false,
});
