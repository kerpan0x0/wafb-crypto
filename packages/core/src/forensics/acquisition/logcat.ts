import { GetLogcatCommand } from '../../adb/commands';
import type { ADBDevice } from '../../adb';
import { Acquirer } from './acquirer';
import type { AcquisitionConfig, AcquisitionProgress, AcquisitionResult } from '.';

export interface LogcatConfig extends AcquisitionConfig {
  buffer?: 'main' | 'system' | 'radio' | 'events' | 'crash' | 'all';
  maxLines?: number;
  filter?: string;
  dumpMode?: boolean;
  format?: 'brief' | 'process' | 'tag' | 'thread' | 'raw' | 'time' | 'threadtime' | 'long';
}

export interface LogcatStats {
  totalLines: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  debugCount: number;
  verboseCount: number;
  timeRange?: {
    start: string;
    end: string;
  };
}

export interface LogcatData {
  stats: LogcatStats;
  buffer: string;
  format: string;
  deviceInfo: any;
  acquisitionTime: string;
}

export class LogcatAcquirer extends Acquirer {
  constructor(
    device: ADBDevice,
    private logcatConfig: LogcatConfig = {}
  ) {
    super(device, logcatConfig, 'logcat');
  }

  async acquire(onProgress?: (progress: AcquisitionProgress) => void): Promise<AcquisitionResult> {
    const startTime = new Date();

    try {
      this.logger.info('Starting logcat acquisition');

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

      // Step 2: Execute logcat using ADBCommands.getLogcat()
      // ✅ FIX: Ora usiamo la funzione già esistente invece di duplicare la logica
      this.notifyProgress(
        onProgress,
        40,
        'Acquiring system logs (this may take 10-30 seconds)...',
        'running'
      );

      const logOutput = await new GetLogcatCommand(this.device.adb).exec({
        buffer: this.logcatConfig.buffer,
        maxLines: this.logcatConfig.maxLines,
        filter: this.logcatConfig.filter,
        dump: this.logcatConfig.dumpMode !== false, // default true
      });

      this.notifyProgress(onProgress, 70, 'Processing log data...', 'running');

      // Step 3: Analyze logs
      const stats = this.analyzeLogcat(logOutput);

      this.logger.info('Logcat stats', stats);

      this.notifyProgress(onProgress, 80, `Processed ${stats.totalLines} log lines`, 'running');

      // Step 4: Create output file
      this.notifyProgress(onProgress, 90, 'Preparing export...', 'running');

      const logcatData: LogcatData = {
        stats,
        buffer: this.logcatConfig.buffer || 'all',
        format: this.logcatConfig.format || 'threadtime',
        deviceInfo,
        acquisitionTime: new Date().toISOString(),
      };

      // Create combined output with metadata + logs
      const combinedOutput = this.formatOutput(logcatData, logOutput);
      const logBytes = new TextEncoder().encode(combinedOutput);

      const blob = new Blob([logBytes], { type: 'text/plain' });
      const fileName = this.generateFileName('logcat', 'txt');

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      this.notifyProgress(onProgress, 100, 'Logcat acquisition completed!', 'completed');

      // Step 5: Build result
      const result: AcquisitionResult = {
        success: true,
        type: 'logcat',
        fileName,
        fileSize: logBytes.length,
        startTime,
        endTime,
        duration,
        data: {
          totalLines: stats.totalLines,
          errorCount: stats.errorCount,
          warningCount: stats.warningCount,
          buffer: this.logcatConfig.buffer || 'all',
          deviceInfo,
        },
        blob,
      };

      // Compute hash if requested
      if (this.config.computeHash) {
        result.hash = await this.computeHash(logBytes);
      }

      this.logger.info('Logcat acquisition completed', {
        fileName,
        totalLines: stats.totalLines,
        duration,
      });

      return result;
    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error('Logcat acquisition failed', error);
      this.notifyProgress(onProgress, 0, `Error: ${errorMessage}`, 'failed');

      return {
        success: false,
        type: 'logcat',
        startTime,
        endTime,
        duration,
        error: errorMessage,
      };
    }
  }

  private formatOutput(data: LogcatData, logOutput: string): string {
    const metadataJson = JSON.stringify(data, null, 2);

    return `# Logcat Acquisition Metadata
# Device: ${data.deviceInfo.model}
# Time: ${data.acquisitionTime}
# Buffer: ${data.buffer}
# Format: ${data.format}
# Total Lines: ${data.stats.totalLines}
# Errors: ${data.stats.errorCount} | Warnings: ${data.stats.warningCount} | Info: ${data.stats.infoCount}
#
# ========================================
# METADATA (JSON)
# ========================================
${metadataJson}
#
# ========================================
# LOGCAT OUTPUT
# ========================================
${logOutput}`;
  }

  /**
   * Analizza il logcat output per estrarre statistiche
   */
  private analyzeLogcat(logOutput: string): LogcatStats {
    const lines = logOutput.split('\n').filter(line => line.trim().length > 0);

    const stats: LogcatStats = {
      totalLines: lines.length,
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      debugCount: 0,
      verboseCount: 0,
    };

    let firstTimestamp: string | null = null;
    let lastTimestamp: string | null = null;

    for (const line of lines) {
      // Count by priority level
      if (line.includes(' E ') || line.includes('/E(')) {
        stats.errorCount++;
      } else if (line.includes(' W ') || line.includes('/W(')) {
        stats.warningCount++;
      } else if (line.includes(' I ') || line.includes('/I(')) {
        stats.infoCount++;
      } else if (line.includes(' D ') || line.includes('/D(')) {
        stats.debugCount++;
      } else if (line.includes(' V ') || line.includes('/V(')) {
        stats.verboseCount++;
      }

      // Extract timestamps
      const timestampMatch = line.match(/^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})/);
      if (timestampMatch) {
        const timestamp = timestampMatch[1];
        if (!firstTimestamp) {
          firstTimestamp = timestamp;
        }
        lastTimestamp = timestamp;
      }
    }

    if (firstTimestamp && lastTimestamp) {
      stats.timeRange = {
        start: firstTimestamp,
        end: lastTimestamp,
      };
    }

    return stats;
  }
}
