// packages/web/vite.config.ts

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { computeVersion } from '../../scripts/version-utils.mjs'; // adjust path

export default defineConfig(() => {
  const isDev = process.env.VITE_DEV_VERSION === 'true';
  const version = computeVersion({ dev: isDev });

  return {
    define: {
      __APP_VERSION__: JSON.stringify(version),
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@wafb/core': path.resolve(__dirname, '../core/src'),
      },
    },
    server: {
      port: 3000,
      open: true,
      https: false,
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom'],
            'wafb-core': ['@wafb/core'],
          },
        },
      },
    },
    optimizeDeps: {
      exclude: ['@wafb/core'],
    },
  };
});