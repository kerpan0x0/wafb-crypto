import { AcquisitionConfig, AcquisitionProgress, AcquisitionResult, AcquisitionFile } from '.';
import { Acquirer } from './acquirer';
import { bytesToStream, hashingPassthrough } from '../../utils/stream-helpers';
import { WhichCommand } from '../../commands';
import type { Device } from '../../adb';

export interface RootBinariesConfig extends AcquisitionConfig { }

export class RootBinariesAcquirer extends Acquirer {
  constructor(
    protected device: Device,
    protected config: RootBinariesConfig = {}
  ) {
    super(device, config, 'rootBinaries');
  }

  async acquire(onProgress?: (progress: AcquisitionProgress) => void): Promise<AcquisitionResult> {
    const startTime = new Date();

    const root_binaries = [
      'su',
      'busybox',
      'supersu',
      'Superuser.apk',
      'KingoUser.apk',
      'SuperSu.apk',
      'magisk',
      'magiskhide',
      'magiskinit',
      'magiskpolicy',
      'magiskboot',
    ];

    try {
      this.logger.info('Starting root binaries acquisition');

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

      // Step 2: Get root binaries
      this.notifyProgress(
        onProgress,
        40,
        'Getting root binaries (this may take 1-2 minutes)...',
        'running'
      );

      const rootBinaries = await this.getAvailableRootBinaries(root_binaries);

      // Step 3: Download file
      this.notifyProgress(onProgress, 70, `Downloading root binaries from device...`, 'running');

      this.notifyProgress(onProgress, 90, 'Preparing download...', 'running');

      const rootBinariesBytes = new TextEncoder().encode(rootBinaries);
      const fileName = `root_binaries.json`;

      let file: AcquisitionFile;
      if (this.config.computeHash) {
        const { writable, readable, hashPromise } = await hashingPassthrough('sha-256');
        bytesToStream(rootBinariesBytes).pipeTo(writable).catch(err => this.logger.error('Hash pipe error', err));
        file = { fileName, fileSize: rootBinariesBytes.length, stream: readable, hashPromise, description: 'Root binaries information', mimeType: 'application/json' };
      } else {
        file = { fileName, fileSize: rootBinariesBytes.length, stream: bytesToStream(rootBinariesBytes), description: 'Root binaries information', mimeType: 'application/json' };
      }

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      this.notifyProgress(onProgress, 100, 'Root binaries downloaded successfully!', 'completed');

      // Step 5: Build result
      const result: AcquisitionResult = {
        success: true,
        type: 'rootBinaries',
        files: [file],
        startTime,
        endTime,
        duration,
        data: {
          format: 'text',
        },
      };

      this.logger.info('Root binaries acquisition completed', {
        fileName,
        fileSize: rootBinaries.length,
        duration,
      });

      return result;
    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error('Root binaries acquisition failed', error);
      this.notifyProgress(onProgress, 0, `Error: ${errorMessage}`, 'failed');

      return {
        success: false,
        type: 'rootBinaries',
        startTime,
        endTime,
        duration,
        error: errorMessage,
        data: {
          format: 'text',
        },
      };
    }
  }

  private async getAvailableRootBinaries(binaries: string[]): Promise<string> {
    const rootBinariesPaths: string[] = [];

    for (const binary of binaries) {
      try {
        const result = await new WhichCommand(this.device).exec({ all: true, binary: binary });

        // Parse multi-line output from `which -a` (e.g., "/path1\n/path2")
        const paths = result
          .split('\n')
          .map(p => p.trim())
          .filter(p => p.startsWith('/'));

        rootBinariesPaths.push(...paths);

        if (paths.length > 0) {
          this.logger.info(`Found ${paths.length} path(s) for binary: ${binary}`);
        }
      } catch (err) {
        this.logger.warn(`Error retrieving binary ${binary}: ${err}`);
      }
    }

    // Remove duplicates (in case same binary found multiple times)
    const uniquePaths = [...new Set(rootBinariesPaths)];

    this.logger.info(`Total unique root binary paths found: ${uniquePaths.length}`);

    return JSON.stringify(uniquePaths, null, 2);
  }
}