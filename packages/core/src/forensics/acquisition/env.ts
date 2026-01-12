import { AcquisitionConfig, AcquisitionProgress, AcquisitionResult, BaseAcquirer } from '../..';
import type { ADBDevice } from '../../adb/device';

export interface EnvConfig extends AcquisitionConfig {
}

export class EnvAcquirer extends BaseAcquirer {

  constructor(
    protected device: ADBDevice,
    protected config: EnvConfig = {}
  ) {
    super(device, config, 'env');
  }

  async acquire(
    onProgress?: (progress: AcquisitionProgress) => void
  ): Promise<AcquisitionResult> {
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
      const blob = new Blob(
        [env],
        { type: 'application/text' }
      );

      const fileName = `env.txt`;

      this.downloadBlob(blob, fileName);

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      this.notifyProgress(onProgress, 100, 'Environment variables downloaded successfully!', 'completed');

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
        }
      };

      // Compute hash if requested
      if (this.config.computeHash) {
        result.hash = await this.computeHash(new TextEncoder().encode(env));
      }

      this.logger.info('Environment variables acquisition completed', {
        fileName,
        fileSize: env.length,
        duration
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
        }
      };
    }
  }

  private async getEnv(): Promise<string> {
    let result = '';

    try {
      result = await this.device.commands.shell(`env`);
      this.logger.info(`Retrieved environment variables`);
    } catch (err) {
      this.logger.warn(`Error retrieving environment variables: ${err}`);
    }

    return result;
  }
}