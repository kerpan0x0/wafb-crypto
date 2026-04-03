import { AcquisitionConfig, AcquisitionProgress, AcquisitionResult, AcquisitionFile } from '.';
import { Device, DeviceProperties } from '../..';
import { EnvCommand, LsCommand, ReadFileCommand } from '../../commands';
import { Acquirer } from './acquirer';
import { bytesToStream, hashingPassthrough } from '../../utils/stream-helpers';

export interface TmpAcquirerConfig extends AcquisitionConfig {}

const defaultTmpDir = `/data/local/tmp`;

export class TmpAcquirer extends Acquirer {
  constructor(device: Device, config: TmpAcquirerConfig = {}) {
    super(device, config, 'tmp');
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

      this.notifyProgress(onProgress, 80, `Creating tmp files...`, 'running');
      
      const files = await this.buildTmpFiles(filesData, deviceInfo);

      this.notifyProgress(onProgress, 100, 'Tmp acquisition completed.', 'completed');

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      this.logger.info(`Tmp acquisition completed in ${(duration / 1000).toFixed(2)} seconds`);

      const result: AcquisitionResult = {
        success: true,
        type: 'tmp',
        files: files,
        startTime,
        endTime,
        duration,
        data: {
          totalFiles: filesData.length,
          files: filesData.map(f => f.path),
        },
      };

      return result;
    } catch (error) {
      this.logger.error('Error during tmp acquisition:', error);
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      const result: AcquisitionResult = {
        success: false,
        type: 'tmp',
        files: [],
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
      const env = await new EnvCommand(this.device).exec();
      const tmpDirLine = env.split('\n').find((line: string) => line.startsWith('TMPDIR='));
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

    const lsOutput = await new LsCommand(this.device).exec({
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

      const fileData = await new ReadFileCommand(this.device).exec({
        path: file,
      });
      this.logger.debug(`Read tmp file: ${fileData.length} bytes`);

      result.push({ path: file, data: fileData });
    }

    return result;
  }

  private async buildTmpFiles(
    filesData: { path: string; data: Uint8Array }[],
    deviceProperties: DeviceProperties
  ): Promise<AcquisitionFile[]> {
    const files: AcquisitionFile[] = [];

    for (const fileData of filesData) {
      const normalizedPath = fileData.path.startsWith('/') 
        ? fileData.path.slice(1) 
        : fileData.path;
      
      const fileName = `tmp/${normalizedPath}`;

      const fileBytes = fileData.data;

      let file: AcquisitionFile;
      if (this.config.computeHash) {
        const { writable, readable, hashPromise } = await hashingPassthrough('sha-256');
        bytesToStream(fileBytes).pipeTo(writable).catch(err => this.logger.error('Hash pipe error', err));
        file = { fileName, fileSize: fileBytes.length, stream: readable, hashPromise, description: `Temporary file from ${fileData.path}`, mimeType: this.getMimeType(fileData.path) };
      } else {
        file = { fileName, fileSize: fileBytes.length, stream: bytesToStream(fileBytes), description: `Temporary file from ${fileData.path}`, mimeType: this.getMimeType(fileData.path) };
      }

      files.push(file);
      this.logger.debug(`Added tmp file: ${fileName} (${this.formatBytes(fileBytes.length)})`);
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

    const metadataJson = JSON.stringify(metadata, null, 2);
    const metadataBlobBytes = new TextEncoder().encode(metadataJson);

    let metadataFile: AcquisitionFile;
    if (this.config.computeHash) {
      const { writable, readable, hashPromise } = await hashingPassthrough('sha-256');
      bytesToStream(metadataBlobBytes).pipeTo(writable).catch(err => this.logger.error('Hash pipe error', err));
      metadataFile = { fileName: 'tmp/acquisition-metadata.json', fileSize: metadataBlobBytes.length, stream: readable, hashPromise, description: 'Tmp acquisition metadata', mimeType: 'application/json' };
    } else {
      metadataFile = { fileName: 'tmp/acquisition-metadata.json', fileSize: metadataBlobBytes.length, stream: bytesToStream(metadataBlobBytes), description: 'Tmp acquisition metadata', mimeType: 'application/json' };
    }

    files.push(metadataFile);

    this.logger.info(`Created ${files.length} tmp files (${filesData.length} files + metadata)`);

    return files;
  }

  private getMimeType(filePath: string): string {
    const fileName = filePath.split('/').pop() || '';
    const ext = fileName.split('.').pop()?.toLowerCase();
    
    const mimeTypes: Record<string, string> = {
      'txt': 'text/plain',
      'log': 'text/plain',
      'json': 'application/json',
      'xml': 'application/xml',
      'html': 'text/html',
      'htm': 'text/html',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'db': 'application/x-sqlite3',
      'sql': 'application/sql',
    };
    
    return mimeTypes[ext || ''] || 'application/octet-stream';
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }
}