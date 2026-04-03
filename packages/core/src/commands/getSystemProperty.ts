import { Logger } from "..";
import { DeviceCommand } from ".";
import { Device } from "../adb";


export class GetNetworkInfoCommand implements DeviceCommand<string> {
  private logger: Logger;

  constructor(private device: Device) {
    this.logger = new Logger('GetNetworkInfoCommand');
  }

  async exec(): Promise<string> {
    try {
      return (await this.device.shell('settings list global')).stdout;
    } catch (error) {
      this.logger.warn('Failed to get network info', error);
      return '';
    }
  }
}

export class GetStorageInfoCommand implements DeviceCommand<string> {
  private logger: Logger;
  constructor(private device: Device) {
    this.logger = new Logger('GetStorageInfoCommand');
  }

  async exec(): Promise<string> {
    try {
      return (await this.device.shell('df /data /sdcard 2>/dev/null || df')).stdout;

    } catch (error) {
      this.logger.warn('Failed to get storage info', error);
      return '';
    }
  }
}
