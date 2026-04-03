import { beforeAll } from 'vitest';

// Mock completo dei tipi di acquisizione
const MOCK_ACQUISITION_TYPES = {
  bugreport: {
    id: 'bugreport',
    name: 'Bugreport',
    description: 'Complete system diagnostic report including logs, configurations, and system state',
    category: 'system',
    icon: '📋',
    minSdkVersion: 14,
    requiresRoot: false,
    estimatedDuration: 120,
    defaultEnabled: true
  },
  packages: {
    id: 'packages',
    name: 'Installed Packages',
    description: 'List of all installed applications with version and installation details',
    category: 'apps',
    icon: '📦',
    minSdkVersion: 14,
    requiresRoot: false,
    estimatedDuration: 10,
    defaultEnabled: true
  },
  logcat: {
    id: 'logcat',
    name: 'System Logs (Logcat)',
    description: 'System logs including application and system events',
    category: 'logs',
    icon: '📝',
    minSdkVersion: 14,
    requiresRoot: false,
    estimatedDuration: 5,
    defaultEnabled: true
  },
  system_info: {
    id: 'system_info',
    name: 'System Information',
    description: 'Detailed device information, battery status, and system properties',
    category: 'system',
    icon: 'ℹ️',
    minSdkVersion: 14,
    requiresRoot: false,
    estimatedDuration: 5,
    defaultEnabled: true
  },
  databases: {
    id: 'databases',
    name: 'App Databases',
    description: 'SQLite databases from installed applications (requires root)',
    category: 'apps',
    icon: '🗄️',
    minSdkVersion: 14,
    requiresRoot: true,
    estimatedDuration: 60,
    defaultEnabled: false
  },
  media: {
    id: 'media',
    name: 'Media Files',
    description: 'Photos, videos, and audio files from device storage',
    category: 'media',
    icon: '🖼️',
    minSdkVersion: 14,
    requiresRoot: false,
    estimatedDuration: 300,
    defaultEnabled: false
  },
  communications: {
    id: 'communications',
    name: 'Communications',
    description: 'SMS, MMS, call logs, and contacts',
    category: 'communications',
    icon: '💬',
    minSdkVersion: 14,
    requiresRoot: true,
    estimatedDuration: 30,
    defaultEnabled: false
  },
  browser: {
    id: 'browser',
    name: 'Browser Data',
    description: 'Browser history, bookmarks, and cookies',
    category: 'apps',
    icon: '🌐',
    minSdkVersion: 14,
    requiresRoot: true,
    estimatedDuration: 20,
    defaultEnabled: false
  }
};

beforeAll(() => {
  // Usa globalThis che funziona sia in browser che in Node/test environment
  (globalThis as any).__ACQUISITION_TYPES__ = MOCK_ACQUISITION_TYPES;
});