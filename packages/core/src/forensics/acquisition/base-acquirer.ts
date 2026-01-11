import type { ADBDevice } from '../../adb/device';
import { Logger } from '../../utils/logger';
import type {
  AcquisitionConfig,
  AcquisitionProgress,
  AcquisitionType
} from './types';

/**
 * Classe base per tutti gli acquirer
 * Contiene funzionalità comuni per evitare duplicazione
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