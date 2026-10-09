import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Build = un unico file HTML autonomo (JS, CSS, font e immagini inclusi):
// si apre con doppio click, funziona offline durante la presentazione.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
  },
})
