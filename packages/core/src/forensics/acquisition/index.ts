import type { DeviceProperties } from '../../adb';

// ============================================================================
// TYPES
// ============================================================================

export type AcquisitionType =
  | 'backup'
  | 'bugreport'
  | 'packages'
  | 'logcat'
  | 'logs'
  | 'rootBinaries'
  | 'env'
  | 'system_info'
  | 'selinux'
  | 'mount'
  | 'settings'
  | 'process'
  | 'tmp'
  | 'services'
  | 'files'
  | 'dumpsys';

export type AcquisitionStatus =
  | 'pending' // In attesa di esecuzione
  | 'running' // In esecuzione
  | 'completed' // Completata con successo
  | 'failed' // Fallita
  | 'skipped'; // Saltata

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

export interface AcquisitionFile {
  fileName: string;
  fileSize: number;
  stream: ReadableStream<Uint8Array>;
  hash?: string;
  hashPromise?: Promise<string>;
  description?: string;
  mimeType?: string;
}

export interface AcquisitionResult {
  success: boolean;
  type: AcquisitionType;
  startTime: Date;
  endTime: Date;
  duration: number;
  data?: unknown;
  error?: string;
  files?: AcquisitionFile[];
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
  backup: {
    id: 'backup',
    name: 'Full Backup',
    description: 'Complete backup of the device including apps and data',
    category: 'system',
    icon: '💾',
    minSdkVersion: 14,
    requiresRoot: false,
    estimatedDuration: 300,
    defaultEnabled: true,
  },
  bugreport: {
    id: 'bugreport',
    name: 'Bugreport',
    description:
      'Complete system diagnostic report including logs, configurations, and system state',
    category: 'system',
    icon: '📋',
    minSdkVersion: 14,
    requiresRoot: false,
    estimatedDuration: 120,
    defaultEnabled: true,
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
    defaultEnabled: true,
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
    defaultEnabled: true,
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
    defaultEnabled: true,
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
    defaultEnabled: true,
  },
  logs: {
    id: 'logs',
    name: 'System Log Files',
    description:
      'Collection of system log files from various locations (kernel logs, ANR, system logs)',
    category: 'logs',
    icon: '📄',
    minSdkVersion: 14,
    requiresRoot: false,
    estimatedDuration: 30,
    defaultEnabled: true,
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
    defaultEnabled: false,
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
    defaultEnabled: true,
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
    defaultEnabled: true,
  },
  settings: {
    id: 'settings',
    name: 'System Settings',
    description: 'Export of system settings and configurations',
    category: 'system',
    icon: '⚙️',
    minSdkVersion: 14,
    requiresRoot: false,
    estimatedDuration: 10,
    defaultEnabled: true,
  },
  process: {
    id: 'process',
    name: 'Running Processes',
    description:
      'Snapshot of all running processes with PID, memory usage, CPU info, and SELinux contexts',
    category: 'system',
    icon: '🔄',
    minSdkVersion: 14,
    requiresRoot: false,
    estimatedDuration: 5,
    defaultEnabled: true,
  },
  services: {
    id: 'services',
    name: 'System Services',
    description: 'List of active system services and their status',
    category: 'system',
    icon: '🧩',
    minSdkVersion: 15,
    requiresRoot: false,
    estimatedDuration: 2000,
    defaultEnabled: true,
  },
  files: {
    id: 'files',
    name: 'File Listing',
    description:
      'Complete file system listing with forensic metadata (timestamps, permissions, ownership)',
    category: 'system',
    icon: '📁',
    minSdkVersion: 14,
    requiresRoot: false,
    estimatedDuration: 180,
    defaultEnabled: true,
  },
  tmp: {
    id: 'tmp',
    name: 'Temporary Files',
    description: 'Acquisition of temporary files from the /data/local/tmp directory',
    category: 'system',
    icon: '🗑️',
    minSdkVersion: 14,
    requiresRoot: false,
    estimatedDuration: 15,
    defaultEnabled: false,
  },
  dumpsys: {
    id: 'dumpsys',
    name: 'Dumpsys',
    description:
      'Full diagnostic dump: detailed system service states, memory, battery, network diagnostics.',
    category: 'system',
    icon: '🔧',
    minSdkVersion: 14,
    requiresRoot: false,
    estimatedDuration: 30,
    defaultEnabled: false,
  },
};

// Export Acquirers
export { Acquirer } from './acquirer';
export { BackupAcquirer } from './backup';
export { BugreportAcquirer } from './bugreport';
export { PackagesAcquirer } from './packages';
export { LogcatAcquirer } from './logcat';
export { RootBinariesAcquirer } from './root-binaries';
export { EnvAcquirer } from './env';
export { MountAcquirer } from './mount';
export { SystemInfoAcquirer } from './system';
export { SELinuxAcquirer } from './selinux';
export { SettingsAcquirer } from './settings';
export { ProcessAcquirer } from './process';
export { ServicesAcquirer } from './services';
export { FileAcquirer } from './files';
export { LogAcquirer } from './logs';
export { TmpAcquirer } from './tmp';
export { DumpsysAcquirer } from './dumpsys';