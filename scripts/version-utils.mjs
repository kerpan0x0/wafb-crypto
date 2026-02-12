// scripts/version-utils.mjs
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Reads the version from the root package.json.
 * This version should be kept in sync with the latest Git tag.
 */
function getBaseVersion() {
  const rootPackageJsonPath = join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(rootPackageJsonPath, 'utf8'));
  return pkg.version || '0.0.0';
}

/**
 * Tries to get the current Git commit hash (short).
 * Returns null if not available (e.g., not a Git repo).
 */
function getCommitHash() {
  try {
    return execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Computes a version string for the application.
 * Format: <base-version>[-<commit-hash>]
 *
 * The base version is always read from the root package.json,
 * which you keep in sync with your release tags via `pnpm version:sync`.
 *
 * @param {Object} options
 * @param {boolean} options.dev - Unused; kept for compatibility. Always appends commit if available.
 * @returns {string}
 */
export function computeVersion({ dev = false } = {}) {
  const base = getBaseVersion();
  const commit = getCommitHash();

  if (commit) {
    return `${base}-${commit}`;
  }
  return base;
}