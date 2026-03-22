import type { DeviceCommand, ShellOptions } from '.';
import { Logger } from '../utils/logger';
import { Device } from '../adb';

export interface FindOptions extends ShellOptions {
  path: string;
  name?: string;
  type?: 'f' | 'd' | 'l';
  maxDepth?: number;
  excludePaths?: string[];
}

export class FindCommand implements DeviceCommand<string> {
  private logger: Logger;

  constructor(private device: Device) {
    this.logger = new Logger('FindCommand');
  }

  async exec(options: FindOptions): Promise<string> {
    const { 
      path, 
      name, 
      type = 'f', 
      maxDepth,
      excludePaths = [],
      timeout = 120000
    } = options;

    this.logger.debug('Executing find command', { path, name, type, maxDepth, excludePaths });

    let command = `find ${this.escapeShellArg(path)}`;
    
    if (excludePaths.length > 0) {
      excludePaths.forEach(excluded => {
        command += ` ! -path '${excluded}/*'`;
      });
    }
    
    if (maxDepth !== undefined) {
      command += ` -maxdepth ${maxDepth}`;
    }
    
    if (type) {
      command += ` -type ${type}`;
    }
    
    if (name) {
      command += ` -name ${this.escapeShellArg(name)}`;
    }
    
    command += ` 2>/dev/null || echo ""`;

    try {
      const output = (await this.device.shell(command, { ...options })).stdout;
      
      const resultCount = output ? output.split('\n').filter(l => l.trim()).length : 0;
      this.logger.debug('Find command completed', { path, resultCount });
      
      return output;
    } catch (error) {
      this.logger.error('Find command failed', { path, error });
      throw error;
    }
  }

  private escapeShellArg(arg: string): string {
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }
}