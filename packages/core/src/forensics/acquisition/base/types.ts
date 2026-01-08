// packages/core/src/forensics/acquisition/base/types.ts

import type { DeviceProperties } from '../../../adb/device';

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
  | 'pending'      // In attesa di esecuzione
  | 'running'      // In esecuzione
  | 'completed'    // Completata con successo
  | 'failed'       // Fallita
  | 'skipped';     // Saltata

/**
 * Configurazione base per un'acquisizione
 */
export interface AcquisitionConfig {
  /**
   * Timeout in millisecondi
   */
  timeout?: number;
  
  /**
   * Se calcolare hash per integrità
   */
  computeHash?: boolean;
  
  /**
   * Opzioni specifiche per tipo di acquisizione
   */
  options?: Record<string, unknown>;
}

/**
 * Progresso di un'acquisizione
 */
export interface AcquisitionProgress {
  /**
   * Percentuale completamento (0-100)
   */
  progress: number;
  
  /**
   * Messaggio di stato
   */
  message: string;
  
  /**
   * Status corrente
   */
  status: AcquisitionStatus;
  
  /**
   * Informazioni sul dispositivo (opzionale)
   */
  deviceInfo?: DeviceProperties;
}

/**
 * Risultato di un'acquisizione
 */
export interface AcquisitionResult {
  /**
   * Se l'acquisizione è andata a buon fine
   */
  success: boolean;
  
  /**
   * Tipo di acquisizione
   */
  type: AcquisitionType;
  
  /**
   * Nome file generato (se applicabile)
   */
  fileName?: string;
  
  /**
   * Dimensione file in bytes (se applicabile)
   */
  fileSize?: number;
  
  /**
   * Hash del file (se computeHash=true)
   */
  hash?: string;
  
  /**
   * Timestamp inizio
   */
  startTime: Date;
  
  /**
   * Timestamp fine
   */
  endTime: Date;
  
  /**
   * Durata in millisecondi
   */
  duration: number;
  
  /**
   * Dati aggiuntivi specifici del tipo
   */
  data?: unknown;
  
  /**
   * Messaggio di errore (se success=false)
   */
  error?: string;
}

/**
 * Metadati di un tipo di acquisizione
 */
export interface AcquisitionMetadata {
  /**
   * Identificatore unico
   */
  id: AcquisitionType;
  
  /**
   * Nome visualizzato
   */
  name: string;
  
  /**
   * Descrizione
   */
  description: string;
  
  /**
   * Categoria
   */
  category: 'system' | 'apps' | 'communications' | 'media' | 'network' | 'logs';
  
  /**
   * Icona (emoji o nome lucide-react)
   */
  icon: string;
  
  /**
   * Versione minima Android richiesta (SDK level)
   */
  minSdkVersion: number;
  
  /**
   * Se richiede root
   */
  requiresRoot: boolean;
  
  /**
   * Tempo stimato (in secondi)
   */
  estimatedDuration: number;
  
  /**
   * Se è abilitato di default
   */
  defaultEnabled: boolean;
}

/**
 * Stato di una sessione di acquisizione multipla
 */
export interface AcquisitionSession {
  /**
   * ID univoco sessione
   */
  id: string;
  
  /**
   * Timestamp inizio sessione
   */
  startTime: Date;
  
  /**
   * Timestamp fine sessione (se completata)
   */
  endTime?: Date;
  
  /**
   * Informazioni dispositivo
   */
  deviceInfo: DeviceProperties;
  
  /**
   * Acquisizioni selezionate
   */
  acquisitions: Array<{
    type: AcquisitionType;
    status: AcquisitionStatus;
    progress: number;
    result?: AcquisitionResult;
  }>;
  
  /**
   * Progresso totale (0-100)
   */
  totalProgress: number;
  
  /**
   * Status generale
   */
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