import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: false, // Disabilitiamo la generazione DTS in tsup
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
    '@yume-chan/struct'
  ],
  esbuildOptions(options) {
    options.banner = {
      js: '// @wafb/core v0.1.0 | GPL-3.0 License'
    };
  }
});
