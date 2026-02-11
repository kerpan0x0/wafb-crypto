import type { Adb } from '@yume-chan/adb';
import { ADBCommands, CommandOptions } from '.';
import { ShellCommand } from './shellCommand';
import { Logger } from '../../utils/logger';

export type DumpsysService =
  | 'battery'
  | 'package'
  | 'activity'
  | 'window'
  | 'display'
  | 'wifi'
  | 'netstats'
  | 'meminfo'
  | 'cpuinfo'
  | 'telephony.registry'
  | 'alarm'
  | 'notification'
  | 'usagestats'
  | 'location'
  | 'connectivity'
  | 'bluetooth_manager'
  | 'power'
  | 'batterystats'
  | 'sensorservice';


export interface DumpsysOptions extends CommandOptions {
  service?: DumpsysService | string;
  packageName?: string;
  args?: string[];
}

export class DumpsysCommand implements ADBCommands<string> {
  private logger: Logger;

  constructor(private adb: Adb) {
    this.logger = new Logger('DumpsysCommand');
  }

  async exec(options: DumpsysOptions): Promise<string> {
    const { service, packageName, args, timeout = 30000 } = options;
    this.logger.debug('Executing dumpsys command', { service, packageName, args });

    const command = this.buildCommand(service, packageName, args);

    try {
      const output = await new ShellCommand(this.adb, command).exec({ timeout });

      this.logger.debug('Dumpsys command completed', {
        service,
        outputLength: output.length
      });

      return output;
    } catch (error) {
      this.logger.error('Dumpsys command failed', { service, error });
      throw error;
    }
  }

  private buildCommand(
    service?: string,
    packageName?: string,
    args: string[] = []
  ): string {
    let command = `dumpsys`;

    if (service) {
      command += ` ${service}`
    }

    if (packageName) {
      command += ` ${packageName}`;
    }

    if (args && args.length > 0) {
      command += ` ${args.join(' ')}`;
    }

    return command;
  }
}