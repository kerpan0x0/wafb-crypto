import type { DeviceProperties } from '../../adb';

// ============================================================================
// TYPES
// ============================================================================

export type AcquisitionType =
  | 'bugreport'
  | 'packages'
  | 'logcat'
  | 'rootBinaries'
  | 'env'
  | 'system_info'
  | 'selinux'
  | 'databases'
  | 'media'
  | 'communications'
  | 'browser'
  | 'mount'
  | 'network';

export type AcquisitionStatus =
  | 'pending'      // In attesa di esecuzione
  | 'running'      // In esecuzione
  | 'completed'    // Completata con successo
  | 'failed'       // Fallita
  | 'skipped';     // Saltata

export interface AcquisitionConfig {
  timeout?: number;
  computeHash?: boolean;
  options?: Record<string, unknown>;
}

export interface AcquisitionProgress {
  progress: number;
  message: string;
  status: AcquisitionStatus;
  deviceInfo?: DeviceProperties;
}

export interface AcquisitionResult {
  success: boolean;
  type: AcquisitionType;
  fileName?: string;
  fileSize?: number;
  hash?: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  data?: unknown;
  error?: string;
}

export interface AcquisitionMetadata {
  id: AcquisitionType;
  name: string;
  description: string;
  category: 'system' | 'apps' | 'communications' | 'media' | 'network' | 'logs';
  icon: string;
  minSdkVersion: number;
  requiresRoot: boolean;
  estimatedDuration: number;
  defaultEnabled: boolean;
}

export interface AcquisitionSession {
  id: string;
  startTime: Date;
  endTime?: Date;
  deviceInfo: DeviceProperties;
  acquisitions: Array<{
    type: AcquisitionType;
    status: AcquisitionStatus;
    progress: number;
    result?: AcquisitionResult;
  }>;
  totalProgress: number;
  status: 'preparing' | 'running' | 'completed' | 'failed' | 'cancelled';
}

export const ACQUISITION_TYPES: Record<AcquisitionType, AcquisitionMetadata> = {
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
  selinux: {
    id: 'selinux',
    name: 'SELinux Information',
    description: 'SELinux mode, policy, contexts, and audit denials',
    category: 'system',
    icon: '🔒',
    minSdkVersion: 14,
    requiresRoot: false,
    estimatedDuration: 15,
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
  },
  network: {
    id: 'network',
    name: 'Network Information',
    description: 'WiFi configurations, network connections, and ARP cache',
    category: 'network',
    icon: '📡',
    minSdkVersion: 14,
    requiresRoot: false,
    estimatedDuration: 5,
    defaultEnabled: true
  },
  rootBinaries: {
    id: 'rootBinaries',
    name: 'Root Binaries',
    description: 'Collection of root binaries present on the device',
    category: 'system',
    icon: '🔧',
    minSdkVersion: 14,
    requiresRoot: false, // TODO check if this should be true
    estimatedDuration: 120,
    defaultEnabled: false
  },
  env: {
    id: 'env',
    name: 'Environment Variables',
    description: 'Collection of environment variables from the device',
    category: 'system',
    icon: '🌐',
    minSdkVersion: 14,
    requiresRoot: false,
    estimatedDuration: 5,
    defaultEnabled: true
  },
  mount: {
    id: 'mount',
    name: 'Mount Points',
    description: 'Information about mounted file systems on the device',
    category: 'system',
    icon: '🗂️',
    minSdkVersion: 14,
    requiresRoot: false,
    estimatedDuration: 5,
    defaultEnabled: true
  },
};

// Export Acquirers 
// TODO export acquirers classes
export { Acquirer } from './acquirer';
export { BugreportAcquirer } from './bugreport';
export { PackagesAcquirer } from './packages';
export { LogcatAcquirer } from './logcat';
export { RootBinariesAcquirer } from './root-binaries';
export { EnvAcquirer } from './env';
export { MountAcquirer } from './mount';
export { SystemInfoAcquirer } from './system';
export { SELinuxAcquirer } from './selinux'
// export { DatabasesAcquirer } from './databases';
// export { MediaAcquirer } from './media';
// export { CommunicationsAcquirer } from './communications';
// export { BrowserAcquirer } from './browser';
// export { NetworkAcquirer } from './network';