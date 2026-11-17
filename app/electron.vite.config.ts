import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: { externalizeDeps: { exclude: ['@lda/shared'] } }
  },
  preload: {
    build: {
      rolldownOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } }
    }
  },
  renderer: {
    resolve: { alias: { '@renderer': resolve('src/renderer/src') } },
    plugins: [react()]
  }
})
