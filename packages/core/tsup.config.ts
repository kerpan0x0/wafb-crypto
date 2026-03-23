import { defineConfig } from 'tsup';
import pkg from './package.json'

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false,
  target: 'es2022',
  platform: 'browser',
  external: [
    '@yume-chan/adb',
    '@yume-chan/android-bin',
    '@yume-chan/scrcpy',
    '@yume-chan/stream-extra',
    '@yume-chan/struct',
    'hash-wasm'
  ],
  esbuildOptions(options) {
    options.banner = {
      js: '// @wafb/core v0.1.0 | GPL-3.0 License'
    };
  }
});
