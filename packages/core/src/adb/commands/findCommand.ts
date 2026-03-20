import type { Adb } from '@yume-chan/adb';
import type { CommandOptions } from '.';
import { ADBCommands } from '.';
import { ShellCommand } from './shellCommand';
import { Logger } from '../../utils/logger';

export interface FindOptions extends CommandOptions {
  path: string;
  name?: string;
  type?: 'f' | 'd' | 'l';
  maxDepth?: number;
  excludePaths?: string[];
}

export class FindCommand implements ADBCommands<string> {
  private logger: Logger;

  constructor(private adb: Adb) {
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
      const output = (await new ShellCommand(this.adb, command).exec({ timeout })).stdout;
      
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