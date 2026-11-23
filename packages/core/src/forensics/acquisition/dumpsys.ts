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

      // Streamed: stdout goes straight to the consumer; no full buffering.
      this.notifyProgress(onProgress, 90, 'Streaming dumpsys output...', 'running');
      const { stream: rawStream, outcome } = await new DumpsysStreamCommand(this.device).exec({ signal: this.config.signal });

      if (this.config.computeHash) {
        const h = await hashingPassthrough('sha-256');
        file = {
          fileName,
          fileSize: 0,
          sizeUnknown: true,
          // pipeThrough: source errors reach the consumer and reject the digest.
          stream: rawStream.pipeThrough({ writable: h.writable, readable: h.readable }),
          hashPromise: h.hashPromise,
          outcome,
          description: 'Dumpsys output',
          mimeType: 'text/plain',
        };
      } else {
        file = {
          fileName,
          fileSize: 0,
          sizeUnknown: true,
          stream: rawStream,
          outcome,
          description: 'Dumpsys output',
          mimeType: 'text/plain',
        };
      }
      this.logger.info('Dumpsys stream ready, handing off to consumer', { fileName });

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      // Only the stream is ready: completion is decided by the consumer.
      this.notifyProgress(onProgress, 95, 'Dumpsys stream ready — data is being transferred...', 'running');

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