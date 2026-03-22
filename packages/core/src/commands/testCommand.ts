import type { DeviceCommand, ShellOptions } from '.';
import { Logger } from '../utils/logger';
import { Device } from '../adb';

export interface TestFileOptions extends ShellOptions {
  path: string;
}

export class TestFileCommand implements DeviceCommand<boolean> {
  private logger: Logger;

  constructor(private device: Device) {
    this.logger = new Logger('TestFileCommand');
  }

  async exec(options: TestFileOptions): Promise<boolean> {
    const { path, timeout = 5000 } = options;

    this.logger.debug('Testing file existence', { path });

    const command = `test -e '${path.replace(/'/g, "'\\''")}' && echo "exists" || echo "not-found"`;

    try {
      const output = (await this.device.shell(command, { ...options })).stdout;
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