import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 47912,
    watch: { usePolling: true, interval: 300 },
    proxy: {
      '/api': { target: 'http://127.0.0.1:47911', changeOrigin: true },
    },
  },
});
