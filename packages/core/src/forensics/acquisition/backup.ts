import { Acquirer, AcquisitionConfig, AcquisitionProgress, AcquisitionResult } from '.';
import { GenerateBackupCommand, ReadFileCommand } from '../../adb/commands';
import { ADBDevice } from '../..';

export interface BackupConfig extends AcquisitionConfig {
  type?: string;
  useCompression?: boolean;
}

// TODO fix name 
export interface BackupResult {
  outputPath: string;
}

export class BackupAcquirer extends Acquirer {
  constructor(
    device: ADBDevice,
    private backupConfig: BackupConfig = { type: 'full', useCompression: false }
  ) {
    super(device, backupConfig, 'backup');
  }

  async acquire(onProgress?: (progress: AcquisitionProgress) => void): Promise<AcquisitionResult> {
    const config = {
      type: this.backupConfig.type ?? 'full',
      useCompression: this.backupConfig.useCompression ?? false,
    };
    const startTime = new Date();

    try {
      this.logger.info('Starting backup acquisition');

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

      // Step 2: Generate backup
      this.notifyProgress(
        onProgress,
        40,
        'Generating backup (this may take several minutes)...',
        'running'
      );

      const backupOutputPath = await this.generateBackup(config.type, config.useCompression);
      this.notifyProgress(onProgress, 80, 'Backup generation completed.', 'running');

      const backupData = await new ReadFileCommand(this.device.adb).exec({ path: backupOutputPath.outputPath });
      this.logger.info(`Backup read from device, size: ${backupData.length} bytes`);

      // Step 3: Create blob and prepare result
      this.notifyProgress(onProgress, 90, 'Preparing backup...', 'running');

      const blob = new Blob([backupData.buffer as ArrayBuffer], {
        type: 'application/vnd.android.backup',
      });
      const fileName = this.generateFileName('backup', 'ab');
      this.logger.info(`Backup prepared: ${fileName}, size: ${backupData.length} bytes`);

      // Step 4: Finalize acquisition
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      this.notifyProgress(
        onProgress,
        100,
        'Backup acquisition completed successfully.',
        'completed'
      );

      const result: AcquisitionResult = {
        success: true,
        type: 'backup',
        fileName,
        fileSize: backupData.length,
        startTime,
        endTime,
        duration,
        data: {
          format: config.useCompression ? 'compressed' : 'uncompressed',
          backupType: config.type,
          deviceInfo,
        },
        blob,
      };

      if (this.config.computeHash) {
        result.hash = await this.computeHash(backupData);
      }

      this.logger.info('Backup acquisition completed', {
        fileName,
        fileSize: backupData.length,
        duration,
      });

      return result;
    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error('Backup acquisition failed', error);
      this.notifyProgress(onProgress, 0, `Error: ${errorMessage}`, 'failed');

      return {
        success: false,
        type: 'backup',
        startTime,
        endTime,
        duration,
        error: errorMessage,
      };
    }
  }

  private async generateBackup(type: string, useCompression: boolean): Promise<BackupResult> {
    let backupType = '';
    let timeout = 600000; // Default: 10 minutes
    let idleTimeout = 45000; // Default: 45 seconds

    switch (type) {
      case 'sms-only': {
        backupType = 'com.android.providers.telephony';
        timeout = 120000; // 2 minutes for SMS-only
        idleTimeout = 30000; // 30 seconds idle
        break;
      }
      case 'full': {
        backupType = 'all';
        timeout = 600000; // 10 minutes for full backup
        idleTimeout = 45000; // 45 seconds idle
        break;
      }
      case 'none': {
        // No backup
        return { outputPath: '' };
      }
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `/sdcard/backup-${timestamp}.ab`;

    return await new GenerateBackupCommand(this.device.adb).exec({
      type: backupType,
      outputPath: backupPath,
      useCompression,
      timeout,
      idleTimeout,
    });
  }
}
