import { AcquisitionConfig, AcquisitionProgress, AcquisitionResult } from '.';
import { Acquirer } from './acquirer';
import { EnvCommand } from '../../adb/commands';
import type { ADBDevice } from '../../adb';

export interface EnvConfig extends AcquisitionConfig {}

export class EnvAcquirer extends Acquirer {
  constructor(
    protected device: ADBDevice,
    protected config: EnvConfig = {}
  ) {
    super(device, config, 'env');
  }

  async acquire(onProgress?: (progress: AcquisitionProgress) => void): Promise<AcquisitionResult> {
    const startTime = new Date();

    try {
      this.logger.info('Starting environment variables acquisition');
      // Step 1: Get device info
      this.notifyProgress(onProgress, 10, 'Reading device information...', 'running');
      const deviceInfo = await this.device.getProperties();

      this.notifyProgress(
        onProgress,
        20,
        `Connected to ${deviceInfo.model}`,
        'running',
        deviceInfo
      );

      // Step 2: Get root binaries
      this.notifyProgress(
        onProgress,
        40,
        'Getting environment variables (this may take 1-2 minutes)...',
        'running'
      );

      const env = await this.getEnv();

      // Step 3: Download file
      this.notifyProgress(
        onProgress,
        70,
        `Downloading environment variables from device...`,
        'running'
      );

      this.notifyProgress(onProgress, 90, 'Preparing download...', 'running');

      // Step 4: Create blob and trigger download
      const blob = new Blob([env], { type: 'application/text' });

      const fileName = `env.txt`;

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      this.notifyProgress(
        onProgress,
        100,
        'Environment variables downloaded successfully!',
        'completed'
      );

      // Step 5: Build result
      const result: AcquisitionResult = {
        success: true,
        type: 'env',
        fileName,
        fileSize: env.length,
        startTime,
        endTime,
        duration,
        data: {
          format: 'text',
          deviceInfo: deviceInfo,
        },
        blob,
      };

      // Compute hash if requested
      if (this.config.computeHash) {
        result.hash = await this.computeHash(new TextEncoder().encode(env));
      }

      this.logger.info('Environment variables acquisition completed', {
        fileName,
        fileSize: env.length,
        duration,
      });

      return result;
    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error('Environment variables acquisition failed', error);
      this.notifyProgress(onProgress, 0, `Error: ${errorMessage}`, 'failed');

      return {
        success: false,
        type: 'env',
        startTime,
        endTime,
        duration,
        error: errorMessage,
        data: {
          format: 'text',
        },
      };
    }
  }

  private async getEnv(): Promise<string> {
    const result = await new EnvCommand(this.device.adb).exec();
    this.logger.info(`Retrieved environment variables`);
    return result;
  }
}
