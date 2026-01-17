import { AcquisitionConfig, AcquisitionProgress, AcquisitionResult } from '.';
import { Acquirer } from './acquirer';
import {
  GetLogcatCommand,
  GetPropCommand,
  ReadFileCommand,
  GetenforceCommand,
  PsCommand,
  LsCommand,
} from '../../adb/commands';
import type { ADBDevice } from '../../adb';

export interface SELinuxConfig extends AcquisitionConfig {
  includeContexts?: boolean;
  includeFileContexts?: boolean;
  includeDenials?: boolean;
  maxDenialLines?: number;
}

export interface SELinuxMode {
  current: 'Enforcing' | 'Permissive' | 'Disabled' | 'Unknown';
  config: string;
}

export interface SELinuxPolicy {
  version: string;
  policyVersion: string;
}

export interface ProcessContext {
  pid: string;
  process: string;
  context: string;
}

export interface SELinuxDenial {
  timestamp: string;
  type: string;
  source: string;
  target: string;
  class: string;
  permission: string;
  raw: string;
}

export interface SELinuxData {
  mode: SELinuxMode;
  policy: SELinuxPolicy;
  processContexts?: ProcessContext[];
  fileContexts?: string[];
  denials?: SELinuxDenial[];
  deviceInfo: any;
  acquisitionTime: string;
}

/**
 * Acquirer for SELinux information
 * Collects SELinux configuration, contexts, and audit logs
 */
export class SELinuxAcquirer extends Acquirer {
  constructor(
    device: ADBDevice,
    private selinuxConfig: SELinuxConfig = {}
  ) {
    super(device, selinuxConfig, 'selinux');
  }

  async acquire(
    onProgress?: (progress: AcquisitionProgress) => void
  ): Promise<AcquisitionResult> {
    const startTime = new Date();

    try {
      this.logger.info('Starting SELinux acquisition');

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

      // Step 2: Get SELinux mode (30%)
      this.notifyProgress(onProgress, 30, 'Checking SELinux mode...', 'running');
      const mode = await this.getSELinuxMode();

      // Step 3: Get policy information (40%)
      this.notifyProgress(onProgress, 40, 'Reading SELinux policy...', 'running');
      const policy = await this.getSELinuxPolicy();

      // Initialize data structure
      const selinuxData: SELinuxData = {
        mode,
        policy,
        deviceInfo,
        acquisitionTime: new Date().toISOString()
      };

      let progressOffset = 50;
      const step = 50 / this.getEnabledComponentsCount();

      // Step 4: Get process contexts (50-70%)
      if (this.selinuxConfig.includeContexts !== false) {
        this.notifyProgress(
          onProgress,
          progressOffset,
          'Collecting process contexts...',
          'running'
        );
        try {
          selinuxData.processContexts = await this.getProcessContexts();
        } catch (error) {
          this.logger.warn('Failed to acquire process contexts', error);
        }
        progressOffset += step;
      }

      // Step 5: Get file contexts (70-85%)
      if (this.selinuxConfig.includeFileContexts !== false) {
        this.notifyProgress(
          onProgress,
          progressOffset,
          'Collecting file contexts...',
          'running'
        );
        try {
          selinuxData.fileContexts = await this.getFileContexts();
        } catch (error) {
          this.logger.warn('Failed to acquire file contexts', error);
        }
        progressOffset += step;
      }

      // Step 6: Get SELinux denials (85-95%)
      if (this.selinuxConfig.includeDenials !== false) {
        this.notifyProgress(
          onProgress,
          progressOffset,
          'Analyzing SELinux denials...',
          'running'
        );
        try {
          selinuxData.denials = await this.getSELinuxDenials();
        } catch (error) {
          this.logger.warn('Failed to acquire SELinux denials', error);
        }
        progressOffset += step;
      }

      // Step 7: Prepare export (95%)
      this.notifyProgress(onProgress, 95, 'Preparing export...', 'running');

      const jsonData = JSON.stringify(selinuxData, null, 2);
      const jsonBytes = new TextEncoder().encode(jsonData);

      const blob = new Blob([jsonBytes], { type: 'application/json' });
      const fileName = this.generateFileName('selinux', 'json', deviceInfo.model);

      this.downloadBlob(blob, fileName);

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      this.notifyProgress(onProgress, 100, 'SELinux acquisition completed!', 'completed');

      // Step 8: Build result
      const result: AcquisitionResult = {
        success: true,
        type: 'selinux',
        fileName,
        fileSize: jsonBytes.length,
        startTime,
        endTime,
        duration,
        data: {
          mode: mode.current,
          policyVersion: policy.version,
          processContextsCount: selinuxData.processContexts?.length || 0,
          fileContextsCount: selinuxData.fileContexts?.length || 0,
          denialsCount: selinuxData.denials?.length || 0,
          deviceInfo
        }
      };

      if (this.config.computeHash) {
        result.hash = await this.computeHash(jsonBytes);
      }

      this.logger.info('SELinux acquisition completed', {
        fileName,
        mode: mode.current,
        duration
      });

      return result;

    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error('SELinux acquisition failed', error);
      this.notifyProgress(onProgress, 0, `Error: ${errorMessage}`, 'failed');

      return {
        success: false,
        type: 'selinux',
        startTime,
        endTime,
        duration,
        error: errorMessage
      };
    }
  }

  // ============================================================================
  // PRIVATE HELPERS - SELINUX-SPECIFIC LOGIC
  // ============================================================================

  private getEnabledComponentsCount(): number {
    let count = 0;
    if (this.selinuxConfig.includeContexts !== false) count++;
    if (this.selinuxConfig.includeFileContexts !== false) count++;
    if (this.selinuxConfig.includeDenials !== false) count++;
    return count || 1;
  }

  /**
   * Get current SELinux mode
   */
  private async getSELinuxMode(): Promise<SELinuxMode> {
    try {
      const getenforceOutput = await new GetenforceCommand(this.device.adb).exec({ timeout: 5000 });
      const current = getenforceOutput.trim() as SELinuxMode['current'];

      // Try to get configured mode from kernel cmdline
      let config = 'Unknown';
      try {
        const decoder = new TextDecoder("utf-8");
        const output = await new ReadFileCommand(this.device.adb).exec({ path: '/proc/cmdline' });
        const cmdlineOutput = decoder.decode(output);

        // Try multiple possible parameter names
        const selinuxMatch =
          cmdlineOutput.match(/androidboot\.selinux=(\w+)/) ||
          cmdlineOutput.match(/selinux=(\w+)/) ||
          cmdlineOutput.match(/enforcing=(\d+)/);

        if (selinuxMatch) {
          const value = selinuxMatch[1];
          if (value === '1') config = 'Enforcing';
          else if (value === '0') config = 'Permissive';
          else config = value;
        } else {
          // If not explicitly set in cmdline, assume same as current
          config = `Default (${current})`;
        }
      } catch (error) {
        // If we can't read cmdline, use current as fallback
        this.logger.debug('Could not read /proc/cmdline for SELinux config', error);
        config = `Default (${current})`;
      }

      return { current, config };
    } catch (error) {
      this.logger.warn('Failed to get SELinux mode', error);
      return { current: 'Unknown', config: 'Unknown' };
    }
  }

  /**
   * Get SELinux policy information
   */
  private async getSELinuxPolicy(): Promise<SELinuxPolicy> {
    try {
      const decoder = new TextDecoder("utf-8");
      const output = await new ReadFileCommand(this.device.adb).exec({ path: '/sys/fs/selinux/policyvers' });
      const outputStr = decoder.decode(output);
      const version = outputStr.trim();

      // Try to get full policy version from multiple sources
      let policyVersion = 'Unknown';
      try {
        const props = await new GetPropCommand(this.device.adb).exec({ timeout: 15000 });

        // Try multiple properties in order of preference
        policyVersion =
          props['ro.build.selinux'] ||
          props['ro.boot.selinux'] ||
          props['selinux.reload_policy'] ||
          `Version ${version}`;  // Fallback to just the version number

        policyVersion = policyVersion.trim();
      } catch (error) {
        this.logger.debug('Could not get policy version from props', error);
        policyVersion = `Version ${version}`;
      }

      return { version, policyVersion };
    } catch (error) {
      this.logger.warn('Failed to get SELinux policy', error);
      return { version: 'Unknown', policyVersion: 'Unknown' };
    }
  }

  /**
   * Get process contexts from running processes
   */
  private async getProcessContexts(): Promise<ProcessContext[]> {
    try {
      const output = await new PsCommand(
        this.device.adb,
      ).exec({ selinux: true, timeout: 10000 });

      const contexts: ProcessContext[] = [];
      const lines = output.split('\n').slice(1); // Skip header

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Parse ps -Z output: LABEL USER PID PPID VSZ RSS WCHAN ADDR S NAME
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 9) {
          contexts.push({
            pid: parts[2],
            process: parts[parts.length - 1],
            context: parts[0]
          });
        }
      }

      this.logger.info(`Collected ${contexts.length} process contexts`);
      return contexts;
    } catch (error) {
      this.logger.warn('Failed to get process contexts', error);
      return [];
    }
  }

  /**
   * Get file contexts for important system paths
   */
  private async getFileContexts(): Promise<string[]> {
    const importantPaths = [
      '/system',
      '/system/bin',
      '/system/lib',
      '/vendor',
      '/data',
      '/data/data',
      '/sdcard',
      '/proc',
      '/sys',
      '/dev'
    ];

    const contexts: string[] = [];

    for (const path of importantPaths) {
      try {
        const output = await new LsCommand(this.device.adb).exec({
          selinux: true,
          path: path,
          timeout: 5000
        });

        if (output.trim()) {
          contexts.push(`# ${path}`);

          const lines = output.trim().split('\n');
          for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine) {
              contexts.push(trimmedLine);
            }
          }

          contexts.push('');
        }
      } catch {
        // Path might not exist or not accessible
        continue;
      }
    }

    const pathCount = contexts.filter(line => line.startsWith('# /')).length;
    this.logger.info(`Collected file contexts for ${pathCount} paths, ${contexts.length} total lines`);

    return contexts;
  }

  /**
   * Extract SELinux denials from audit log
   */
  private async getSELinuxDenials(): Promise<SELinuxDenial[]> {
    try {
      const maxLines = this.selinuxConfig.maxDenialLines || 500;
      const pattern = /avc.*denied/i;
      const logcatOutput = await new GetLogcatCommand(this.device.adb).exec({ dump: true, buffer: "all", timeout: 15000 })

      const lines = logcatOutput.split('\n')
        .filter((line: string) => pattern.test(line))
        .slice(-maxLines)

      const denials: SELinuxDenial[] = [];

      for (const line of lines) {
        if (!line.includes('avc') || !line.includes('denied')) continue;

        const denial = this.parseDenialLine(line);
        if (denial) {
          denials.push(denial);
        }
      }

      this.logger.info(`Collected ${denials.length} SELinux denials`);
      return denials;
    } catch (error) {
      this.logger.warn('Failed to get SELinux denials', error);
      return [];
    }
  }

  /**
   * Parse a single AVC denial line
   */
  private parseDenialLine(line: string): SELinuxDenial | null {
    try {
      // Extract timestamp
      const timestampMatch = line.match(/^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})/);
      const timestamp = timestampMatch ? timestampMatch[1] : 'Unknown';

      // Extract source context
      const sourceMatch = line.match(/scontext=([^\s]+)/);
      const source = sourceMatch ? sourceMatch[1] : 'Unknown';

      // Extract target context
      const targetMatch = line.match(/tcontext=([^\s]+)/);
      const target = targetMatch ? targetMatch[1] : 'Unknown';

      // Extract class
      const classMatch = line.match(/tclass=([^\s]+)/);
      const className = classMatch ? classMatch[1] : 'Unknown';

      // Extract permission
      const permMatch = line.match(/denied\s+\{\s*([^}]+)\s*\}/);
      const permission = permMatch ? permMatch[1].trim() : 'Unknown';

      // Determine type
      const type = line.includes('avc: granted') ? 'granted' : 'denied';

      return {
        timestamp,
        type,
        source,
        target,
        class: className,
        permission,
        raw: line.trim()
      };
    } catch (error) {
      this.logger.debug('Failed to parse denial line', { line, error });
      return null;
    }
  }
}