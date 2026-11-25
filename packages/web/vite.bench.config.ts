// Separate build for the benchmark harness, so it never ships in the app bundle.
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify('bench') },
  resolve: { alias: { '@wafb/core': path.resolve(__dirname, '../core/src') } },
  build: { outDir: 'dist-bench', rollupOptions: { input: path.resolve(__dirname, 'bench.html') } },
  preview: { port: 4174, strictPort: true },
});
