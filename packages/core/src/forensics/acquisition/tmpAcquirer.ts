import { AcquisitionConfig, AcquisitionProgress, AcquisitionResult } from '.';
import { ADBDevice, DeviceProperties } from '../..';
import { EnvCommand, LsCommand, ReadFileCommand } from '../../adb/commands';
import { Acquirer } from './acquirer';

export interface TmpAcquirerConfig extends AcquisitionConfig {}

const defaultTmpDir = `/data/local/tmp`;

export class TmpAcquirer extends Acquirer {
  constructor(device: ADBDevice, tmpAcquirerConfig: TmpAcquirerConfig = {}) {
    super(device, tmpAcquirerConfig, 'tmp');
  }

  async acquire(onProgress?: (progress: AcquisitionProgress) => void): Promise<AcquisitionResult> {
    const startTime = new Date();
    try {
      this.notifyProgress(onProgress, 0, 'Starting tmp acquisition...', 'running');
      const deviceInfo = await this.device.getProperties();
      this.notifyProgress(
        onProgress,
        10,
        `Connected to ${deviceInfo.model}`,
        'running',
        deviceInfo
      );
      const tmpDir = await this.getTmpDir();
      this.notifyProgress(onProgress, 20, `Listing files in ${tmpDir}...`, 'running');
      const tmpFiles = await this.listTmpFiles();
      this.notifyProgress(onProgress, 50, `Found ${tmpFiles.length} files in ${tmpDir}`, 'running');
      this.notifyProgress(onProgress, 60, `Reading files from ${tmpDir}...`, 'running');
      const filesData = await this.readFiles(tmpFiles);
      this.notifyProgress(onProgress, 80, `Building tmp archive...`, 'running');
      const { blob, fileName } = await this.buildTmpZip(filesData, deviceInfo);
      this.notifyProgress(onProgress, 100, 'Tmp acquisition completed.', 'completed');

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      this.logger.info(`Tmp acquisition completed in ${(duration / 1000).toFixed(2)} seconds`);

      const result: AcquisitionResult = {
        success: true,
        type: 'tmp',
        fileName,
        fileSize: blob.size,
        startTime,
        endTime,
        duration,
        data: {
          totalFiles: filesData.length,
          files: filesData.map(f => f.path),
        },
        blob,
      };

      if (this.config.computeHash) {
        const zipBytes = new Uint8Array(await blob.arrayBuffer());
        result.hash = await this.computeHash(zipBytes);
      }

      return result;
    } catch (error) {
      this.logger.error('Error during tmp acquisition:', error);
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      const result: AcquisitionResult = {
        success: false,
        type: 'tmp',
        startTime,
        endTime,
        duration,
        error: (error as Error).message,
      };
      return result;
    }
  }

  private async getTmpDir(): Promise<string> {
    try {
      const env = await new EnvCommand(this.device.adb).exec();
      const tmpDirLine = env.split('\n').find(line => line.startsWith('TMPDIR='));
      if (tmpDirLine) {
        const tmpDir = tmpDirLine.split('=')[1].trim();
        this.logger.info(`Using TMPDIR from device environment: ${tmpDir}`);
        return tmpDir;
      } else {
        this.logger.warn(`TMPDIR not found in device environment, using default: ${defaultTmpDir}`);
        return defaultTmpDir;
      }
    } catch (error) {
      this.logger.error('Failed to get TMPDIR from device environment, using default', error);
      return defaultTmpDir;
    }
  }

  private async listTmpFiles(): Promise<string[]> {
    const result: string[] = [];

    const lsOutput = await new LsCommand(this.device.adb).exec({
      path: defaultTmpDir,
      recursive: true,
    });

    if (lsOutput && lsOutput.trim()) {
      const files = this.parseFilesFromLs(lsOutput, defaultTmpDir);
      if (files.length > 0) {
        result.push(...files);
        this.logger.debug(`Files in ${defaultTmpDir}: ${files.length}`);
      }
    }
    this.logger.debug(`Temporary files in ${defaultTmpDir}: ${result.join(', ')}`);

    return result;
  }

  // TODO move this replicated code (logs) to a utility function
  private parseFilesFromLs(lsOutput: string, basePath: string): string[] {
    const files: string[] = [];
    const lines = lsOutput.split('\n').filter(line => line.trim());

    for (const line of lines) {
      if (!line.trim() || line.endsWith(':')) continue;

      const parts = line.trim().split(/\s+/);
      if (parts.length === 0) continue;

      if (parts[0].startsWith('-')) {
        const fileName = parts[parts.length - 1];
        if (fileName && fileName !== '.' && fileName !== '..') {
          const fullPath = basePath.endsWith('/')
            ? `${basePath}${fileName}`
            : `${basePath}/${fileName}`;
          files.push(fullPath);
        }
      }
    }

    return files;
  }

  private async readFiles(files: string[]): Promise<{ path: string; data: Uint8Array }[]> {
    const result: { path: string; data: Uint8Array }[] = [];

    for (const file of files) {
      this.logger.info(`Processing tmp file: ${file}`);

      const fileData = await new ReadFileCommand(this.device.adb).exec({
        path: file,
      });
      this.logger.debug(`Read tmp file: ${fileData.length} bytes`);

      result.push({ path: file, data: fileData });
    }

    return result;
  }

  private async buildTmpZip(
    filesData: { path: string; data: Uint8Array }[],
    deviceProperties: DeviceProperties
  ): Promise<{ blob: Blob; fileName: string }> {
    const JSZip = await import('jszip');
    const zip = new JSZip.default();

    for (const fileData of filesData) {
      const normalizedPath = fileData.path.startsWith('/') ? fileData.path.slice(1) : fileData.path;
      zip.file(`tmp/${normalizedPath}`, new Uint8Array(fileData.data));
    }

    const metadata = {
      deviceModel: deviceProperties.model,
      acquisitionTime: new Date().toISOString(),
      totalFiles: filesData.length,
      files: filesData.map(f => ({
        path: f.path,
        size: f.data.length,
      })),
    };
    zip.file('tmp/acquisition-metadata.json', JSON.stringify(metadata, null, 2));

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const fileName = this.generateFileName('tmp', 'zip');

    return { blob: zipBlob, fileName };
  }
}
