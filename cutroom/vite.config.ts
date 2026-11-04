import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const api = `http://127.0.0.1:${process.env.PORT ?? 5174}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist/web', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: {
    port: 5173,
    proxy: { '/api': api, '/files': api, '/assets': api },
  },
});
