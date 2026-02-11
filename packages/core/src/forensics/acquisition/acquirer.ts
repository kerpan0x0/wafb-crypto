import type { ADBDevice } from '../../adb';
import { Logger } from '../../utils/logger';
import { AcquisitionConfig, AcquisitionType, AcquisitionProgress } from '.';

/** @internal */
export abstract class Acquirer {
  protected logger: Logger;

  constructor(
    protected device: ADBDevice,
    protected config: AcquisitionConfig = {},
    protected acquisitionType: AcquisitionType
  ) {
    this.logger = new Logger(`${acquisitionType}Acquirer`);
  }

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
        deviceInfo,
      });
    }
  }

  protected async computeHash(data: Uint8Array): Promise<string> {
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      throw new Error('Web Crypto API not available');
    }

    const normalizedData = new Uint8Array(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', normalizedData);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  protected generateFileName(prefix: string, extension: string): string {
    return `${prefix}.${extension}`;
  }
}
