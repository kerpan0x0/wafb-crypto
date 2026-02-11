import { Acquirer } from './acquirer';
import type { AcquisitionConfig, AcquisitionProgress, AcquisitionResult } from '.';
import type { ADBDevice } from '../../adb/device';
import { DumpsysCommand } from '../../adb/commands';

export interface DumpsysConfig extends AcquisitionConfig { }

export class DumpsysAcquirer extends Acquirer {
  constructor(
    device: ADBDevice,
    private dumpsysConfig: DumpsysConfig = {}
  ) {
    super(device, dumpsysConfig, 'dumpsys');
  }

  async acquire(
    onProgress?: (progress: AcquisitionProgress) => void
  ): Promise<AcquisitionResult> {
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

      const timeout = this.config.timeout ?? 600000;
      const dumpsysOutput = await new DumpsysCommand(this.device.adb).exec({ timeout });

      this.logger.info('Dumpsys collection completed', {
        outputSize: dumpsysOutput.length
      });

      this.notifyProgress(
        onProgress,
        90,
        'Processing dumpsys output...',
        'running'
      );

      // Step 3: Convert to blob and create download
      const textBytes = new TextEncoder().encode(dumpsysOutput);
      const blob = new Blob([textBytes], { type: 'text/plain' });
      const fileName = this.generateFileName('dumpsys', 'txt', deviceInfo.model);

      this.downloadBlob(blob, fileName);

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      this.notifyProgress(onProgress, 100, 'Dumpsys acquisition completed!', 'completed');

      // Step 4: Build result
      const result: AcquisitionResult = {
        success: true,
        type: 'dumpsys' as any,
        fileName,
        fileSize: textBytes.length,
        startTime,
        endTime,
        duration,
        data: {
          deviceInfo,
          outputSize: dumpsysOutput.length,
          lines: dumpsysOutput.split('\n').length
        }
      };

      if (this.config.computeHash) {
        result.hash = await this.computeHash(textBytes);
      }

      this.logger.info('Dumpsys acquisition completed', {
        fileName,
        fileSize: textBytes.length,
        duration
      });

      return result;

    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error('Dumpsys acquisition failed', error);
      this.notifyProgress(onProgress, 0, `Error: ${errorMessage}`, 'failed');

      return {
        success: false,
        type: 'dumpsys' as any,
        startTime,
        endTime,
        duration,
        error: errorMessage
      };
    }
  }
}