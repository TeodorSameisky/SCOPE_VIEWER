import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { configDefaults, defineConfig } from 'vitest/config'
import { thirdPartyLicenses } from './tools/thirdPartyLicenses.ts'
import { PAGE_COLORS } from './src/render/pageColors.ts'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

/** Output folder of MathJax's on-demand glyph tables */
const MATHJAX_FONTS = 'assets/mathjax-fonts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // The service worker contains the Workbox runtime: its licenses go into the notices too
    thirdPartyLicenses('third-party-licenses.txt', ['workbox-core', 'workbox-precaching', 'workbox-routing', 'workbox-strategies', 'workbox-expiration']),
    // Installable app: web app manifest + service worker for offline use
    VitePWA({
      // A new version is offered to the user (see PwaStatus) instead of replacing the running app
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        id: '/',
        name: 'Scope Viewer',
        short_name: 'Scope Viewer',
        description: 'View and analyse oscilloscope session files (Tektronix .tss / .wfm / .isf) – everything stays on your computer.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        // The default (dark) appearance; the app updates the title bar for the light one
        background_color: PAGE_COLORS.dark.background,
        theme_color: PAGE_COLORS.dark.chrome,
        categories: ['utilities', 'productivity'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // "Open with Scope Viewer" for session files once the app is installed (Chromium desktop)
        file_handlers: [
          {
            action: '/',
            accept: {
              'application/x-tektronix-session': ['.tss'],
              'application/x-tektronix-waveform': ['.wfm'],
              'application/x-tektronix-isf': ['.isf'],
              'application/x-scopeview': ['.scopeview'],
            },
          },
        ],
      },
      workbox: {
        // Precache the app shell and the MathJax core, so the app (TeX included) works offline
        // right after installing. The rarely used MathJax glyph tables (~10 MB) are cached when
        // first needed instead.
        globPatterns: ['**/*.{html,js,css,svg,ico,txt}', 'apple-touch-icon-*.png'],
        globIgnores: [`${MATHJAX_FONTS}/**`],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Hashed file names never change content: cache first
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/assets/'),
            handler: 'CacheFirst',
            options: { cacheName: 'assets', expiration: { maxEntries: 120 } },
          },
        ],
      },
    }),
  ],
  define: {
    // Shown in the help popover and written into analysis files and reports
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    // MathJax (TeX in callouts, ~1.4 MB) is its own chunk, loaded only when a callout has a formula
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // MathJax's glyph tables for rarer characters (~10 MB in ~40 files) get their own folder,
        // so the service worker can leave them out of the offline precache
        chunkFileNames: (chunk) =>
          chunk.moduleIds.some((id) => id.includes('mathjax-newcm-font') && id.includes('dynamic')) ? `${MATHJAX_FONTS}/[name]-[hash].js` : 'assets/[name]-[hash].js',
      },
    },
  },
  test: {
    // Worktrees of parallel Claude Code sessions live in .claude/worktrees: not part of this checkout
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
})
