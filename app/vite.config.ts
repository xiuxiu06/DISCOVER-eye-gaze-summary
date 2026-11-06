import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // Relative paths so a build works from any folder during an offline demo.
  base: './',
  plugins: [react()],
})
