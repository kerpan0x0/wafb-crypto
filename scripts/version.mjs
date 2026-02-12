import { execSync } from 'child_process';

export function getVersion(dev = false) {
  try {
    const tag = execSync('git describe --tags --abbrev=0', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim().replace(/^v/, '');

    if (!dev) return tag;

    const commit = execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    return `${tag}-${commit}`;
  } catch {
    try {
      const commit = execSync('git rev-parse --short HEAD', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
      return `dev-${commit}`;
    } catch {
      return '0.0.0';
    }
  }
}