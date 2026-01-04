import type { Adb } from '@yume-chan/adb';
import type { ADBConnection, DeviceInfo } from './connection';
import { ADBCommands } from './commands';
import { Logger } from '../utils/logger';

export interface DeviceProperties {
  androidVersion: string;
  buildId: string;
  model: string;
  manufacturer: string;
  brand: string;
  sdkVersion: number;
  serialNumber: string;
}

export class ADBDevice {
  private logger: Logger;
  public readonly commands: ADBCommands;
  public readonly info: DeviceInfo;

  constructor(
    private adb: Adb,
    deviceInfo: DeviceInfo,
    private connection: ADBConnection
  ) {
    this.info = deviceInfo;
    this.commands = new ADBCommands(this.adb);
    this.logger = new Logger('ADBDevice');
    this.logger.info('Device initialized', { serial: deviceInfo.serialNumber });
  }

  /**
   * Ottiene le proprietà del dispositivo Android
   */
  async getProperties(): Promise<DeviceProperties> {
    this.logger.debug('Fetching device properties...');

    const props = await this.commands.getprop();

    return {
      androidVersion: props['ro.build.version.release'] || 'Unknown',
      buildId: props['ro.build.id'] || 'Unknown',
      model: props['ro.product.model'] || this.info.productName || 'Unknown',
      manufacturer: props['ro.product.manufacturer'] || this.info.manufacturerName || 'Unknown',
      brand: props['ro.product.brand'] || 'Unknown',
      sdkVersion: parseInt(props['ro.build.version.sdk'] || '0', 10),
      // RISOLUZIONE TS2345: Forniamo sempre una stringa, anche se serialNumber è undefined
      serialNumber: this.info.serialNumber || 'Unknown' 
    };
  }

  /**
   * Verifica se il dispositivo è rootato
   */
  async isRooted(): Promise<boolean> {
    try {
      const result = await this.commands.shell('su -c "id"');
      return result.includes('uid=0');
    } catch {
      return false;
    }
  }

  /**
   * Ottiene informazioni sulla batteria
   */
  async getBatteryInfo(): Promise<{
    level: number;
    temperature: number;
    voltage: number;
    status: string;
  }> {
    const output = await this.commands.shell('dumpsys battery');
    
    // Usiamo nullish coalescing per sicurezza
    const level = this.extractValue(output, 'level') ?? 0;
    const temperature = this.extractValue(output, 'temperature') ?? 0;
    const voltage = this.extractValue(output, 'voltage') ?? 0;
    const status = this.extractStringValue(output, 'status') || 'Unknown';

    return {
      level: parseInt(level.toString(), 10),
      temperature: parseInt(temperature.toString(), 10) / 10,
      voltage: parseInt(voltage.toString(), 10),
      status
    };
  }

  async disconnect(): Promise<void> {
    await this.connection.disconnect();
  }

  isConnected(): boolean {
    return this.connection.isConnected();
  }

private extractValue(output: string, key: string): number | null {
    const regex = new RegExp(`${key}:\\s*(\\d+)`, 'i');
    const match = output.match(regex);
    return (match && match[1]) ? parseInt(match[1], 10) : null;
  }

private extractStringValue(output: string, key: string): string | null {
    const regex = new RegExp(`${key}:\\s*(.+)`, 'i');
    const match = output.match(regex);
    return (match && match[1]) ? match[1].trim() : null;
  }
}