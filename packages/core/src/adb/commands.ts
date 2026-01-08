// packages/core/src/adb/commands.ts

import type { Adb } from '@yume-chan/adb';
import { Logger } from '../utils/logger';
import { ADBCommandError } from '../utils/errors';
import { readStreamAsText, readStreamAsBytes } from '../utils/stream-helpers';

export interface ShellOptions {
  timeout?: number;
}

export interface LogcatOptions {
  buffer?: 'main' | 'system' | 'radio' | 'events' | 'crash' | 'default' | 'all';
  filter?: string;
  maxLines?: number;
  dump?: boolean;
}

export class ADBCommands {
  private logger: Logger;

  constructor(private adb: Adb) {
    this.logger = new Logger('ADBCommands');
  }

  /**
   * Executes a shell command with optional timeout
   * Usa l'API subprocess.shell() che restituisce un socket
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

  /**
   * Lists installed packages
   */
  async listPackages(options: { includeSystem?: boolean } = {}): Promise<string[]> {
    const { includeSystem = true } = options;
    const command = includeSystem ? 'pm list packages' : 'pm list packages -3';
    const output = await this.shell(command);

    return output
      .split('\n')
      .filter(line => line.startsWith('package:'))
      .map(line => line.replace('package:', '').trim())
      .filter(Boolean);
  }

  /**
   * Gets detailed package information
   */
  async getPackageInfo(packageName: string) {
    try {
      const output = await this.shell(`dumpsys package ${packageName}`);
      if (!output || output.trim().length === 0) {
        return null;
      }

      return {
        versionName: this.extractField(output, 'versionName') || 'Unknown',
        versionCode: this.extractField(output, 'versionCode') || 'Unknown',
        installLocation: this.extractField(output, 'codePath') || 'Unknown',
        firstInstallTime: this.extractField(output, 'firstInstallTime') || 'Unknown',
        lastUpdateTime: this.extractField(output, 'lastUpdateTime') || 'Unknown'
      };
    } catch (error) {
      this.logger.debug('Failed to get package info', { packageName, error });
      return null;
    }
  }

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
   * Helper per estrarre campi da dumpsys output
   */
  private extractField(output: string, field: string): string | null {
    const regex = new RegExp(`${field}=([^\\s]+)`, 'i');
    const match = output.match(regex);
    return match?.[1] || null;
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