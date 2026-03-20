import type { Adb } from '@yume-chan/adb';
import type { CommandOptions } from '.';
import { ADBCommands } from '.';
import { ShellCommand } from './shellCommand';
import { Logger } from '../../utils/logger';

export interface StatOptions extends CommandOptions {
  path: string;
  format?: string;
}

export class StatCommand implements ADBCommands<string> {
  private logger: Logger;

  private static readonly DEFAULT_FORMAT = '%s|%F|%Y|%X|%Z|%a|%A|%U|%G|%u|%g|%i|%C';

  constructor(private adb: Adb) {
    this.logger = new Logger('StatCommand');
  }

  async exec(options: StatOptions): Promise<string> {
    const { path, format = StatCommand.DEFAULT_FORMAT, timeout = 5000 } = options;

    this.logger.debug('Executing stat command', { path });

    const command = `stat -c "${format}" ${this.escapeShellArg(path)} 2>/dev/null || echo ""`;

    try {
      const output = (await new ShellCommand(this.adb, command).exec({ timeout })).stdout;

      this.logger.debug('Stat command completed', {
        path,
        outputLength: output.length,
      });

      return output;
    } catch (error) {
      this.logger.error('Stat command failed', { path, error });
      throw error;
    }
  }

  private escapeShellArg(arg: string): string {
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }
}

export interface StatBatchOptions extends CommandOptions {
  paths: string[];
  format?: string;
}

export class StatBatchCommand implements ADBCommands<string> {
  private logger: Logger;
  private static readonly DEFAULT_FORMAT = '%s|%F|%Y|%X|%Z|%a|%A|%U|%G|%u|%g|%i|%C';

  constructor(private adb: Adb) {
    this.logger = new Logger('StatBatchCommand');
  }

  async exec(options: StatBatchOptions): Promise<string> {
    const { paths, format = StatBatchCommand.DEFAULT_FORMAT, timeout = 30000 } = options;

    if (paths.length === 0) {
      return '';
    }

    this.logger.debug('Executing batch stat command', { count: paths.length });

    // Build command that stats all files
    // Each stat output will be on a separate line
    const commands = paths
      .map(path => `stat -c "${format}" ${this.escapeShellArg(path)} 2>/dev/null || echo "ERROR"`)
      .join(' ; ');

    try {
      const output = (await new ShellCommand(this.adb, commands).exec({ timeout })).stdout;

      this.logger.debug('Batch stat command completed', {
        count: paths.length,
        outputLength: output.length,
      });

      return output;
    } catch (error) {
      this.logger.error('Batch stat command failed', { count: paths.length, error });
      throw error;
    }
  }

  private escapeShellArg(arg: string): string {
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }
}
