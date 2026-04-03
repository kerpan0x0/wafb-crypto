import { Acquirer, AcquisitionConfig, AcquisitionProgress, AcquisitionResult, AcquisitionFile } from '.';
import { Device } from '../../adb';
import { MountCommand, ProcMountCommand } from '../../commands';
import { bytesToStream, hashingPassthrough } from '../../utils/stream-helpers';

export class MountAcquirer extends Acquirer {
  constructor(device: Device, config: AcquisitionConfig = {}) {
    super(device, config, 'mount');
  }

  async acquire(onProgress?: (progress: AcquisitionProgress) => void): Promise<AcquisitionResult> {
    const startTime = new Date();

    try {
      this.logger.info('Starting mount acquisition');

      this.notifyProgress(onProgress, 10, 'Reading device information...', 'running');
      const deviceInfo = await this.device.getProperties();

      this.notifyProgress(
        onProgress,
        20,
        `Connected to ${deviceInfo.model}`,
        'running',
        deviceInfo
      );

      this.notifyProgress(onProgress, 30, 'Run Mount command.', 'running');

      const mountOutput = await new MountCommand(this.device).exec();
      const mountData = mountOutput
        .split('\n')
        .map(line => line.trim())
        .filter(line => line !== '');

      this.notifyProgress(onProgress, 50, 'Run ProcMount command.', 'running');
      const procMountOutput = await new ProcMountCommand(this.device).exec();
      const procMountData = procMountOutput
        .split('\n')
        .map(line => line.trim())
        .filter(line => line !== '');
      this.notifyProgress(onProgress, 70, 'Processing mount data.', 'running');

      const combinedMountsSet = new Set<string>([...mountData, ...procMountData]);
      const combinedMounts = Array.from(combinedMountsSet);

      const mountJson = JSON.stringify(combinedMounts, null, 2);

      this.notifyProgress(onProgress, 90, 'Preparing download.', 'running');

      const blobBytes = new TextEncoder().encode(mountJson);

      const fileName = this.generateFileName('mounts', 'json');

      let file: AcquisitionFile;
      if (this.config.computeHash) {
        const { writable, readable, hashPromise } = await hashingPassthrough('sha-256');
        bytesToStream(blobBytes).pipeTo(writable).catch(err => this.logger.error('Hash pipe error', err));
        file = { fileName: fileName, fileSize: blobBytes.length, stream: readable, hashPromise, description: 'Mount points information', mimeType: 'application/json' };
      } else {
        file = { fileName: fileName, fileSize: blobBytes.length, stream: bytesToStream(blobBytes), description: 'Mount points information', mimeType: 'application/json' };
      }

      this.notifyProgress(
        onProgress,
        100,
        'Mount acquisition completed successfully.',
        'completed'
      );

      const endTime = new Date();
      const result: AcquisitionResult = {
        success: true,
        type: this.acquisitionType,
        files: [file],
        startTime,
        endTime,
        duration: endTime.getTime() - startTime.getTime(),
        data: {
          totalMounts: combinedMounts.length,
        },
      };

      return result;
    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error('Mount acquisition failed', { error: errorMessage });

      this.notifyProgress(onProgress, 100, `Mount acquisition failed: ${errorMessage}`, 'failed');

      return {
        success: false,
        type: this.acquisitionType,
        startTime,
        endTime,
        duration,
        error: errorMessage,
      };
    } finally {
      const endTime = new Date();
      this.logger.info(
        `Mount acquisition finished in ${((endTime.getTime() - startTime.getTime()) / 1000).toFixed(2)} seconds`
      );
    }
  }
}