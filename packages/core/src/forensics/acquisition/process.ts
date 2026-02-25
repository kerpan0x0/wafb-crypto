import type { ADBDevice } from '../../adb';
import { Acquirer } from './acquirer';
import type { AcquisitionConfig, AcquisitionProgress, AcquisitionResult, AcquisitionFile } from '.';
import { PsCommand } from '../../adb/commands';

export interface ProcessConfig extends AcquisitionConfig {
  includeThreads?: boolean;
  includeSELinuxContext?: boolean;
  includeMemoryInfo?: boolean;
}

export interface ProcessInfo {
  pid: number;
  ppid: number;
  tid?: number;
  uid: number;
  gid: number;
  user: string;
  name: string;
  state: string;
  priority: number;
  nice: number;
  vsz: number;
  rss: number;
  wchan: string;
  addr: string;
  selinuxContext?: string;
  cpu?: string;
  cpuPercent?: number;
  memPercent?: number;
  threads?: number;
  startTime?: string;
  elapsedTime?: string;
}

export interface ProcessData {
  totalProcesses: number;
  systemProcesses: number;
  userProcesses: number;
  processes: ProcessInfo[];
  deviceInfo: any;
  acquisitionTime: string;
  timestamp: number;
}

/**
 * Process Acquirer - Handles process acquisition and parsing
 *
 * Architecture:
 * - Uses PsCommand for command execution (raw output)
 * - Contains parsing logic HERE (temporarily)
 * - TODO: Move parsing to ProcessAdapter when adapter layer is ready
 */
export class ProcessAcquirer extends Acquirer {
  constructor(
    device: ADBDevice,
    protected config: ProcessConfig = {}
  ) {
    super(device, config, 'process');
  }

  async acquire(onProgress?: (progress: AcquisitionProgress) => void): Promise<AcquisitionResult> {
    const startTime = new Date();

    try {
      this.logger.info('Starting process acquisition');

      // Step 1: Get device info (10%)
      this.notifyProgress(onProgress, 10, 'Reading device information...', 'running');
      const deviceInfo = await this.device.getProperties();

      this.notifyProgress(
        onProgress,
        20,
        `Connected to ${deviceInfo.model}`,
        'running',
        deviceInfo
      );

      // Step 2: Get process list (40%)
      this.notifyProgress(onProgress, 40, 'Collecting process information...', 'running');
      const processes = await this.getProcessList();

      this.logger.info(`Collected ${processes.length} processes`);

      // Step 3: Analyze processes (70%)
      this.notifyProgress(onProgress, 70, `Analyzing ${processes.length} processes...`, 'running');

      const systemCount = this.countSystemProcesses(processes);
      const userCount = processes.length - systemCount;

      // Step 4: Prepare export (90%)
      this.notifyProgress(onProgress, 90, 'Preparing export...', 'running');

      const processData: ProcessData = {
        totalProcesses: processes.length,
        systemProcesses: systemCount,
        userProcesses: userCount,
        processes,
        deviceInfo,
        acquisitionTime: new Date().toISOString(),
        timestamp: Date.now(),
      };

      const jsonData = JSON.stringify(processData, null, 2);
      const jsonBytes = new TextEncoder().encode(jsonData);

      const blob = new Blob([jsonBytes], { type: 'application/json' });
      const fileName = this.generateFileName('processes', 'json');

      const file: AcquisitionFile = {
        fileName: fileName,
        fileSize: blob.size,
        blob: blob,
        description: 'Running processes',
        mimeType: blob.type,
      };

      if (this.config.computeHash) {
        const blobBytes = new Uint8Array(await blob.arrayBuffer());
        file.hash = await this.computeHash(blobBytes);
      }

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      this.notifyProgress(onProgress, 100, 'Process acquisition completed!', 'completed');

      // Step 5: Build result
      const result: AcquisitionResult = {
        success: true,
        type: 'process',
        files: [file],
        startTime,
        endTime,
        duration,
        data: {
          totalProcesses: processes.length,
          systemProcesses: systemCount,
          userProcesses: userCount,
          deviceInfo,
        },
      };

      this.logger.info('Process acquisition completed', {
        fileName,
        totalProcesses: processes.length,
        duration,
      });

      return result;
    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error('Process acquisition failed', error);
      this.notifyProgress(onProgress, 0, `Error: ${errorMessage}`, 'failed');

      return {
        success: false,
        type: 'process',
        startTime,
        endTime,
        duration,
        error: errorMessage,
      };
    }
  }

  // ============================================================================
  // PRIVATE: COMMAND EXECUTION (uses PsCommand)
  // ============================================================================

  /**
   * Get process list using PsCommand
   * Returns raw output, then parses it
   */
  private async getProcessList(): Promise<ProcessInfo[]> {
    // Build command options
    const options: any = {
      all: true,
      selinux: this.config.includeSELinuxContext !== false,
      threads: this.config.includeThreads || false,
    };

    // Execute command - get RAW output
    const rawOutput = await new PsCommand(this.device.adb).exec(options);

    // Parse output HERE (TODO: move to ProcessAdapter)
    return this.parseProcessOutput(rawOutput);
  }

  // ============================================================================
  // PARSING LOGIC (TODO: Move to ProcessAdapter)
  // ============================================================================

  /**
   * Parse raw PS output into ProcessInfo array
   *
   * TODO: Move this to ProcessAdapter class when adapter layer is ready
   *
   * @param output - Raw ps command output
   * @returns Array of parsed ProcessInfo
   */
  private parseProcessOutput(output: string): ProcessInfo[] {
    const processes: ProcessInfo[] = [];
    const lines = output.split('\n');

    // Skip header line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        const process = this.parseProcessLine(line);
        if (process) {
          processes.push(process);
        }
      } catch (error) {
        this.logger.debug(`Failed to parse process line: ${line}`, error);
      }
    }

    return processes;
  }

  /**
   * Parse a single process line
   *
   * TODO: Move to ProcessAdapter
   *
   * Format: LABEL USER PID PPID VSZ RSS WCHAN ADDR S NAME
   * or:     USER PID PPID VSZ RSS WCHAN ADDR S NAME (without SELinux)
   */
  private parseProcessLine(line: string): ProcessInfo | null {
    const parts = line.split(/\s+/);

    if (parts.length < 9) {
      return null;
    }

    let offset = 0;
    let selinuxContext: string | undefined;

    // Check if first field is SELinux context
    if (this.config.includeSELinuxContext !== false && parts[0].includes(':')) {
      selinuxContext = parts[0];
      offset = 1;
    }

    const user = parts[offset];
    const pid = parseInt(parts[offset + 1], 10);
    const ppid = parseInt(parts[offset + 2], 10);
    const vsz = parseInt(parts[offset + 3], 10);
    const rss = parseInt(parts[offset + 4], 10);
    const wchan = parts[offset + 5];
    const addr = parts[offset + 6];
    const state = parts[offset + 7];
    const name = parts.slice(offset + 8).join(' ');

    if (isNaN(pid) || isNaN(ppid)) {
      return null;
    }

    const processInfo: ProcessInfo = {
      pid,
      ppid,
      uid: this.getUserId(user),
      gid: 0, // Not available in ps output
      user,
      name,
      state,
      priority: 0, // Would need separate query
      nice: 0, // Would need separate query
      vsz: Math.round(vsz / 1024), // Convert to KB
      rss: Math.round(rss / 1024), // Convert to KB
      wchan,
      addr,
    };

    if (selinuxContext) {
      processInfo.selinuxContext = selinuxContext;
    }

    return processInfo;
  }

  /**
   * Map username to UID
   *
   * TODO: Move to ProcessAdapter or utility class
   */
  private getUserId(user: string): number {
    // Map common Android users to UIDs
    const userMap: Record<string, number> = {
      root: 0,
      system: 1000,
      radio: 1001,
      bluetooth: 1002,
      graphics: 1003,
      input: 1004,
      audio: 1005,
      camera: 1006,
      log: 1007,
      compass: 1008,
      mount: 1009,
      wifi: 1010,
      shell: 2000,
      cache: 2001,
      diag: 2002,
    };

    if (userMap[user] !== undefined) {
      return userMap[user];
    }

    // Try to parse as u0_aXXX format
    const match = user.match(/u(\d+)_a(\d+)/);
    if (match) {
      const userId = parseInt(match[1], 10);
      const appId = parseInt(match[2], 10);
      return userId * 100000 + 10000 + appId;
    }

    return -1;
  }

  // ============================================================================
  // BUSINESS LOGIC (stays in Acquirer)
  // ============================================================================

  private countSystemProcesses(processes: ProcessInfo[]): number {
    return processes.filter(p => this.isSystemProcess(p)).length;
  }

  private isSystemProcess(process: ProcessInfo): boolean {
    // System processes typically run as root, system, or have UID < 10000
    if (process.uid < 10000) {
      return true;
    }

    // Check for system process names
    const systemProcessPatterns = [
      /^system_server$/,
      /^surfaceflinger$/,
      /^zygote/,
      /^installd$/,
      /^vold$/,
      /^netd$/,
      /^debuggerd/,
      /^rild$/,
      /^drmserver$/,
      /^mediaserver$/,
      /^sdcard$/,
      /^adbd$/,
    ];

    return systemProcessPatterns.some(pattern => pattern.test(process.name));
  }
}
