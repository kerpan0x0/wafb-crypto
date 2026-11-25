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

      const { stream, outcome } = await new BackupCommand(this.device).exec({
        type: backupType,
        buPath,
        timeout,
        signal: this.config.signal,
      });

      // The exit code is no longer only logged: it is part of the deferred
      // `outcome`, which the consumer must await before declaring the
      // artefact complete.
      outcome?.then(o => {
        if (o.cause !== 'eof' || (o.exitCode !== null && o.exitCode !== 0)) {
          this.logger.warn(`bu backup ended: ${o.cause}, exit code ${o.exitCode ?? 'n/a'}`);
        } else {
          this.logger.info('bu backup ended regularly');
        }
      });

      // ── Step 5: Return stream in AcquisitionFile ──────────────────────────
      // Size is unknown until the stream is consumed: `sizeUnknown` marks it
      // explicitly instead of overloading fileSize = 0.
      const fileName = this.generateFileName('backup', 'ab');

      let acquisitionFile: AcquisitionFile;

      if (this.config.computeHash) {
        const h = await hashingPassthrough('sha-256');
        acquisitionFile = {
          // pipeThrough: errors propagate to the consumer and reject the digest,
          // instead of being only logged (0.3.1 used pipeTo(...).catch(log)).
          stream: stream.pipeThrough({ writable: h.writable, readable: h.readable }),
          hashPromise: h.hashPromise,
          outcome,
          fileName,
          mimeType: 'application/vnd.android.backup',
          fileSize: 0,
          sizeUnknown: true,
          description: 'Android backup',
        };
      } else {
        acquisitionFile = {
          stream,
          outcome,
          fileName,
          mimeType: 'application/vnd.android.backup',
          fileSize: 0,
          sizeUnknown: true,
          description: 'Android backup',
        };
      }

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      // `success: true` here means "the stream is available for reading",
      // NOT "the backup was acquired". Status stays 'running': completion is
      // decided by the consumer once source outcome, digest, encryption and
      // write have all concluded.
      this.notifyProgress(onProgress, 40, 'Backup stream ready — data is being transferred...', 'running');

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