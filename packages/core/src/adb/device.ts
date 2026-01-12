import type { Adb } from '@yume-chan/adb';
import type { ADBConnection } from './connection';
import { ADBCommands } from './commands';
import { Logger } from '../utils/logger';
import type {
  BatteryInfo,
  DeviceInfo,
  DeviceProperties,
  MemoryInfo,
  NetworkInfo,
  SensorInfo,
  StorageInfo
} from './base';

/**
 * ADBDevice - Represents a connected Android device
 * 
 * DESIGN PRINCIPLES:
 * - Device-level operations (properties, status, state) are exposed as direct methods
 * - Low-level operations (shell, packages, files) are delegated to commands
 */
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

  // ============================================================================
  // DEVICE PROPERTIES & STATE - High-level device information
  // ============================================================================

  /**
   * Gets Android device properties
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
      serialNumber: this.info.serialNumber || 'Unknown',
    };
  }

  /**
   * Checks if device is rooted
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
   * Gets battery information
   */
  async getBatteryInfo(): Promise<BatteryInfo> {
    try {
      const output = await this.commands.shell('dumpsys battery');

      return {
        level: this.extractNumber(output, 'level') ?? 0,
        temperature: (this.extractNumber(output, 'temperature') ?? 0) / 10,
        voltage: this.extractNumber(output, 'voltage') ?? 0,
        status: this.extractString(output, 'status') || 'Unknown',
        health: this.extractString(output, 'health') || '',
        technology: this.extractString(output, 'technology') || '',
        present: this.extractString(output, 'present') === 'true'
      };
    } catch (error) {
      this.logger.warn('Failed to get battery info', error);
      return {
        level: 0,
        temperature: 0,
        voltage: 0,
        status: 'Unknown'
      };
    }
  }

  /**
   * Gets network information
   */
  async getNetworkInfo(): Promise<NetworkInfo> {
    try {
      const settingsOutput = await this.commands.shell('settings list global');

      return {
        wifiEnabled: settingsOutput.includes('wifi_on=1'),
        mobileDataEnabled: settingsOutput.includes('mobile_data=1'),
        airplaneModeOn: settingsOutput.includes('airplane_mode_on=1'),
        activeNetworkType: this.extractActiveNetwork(settingsOutput)
      };
    } catch (error) {
      this.logger.warn('Failed to get network info', error);
      return {
        wifiEnabled: false,
        mobileDataEnabled: false,
        airplaneModeOn: false
      };
    }
  }

  /**
   * Gets storage information
   */
  async getStorageInfo(): Promise<StorageInfo> {
    try {
      const dfOutput = await this.commands.shell('df /data /sdcard 2>/dev/null || df');
      const lines = dfOutput.split('\n').filter(l => l.trim());

      let totalInternal = 'Unknown';
      let availableInternal = 'Unknown';

      for (const line of lines) {
        if (line.includes('/data') || line.includes('userdata')) {
          const parts = line.split(/\s+/).filter(p => p);
          if (parts.length >= 4) {
            totalInternal = parts[1];
            availableInternal = parts[3];
          }
          break;
        }
      }

      return {
        totalInternal,
        availableInternal
      };
    } catch (error) {
      this.logger.warn('Failed to get storage info', error);
      return {
        totalInternal: 'Unknown',
        availableInternal: 'Unknown'
      };
    }
  }

  /**
   * Gets memory information
   */
  async getMemoryInfo(): Promise<MemoryInfo> {
    try {
      const output = await this.commands.shell('dumpsys meminfo');

      const totalMatch = output.match(/Total RAM:\s+([^\n]+)/);
      const freeMatch = output.match(/Free RAM:\s+([^\n]+)/);
      const lowMemMatch = output.match(/Low Memory:\s+(\w+)/);
      const thresholdMatch = output.match(/Threshold:\s+([^\n]+)/);

      return {
        totalRam: totalMatch?.[1]?.trim() || 'Unknown',
        availableRam: freeMatch?.[1]?.trim() || 'Unknown',
        lowMemory: lowMemMatch?.[1] === 'true',
        threshold: thresholdMatch?.[1]?.trim() || 'Unknown'
      };
    } catch (error) {
      this.logger.warn('Failed to get memory info', error);
      return {
        totalRam: 'Unknown',
        availableRam: 'Unknown',
        lowMemory: false,
        threshold: 'Unknown'
      };
    }
  }

  /**
   * Gets list of device sensors
   */
  async getSensors(): Promise<SensorInfo[]> {
    try {
      const output = await this.commands.shell('dumpsys sensorservice');
      const sensors: SensorInfo[] = [];

      const lines = output.split('\n');
      let currentSensor: Partial<SensorInfo> | null = null;

      for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.match(/^\w+\s+Sensor\s*$/i) || trimmed.includes('| ')) {
          if (currentSensor?.name) {
            sensors.push(currentSensor as SensorInfo);
          }
          currentSensor = {};
          continue;
        }

        if (!currentSensor) continue;

        if (trimmed.includes('name=')) {
          currentSensor.name = this.extractValue(trimmed, 'name');
        } else if (trimmed.includes('type=')) {
          currentSensor.type = this.extractValue(trimmed, 'type');
        } else if (trimmed.includes('vendor=')) {
          currentSensor.vendor = this.extractValue(trimmed, 'vendor');
        } else if (trimmed.includes('version=')) {
          currentSensor.version = this.extractValue(trimmed, 'version');
        }
      }

      if (currentSensor?.name) {
        sensors.push(currentSensor as SensorInfo);
      }

      return sensors;
    } catch (error) {
      this.logger.warn('Failed to get sensors info', error);
      return [];
    }
  }

  // ============================================================================
  // CONNECTION MANAGEMENT
  // ============================================================================

  async disconnect(): Promise<void> {
    await this.connection.disconnect();
  }

  isConnected(): boolean {
    return this.connection.isConnected();
  }

  // ============================================================================
  // PRIVATE PARSING HELPERS
  // ============================================================================

  private extractNumber(output: string, key: string): number | null {
    const regex = new RegExp(`${key}[:\\s]+(\\d+)`, 'i');
    const match = output.match(regex);
    return match ? parseInt(match[1], 10) : null;
  }

  private extractString(output: string, key: string): string | null {
    const regex = new RegExp(`${key}[:\\s]+([^\\n\\r]+)`, 'i');
    const match = output.match(regex);
    return match?.[1]?.trim() || null;
  }

  private extractValue(line: string, key: string): string {
    const regex = new RegExp(`${key}=([^,\\s]+)`);
    const match = line.match(regex);
    return match?.[1] || 'Unknown';
  }

  private extractActiveNetwork(output: string): string | undefined {
    if (output.includes('wifi_on=1')) return 'WiFi';
    if (output.includes('mobile_data=1')) return 'Mobile Data';
    return undefined;
  }
}