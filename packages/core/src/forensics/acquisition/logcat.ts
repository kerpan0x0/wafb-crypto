import type { ADBDevice } from '../../adb/device';
import { Logger } from '../../utils/logger';
import type {
  AcquisitionConfig,
  AcquisitionProgress,
  AcquisitionResult
} from './types';

/**
 * Opzioni specifiche per Logcat
 */
export interface LogcatConfig extends AcquisitionConfig {
  /**
   * Buffer da acquisire (default: 'all')
   * - main: Main log buffer
   * - system: System log buffer
   * - radio: Radio/telephony log buffer
   * - events: Event log buffer
   * - crash: Crash log buffer
   * - all: Tutti i buffer
   */
  buffer?: 'main' | 'system' | 'radio' | 'events' | 'crash' | 'all';
  
  /**
   * Numero massimo di righe da acquisire
   */
  maxLines?: number;
  
  /**
   * Filtro per tag/priorità (es. "ActivityManager:I *:S")
   */
  filter?: string;
  
  /**
   * Se usare dump mode (-d) invece di streaming
   * In modalità dump, logcat si ferma dopo aver stampato i log esistenti
   */
  dumpMode?: boolean;
  
  /**
   * Formato output (default: 'threadtime')
   * - brief: tag/priority/PID e messaggio
   * - process: PID e messaggio
   * - tag: tag e messaggio
   * - thread: priority, PID, TID e messaggio
   * - raw: solo messaggio
   * - time: timestamp + priority/tag + messaggio
   * - threadtime: timestamp + PID + TID + priority/tag + messaggio (default)
   * - long: tutte le info su righe separate
   */
  format?: 'brief' | 'process' | 'tag' | 'thread' | 'raw' | 'time' | 'threadtime' | 'long';
}

/**
 * Statistiche sui log acquisiti
 */
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

/**
 * Dati dell'acquisizione logcat
 */
export interface LogcatData {
  stats: LogcatStats;
  buffer: string;
  format: string;
  deviceInfo: any;
  acquisitionTime: string;
}

/**
 * Acquirer per Logcat (system logs)
 */
export class LogcatAcquirer {
  private logger: Logger;
  
  constructor(
    private device: ADBDevice,
    private config: LogcatConfig = {}
  ) {
    this.logger = new Logger('LogcatAcquirer');
  }

  /**
   * Esegue l'acquisizione dei log
   */
  async acquire(
    onProgress?: (progress: AcquisitionProgress) => void
  ): Promise<AcquisitionResult> {
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

      // Step 2: Build logcat command
      this.notifyProgress(onProgress, 30, 'Preparing logcat command...', 'running');
      const logcatCommand = this.buildLogcatCommand();
      
      this.logger.info('Logcat command', { command: logcatCommand });

      // Step 3: Execute logcat
      this.notifyProgress(
        onProgress,
        40,
        'Acquiring system logs (this may take 10-30 seconds)...',
        'running'
      );
      
      const logOutput = await this.device.commands.shell(logcatCommand, {
        timeout: this.config.timeout || 60000 // 60 seconds default
      });

      this.notifyProgress(onProgress, 70, 'Processing log data...', 'running');

      // Step 4: Analyze logs
      const stats = this.analyzeLogcat(logOutput);
      
      this.logger.info('Logcat stats', stats);
      
      this.notifyProgress(
        onProgress,
        80,
        `Processed ${stats.totalLines} log lines`,
        'running'
      );

      // Step 5: Create output file
      this.notifyProgress(onProgress, 90, 'Preparing export...', 'running');
      
      const logcatData: LogcatData = {
        stats,
        buffer: this.config.buffer || 'all',
        format: this.config.format || 'threadtime',
        deviceInfo,
        acquisitionTime: new Date().toISOString()
      };

      // Create metadata file (JSON)
      const metadataJson = JSON.stringify(logcatData, null, 2);
      
      // Create combined output with metadata + logs
      const combinedOutput = `# Logcat Acquisition Metadata
# Device: ${deviceInfo.model}
# Time: ${logcatData.acquisitionTime}
# Buffer: ${logcatData.buffer}
# Format: ${logcatData.format}
# Total Lines: ${stats.totalLines}
# Errors: ${stats.errorCount} | Warnings: ${stats.warningCount} | Info: ${stats.infoCount}
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

      const logBytes = new TextEncoder().encode(combinedOutput);
      
      const blob = new Blob([logBytes], { type: 'text/plain' });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `logcat-${deviceInfo.model}-${timestamp}.txt`;
      
      this.downloadBlob(blob, fileName);

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      this.notifyProgress(onProgress, 100, 'Logcat acquisition completed!', 'completed');

      // Step 6: Build result
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
          buffer: this.config.buffer || 'all',
          deviceInfo
        }
      };

      // Compute hash if requested
      if (this.config.computeHash) {
        result.hash = await this.computeHash(logBytes);
      }

      this.logger.info('Logcat acquisition completed', {
        fileName,
        totalLines: stats.totalLines,
        duration
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
        error: errorMessage
      };
    }
  }

  /**
   * Costruisce il comando logcat con le opzioni configurate
   */
  private buildLogcatCommand(): string {
    const parts: string[] = ['logcat'];
    
    // Dump mode (default per forensics)
    if (this.config.dumpMode !== false) {
      parts.push('-d');
    }
    
    // Buffer selection
    if (this.config.buffer) {
      parts.push(`-b ${this.config.buffer}`);
    }
    
    // Format
    if (this.config.format) {
      parts.push(`-v ${this.config.format}`);
    }
    
    // Max lines
    if (this.config.maxLines) {
      parts.push(`-t ${this.config.maxLines}`);
    }
    
    // Filter (must be last)
    if (this.config.filter) {
      parts.push(this.config.filter);
    }
    
    return parts.join(' ');
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
      verboseCount: 0
    };

    let firstTimestamp: string | null = null;
    let lastTimestamp: string | null = null;

    for (const line of lines) {
      // Count by priority level (format: "XX-XX XX:XX:XX.XXX  PID  TID L TAG: message")
      // Priority is usually a single letter: V, D, I, W, E, F
      
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

      // Extract timestamps (format: "MM-DD HH:MM:SS.mmm")
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
        end: lastTimestamp
      };
    }

    return stats;
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