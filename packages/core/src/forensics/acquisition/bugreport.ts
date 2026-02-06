import { 
  WhichCommand, 
  DeleteFileCommand, 
  BugreportCommand, 
  BugreportzCommand, 
  ReadFileCommand 
} from '../../adb/commands';
import type { ADBDevice } from '../../adb';
import { Acquirer } from './acquirer';
import type {
  AcquisitionConfig,
  AcquisitionProgress,
  AcquisitionResult
} from '.';

export interface BugreportConfig extends AcquisitionConfig {
  preferZip?: boolean;
  cleanupAfter?: boolean;
}

export class BugreportAcquirer extends Acquirer {
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

      const bugreportOut = await this.generateBugreport(useZip);
      bugreportPath = this.parseBugreportPath(bugreportOut)

      // Step 4: Download file
      this.notifyProgress(
        onProgress,
        70,
        `Downloading ${useZip ? 'zip' : 'text'} file from device...`,
        'running'
      );

      const bugreportData = await new ReadFileCommand(this.device.adb).exec({ path: bugreportPath });

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

  private async performCleanup(bugreportPath: string, useZip: boolean): Promise<void> {
    if (this.bugreportConfig.cleanupAfter === false) {
      this.logger.warn('Cleanup disabled by configuration - file remains on device');
      this.cleanupPerformed = false;
      return;
    }

    try {
      if (!useZip || bugreportPath.startsWith('/sdcard/')) {
        this.logger.info('Attempting cleanup of bugreport file', { path: bugreportPath });

        await new DeleteFileCommand(this.device.adb).exec({ path: bugreportPath });

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

  private async checkBugreportzSupport(): Promise<boolean> {
    if (this.bugreportConfig.preferZip === false) {
      return false;
    }

    return '' !== (await new WhichCommand(this.device.adb).exec({ command: 'bugreportz' }));
  }

  private async generateBugreport(useZip: boolean): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const bugreportPath = `/sdcard/bugreport-${timestamp}.txt`;

    if (useZip) {
      return await new BugreportzCommand(this.device.adb).exec({ timeout: 180000 });
    } else {
      return await new BugreportCommand(this.device.adb).exec({ outputPath: bugreportPath, timeout: 180000 });
    }
  }

  public wasCleanupPerformed(): boolean {
    return this.cleanupPerformed;
  }

  private parseBugreportPath(input: string): string {
    if (!input) return "";

    const trimmedInput = input.trim();

    // Caso A: Formato bugreportz (es: "OK:/data/user_de/0/.../file.zip")
    // Cerchiamo OK: ovunque e prendiamo quello che segue
    const okMatch = trimmedInput.match(/OK:\s*([^\s\r\n]+)/i);
    if (okMatch && okMatch[1]) {
      return okMatch[1].trim();
    }

    // Caso B: L'output è già un percorso (es: "/sdcard/bugreport-....txt")
    // Se la stringa inizia con / e non contiene spazi (o prendiamo la prima parola), è il nostro path
    if (trimmedInput.startsWith('/')) {
      // Prendiamo solo la prima riga/parola per evitare residui della shell
      return trimmedInput.split(/[\s\r\n]/)[0];
    }

    // Se arriviamo qui, logghiamo per capire cosa ha risposto la shell
    this.logger.warn('Unrecognized bugreport output format', { rawOutput: trimmedInput });
    return "";
  }
}