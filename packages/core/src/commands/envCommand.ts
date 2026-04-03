import { DeviceCommand, ShellOptions } from '.';
import { Device } from '../adb';


export class EnvCommand implements DeviceCommand<string> {
  constructor(private device: Device) {
  }

  async exec(options: ShellOptions = {}): Promise<string> {
    return (await this.device.shell(`env`, { ...options })).stdout;
  }
}
