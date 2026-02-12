import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { getVersion } from '../../scripts/version.mjs'; // .mjs extension

export default defineConfig(({ command }) => {
  const isDevServer = command === 'serve';
  const isDevBuild = process.env.VITE_DEV_VERSION === 'true';
  const version = getVersion(isDevServer || isDevBuild);

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
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  };
});