import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// WindRide is a PWA-first, zero-backend app (DEC-001/007). vite-plugin-pwa gives us
// an installable, offline-capable shell. Theme colour is the Baltic Dusk background (DESIGN.md).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'WindRide',
        short_name: 'WindRide',
        description: "Wind-aware cycling route planner — the least suffering for today's wind.",
        theme_color: '#0A1220',
        background_color: '#0A1220',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  test: {
    // Engine and adapter tests run on fixtures only — never live APIs (CLAUDE.md rule 3).
    globals: true,
    // Engine/adapter tests run under node; UI render tests (WR-008/009) get jsdom.
    environment: 'node',
    environmentMatchGlobs: [['src/ui/**', 'jsdom']],
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Coverage targets (CLAUDE.md testing policy): engine >= 90%, adapters >= 80%.
      include: ['src/engine/**', 'src/adapters/**'],
    },
  },
});
