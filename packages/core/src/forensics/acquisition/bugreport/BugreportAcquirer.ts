import type { ADBDevice } from '../../../adb/device';
import { Logger } from '../../../utils/logger';
import type {
  AcquisitionConfig,
  AcquisitionProgress,
  AcquisitionResult
} from '../base/types';

/**
 * Opzioni specifiche per Bugreport
 */
export interface BugreportConfig extends AcquisitionConfig {
  /**
   * Se usare bugreportz (zip) o bugreport legacy (txt)
   */
  preferZip?: boolean;
  
  /**
   * Se rimuovere il file dal dispositivo dopo il download
   */
  cleanupAfter?: boolean;
}

/**
 * Acquirer per Bugreport Android
 */
export class BugreportAcquirer {
  private logger: Logger;
  
  constructor(
    private device: ADBDevice,
    private config: BugreportConfig = {}
  ) {
    this.logger = new Logger('BugreportAcquirer');
  }

  /**
   * Esegue l'acquisizione del bugreport
   */
  async acquire(
    onProgress?: (progress: AcquisitionProgress) => void
  ): Promise<AcquisitionResult> {
    const startTime = new Date();
    
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
      const useZip = await this.checkBugreportzSupport();
      
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
      
      const bugreportPath = await this.generateBugreport(useZip);

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
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `bugreport-${deviceInfo.model}-${timestamp}.${useZip ? 'zip' : 'txt'}`;
      
      this.downloadBlob(blob, fileName);

      // Step 6: Cleanup (optional)
      if (this.config.cleanupAfter !== false) {
        try {
          if (!useZip || bugreportPath.startsWith('/sdcard/')) {
            await this.device.commands.shell(`rm ${bugreportPath}`);
            this.logger.info('Cleaned up bugreport file from device');
          }
        } catch (err) {
          this.logger.warn('Failed to cleanup bugreport file', err);
        }
      }

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
          deviceInfo
        }
      };

      // Compute hash if requested
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

      return {
        success: false,
        type: 'bugreport',
        startTime,
        endTime,
        duration,
        error: errorMessage
      };
    }
  }

  /**
   * Verifica se bugreportz è disponibile
   */
  private async checkBugreportzSupport(): Promise<boolean> {
    if (this.config.preferZip === false) {
      return false;
    }

    try {
      await this.device.commands.shell('which bugreportz', { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Genera il bugreport sul dispositivo
   */
  private async generateBugreport(useZip: boolean): Promise<string> {
    if (useZip) {
      // Try bugreportz (faster, creates zip)
      const output = await this.device.commands.shell('bugreportz', {
        timeout: 180000 // 3 minutes
      });

      const zipMatch = output.match(/OK:(.+\.zip)/);
      if (zipMatch) {
        return zipMatch[1].trim();
      }
      
      throw new Error('Could not parse bugreportz output');
    } else {
      // Fallback to regular bugreport
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const bugreportPath = `/sdcard/bugreport-${timestamp}.txt`;
      
      await this.device.commands.shell(`bugreport > ${bugreportPath}`, {
        timeout: 180000
      });
      
      return bugreportPath;
    }
  }

  /**
   * Download blob come file
   */
  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Calcola hash SHA-256
   */
  private async computeHash(data: Uint8Array): Promise<string> {
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      throw new Error('Web Crypto API not available');
    }

    // Crea una nuova Uint8Array con ArrayBuffer garantito (non SharedArrayBuffer)
    const normalizedData = new Uint8Array(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', normalizedData);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Helper per notificare progresso
   */
  private notifyProgress(
    onProgress: ((progress: AcquisitionProgress) => void) | undefined,
    progress: number,
    message: string,
    status: AcquisitionProgress['status'],
    deviceInfo?: AcquisitionProgress['deviceInfo']
  ): void {
    if (onProgress) {
      onProgress({
        progress: Math.min(100, Math.max(0, progress)),
        message,
        status,
        deviceInfo
      });
    }
  }
}