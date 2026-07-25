import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
  server: {
    // Same-origin /api in dev: proxy to the local FastAPI (run: uvicorn
    // app.main:app --port 8000 in backend/). In prod, Caddy does this instead.
    proxy: {
      '/api': 'http://localhost:8000',
    },
    // The Research page imports ../RESEARCH.md?raw from the repo root (single
    // source of truth); allow the dev server to read one level up.
    fs: {
      allow: ['..'],
    },
  },
})
