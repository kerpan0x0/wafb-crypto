import type { DeviceCommand, ShellOptions } from '.';
import { Logger } from '../utils/logger';
import { Device } from '../adb';

export interface HashOptions extends ShellOptions {
  path: string;
  algorithm: 'md5' | 'sha1' | 'sha256' | 'sha512';
}

export class HashCommand implements DeviceCommand<string> {
  private logger: Logger;

  constructor(private device: Device) {
    this.logger = new Logger('HashCommand');
  }

  async exec(options: HashOptions): Promise<string> {
    const { path, algorithm, timeout = 60000 } = options;

    this.logger.debug('Executing hash command', { path, algorithm });

    const command = this.buildHashCommand(path, algorithm);

    try {
      const output = (await this.device.shell(command, { ...options })).stdout;
      
      this.logger.debug('Hash command completed', { 
        path, 
        algorithm,
        outputLength: output.length 
      });
      
      return output;
    } catch (error) {
      this.logger.error('Hash command failed', { path, algorithm, error });
      throw error;
    }
  }

  private buildHashCommand(path: string, algorithm: string): string {
    const escapedPath = this.escapeShellArg(path);
    
    const commands: Record<string, string> = {
      'md5': `md5sum ${escapedPath} 2>/dev/null || md5 ${escapedPath} 2>/dev/null || echo "UNSUPPORTED"`,
      'sha1': `sha1sum ${escapedPath} 2>/dev/null || echo "UNSUPPORTED"`,
      'sha256': `sha256sum ${escapedPath} 2>/dev/null || echo "UNSUPPORTED"`,
      'sha512': `sha512sum ${escapedPath} 2>/dev/null || echo "UNSUPPORTED"`
    };

    return commands[algorithm] || commands['sha256'];
  }

  private escapeShellArg(arg: string): string {
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }
}

export interface HashBatchOptions extends ShellOptions {
  files: Array<{ path: string; algorithm: string }>;
}

export class HashBatchCommand implements DeviceCommand<string> {
  private logger: Logger;

  constructor(private device: Device) {
    this.logger = new Logger('HashBatchCommand');
  }

  async exec(options: HashBatchOptions): Promise<string> {
    const { files, timeout = 120000 } = options;

    if (files.length === 0) {
      return '';
    }

    this.logger.debug('Executing batch hash command', { count: files.length });

    const commands = files.map(({ path, algorithm }) => {
      const escapedPath = `'${path.replace(/'/g, "'\\''")}'`;
      const hashCmd = this.getHashCommand(algorithm);
      
      return `echo "START:${path}" && ${hashCmd} ${escapedPath} 2>/dev/null || echo "ERROR"`;
    }).join(' ; ');

    try {
      const output = (await this.device.shell(commands, { ...options })).stdout;
      
      this.logger.debug('Batch hash command completed', { 
        count: files.length,
        outputLength: output.length
      });
      
      return output;
    } catch (error) {
      this.logger.error('Batch hash command failed', { count: files.length, error });
      throw error;
    }
  }

  private getHashCommand(algorithm: string): string {
    const commands: Record<string, string> = {
      'md5': 'md5sum',
      'sha1': 'sha1sum',
      'sha256': 'sha256sum',
      'sha512': 'sha512sum'
    };
    return commands[algorithm] || 'sha256sum';
  }
}