import type { ADBDevice, DeviceProperties } from "../../adb";
import { LsCommand, ReadFileCommand } from "../../adb/commands";
import { Acquirer, AcquisitionResult, AcquisitionProgress, AcquisitionConfig } from ".";

export interface LogConfig extends AcquisitionConfig {
    includeSystemLogs?: boolean;
}

export interface LogData {
    totalFiles: number;
    successfulFiles: number;
    failedFiles: number;
    skippedFiles: number;
    logs: Array<{
        path: string;
        data: string;
        size: number;
        success: boolean;
        error?: string;
    }>;
    deviceInfo: any;
    acquisitionTime: string;
}

export class LogAcquirer extends Acquirer {

    static readonly staticLogFiles = [
        '/data/system/uiderrors.txt',
        '/proc/kmsg',
        '/proc/last_kmsg',
        '/sys/fs/pstore/console-ramoops',
    ];

    static readonly logFolders = [
        '/data/anr/',
        '/data/log/',
        '/sdcard/log/'
    ];

    constructor(
        device: ADBDevice,
        private logConfig: LogConfig = {}
    ) {
        super(device, logConfig, 'logs');
    }

    async acquire(
        onProgress?: (progress: AcquisitionProgress) => void
    ): Promise<AcquisitionResult> {
        const startTime = new Date();

        try {
            this.logger.info('Starting log acquisition');

            this.notifyProgress(onProgress, 5, 'Reading device information...', 'running');
            const deviceInfo = await this.device.getProperties();
            this.notifyProgress(onProgress, 10, `Connected to ${deviceInfo.model}`, 'running', deviceInfo);

            this.notifyProgress(onProgress, 15, 'Collecting system logs...', 'running');
            const logFiles: string[] = [];
            if (this.logConfig.includeSystemLogs !== false) {
                logFiles.push(...LogAcquirer.staticLogFiles);
            }

            this.notifyProgress(onProgress, 25, 'Scanning log directories...', 'running');
            logFiles.push(...await this.logsFileName(LogAcquirer.logFolders));

            this.notifyProgress(onProgress, 45, 'Acquiring log files...', 'running');
            const logData = await this.getFiles(logFiles, deviceInfo);

            this.notifyProgress(onProgress, 70, 'Downloading log archive...', 'running');
            this.downloadLogs(logData);

            const endTime = new Date();
            const duration = endTime.getTime() - startTime.getTime();

            this.notifyProgress(onProgress, 100, 'Log acquisition completed!', 'completed');

            const result: AcquisitionResult = {
                success: true,
                type: 'logs',
                fileName: logFiles.join(' '),
                fileSize: logData.logs.reduce((acc, log) => acc + log.size, 0),
                startTime,
                endTime,
                duration,
                data: logData
            };

            return result;

        } catch (error) {
            const endTime = new Date();
            const duration = endTime.getTime() - startTime.getTime();
            const errorMessage = error instanceof Error ? error.message : String(error);

            this.logger.error('Log acquisition failed', { error: errorMessage });
            this.notifyProgress(onProgress, 100, `Log acquisition failed: ${errorMessage}`, 'failed');

            return {
                success: false,
                type: 'logs',
                startTime,
                endTime,
                duration,
                error: errorMessage
            };
        }
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

    // TODO remove deviceInfo side effect
    private async getFiles(logFiles: string[], deviceInfo: DeviceProperties): Promise<LogData> {

        const result: LogData = {
            totalFiles: logFiles.length,
            successfulFiles: 0,
            failedFiles: 0,
            skippedFiles: 0,
            logs: [],
            deviceInfo,
            acquisitionTime: new Date().toISOString()
        };

        this.logger.info(`Found ${logFiles.length} log files to acquire`);

        for (const logFile of logFiles) {
            try {
                this.logger.debug(`Pulling: ${logFile}`);

                const fileData = await new ReadFileCommand(this.device.adb).exec({
                    path: logFile
                });
                const logContent = new TextDecoder('utf-8', { fatal: false }).decode(fileData);

                result.logs.push({
                    path: logFile,
                    data: logContent,
                    size: fileData.length,
                    success: true
                });
                result.successfulFiles++;

            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);

                if (errorMessage.toLowerCase().includes('permission denied')) {
                    this.logger.debug(`Permission denied for ${logFile}`);
                    result.skippedFiles++;
                } else {
                    this.logger.error(`Failed to pull log file ${logFile}: ${errorMessage}`);
                    result.logs.push({
                        path: logFile,
                        data: '',
                        size: 0,
                        success: false,
                        error: errorMessage
                    });
                    result.failedFiles++;
                }
            }
        }
        return result;
    }

    private async downloadLogs(logData: LogData): Promise<void> {
        const JSZip = await import('jszip');
        const zip = new JSZip.default();

        for (const logEntry of logData.logs) {
            if (logEntry.success && logEntry.data) {
                const normalizedPath = logEntry.path.startsWith('/') ? logEntry.path.slice(1) : logEntry.path;
                const zipPath = `logs/${normalizedPath}`;

                zip.file(zipPath, logEntry.data);
            }
        }

        const metadata = {
            deviceInfo: logData.deviceInfo,
            acquisitionTime: logData.acquisitionTime,
            totalFiles: logData.totalFiles,
            successfulFiles: logData.successfulFiles,
            failedFiles: logData.failedFiles,
            skippedFiles: logData.skippedFiles,
            summary: logData.logs.map(log => ({
                path: log.path,
                size: log.size,
                success: log.success,
                error: log.error
            }))
        };
        zip.file('logs/acquisition-metadata.json', JSON.stringify(metadata, null, 2));

        // TODO add hash computation 

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const fileName = this.generateFileName('logs', 'zip', logData.deviceInfo.model || 'unknown');
        this.downloadBlob(zipBlob, fileName);
    }


    private async logsFileName(logFolders: string[]): Promise<string[]> {
        const result = [];

        for (const logFolder of logFolders) {
            try {
                const lsOutput = await new LsCommand(this.device.adb).exec({
                    path: logFolder,
                    recursive: true
                });

                if (lsOutput && lsOutput.trim()) {
                    const files = this.parseFilesFromLs(lsOutput, logFolder);
                    if (files.length > 0) {
                        result.push(...files);
                        this.logger.debug(`Files in ${logFolder}: ${files.length}`);
                    }
                }
            } catch (error) {
                this.logger.debug(`Impossible to get files from ${logFolder}`, error);
            }
        }
        return result;
    }
} 