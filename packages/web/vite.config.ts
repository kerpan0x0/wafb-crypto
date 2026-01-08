import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import pkg from './package.json';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@wafb/core': path.resolve(__dirname, '../core/src')
    }
  },
  server: {
    port: 3000,
    open: true,
    https: false
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'wafb-core': ['@wafb/core']
        }
      }
    }
  },
  optimizeDeps: {
    exclude: ['@wafb/core']
  }
});