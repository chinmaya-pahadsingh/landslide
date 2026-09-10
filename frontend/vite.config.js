import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      clientPort: 5173
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
  }
})
