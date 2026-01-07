// packages/web/src/lib/constants.ts

export const APP_NAME = 'WAFB';
export const APP_FULL_NAME = 'WebADB Forensics Bridge';
export const APP_VERSION = '0.1.0';
export const APP_LICENSE = 'GPL-3.0';

export const GITHUB_URL = 'https://git.lattuga.net/garrett/wafb';

export const DEVICE_REQUIREMENTS = [
  'Chrome or Edge browser (WebUSB required)',
  'Android device with USB debugging enabled',
  'USB cable connected to your computer',
  'Desktop ADB server must be stopped (run: adb kill-server)',
] as const;

export const STATUS_ICONS = {
  idle: '⏸️',
  connecting: '🔌',
  connected: '🔌',
  generating: '⚙️',
  downloading: '⬇️',
  success: '✓',
  error: '✗',
} as const;