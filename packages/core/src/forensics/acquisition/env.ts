import { AcquisitionConfig, AcquisitionProgress, AcquisitionResult, AcquisitionFile } from '.';
import { Acquirer } from './acquirer';
import { EnvCommand } from '../../commands';
import type { Device } from '../../adb';
import { bytesToStream, hashingPassthrough } from '../../utils/stream-helpers';

export interface EnvConfig extends AcquisitionConfig { }

export class EnvAcquirer extends Acquirer {
  constructor(
    protected device: Device,
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
      const blobBytes = new TextEncoder().encode(env);

      const fileName = `env.txt`;

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      let file: AcquisitionFile;
      if (this.config.computeHash) {
        const { writable, readable, hashPromise } = await hashingPassthrough('sha-256');
        bytesToStream(blobBytes).pipeTo(writable).catch(err => this.logger.error('Hash pipe error', err));
        file = { fileName: fileName, fileSize: blobBytes.length, stream: readable, hashPromise, description: 'Environment variables', mimeType: 'application/text' };
      } else {
        file = { fileName: fileName, fileSize: blobBytes.length, stream: bytesToStream(blobBytes), description: 'Environment variables', mimeType: 'application/text' };
      }

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
        files: [file],
        startTime,
        endTime,
        duration,
        data: {
          format: 'text',
          deviceInfo: deviceInfo,
        },
      };

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
    const result = await new EnvCommand(this.device).exec();
    this.logger.info(`Retrieved environment variables`);
    return result;
  }
}