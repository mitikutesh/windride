import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// WindRide is a PWA-first, zero-backend app (DEC-001/007). vite-plugin-pwa gives us
// an installable, offline-capable shell. Theme colour is the Baltic Dusk background (DESIGN.md).
export default defineConfig({
  // Served from '/' by default; the GitHub Pages deploy sets VITE_BASE='/windride/' (project site
  // lives under a repo subpath). Assets + service-worker scope pick this up automatically.
  base: process.env.VITE_BASE || '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'WindRide',
        short_name: 'WindRide',
        description: "Wind-aware cycling route planner — the least suffering for today's wind.",
        theme_color: '#0E120D',
        background_color: '#0E120D',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.', // relative so the installed PWA launches correctly under a subpath (Pages) too
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
    // tools/**.test.mjs covers the manual preprocessing scripts (WR-052): they are plain ESM so
    // `node tools/…` runs them without a build step, and the tests import exactly that module.
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tools/**/*.{test,spec}.mjs'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Coverage targets (CLAUDE.md testing policy): engine >= 90%, adapters >= 80%.
      include: ['src/engine/**', 'src/adapters/**'],
    },
  },
});
