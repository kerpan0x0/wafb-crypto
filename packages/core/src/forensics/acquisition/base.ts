import type { ADBDevice } from '../../adb/device';
import type { DeviceProperties } from '../../adb/base';
import { Logger } from '../../utils/logger';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Tipi di acquisizione disponibili
 */
export type AcquisitionType = 
  | 'bugreport'
  | 'packages'
  | 'logcat'
  | 'system_info'
  | 'databases'
  | 'media'
  | 'communications'
  | 'browser'
  | 'network';

/**
 * Status di un'acquisizione
 */
export type AcquisitionStatus = 
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

/**
 * Configurazione base per un'acquisizione
 */
export interface AcquisitionConfig {
  timeout?: number;
  computeHash?: boolean;
  options?: Record<string, unknown>;
}

/**
 * Progresso di un'acquisizione
 */
export interface AcquisitionProgress {
  progress: number;
  message: string;
  status: AcquisitionStatus;
  deviceInfo?: DeviceProperties;
}

/**
 * Risultato di un'acquisizione
 */
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

/**
 * Metadati di un tipo di acquisizione
 */
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

/**
 * Stato di una sessione di acquisizione multipla
 */
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

/**
 * Registry dei tipi di acquisizione disponibili
 */
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
  }
};

// ============================================================================
// BASE ACQUIRER CLASS
// ============================================================================

/**
 * Classe base per tutti gli acquirer
 */
export abstract class BaseAcquirer {
  protected logger: Logger;

  constructor(
    protected device: ADBDevice,
    protected config: AcquisitionConfig = {},
    protected acquisitionType: AcquisitionType
  ) {
    this.logger = new Logger(`${acquisitionType}Acquirer`);
  }

  /**
   * Helper per notificare progresso
   */
  protected notifyProgress(
    onProgress: ((progress: AcquisitionProgress) => void) | undefined,
    progress: number,
    message: string,
    status: AcquisitionProgress['status'],
    deviceInfo?: AcquisitionProgress['deviceInfo']
  ): void {
    if (onProgress) {
      onProgress({
        progress: Math.min(100, Math.max(0, progress)),
        message,
        status,
        deviceInfo
      });
    }
  }

  /**
   * Download blob come file
   */
  protected downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Calcola hash SHA-256
   */
  protected async computeHash(data: Uint8Array): Promise<string> {
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      throw new Error('Web Crypto API not available');
    }

    const normalizedData = new Uint8Array(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', normalizedData);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Genera nome file con timestamp
   */
  protected generateFileName(prefix: string, extension: string, deviceModel: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${prefix}-${deviceModel}-${timestamp}.${extension}`;
  }
}