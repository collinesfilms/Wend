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
    // The translation catalogue is shared with the Go server, so it sits above
    // this directory and the dev server has to be allowed to read it.
    fs: { allow: ['..'] },
    proxy: {
      '/api': 'http://localhost:8080',
      '/auth': 'http://localhost:8080',
    },
  },
})
