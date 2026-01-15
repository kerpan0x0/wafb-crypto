import { Adb } from "@yume-chan/adb";
import { Logger } from "../..";
import { ADBCommands, BatteryInfo, CommandArgs, CommandOptions, MemoryInfo, NetworkInfo, PackageInfoOptions, PackageInfoResult, SensorInfo, StorageInfo } from ".";
import { ShellCommand } from "./shellCommand";

export class GetBatteryInfoCommand implements ADBCommands<BatteryInfo> {
  private logger: Logger;

  constructor(private adb: Adb) {
    this.logger = new Logger('GetBatteryInfoCommand');
  }

  async exec(): Promise<BatteryInfo> {
    try {
      const output = await new ShellCommand(this.adb, 'dumpsys battery').exec();
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
}

export class GetMemoryInfoCommand implements ADBCommands<MemoryInfo> {
  private logger: Logger;

  constructor(private adb: Adb) {
    this.logger = new Logger('GetMemoryInfoCommand');
  }

  async exec(): Promise<MemoryInfo> {
    try {
      const output = await new ShellCommand(this.adb, 'dumpsys meminfo').exec();

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
}

export class GetNetworkInfoCommand implements ADBCommands<NetworkInfo> {
  private logger: Logger;

  constructor(private adb: Adb) {
    this.logger = new Logger('GetNetworkInfoCommand');
  }

  async exec(): Promise<NetworkInfo> {
    try {
      const settingsOutput = await new ShellCommand(this.adb, 'settings list global').exec();

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

  private extractActiveNetwork(output: string): string | undefined {
    if (output.includes('wifi_on=1')) return 'WiFi';
    if (output.includes('mobile_data=1')) return 'Mobile Data';
    return undefined;
  }
}

export class GetPackageInfoCommand implements ADBCommands<PackageInfoResult | null> {
  private logger: Logger;

  constructor(private adb: Adb) {
    this.logger = new Logger('GetPackageInfoCommand');
  }

  async exec(
    args: CommandArgs,
    options: PackageInfoOptions = {}
  ): Promise<PackageInfoResult | null> {
    const { includePermissions = false, timeout = 10000 } = options;
    const packageName = args.packageName.toString();

    try {
      const output = await new ShellCommand(this.adb, `dumpsys package ${packageName}`).exec({ timeout });

      if (!output || output.trim().length === 0) {
        return null;
      }

      const info: PackageInfoResult = {
        packageName: packageName,
        versionName: this.extractField(output, 'versionName') || 'Unknown',
        versionCode: this.extractField(output, 'versionCode') || 'Unknown',
        installLocation: this.extractField(output, 'codePath') || 'Unknown',
        firstInstallTime: this.extractField(output, 'firstInstallTime') || 'Unknown',
        lastUpdateTime: this.extractField(output, 'lastUpdateTime') || 'Unknown',
        targetSdk: this.extractNumber(output, 'targetSdk'),
        minSdk: this.extractNumber(output, 'minSdk')
      };

      if (includePermissions) {
        info.permissions = this.extractPermissions(output);
      }

      return info;
    } catch (error) {
      this.logger.debug('Failed to get package info', { packageName, error });
      return null;
    }
  }

  private extractField(output: string, field: string): string | null {
    const regex = new RegExp(`${field}=([^\\s]+)`, 'i');
    const match = output.match(regex);
    return match?.[1] || null;
  }

  private extractNumber(output: string, field: string): number | undefined {
    const value = this.extractField(output, field);
    if (!value) return undefined;

    const num = parseInt(value, 10);
    return isNaN(num) ? undefined : num;
  }

  private extractPermissions(output: string): string[] {
    const permissions: string[] = [];
    const lines = output.split('\n');
    let inPermissionsSection = false;

    for (const line of lines) {
      if (line.includes('requested permissions:')) {
        inPermissionsSection = true;
        continue;
      }

      if (inPermissionsSection) {
        if (line.trim().startsWith('android.permission.')) {
          const permission = line.trim().split(':')[0];
          if (permission) {
            permissions.push(permission);
          }
        } else if (!line.trim().startsWith('android.') && line.trim().length > 0) {
          break;
        }
      }
    }

    return permissions;
  }
}

export class GetPropCommand implements ADBCommands<Record<string, string>> {

  constructor(private adb: Adb) { }

  async exec(options: CommandOptions = {}): Promise<Record<string, string>> {
    const output = await new ShellCommand(this.adb, 'getprop').exec(options);
    const props: Record<string, string> = {};
    const regex = /\[([^\]]+)\]:\s*\[([^\]]*)\]/g;

    let match;
    while ((match = regex.exec(output)) !== null) {
      if (match[1] && match[2] !== undefined) {
        props[match[1]] = match[2];
      }
    }

    return props;
  }
}

export class GetSensorsCommand implements ADBCommands<SensorInfo[]> {
  private logger: Logger;

  constructor(private adb: Adb) {
    this.logger = new Logger('GetSensorsCommand');
  }

  async exec(): Promise<SensorInfo[]> {
    try {
      const output = await new ShellCommand(this.adb, 'dumpsys sensorservice').exec();
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

  private extractValue(line: string, key: string): string {
    const regex = new RegExp(`${key}=([^,\\s]+)`);
    const match = line.match(regex);
    return match?.[1] || 'Unknown';
  }
}

export class GetStorageInfoCommand implements ADBCommands<StorageInfo> {
  private logger: Logger;
  constructor(private adb: Adb) {
    this.logger = new Logger('GetStorageInfoCommand');
  }

  async exec(): Promise<StorageInfo> {
    try {
      const dfOutput = await new ShellCommand(this.adb, 'df /data /sdcard 2>/dev/null || df').exec();
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
}