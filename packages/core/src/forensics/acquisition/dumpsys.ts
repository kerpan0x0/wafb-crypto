import { Acquirer } from './acquirer';
import type { AcquisitionConfig, AcquisitionProgress, AcquisitionResult, AcquisitionFile } from '.';
import type { ADBDevice } from '../../adb/device';
import { DumpsysCommand, DumpsysStreamCommand } from '../../adb/commands';

export interface DumpsysConfig extends AcquisitionConfig { }

export class DumpsysAcquirer extends Acquirer {
  constructor(
    device: ADBDevice,
    protected config: DumpsysConfig = {}
  ) {
    super(device, config, 'dumpsys');
  }

  async acquire(onProgress?: (progress: AcquisitionProgress) => void): Promise<AcquisitionResult> {
    const startTime = new Date();

    try {
      this.logger.info('Starting dumpsys acquisition');

      // Step 1: Get device info (10%)
      this.notifyProgress(onProgress, 10, 'Reading device information...', 'running');
      const deviceInfo = await this.device.getProperties();

      this.notifyProgress(
        onProgress,
        20,
        `Connected to ${deviceInfo.model}`,
        'running',
        deviceInfo
      );

      // Step 2: Execute dumpsys (30-90%)
      this.notifyProgress(
        onProgress,
        30,
        'Collecting device diagnostic information. This might take a while...',
        'running'
      );

      const fileName = this.generateFileName('dumpsys', 'txt');
      let file: AcquisitionFile;

      if (this.config.computeHash) {
        // Buffered mode: load the full output into memory so we can hash it.
        // Use only when forensic integrity is required — large outputs (50-200 MB)
        // will be held in browser memory for the duration of the acquisition.
        this.notifyProgress(onProgress, 90, 'Processing dumpsys output...', 'running');

        const timeout = this.config.timeout ?? 600000;
        const output = await new DumpsysCommand(this.device.adb).exec({ timeout });

        const textBytes = new TextEncoder().encode(output);
        const blob = new Blob([textBytes], { type: 'text/plain' });

        file = {
          fileName,
          fileSize: blob.size,
          blob,
          description: 'Dumpsys output',
          mimeType: 'text/plain',
        };

        file.hash = await this.computeHash(textBytes);

        this.logger.info('Dumpsys acquisition completed (buffered)', {
          fileName,
          fileSize: blob.size,
        });
      } else {
        // Streaming mode (default): pipe stdout directly into the ZIP writer
        // without buffering in memory. fileSize is unknown until the stream
        // is consumed. Hash computation is skipped.
        this.notifyProgress(onProgress, 90, 'Streaming dumpsys output into archive...', 'running');

        const { stream: dumpsysStream } = await new DumpsysStreamCommand(this.device.adb).exec();

        file = {
          fileName,
          fileSize: 0,
          stream: dumpsysStream,
          description: 'Dumpsys output',
          mimeType: 'text/plain',
        };

        this.logger.info('Dumpsys stream ready, handing off to ZIP writer', { fileName });
      }

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      this.notifyProgress(onProgress, 100, 'Dumpsys acquisition completed!', 'completed');

      return {
        success: true,
        type: 'dumpsys',
        files: [file],
        startTime,
        endTime,
        duration,
        data: { deviceInfo },
      };
    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error('Dumpsys acquisition failed', error);
      this.notifyProgress(onProgress, 0, `Error: ${errorMessage}`, 'failed');

      return {
        success: false,
        type: 'dumpsys',
        startTime,
        endTime,
        duration,
        error: errorMessage,
      };
    }
  }
}