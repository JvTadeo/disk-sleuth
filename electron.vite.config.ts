import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = resolve(__dirname, 'src/shared')

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    build: {
      minify: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // Runs in its own utilityProcess (see src/main/scanner-host.ts).
          scanner: resolve(__dirname, 'src/scanner/worker.ts'),
          // Plain Node CLI: `npm run bench`.
          bench: resolve(__dirname, 'scripts/bench.ts')
        }
      }
    }
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    build: { minify: true }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': shared
      }
    },
    plugins: [react(), tailwindcss()],
    build: {
      // Electron 45 ships a recent Chromium: no polyfills or legacy output needed.
      target: 'chrome140',
      // electron-vite does not minify by default; minifying cuts the window's JS by ~3x.
      minify: true,
      reportCompressedSize: true
    }
  }
})
