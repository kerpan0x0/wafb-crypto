// packages/web/vite.config.ts

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { execSync } from 'child_process';

/**
 * Get the current version from git tag.
 * Strategy:
 * 1. Try to get the most recent tag (e.g., v1.2.3)
 * 2. Fallback to short commit hash (dev-a1b2c3d)
 * 3. Final fallback: package.json version
 */
function getGitVersion(): string {
  try {
    // Get the most recent tag matching v*.*.*
    const tag = execSync('git describe --tags --abbrev=0', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    return tag;
  } catch {
    try {
      // Fallback: short commit hash
      const commit = execSync('git rev-parse --short HEAD', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
      return `dev-${commit}`;
    } catch {
      // Last resort: package.json version
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pkg = require('./package.json');
      return pkg.version || '0.0.0';
    }
  }
}

export default defineConfig({
  define: {
    // Inject the resolved version into __APP_VERSION__
    __APP_VERSION__: JSON.stringify(getGitVersion()),
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
});