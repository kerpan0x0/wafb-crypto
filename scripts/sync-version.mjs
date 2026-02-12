#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { globSync } from 'glob';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

const newVersion = process.argv[2];
if (!newVersion) {
  console.error('❌ Usage: node sync-version.mjs <version>');
  process.exit(1);
}

const files = [
  resolve(rootDir, 'package.json'),
  ...globSync('packages/*/package.json', { cwd: rootDir, absolute: true })
];

for (const file of files) {
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  pkg.version = newVersion;
  writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`✅ ${file} → ${newVersion}`);
}