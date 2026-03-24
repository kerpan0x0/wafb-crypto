import { Acquirer, AcquisitionConfig, AcquisitionProgress, AcquisitionResult, AcquisitionFile } from '.';
import { BackupCommand, WhichCommand } from '../../commands';
import { ADBCommandError } from '../../utils/errors';
import { Device } from '../../adb';
import { hashingPassthrough } from '../../utils/stream-helpers';

export interface BackupConfig extends AcquisitionConfig {
  type?: string;
}

/** Candidate paths for the `bu` binary, tried in order. */
const BU_CANDIDATES = ['/system/bin/bu', '/system/xbin/bu', 'bu'];

export class BackupAcquirer extends Acquirer {
  constructor(
    device: Device,
    protected config: BackupConfig = { type: 'full' }
  ) {
    super(device, config, 'backup');
  }

  async acquire(onProgress?: (progress: AcquisitionProgress) => void): Promise<AcquisitionResult> {
    const config = {
      type: this.config.type ?? 'full',
    };
    const startTime = new Date();

    try {
      this.logger.info('Starting backup acquisition');

      // ── Step 1: Device info ───────────────────────────────────────────────
      this.notifyProgress(onProgress, 5, 'Reading device information...', 'running');
      const deviceInfo = await this.device.getProperties();
      this.notifyProgress(onProgress, 10, `Connected to ${deviceInfo.model}`, 'running', deviceInfo);

      // ── Step 2: Locate `bu` binary ────────────────────────────────────────
      this.notifyProgress(onProgress, 15, 'Checking backup utility...', 'running');
      const buPath = await this.findBuBinary();

      if (!buPath) {
        throw new ADBCommandError(
          '`bu` binary not found on device. ' +
            'Checked: ' + BU_CANDIDATES.join(', ') +
            '. Backup is not available on this device.'
        );
      }

      this.logger.info(`Found bu binary at: ${buPath}`);

      // ── Step 3: Skip if type is 'none' ────────────────────────────────────
      if (config.type === 'none') {
        return this.skippedResult(startTime);
      }

      // ── Step 4: Start backup, get raw stdout stream ───────────────────────
      // bu backup writes the .ab data to stdout.  We return it as a
      // ReadableStream so the ZIP writer can pipe it directly to disk
      // without ever buffering the full backup in browser memory.
      this.notifyProgress(
        onProgress,
        20,
        'Starting backup — confirm on device if prompted...',
        'running'
      );

      const { backupType, timeout } = this.resolveBackupParams(config.type);
      this.logger.info(`Backup type: ${backupType}, buPath: ${buPath}`);

      const { stream, exited } = await new BackupCommand(this.device).exec({
        type: backupType,
        buPath,
        timeout,
      });

      // Wire up exit logging (non-blocking — the stream is the primary signal)
      exited.then(code => {
        if (code !== 0) {
          this.logger.warn(`bu backup exited with code ${code}`);
        } else {
          this.logger.info('bu backup exited cleanly');
        }
      }).catch(() => {/* ignore */});

      this.notifyProgress(onProgress, 30, 'Backup streaming in progress — confirm on device if prompted...', 'running');

      // ── Step 5: Return stream in AcquisitionFile ──────────────────────────
      // fileSize is unknown until the stream is consumed; set to 0.
      // The ZIP writer will record the real size via the data descriptor.
      const fileName = this.generateFileName('backup', 'ab');

      let acquisitionFile: AcquisitionFile;

      if (this.config.computeHash) {
        const { writable, readable, hashPromise } = await hashingPassthrough('sha-256');
        stream.pipeTo(writable).catch(err => {
          this.logger.error('Backup stream pipe error', err);
        });
        acquisitionFile = {
          stream: readable,
          hashPromise,
          fileName,
          mimeType: 'application/vnd.android.backup',
          fileSize: 0,
          description: 'Android backup',
        };
      } else {
        acquisitionFile = {
          stream,
          fileName,
          mimeType: 'application/vnd.android.backup',
          fileSize: 0,
          description: 'Android backup',
        };
      }

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      // Report 40% — the stream is ready but not yet consumed (ZIP writing
      // happens in the caller after this returns).  The caller will update
      // progress to 100% once the stream has been fully written to disk.
      this.notifyProgress(onProgress, 40, 'Backup stream ready, writing to ZIP...', 'running');

      return {
        success: true,
        type: 'backup',
        files: [acquisitionFile],
        startTime,
        endTime,
        duration,
        data: {
          backupType: config.type,
          buPath,
          deviceInfo,
        },
      };
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

  // ---------------------------------------------------------------------------

  private async findBuBinary(): Promise<string | null> {
    for (const candidate of BU_CANDIDATES) {
      try {
        const found = await new WhichCommand(this.device).exec({ binary: candidate });
        if (found.startsWith('/')) return found;
      } catch {
        // not found — try next
      }
    }
    return null;
  }

  private resolveBackupParams(type: string): { backupType: string; timeout: number } {
    switch (type) {
      case 'sms-only':
        return { backupType: 'com.android.providers.telephony', timeout: 300000 };
      case 'full':
        return { backupType: 'all', timeout: 600000 };
      default:
        return { backupType: type, timeout: 600000 };
    }
  }

  private skippedResult(startTime: Date): AcquisitionResult {
    const endTime = new Date();
    return {
      success: true,
      type: 'backup',
      startTime,
      endTime,
      duration: endTime.getTime() - startTime.getTime(),
      data: { backupType: 'none' },
    };
  }
}