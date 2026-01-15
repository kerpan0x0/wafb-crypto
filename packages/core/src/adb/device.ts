import type { Adb } from '@yume-chan/adb';
import type { ADBConnection } from './connection';
import { GetPropCommand } from './commands';
import { Logger } from '../utils/logger';
import {
  IsRootedCommand,
} from './commands';
import { DeviceInfo, DeviceProperties } from '.';

export class ADBDevice {
  private logger: Logger;
  public readonly info: DeviceInfo;
  public readonly adb: Adb;

  constructor(
    adb: Adb,
    deviceInfo: DeviceInfo,
    private connection: ADBConnection
  ) {
    this.adb = adb;
    this.info = deviceInfo;
    this.logger = new Logger('ADBDevice');
    this.logger.info('Device initialized', { serial: deviceInfo.serialNumber });
  }

  async getProperties(): Promise<DeviceProperties> {
    this.logger.debug('Fetching device properties...');

    const props = await new GetPropCommand(this.adb).exec();

    return {
      androidVersion: props['ro.build.version.release'] || 'Unknown',
      buildId: props['ro.build.id'] || 'Unknown',
      model: props['ro.product.model'] || this.info.productName || 'Unknown',
      manufacturer: props['ro.product.manufacturer'] || this.info.manufacturerName || 'Unknown',
      brand: props['ro.product.brand'] || 'Unknown',
      sdkVersion: parseInt(props['ro.build.version.sdk'] || '0', 10),
      serialNumber: this.info.serialNumber || 'Unknown',
    };
  }

  async isRooted(): Promise<boolean> {
    try {
      return await new IsRootedCommand(this.adb).exec();
    } catch {
      return false;
    }
  }

  async disconnect(): Promise<void> {
    await this.connection.disconnect();
  }

  isConnected(): boolean {
    return this.connection.isConnected();
  }
}