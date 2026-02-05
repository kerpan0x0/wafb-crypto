import type { Adb } from '@yume-chan/adb';
import type { CommandOptions } from '.';
import { ADBCommands } from '.';
import { ShellCommand } from './shellCommand';
import { Logger } from '../../utils/logger';

export interface TestFileOptions extends CommandOptions {
  path: string;
}

export class TestFileCommand implements ADBCommands<boolean> {
  private logger: Logger;

  constructor(private adb: Adb) {
    this.logger = new Logger('TestFileCommand');
  }

  async exec(options: TestFileOptions): Promise<boolean> {
    const { path, timeout = 5000 } = options;

    this.logger.debug('Testing file existence', { path });

    const command = `test -e '${path.replace(/'/g, "'\\''")}' && echo "exists" || echo "not-found"`;

    try {
      const output = await new ShellCommand(this.adb, command).exec({ timeout });
      const exists = output.trim() === 'exists';
      
      this.logger.debug('File existence test result', { path, exists });
      
      return exists;
    } catch (error) {
      this.logger.error('Test file command failed', { path, error });
      // If command fails, assume file doesn't exist
      return false;
    }
  }
}