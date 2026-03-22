import type { DeviceCommand, ShellOptions } from '.';
import { Device } from '../adb';

export interface WhichOptions extends ShellOptions {
  all?: boolean;
  binary: string;
}

export class WhichCommand implements DeviceCommand<string> {

  constructor(private device: Device) { }

  async exec(options: WhichOptions): Promise<string> {
    const args: string[] = [];

    if (options.all) args.push('-a');

    return (await this.device.shell(`which ${args.join(' ')} ${options.binary}`, { ...options })).stdout.trim();
  }

}
