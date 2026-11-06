import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // Relative paths so a build works from any folder during an offline demo.
  base: './',
  plugins: [react(), tailwindcss()],
  // The upload feature bundles the lane map, which lives outside app/.
  server: { fs: { allow: ['.', '../data/lane_map.csv'] } },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
