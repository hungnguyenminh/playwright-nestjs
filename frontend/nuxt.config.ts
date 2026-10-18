// Internal tool, and Element Plus is not SSR-friendly: run as a SPA.
export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  ssr: false,
  devtools: { enabled: false },
  devServer: { port: 3000 },
  modules: ['@nuxtjs/tailwindcss', '@element-plus/nuxt', '@pinia/nuxt'],
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
