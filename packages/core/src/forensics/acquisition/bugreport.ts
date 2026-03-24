import {
  WhichCommand,
  DeleteFileCommand,
  BugreportCommand,
  BugreportzCommand,
  ReadFileCommand,
} from '../../commands';
import type { BugreportStream } from '../../commands/bugreportCommand';
import type { Device } from '../../adb';
import { bytesToStream, hashingPassthrough } from '../../utils/stream-helpers';
import { Acquirer } from './acquirer';
import type { AcquisitionConfig, AcquisitionProgress, AcquisitionResult, AcquisitionFile } from '.';

export interface BugreportConfig extends AcquisitionConfig {
  preferZip?: boolean;
  cleanupAfter?: boolean;
}

export class BugreportAcquirer extends Acquirer {
  private cleanupPerformed: boolean = false;

  constructor(
    device: Device,
    protected config: BugreportConfig = {}
  ) {
    super(device, config, 'bugreport');
  }

  async acquire(onProgress?: (progress: AcquisitionProgress) => void): Promise<AcquisitionResult> {
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

      const bugreportResult = await this.generateBugreport(useZip);
      useZip = bugreportResult.usedZip;

      let acquisitionFile: AcquisitionFile;

      if (bugreportResult.usedZip) {
        // bugreportz: file is on device storage, download it
        bugreportPath = this.parseBugreportPath(bugreportResult.output);

        this.notifyProgress(onProgress, 70, 'Downloading bugreport zip from device...', 'running');

        const bugreportData = await new ReadFileCommand(this.device).exec({
          path: bugreportPath,
        });

        this.notifyProgress(onProgress, 90, 'Preparing download...', 'running');

        const fileName = this.generateFileName('bugreport', 'zip');

        if (this.config.computeHash) {
          const { writable, readable, hashPromise } = await hashingPassthrough('sha-256');
          bytesToStream(bugreportData).pipeTo(writable).catch(err => {
            this.logger.error('Bugreport hash pipe error', err);
          });
          acquisitionFile = {
            stream: readable,
            hashPromise,
            fileName,
            mimeType: 'application/zip',
            fileSize: bugreportData.length,
            description: 'System bugreport archive',
          };
        } else {
          acquisitionFile = {
            stream: bytesToStream(bugreportData),
            fileName,
            mimeType: 'application/zip',
            fileSize: bugreportData.length,
            description: 'System bugreport archive',
          };
        }

        // Cleanup the file left on the device
        await this.performCleanup(bugreportPath, true);
      } else {
        // Legacy bugreport: stdout stream — pipe directly into the ZIP writer,
        // no temporary file on the device, no ReadFileCommand needed.
        this.notifyProgress(onProgress, 70, 'Streaming bugreport output into archive...', 'running');

        const fileName = this.generateFileName('bugreport', 'txt');

        acquisitionFile = {
          stream: bugreportResult.stream.stream,
          fileName,
          mimeType: 'text/plain',
          fileSize: 0,
          description: 'System bugreport (legacy text format)',
        };

        // Wire up exit logging (non-blocking)
        bugreportResult.stream.exited.then(code => {
          if (code !== 0) this.logger.warn(`bugreport exited with code ${code}`);
          else this.logger.info('bugreport stream completed');
        }).catch(() => {/* ignore */});
      }

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      this.notifyProgress(onProgress, 100, 'Bugreport acquisition completed!', 'completed');

      // Step 7: Build result
      const result: AcquisitionResult = {
        success: true,
        type: 'bugreport',
        files: [acquisitionFile],
        startTime,
        endTime,
        duration,
        data: {
          format: useZip ? 'zip' : 'text',
          deviceInfo: deviceInfo,
          cleanupPerformed: this.cleanupPerformed,
        },
      };

      this.logger.info('Bugreport acquisition completed', {
        fileName: acquisitionFile.fileName,
        streaming: !bugreportResult.usedZip,
        duration,
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
          cleanupPerformed: this.cleanupPerformed,
        },
      };
    }
  }

  private async performCleanup(bugreportPath: string, useZip: boolean): Promise<void> {
    if (this.config.cleanupAfter === false) {
      this.logger.warn('Cleanup disabled by configuration - file remains on device');
      this.cleanupPerformed = false;
      return;
    }

    try {
      if (!useZip || bugreportPath.startsWith('/sdcard/')) {
        this.logger.info('Attempting cleanup of bugreport file', { path: bugreportPath });

        await new DeleteFileCommand(this.device).exec({ path: bugreportPath });

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
        error: err,
      });
    }
  }

  private async checkBugreportzSupport(): Promise<boolean> {
    if (this.config.preferZip === false) {
      return false;
    }

    try {
      const path = await new WhichCommand(this.device).exec({ binary: 'bugreportz' });
      return path.startsWith('/');
    } catch (error) {
      this.logger.warn('Failed to check bugreportz support, falling back to legacy bugreport', error);
      return false;
    }
  }

  private async generateBugreport(useZip: boolean): Promise<
    | { usedZip: true; output: string }
    | { usedZip: false; stream: BugreportStream }
  > {
    if (useZip) {
      try {
        const output = await new BugreportzCommand(this.device).exec({
          timeout: this.config.timeout || 180000,
          idleTimeout: 180000,
          throwOnError: true,
        });
        return { usedZip: true, output };
      } catch (error) {
        this.logger.warn('bugreportz failed, falling back to legacy text bugreport', error);
        // fall through to streaming legacy format
      }
    }

    // Legacy `bugreport` writes to stdout — stream directly into the ZIP,
    // no temporary file on the device needed.
    const stream = await new BugreportCommand(this.device).exec();
    return { usedZip: false, stream };
  }

  public wasCleanupPerformed(): boolean {
    return this.cleanupPerformed;
  }

  private parseBugreportPath(input: string): string {
    if (!input) return '';

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
    return '';
  }
}