import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/core'] },
  resolve: {
    alias: Object.fromEntries(
      ['schema', 'core', 'renderer', 'webmcp'].map((n) => [
        `@muweave/${n}`,
        fileURLToPath(new URL(`../../packages/${n}/src/index.ts`, import.meta.url)),
      ]),
    ),
  },
  server: {
    host: '127.0.0.1',
    port: 4175,
    strictPort: true,
  },
  preview: { host: '127.0.0.1', port: 4175, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});
