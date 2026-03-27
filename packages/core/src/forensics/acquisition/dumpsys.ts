import { Acquirer } from './acquirer';
import type { AcquisitionConfig, AcquisitionProgress, AcquisitionResult, AcquisitionFile } from '.';
import { hashingPassthrough, bytesToStream } from '../../utils/stream-helpers';
import type { Device } from '../../adb/device';
import { DumpsysStreamCommand } from '../../commands';

export interface DumpsysConfig extends AcquisitionConfig { }

export class DumpsysAcquirer extends Acquirer {
  constructor(
    device: Device,
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
        // Hash mode: stream through hashingPassthrough so CRC is computed
        // incrementally — O(1) memory, no buffering of the full output.
        this.notifyProgress(onProgress, 90, 'Streaming dumpsys output with hash...', 'running');

        const { stream: rawStream } = await new DumpsysStreamCommand(this.device).exec();
        const { writable, readable, hashPromise } = await hashingPassthrough('sha-256');

        rawStream.pipeTo(writable).catch(err => {
          this.logger.error('Dumpsys stream pipe error', err);
        });

        file = {
          fileName,
          fileSize: 0,
          stream: readable,
          hashPromise,
          description: 'Dumpsys output',
          mimeType: 'text/plain',
        };

        this.logger.info('Dumpsys stream (with hash) ready, handing off to ZIP writer', { fileName });
      } else {
        // Streaming mode (default): pipe stdout directly into the ZIP writer
        // without buffering in memory.
        this.notifyProgress(onProgress, 90, 'Streaming dumpsys output into archive...', 'running');

        const { stream: dumpsysStream } = await new DumpsysStreamCommand(this.device).exec();

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
        data: {},
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