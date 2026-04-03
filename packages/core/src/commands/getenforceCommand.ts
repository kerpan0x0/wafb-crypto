import { DeviceCommand } from '.';
import { Device, ShellOptions } from '../adb';


export class GetenforceCommand implements DeviceCommand<string> {
  constructor(private device: Device) {
  }

  async exec(options: ShellOptions): Promise<string> {
    return (await this.device.shell(`getenforce`)).stdout;
  }
}
