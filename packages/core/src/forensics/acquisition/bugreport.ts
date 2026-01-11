import type { ADBDevice } from '../../adb/device';
import { BaseAcquirer } from './base';
import type {
  AcquisitionConfig,
  AcquisitionProgress,
  AcquisitionResult
} from './base';

export interface BugreportConfig extends AcquisitionConfig {
  preferZip?: boolean;
  cleanupAfter?: boolean;
}

/**
 * Acquirer per Bugreport Android
 */
export class BugreportAcquirer extends BaseAcquirer {
  private cleanupPerformed: boolean = false;
  
  constructor(
    device: ADBDevice,
    private bugreportConfig: BugreportConfig = {}
  ) {
    super(device, bugreportConfig, 'bugreport');
  }

  async acquire(
    onProgress?: (progress: AcquisitionProgress) => void
  ): Promise<AcquisitionResult> {
    const startTime = new Date();
    let bugreportPath: string | null = null;
    let useZip = false;
    
    try {
      this.logger.info('Starting bugreport acquisition');
      
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

      // Step 2: Check bugreportz availability
      this.notifyProgress(onProgress, 30, 'Checking bugreport support...', 'running');
      useZip = await this.checkBugreportzSupport();
      
      if (useZip) {
        this.logger.info('Using bugreportz (zip format)');
      } else {
        this.logger.info('Using legacy bugreport (text format)');
      }

      // Step 3: Generate bugreport
      this.notifyProgress(
        onProgress,
        40,
        'Generating bugreport (this may take 1-2 minutes)...',
        'running'
      );
      
      bugreportPath = await this.generateBugreport(useZip);

      // Step 4: Download file
      this.notifyProgress(
        onProgress,
        70,
        `Downloading ${useZip ? 'zip' : 'text'} file from device...`,
        'running'
      );
      
      const bugreportData = await this.device.commands.readFile(bugreportPath);
      
      this.notifyProgress(onProgress, 90, 'Preparing download...', 'running');

      // Step 5: Create blob and trigger download
      const blob = new Blob(
        [bugreportData.buffer as ArrayBuffer],
        { type: useZip ? 'application/zip' : 'text/plain' }
      );
      
      const fileName = this.generateFileName(
        'bugreport',
        useZip ? 'zip' : 'txt',
        deviceInfo.model
      );
      
      this.downloadBlob(blob, fileName);

      // Step 6: Cleanup
      await this.performCleanup(bugreportPath, useZip);

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      this.notifyProgress(onProgress, 100, 'Bugreport downloaded successfully!', 'completed');

      // Step 7: Build result
      const result: AcquisitionResult = {
        success: true,
        type: 'bugreport',
        fileName,
        fileSize: bugreportData.length,
        startTime,
        endTime,
        duration,
        data: {
          format: useZip ? 'zip' : 'text',
          deviceInfo: deviceInfo,
          cleanupPerformed: this.cleanupPerformed
        }
      };

      if (this.config.computeHash) {
        result.hash = await this.computeHash(bugreportData);
      }

      this.logger.info('Bugreport acquisition completed', {
        fileName,
        fileSize: bugreportData.length,
        duration
      });

      return result;

    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      this.logger.error('Bugreport acquisition failed', error);
      this.notifyProgress(onProgress, 0, `Error: ${errorMessage}`, 'failed');

      // CRITICAL: Attempt cleanup even on error
      if (bugreportPath) {
        await this.performCleanup(bugreportPath, useZip);
      }

      return {
        success: false,
        type: 'bugreport',
        startTime,
        endTime,
        duration,
        error: errorMessage,
        data: {
          cleanupPerformed: this.cleanupPerformed
        }
      };
    }
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Performs cleanup of bugreport file from device
   */
  private async performCleanup(bugreportPath: string, useZip: boolean): Promise<void> {
    if (this.bugreportConfig.cleanupAfter === false) {
      this.logger.warn('Cleanup disabled by configuration - file remains on device');
      this.cleanupPerformed = false;
      return;
    }

    try {
      if (!useZip || bugreportPath.startsWith('/sdcard/')) {
        this.logger.info('Attempting cleanup of bugreport file', { path: bugreportPath });
        
        await this.device.commands.deleteFile(bugreportPath);
        
        this.cleanupPerformed = true;
        this.logger.info('Cleaned up bugreport file from device');
      } else {
        this.logger.info('Skipping cleanup - bugreportz file will be auto-cleaned by system');
        this.cleanupPerformed = true;
      }
    } catch (err) {
      this.cleanupPerformed = false;
      this.logger.error('Failed to cleanup bugreport file from device', {
        path: bugreportPath,
        error: err
      });
    }
  }

  /**
   * Check if bugreportz is available
   */
  private async checkBugreportzSupport(): Promise<boolean> {
    if (this.bugreportConfig.preferZip === false) {
      return false;
    }

    return await this.device.commands.checkCommandExists('bugreportz');
  }

  /**
   * Generate bugreport on device
   */
  private async generateBugreport(useZip: boolean): Promise<string> {
    if (useZip) {
      return await this.device.commands.generateBugreportz(180000);
    } else {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const bugreportPath = `/sdcard/bugreport-${timestamp}.txt`;
      return await this.device.commands.generateBugreportLegacy(bugreportPath, 180000);
    }
  }

  /**
   * Expose cleanup status for testing
   */
  public wasCleanupPerformed(): boolean {
    return this.cleanupPerformed;
  }
}