import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Everything the interface loads lives under /_/ so the root namespace stays
// free for slugs: go.collines.co/<slug> and nothing else.
export default defineConfig({
  base: '/_/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/auth': 'http://localhost:8080',
    },
  },
})
