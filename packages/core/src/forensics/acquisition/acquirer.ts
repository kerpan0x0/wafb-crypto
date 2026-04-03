import type { Device } from '../../adb';
import { Logger } from '../../utils/logger';
import { AcquisitionConfig, AcquisitionType, AcquisitionProgress } from '.';

/** @internal */
export abstract class Acquirer {
  protected logger: Logger;

  constructor(
    protected device: Device,
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

  protected generateFileName(prefix: string, extension: string): string {
    return `${prefix}.${extension}`;
  }
}
