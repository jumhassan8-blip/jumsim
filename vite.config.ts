import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
// /api/* is proxied to the local function runner (`npm run api`, :8789) in
// dev and preview — the same routes Vercel serves in production.
const apiProxy = {
  '/api': {
    target: 'http://127.0.0.1:8789',
    changeOrigin: true,
  },
}

export default defineConfig(({ mode }) => ({
  base: '/',
  plugins: [inspectAttr(), react()],
  env: {
    // vite 7 only inlines keys listed here — expose MODE so the app can
    // distinguish production deploys from dev/preview builds
    MODE: mode,
  },
  // The spec'd EXPO_PUBLIC_* names must reach import.meta.env (the default
  // prefix is VITE_* only). Values come from .env — public config, not secrets.
  envPrefix: ['VITE_', 'EXPO_PUBLIC_'],
  server: {
    port: 3000,
    proxy: apiProxy,
  },
  preview: {
    proxy: apiProxy,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
