import { Acquirer } from './acquirer';
import type { AcquisitionConfig, AcquisitionProgress, AcquisitionResult } from '.';
import type { ADBDevice } from '../../adb/device';
import {
  FindCommand,
  HashBatchCommand,
  HashCommand,
  ReadFileCommand,
  StatBatchCommand,
} from '../../adb/commands';

export interface FileAcquisitionConfig extends AcquisitionConfig {
  downloadFiles?: boolean;
  additionalPaths?: string[];
  maxTotalSize?: number;
  maxStatBatchSize?: number;
  maxHashBatchSize?: number;
  parallelScans?: number;
  computeFileHashes?: boolean;
  hashAlgorithms?: ('md5' | 'sha1' | 'sha256' | 'sha512')[];
  maxHashFileSize?: number;
  excludeHashPaths?: string[];
  hashMethod?: 'device' | 'browser' | 'auto';
}

interface FileDetail {
  path: string;
  size: number;
  type: string;
  modified_time: number; // MVT requirement (was mtime)
  access_time: number; // MVT requirement (was atime)
  changed_time: number; // MVT requirement (was ctime)
  mode: string; // MVT requirement - file permissions mode
  context: string; // MVT requirement - SELinux context
  permissionsOctal: string;
  permissionsHuman: string;
  owner: string;
  group: string;
  uid: number;
  gid: number;
  inode: number;
  md5?: string;
  sha1?: string;
  sha256?: string;
  sha512?: string;
  mimeType?: string;
}

export class FileAcquirer extends Acquirer {
  private fileDetails: FileDetail[] = [];
  private filePathsSet = new Set<string>();
  private totalBytesScanned = 0;
  private totalBytesHashed = 0;
  private filesHashed = 0;

  private deviceHashSupport: Map<string, boolean> = new Map();

  private readonly DEFAULT_FOLDERS = [
    '/sdcard/',
    '/system/',
    '/system_ext/',
    '/vendor/',
    '/cust/',
    '/product/',
    '/apex/',
    '/data/local/tmp/',
    '/data/media/0/',
    '/data/misc/radio/',
    '/data/vendor/secradio/',
    '/data/log/',
    '/tmp/',
    '/',
    '/data/data/',
  ];

  private readonly EXCLUDED_PATHS = ['/proc', '/sys', '/dev', '/acct'];

  constructor(
    device: ADBDevice,
    private fileConfig: FileAcquisitionConfig = {}
  ) {
    super(device, fileConfig, 'files');

    if (this.fileConfig.downloadFiles === undefined) this.fileConfig.downloadFiles = false;
    if (this.fileConfig.additionalPaths === undefined) this.fileConfig.additionalPaths = [];
    if (this.fileConfig.maxStatBatchSize === undefined) this.fileConfig.maxStatBatchSize = 50;
    if (this.fileConfig.maxHashBatchSize === undefined) this.fileConfig.maxHashBatchSize = 30;
    if (this.fileConfig.parallelScans === undefined) this.fileConfig.parallelScans = 3;
    if (this.fileConfig.computeFileHashes === undefined) this.fileConfig.computeFileHashes = false;
    if (this.fileConfig.hashAlgorithms === undefined) this.fileConfig.hashAlgorithms = ['sha256'];
    if (this.fileConfig.maxHashFileSize === undefined)
      this.fileConfig.maxHashFileSize = 10 * 1024 * 1024;
    if (this.fileConfig.excludeHashPaths === undefined)
      this.fileConfig.excludeHashPaths = ['/system', '/vendor', '/product', '/apex'];
    if (this.fileConfig.hashMethod === undefined) this.fileConfig.hashMethod = 'auto';
  }

  async acquire(onProgress?: (progress: AcquisitionProgress) => void): Promise<AcquisitionResult> {
    const startTime = new Date();

    try {
      this.logger.info('Starting file acquisition');

      this.notifyProgress(onProgress, 5, 'Reading device information...', 'running');
      const deviceInfo = await this.device.getProperties();

      this.notifyProgress(
        onProgress,
        10,
        `Connected to ${deviceInfo.model}`,
        'running',
        deviceInfo
      );

      if (
        this.fileConfig.computeFileHashes &&
        (this.fileConfig.hashMethod === 'device' || this.fileConfig.hashMethod === 'auto')
      ) {
        await this.testDeviceHashSupport();
      }

      this.notifyProgress(
        onProgress,
        15,
        'Collecting list of files... This might take a while...',
        'running'
      );

      const foldersToScan = [...this.DEFAULT_FOLDERS];

      if (this.fileConfig.additionalPaths && this.fileConfig.additionalPaths.length > 0) {
        foldersToScan.push(...this.fileConfig.additionalPaths);
      }

      await this.scanFoldersParallel(foldersToScan, onProgress);

      this.logger.info(`Found ${this.fileDetails.length} files total`);
      this.logger.info(`Hashed ${this.filesHashed} files (${this.totalBytesHashed} bytes)`);

      if (this.fileConfig.downloadFiles) {
        this.notifyProgress(onProgress, 85, 'Downloading files...', 'running');
        await this.downloadAllFiles(onProgress);
      }

      this.notifyProgress(onProgress, 95, 'Preparing output...', 'running');

      // Output direct array for MVT compatibility
      const outputJson = JSON.stringify(this.fileDetails, null, 2);
      const outputBytes = new TextEncoder().encode(outputJson);

      const blob = new Blob([outputBytes], { type: 'application/json' });
      const fileName = this.generateFileName('files', 'json');

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      this.notifyProgress(onProgress, 100, 'File acquisition completed', 'completed');

      const result: AcquisitionResult = {
        success: true,
        type: 'files',
        fileName,
        fileSize: outputBytes.length,
        startTime,
        endTime,
        duration,
        data: {
          totalFiles: this.fileDetails.length,
          totalSize: this.totalBytesScanned,
          filesHashed: this.filesHashed,
          totalBytesHashed: this.totalBytesHashed,
          downloadedFiles: this.fileConfig.downloadFiles || false,
          hashAlgorithms: this.fileConfig.computeFileHashes ? this.fileConfig.hashAlgorithms : [],
        },
        blob,
      };

      if (this.config.computeHash) {
        result.hash = await this.computeHash(outputBytes);
      }

      this.logger.info('File acquisition completed', {
        fileName,
        totalFiles: this.fileDetails.length,
        totalSize: this.totalBytesScanned,
        filesHashed: this.filesHashed,
        duration,
      });

      return result;
    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error('File acquisition failed', error);
      this.notifyProgress(onProgress, 0, `Error: ${errorMessage}`, 'failed');

      return {
        success: false,
        type: 'files',
        startTime,
        endTime,
        duration,
        error: errorMessage,
      };
    }
  }

  private async testDeviceHashSupport(): Promise<void> {
    this.logger.debug('Testing device hash support');

    const algorithms = this.fileConfig.hashAlgorithms || ['sha256'];

    for (const algo of algorithms) {
      try {
        const hashCmd = new HashCommand(this.device.adb);
        // Test on a small system file that should exist
        const output = await hashCmd.exec({
          path: '/system/build.prop',
          algorithm: algo,
          timeout: 5000,
        });

        const isSupported = this.parseHashOutput(output) !== null;
        this.deviceHashSupport.set(algo, isSupported);

        this.logger.debug(
          `Device ${isSupported ? 'supports' : 'does not support'} ${algo} hashing`
        );
      } catch (error) {
        this.deviceHashSupport.set(algo, false);
        this.logger.debug(`Device does not support ${algo} hashing`);
      }
    }
  }

  private parseHashOutput(output: string): string | null {
    const trimmed = output.trim();

    if (trimmed === 'UNSUPPORTED' || trimmed === '' || trimmed === 'ERROR') {
      return null;
    }

    const gnuMatch = trimmed.match(/^([a-fA-F0-9]+)\s+/);
    if (gnuMatch) {
      return gnuMatch[1].toLowerCase();
    }

    const bsdMatch = trimmed.match(/=\s*([a-fA-F0-9]+)\s*$/);
    if (bsdMatch) {
      return bsdMatch[1].toLowerCase();
    }

    if (/^[a-fA-F0-9]+$/.test(trimmed)) {
      return trimmed.toLowerCase();
    }

    return null;
  }

  private shouldHashFile(file: FileDetail): boolean {
    const maxSize = this.fileConfig.maxHashFileSize || 10 * 1024 * 1024;
    const excludePaths = this.fileConfig.excludeHashPaths || [];

    if (file.size > maxSize) {
      this.logger.debug(`Skipping hash for large file: ${file.path} (${file.size} > ${maxSize})`);
      return false;
    }

    if (excludePaths.some(excluded => file.path.startsWith(excluded))) {
      this.logger.debug(`Skipping hash for excluded path: ${file.path}`);
      return false;
    }

    if (file.sha256 || file.md5) {
      this.logger.debug(`Skipping already hashed file: ${file.path}`);
      return false;
    }

    return true;
  }

  private async computeHashBatch(files: FileDetail[]): Promise<void> {
    const method = this.fileConfig.hashMethod || 'auto';
    const algorithms = this.fileConfig.hashAlgorithms || ['sha256'];

    // Try device-side hashing if available
    if (method === 'device' || method === 'auto') {
      const deviceSupported = algorithms.every(algo => this.deviceHashSupport.get(algo));

      if (deviceSupported) {
        try {
          await this.computeHashBatchOnDevice(files, algorithms);
          return;
        } catch (error) {
          this.logger.warn('Device-side hashing failed, falling back to browser', { error });
          if (method === 'device') {
            throw error;
          }
        }
      }
    }

    if (method === 'browser' || method === 'auto') {
      await this.computeHashBatchInBrowser(files, algorithms);
    }
  }

  private async computeHashBatchOnDevice(files: FileDetail[], algorithms: string[]): Promise<void> {
    if (files.length === 0) {
      return;
    }

    // Start with small batch size for hashing
    let batchSize = 3;
    const minBatchSize = 1;
    const maxBatchSize = this.fileConfig.maxHashBatchSize || 30;

    let i = 0;
    let consecutiveSuccesses = 0;

    this.logger.debug(`Starting adaptive hash batching for ${files.length} files`);

    while (i < files.length) {
      const batch = files.slice(i, i + batchSize);

      try {
        // Build hash requests for this batch
        const hashRequests = batch.flatMap(file =>
          algorithms.map(algo => ({ path: file.path, algorithm: algo }))
        );

        // Calculate timeout based on batch size and file sizes
        // Larger files need more time to hash
        const totalSize = batch.reduce((sum, file) => sum + file.size, 0);
        const estimatedTime = Math.max(30000, Math.min(180000, totalSize / 1024 + 30000));

        this.logger.debug(
          `Hashing batch of ${batch.length} files (total size: ${totalSize} bytes)`,
          {
            batchSize,
            estimatedTimeout: estimatedTime,
          }
        );

        const hashBatchCmd = new HashBatchCommand(this.device.adb);
        const rawOutput = await hashBatchCmd.exec({
          files: hashRequests,
          timeout: estimatedTime,
        });

        const results = this.parseBatchHashOutput(rawOutput, batch);

        // Apply results to files
        for (const file of batch) {
          for (const algo of algorithms) {
            const hash = results.get(`${file.path}:${algo}`);
            if (hash) {
              (file as any)[algo] = hash;
              this.filesHashed++;
              this.totalBytesHashed += file.size;
            }
          }
        }

        // Success! Move to next batch
        i += batchSize;
        consecutiveSuccesses++;

        // Gradually increase batch size on success
        // More conservative than stat: increase after 3 successes instead of 5
        if (consecutiveSuccesses >= 3 && batchSize < maxBatchSize) {
          const oldSize = batchSize;
          batchSize = Math.min(maxBatchSize, batchSize + 1);
          this.logger.debug(
            `Increasing hash batch size from ${oldSize} to ${batchSize} after ${consecutiveSuccesses} successes`
          );
          consecutiveSuccesses = 0;
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Check if timeout
        if (errorMsg.includes('timeout') || errorMsg.includes('timed out')) {
          // Reduce batch size adaptively
          const newBatchSize = Math.max(minBatchSize, Math.floor(batchSize / 2));

          this.logger.warn(
            `Hash batch timeout with size ${batchSize}, reducing to ${newBatchSize}`,
            {
              error: errorMsg.substring(0, 200),
              batchSize,
              fileCount: batch.length,
              samplePath: batch[0]?.path.substring(0, 100),
              totalSize: batch.reduce((sum, f) => sum + f.size, 0),
            }
          );

          batchSize = newBatchSize;
          consecutiveSuccesses = 0;

          // Retry same batch with smaller size (don't increment i)
          continue;
        }

        // Non-timeout error, log and skip this batch
        this.logger.warn(`Failed to hash batch starting at index ${i}`, {
          error: errorMsg.substring(0, 200),
          batchSize,
          fileCount: batch.length,
          skippedFiles: batch.map(f => f.path.substring(0, 50)),
        });

        // Skip this batch and continue with next files
        i += batchSize;
        consecutiveSuccesses = 0;
      }
    }

    this.logger.info(
      `Completed adaptive hash batching: ${this.filesHashed} files hashed (${this.totalBytesHashed} bytes)`
    );
  }

  private parseBatchHashOutput(output: string, files: FileDetail[]): Map<string, string> {
    const results = new Map<string, string>();
    const lines = output.split('\n');

    let currentPath: string | null = null;
    let currentAlgo: string | null = null;

    for (const line of lines) {
      const trimmed = line.trim();

      const startMatch = trimmed.match(/^START:(.+)$/);
      if (startMatch) {
        currentPath = startMatch[1];
        const fileIndex = files.findIndex(f => f.path === currentPath);
        if (fileIndex !== -1) {
          const algoIndex = Math.floor(fileIndex / files.length);
          const algorithms = this.fileConfig.hashAlgorithms || ['sha256'];
          currentAlgo = algorithms[algoIndex] || 'sha256';
        }
        continue;
      }

      if (trimmed === 'ERROR' && currentPath) {
        currentPath = null;
        currentAlgo = null;
        continue;
      }

      if (currentPath && currentAlgo && trimmed) {
        const hash = this.parseHashOutput(trimmed);
        if (hash) {
          results.set(`${currentPath}:${currentAlgo}`, hash);
          currentPath = null;
          currentAlgo = null;
        }
      }
    }

    return results;
  }

  private async computeHashBatchInBrowser(
    files: FileDetail[],
    algorithms: string[]
  ): Promise<void> {
    for (const file of files) {
      try {
        const readCmd = new ReadFileCommand(this.device.adb);
        const fileData = await readCmd.exec({
          path: file.path,
          timeout: 30000,
        });

        for (const algo of algorithms) {
          if (algo === 'md5') {
            this.logger.warn(
              `MD5 not supported in browser SubtleCrypto, skipping for ${file.path}`
            );
            continue;
          }

          const hash = await this.computeHashInBrowser(fileData, algo);
          (file as any)[algo] = hash;
        }

        this.filesHashed++;
        this.totalBytesHashed += file.size;
      } catch (error) {
        this.logger.warn(`Failed to hash file in browser: ${file.path}`, { error });
      }
    }
  }

  private async computeHashInBrowser(data: Uint8Array, algorithm: string): Promise<string> {
    const algoMap: Record<string, string> = {
      sha1: 'SHA-1',
      sha256: 'SHA-256',
      sha512: 'SHA-512',
      // Note: MD5 not supported by SubtleCrypto
    };

    const cryptoAlgo = algoMap[algorithm];
    if (!cryptoAlgo) {
      throw new Error(`Unsupported hash algorithm for browser: ${algorithm}`);
    }

    const hashBuffer = await crypto.subtle.digest(cryptoAlgo, data as BufferSource);
    return this.bufferToHex(hashBuffer);
  }

  private bufferToHex(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private async scanFoldersParallel(
    folders: string[],
    onProgress?: (progress: AcquisitionProgress) => void
  ): Promise<void> {
    const concurrency = this.fileConfig.parallelScans || 3;
    const totalFolders = folders.length;
    let completedFolders = 0;

    for (let i = 0; i < folders.length; i += concurrency) {
      const batch = folders.slice(i, i + concurrency);

      await Promise.all(
        batch.map(async folder => {
          await this.scanFolder(folder);

          completedFolders++;
          const progress = 15 + Math.round((completedFolders / totalFolders) * 60);
          this.notifyProgress(
            onProgress,
            progress,
            `Scanned ${completedFolders}/${totalFolders} folders (${this.fileDetails.length} files found)`,
            'running'
          );
        })
      );
    }
  }

  private shouldExcludePath(path: string): boolean {
    return this.EXCLUDED_PATHS.some(excluded => path.startsWith(excluded));
  }

  private async scanFolder(folder: string): Promise<void> {
    if (this.shouldExcludePath(folder)) {
      this.logger.info(`Skipping virtual filesystem: ${folder}`);
      return;
    }

    try {
      this.logger.debug(`Scanning folder: ${folder}`);

      const findCmd = new FindCommand(this.device.adb);
      const output = await findCmd.exec({
        path: folder,
        type: 'f',
        excludePaths: this.EXCLUDED_PATHS,
        timeout: 120000,
      });

      if (!output || output.trim() === '') {
        this.logger.debug(`No files found in ${folder}`);
        return;
      }

      const filePaths = output
        .split('\n')
        .map(line => line.trim())
        .filter(line => line !== '');

      this.logger.debug(`Found ${filePaths.length} files in ${folder}`);

      await this.collectMetadataBatch(filePaths);
    } catch (error) {
      this.logger.warn(`Failed to scan folder ${folder}`, { error });
    }
  }

  private async collectMetadataBatch(filePaths: string[]): Promise<void> {
    // Start VERY small to avoid timeout with long paths
    let batchSize = 5;
    const minBatchSize = 1;
    const maxBatchSize = this.fileConfig.maxStatBatchSize || 50;

    let i = 0;
    let consecutiveSuccesses = 0;

    while (i < filePaths.length) {
      const batch = filePaths.slice(i, i + batchSize);

      try {
        // Step 1: Stat batch to get metadata
        const statBatchCmd = new StatBatchCommand(this.device.adb);
        const output = await statBatchCmd.exec({
          paths: batch,
          timeout: 120000,
        });

        this.parseBatchStatOutput(batch, output);

        // Step 2: Hash batch if enabled
        if (this.fileConfig.computeFileHashes) {
          // Find files we just added (they're the last ones)
          const startIndex = this.fileDetails.length - batch.length;
          const justAddedFiles = this.fileDetails.slice(startIndex);

          // Filter eligible files for hashing
          const eligibleFiles = justAddedFiles.filter(file => this.shouldHashFile(file));

          if (eligibleFiles.length > 0) {
            await this.computeHashBatch(eligibleFiles);
          }
        }

        // Success! Move to next batch
        i += batchSize;
        consecutiveSuccesses++;

        // Gradually increase batch size on success
        if (consecutiveSuccesses >= 5 && batchSize < maxBatchSize) {
          batchSize = Math.min(15, batchSize + 2);
          this.logger.debug(
            `Increasing batch size to ${batchSize} after ${consecutiveSuccesses} successes`
          );
          consecutiveSuccesses = 0;
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Check if timeout
        if (errorMsg.includes('timeout') || errorMsg.includes('timed out')) {
          // Reduce batch size adaptively
          const newBatchSize = Math.max(minBatchSize, Math.floor(batchSize / 2));

          this.logger.warn(
            `Batch stat timeout with size ${batchSize}, reducing to ${newBatchSize}`,
            {
              error: errorMsg.substring(0, 200),
              samplePath: batch[0]?.substring(0, 100),
            }
          );

          batchSize = newBatchSize;
          consecutiveSuccesses = 0;

          // Retry same batch with smaller size (don't increment i)
          continue;
        }

        // Non-timeout error, skip batch and continue
        this.logger.warn(`Failed to stat batch starting at index ${i}`, {
          error: errorMsg.substring(0, 200),
        });
        i += batchSize;
        consecutiveSuccesses = 0;
      }
    }
  }

  private parseBatchStatOutput(paths: string[], output: string): void {
    const lines = output.split('\n');
    const trimmedLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed !== '') {
        trimmedLines.push(trimmed);
      }
    }

    for (let i = 0; i < trimmedLines.length; i++) {
      const line = trimmedLines[i];
      const path = paths[i];

      if (line === 'ERROR' || line === '') {
        this.logger.debug(`Skipping failed stat for ${path}`);
        continue;
      }

      try {
        const detail = this.parseStatLine(path, line);
        if (detail) {
          this.addFileDetail(detail);
        }
      } catch (error) {
        this.logger.debug(`Failed to parse stat output for ${path}`, { error, line });
      }
    }
  }

  private parseStatLine(path: string, line: string): FileDetail | null {
    const parts = line.split('|');

    if (parts.length !== 13) {
      this.logger.warn(`Unexpected stat format for ${path}`, { parts: parts.length });
      return null;
    }

    const [
      sizeStr,
      typeStr,
      mtimeStr,
      atimeStr,
      ctimeStr,
      octalPerms,
      humanPerms,
      owner,
      group,
      uidStr,
      gidStr,
      inodeStr,
      selinuxContext,
    ] = parts;

    const size = parseInt(sizeStr, 10);
    const mtime = parseInt(mtimeStr, 10);
    const atime = parseInt(atimeStr, 10);
    const ctime = parseInt(ctimeStr, 10);
    const uid = parseInt(uidStr, 10);
    const gid = parseInt(gidStr, 10);
    const inode = parseInt(inodeStr, 10);

    if (isNaN(size) || isNaN(mtime) || isNaN(uid) || isNaN(gid) || isNaN(inode)) {
      this.logger.warn(`Invalid numeric values in stat for ${path}`);
      return null;
    }

    if (typeStr === 'directory') {
      return null;
    }

    return {
      path,
      size,
      type: typeStr,
      modified_time: mtime,
      access_time: atime,
      changed_time: ctime,
      mode: humanPerms, // MVT expects human-readable mode string
      context: selinuxContext || '', // SELinux context from stat -c %C
      permissionsOctal: octalPerms,
      permissionsHuman: humanPerms,
      owner,
      group,
      uid,
      gid,
      inode,
    };
  }

  private addFileDetail(detail: FileDetail): void {
    // O(1) deduplication check using Set
    if (this.filePathsSet.has(detail.path)) {
      return;
    }

    this.fileDetails.push(detail);
    this.filePathsSet.add(detail.path);
    this.totalBytesScanned += detail.size;
  }

  private async downloadAllFiles(
    onProgress?: (progress: AcquisitionProgress) => void
  ): Promise<void> {
    this.logger.info('Downloading files (optional feature)...');

    let downloadedCount = 0;
    let downloadedSize = 0;

    for (let i = 0; i < this.fileDetails.length; i++) {
      const file = this.fileDetails[i];
      const progress = 85 + Math.round((i / this.fileDetails.length) * 10);

      if (this.fileConfig.maxTotalSize && downloadedSize >= this.fileConfig.maxTotalSize) {
        this.logger.warn('Reached maximum download size limit, stopping downloads');
        break;
      }

      this.notifyProgress(
        onProgress,
        progress,
        `Downloading ${downloadedCount + 1}/${this.fileDetails.length}: ${this.getDisplayPath(file.path)}`,
        'running'
      );

      try {
        const readCmd = new ReadFileCommand(this.device.adb);
        await readCmd.exec({
          path: file.path,
          timeout: 30000,
        });

        downloadedCount++;
        downloadedSize += file.size;
      } catch (error) {
        this.logger.warn(`Failed to download file: ${file.path}`, { error });
      }
    }

    this.logger.info(`Downloaded ${downloadedCount} files (${downloadedSize} bytes)`);
  }

  private getDisplayPath(path: string): string {
    if (path.length <= 50) {
      return path;
    }
    return '...' + path.substring(path.length - 47);
  }
}
