// Internal tool, and Element Plus is not SSR-friendly: run as a SPA.
export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  ssr: false,
  // Lets a second dev server (e.g. UI tests on another port) run without sharing .nuxt.
  buildDir: process.env.NUXT_BUILD_DIR || '.nuxt',
  devtools: { enabled: false },
  devServer: { port: 3000 },
  modules: ['@nuxtjs/tailwindcss', '@element-plus/nuxt', '@pinia/nuxt'],
  vite: {
    // A second dev server gets its own dependency cache, or it overwrites the main one's.
    ...(process.env.NUXT_BUILD_DIR && {
      cacheDir: `node_modules/.cache/vite-${process.env.NUXT_BUILD_DIR.replace(/\W/g, '')}`,
    }),
    optimizeDeps: {
      // Loaded via dynamic import(): pre-bundle at startup instead of discovering
      // them on first use, which re-optimizes mid-session.
      include: ['markdown-it', 'dompurify', 'socket.io-client'],
      // Monaco is served as plain ESM: its pre-bundled 5 MB chunk was answered
      // with 404 by the dev server after re-optimizations.
      exclude: ['monaco-editor'],
    },
  },
  runtimeConfig: {
    public: {
      // Overridden by NUXT_PUBLIC_API_BASE
      apiBase: 'http://localhost:3001',
    },
  },
  app: {
    head: { title: 'Browser Automation' },
  },
});
