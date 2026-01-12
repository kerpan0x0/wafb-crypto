import type { Adb } from '@yume-chan/adb';
import type {
  ShellOptions,
  LogcatOptions,
  PackageListOptions,
  PackageInfoOptions,
  PackageInfoResult
}
  from './base';
import { Logger } from '../utils/logger';
import { ADBCommandError } from '../utils/errors';
import { readStreamAsText, readStreamAsBytes } from '../utils/stream-helpers';


/**
 * ADBCommands - Centralized ADB command execution
 * All acquirers should use these methods instead of calling shell() directly
 */
export class ADBCommands {
  private logger: Logger;

  constructor(private adb: Adb) {
    this.logger = new Logger('ADBCommands');
  }

  // ============================================================================
  // BASIC COMMANDS
  // ============================================================================

  /**
   * Executes a shell command with optional timeout
   */
  async shell(command: string, options: ShellOptions = {}): Promise<string> {
    const { timeout } = options;
    this.logger.debug('Executing shell command', { command, timeout });

    try {
      const execute = async (): Promise<string> => {
        if (!this.adb.subprocess.shellProtocol) {
          throw new Error("Shell protocol not available");
        }
        const shellSocket = await this.adb.subprocess.shellProtocol.spawn(command);
        const output = await readStreamAsText(shellSocket.stdout);
        return output;
      };

      if (timeout) {
        return await this.withTimeout(execute(), timeout, command);
      }

      return await execute();
    } catch (error) {
      this.logger.error('Command execution failed', { command, error });
      throw new ADBCommandError(`Failed to execute command "${command}": ${(error as Error).message}`);
    }
  }

  /**
   * Gets system properties
   */
  async getprop(): Promise<Record<string, string>> {
    const output = await this.shell('getprop');
    const props: Record<string, string> = {};
    const regex = /\[([^\]]+)\]:\s*\[([^\]]*)\]/g;

    let match;
    while ((match = regex.exec(output)) !== null) {
      if (match[1] && match[2] !== undefined) {
        props[match[1]] = match[2];
      }
    }

    return props;
  }

  // ============================================================================
  // PACKAGE MANAGEMENT
  // ============================================================================

  /**
   * Lists installed packages
   */
  async listPackages(options: PackageListOptions = {}): Promise<string[]> {
    const { includeSystem = true, timeout = 30000 } = options;
    const command = includeSystem ? 'pm list packages' : 'pm list packages -3';
    const output = await this.shell(command, { timeout });

    return output
      .split('\n')
      .filter(line => line.startsWith('package:'))
      .map(line => line.replace('package:', '').trim())
      .filter(Boolean);
  }

  /**
   * Gets detailed package information
   */
  async getPackageInfo(
    packageName: string,
    options: PackageInfoOptions = {}
  ): Promise<PackageInfoResult | null> {
    const { includePermissions = false, timeout = 10000 } = options;

    try {
      const output = await this.shell(`dumpsys package ${packageName}`, { timeout });

      if (!output || output.trim().length === 0) {
        return null;
      }

      const info: PackageInfoResult = {
        packageName,
        versionName: this.extractField(output, 'versionName') || 'Unknown',
        versionCode: this.extractField(output, 'versionCode') || 'Unknown',
        installLocation: this.extractField(output, 'codePath') || 'Unknown',
        firstInstallTime: this.extractField(output, 'firstInstallTime') || 'Unknown',
        lastUpdateTime: this.extractField(output, 'lastUpdateTime') || 'Unknown',
        targetSdk: this.extractNumber(output, 'targetSdk'),
        minSdk: this.extractNumber(output, 'minSdk')
      };

      if (includePermissions) {
        info.permissions = this.extractPermissions(output);
      }

      return info;
    } catch (error) {
      this.logger.debug('Failed to get package info', { packageName, error });
      return null;
    }
  }

  // ============================================================================
  // LOGGING
  // ============================================================================

  /**
   * Gets logcat output
   */
  async getLogcat(options: LogcatOptions = {}): Promise<string> {
    const args = ['logcat'];

    if (options.dump !== false) args.push('-d');
    if (options.buffer) args.push(`-b ${options.buffer}`);
    if (options.maxLines) args.push(`-t ${options.maxLines}`);
    if (options.filter) args.push(options.filter);

    return this.shell(args.join(' '));
  }

  // ============================================================================
  // BUGREPORT - NEW METHODS
  // ============================================================================

  /**
   * Check if bugreportz command is available
   */
  async checkCommandExists(command: string): Promise<boolean> {
    try {
      await this.shell(`which ${command}`, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generate bugreport using bugreportz (zip format)
   */
  async generateBugreportz(timeout: number = 180000): Promise<string> {
    const output = await this.shell('bugreportz', { timeout });
    const zipMatch = output.match(/OK:(.+\.zip)/);

    if (zipMatch) {
      return zipMatch[1].trim();
    }

    throw new ADBCommandError('Could not parse bugreportz output');
  }

  /**
   * Generate legacy bugreport (text format)
   */
  async generateBugreportLegacy(outputPath: string, timeout: number = 180000): Promise<string> {
    await this.shell(`bugreport > ${outputPath}`, { timeout });
    return outputPath;
  }

  // ============================================================================
  // FILE OPERATIONS
  // ============================================================================

  /**
   * Reads a file via Sync service
   */
  async readFile(path: string): Promise<Uint8Array> {
    const sync = await this.adb.sync();

    try {
      const readable = await sync.read(path);
      return await readStreamAsBytes(readable as any);
    } catch (error) {
      throw new ADBCommandError(`Failed to read file "${path}": ${(error as Error).message}`);
    } finally {
      await this.closeSyncService(sync);
    }
  }

  /**
   * Writes a file via Sync service
   */
  async writeFile(path: string, content: Uint8Array): Promise<void> {
    const sync = await this.adb.sync();

    try {
      await sync.write({
        filename: path,
        file: new ReadableStream({
          start(controller) {
            controller.enqueue(content);
            controller.close();
          }
        }) as any
      });
    } catch (error) {
      throw new ADBCommandError(`Failed to write file "${path}": ${(error as Error).message}`);
    } finally {
      await this.closeSyncService(sync);
    }
  }

  /**
   * Delete file from device
   */
  async deleteFile(path: string): Promise<void> {
    await this.shell(`rm ${path}`);
  }

  // ============================================================================
  // HELPER METHODS (PRIVATE)
  // ============================================================================

  /**
   * Extract field from dumpsys output
   */
  private extractField(output: string, field: string): string | null {
    const regex = new RegExp(`${field}=([^\\s]+)`, 'i');
    const match = output.match(regex);
    return match?.[1] || null;
  }

  /**
   * Extract number from dumpsys output
   */
  private extractNumber(output: string, field: string): number | undefined {
    const value = this.extractField(output, field);
    if (!value) return undefined;

    const num = parseInt(value, 10);
    return isNaN(num) ? undefined : num;
  }

  /**
   * Extract permissions from dumpsys package output
   */
  private extractPermissions(output: string): string[] {
    const permissions: string[] = [];
    const lines = output.split('\n');
    let inPermissionsSection = false;

    for (const line of lines) {
      if (line.includes('requested permissions:')) {
        inPermissionsSection = true;
        continue;
      }

      if (inPermissionsSection) {
        if (line.trim().startsWith('android.permission.')) {
          const permission = line.trim().split(':')[0];
          if (permission) {
            permissions.push(permission);
          }
        } else if (!line.trim().startsWith('android.') && line.trim().length > 0) {
          break;
        }
      }
    }

    return permissions;
  }

  /**
   * Helper per timeout con messaggio personalizzato
   */
  private withTimeout<T>(promise: Promise<T>, ms: number, command: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new ADBCommandError(`Command "${command}" timed out after ${ms}ms`)),
          ms
        )
      )
    ]);
  }

  /**
   * Helper per chiudere il sync service in modo sicuro
   */
  private async closeSyncService(sync: any): Promise<void> {
    try {
      if (typeof sync.dispose === 'function') {
        await sync.dispose();
      } else if (typeof sync.close === 'function') {
        await sync.close();
      }
    } catch (error) {
      this.logger.warn('Failed to close sync service', { error });
    }
  }
}