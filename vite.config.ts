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
      includeAssets: ['deck.svg'],
      manifest: {
        name: 'Deck',
        short_name: 'Deck',
        description: 'Put what matters on deck.',
        theme_color: '#19191c',
        background_color: '#19191c',
        display: 'standalone',
        icons: [{ src: '/deck.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 6000000,
      },
    }),
  ],
  server: { port: 1432, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  envPrefix: ['VITE_', 'TAURI_'],
  clearScreen: false,
});
