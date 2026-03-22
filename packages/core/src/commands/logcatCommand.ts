import { DeviceCommand } from '.';
import { Device, ShellOptions } from '../adb';

export interface LogcatOptions extends ShellOptions {
  buffer?: 'main' | 'system' | 'radio' | 'events' | 'crash' | 'default' | 'all';
  filter?: string;
  maxLines?: number;
  dump?: boolean;
}

export class GetLogcatCommand implements DeviceCommand<string> {

  constructor(private device: Device) { }

  async exec(options: LogcatOptions = {}): Promise<string> {
    const command = 'logcat';
    const args = [];

    if (options.dump !== false) args.push('-d');
    if (options.buffer) args.push(`-b ${options.buffer}`);
    if (options.maxLines) args.push(`-t ${options.maxLines}`);
    if (options.filter) args.push(options.filter);

    return (await this.device.shell(`${command} ${args.join(' ')}`, { ...options })).stdout;
  }
}
