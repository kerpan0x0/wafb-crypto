import type { Device, DeviceProperties } from '../../adb';
import { Acquirer } from './acquirer';
import type { AcquisitionConfig, AcquisitionProgress, AcquisitionResult, AcquisitionFile } from '.';
import { DumpsysCommand, GetNetworkInfoCommand, GetStorageInfoCommand } from '../../commands';
import { bytesToStream, hashingPassthrough } from '../../utils/stream-helpers';

export interface SystemInfoConfig extends AcquisitionConfig {
  includeBattery?: boolean;
  includeNetwork?: boolean;
  includeStorage?: boolean;
  includeMemory?: boolean;
  includeSensors?: boolean;
}

export interface BatteryInfo {
  level: number;
  temperature: number;
  voltage: number;
  status: string;
  health?: string;
  technology?: string;
  present?: boolean;
}

export interface NetworkInfo {
  wifiEnabled: boolean;
  mobileDataEnabled: boolean;
  airplaneModeOn: boolean;
  activeNetworkType?: string;
  ipAddress?: string;
  macAddress?: string;
}

export interface StorageInfo {
  totalInternal: string;
  availableInternal: string;
  totalExternal?: string;
  availableExternal?: string;
}

export interface MemoryInfo {
  totalRam: string;
  availableRam: string;
  lowMemory: boolean;
  threshold: string;
}

export interface SensorInfo {
  name: string;
  type: string;
  vendor?: string;
  version?: string;
  power?: string;
  maxRange?: string;
}

// ------------------------------------------------------------------------

export interface SystemInfoData {
  device: {
    manufacturer: string;
    model: string;
    brand: string;
    androidVersion: string;
    buildId: string;
    sdkVersion: number;
    serialNumber: string;
    bootloader?: string;
    hardware?: string;
    fingerprint?: string;
  };
  battery?: BatteryInfo;
  network?: NetworkInfo;
  storage?: StorageInfo;
  memory?: MemoryInfo;
  sensors?: SensorInfo[];
  systemProperties: DeviceProperties;
  acquisitionTime: string;
}

export class SystemInfoAcquirer extends Acquirer {
  constructor(
    device: Device,
    protected config: SystemInfoConfig = {}
  ) {
    super(device, config, 'system_info');
  }

  async acquire(onProgress?: (progress: AcquisitionProgress) => void): Promise<AcquisitionResult> {
    const startTime = new Date();

    try {
      this.logger.info('Starting system info acquisition');

      // Step 1: Get device properties (10%)
      this.notifyProgress(onProgress, 10, 'Reading device properties...', 'running');
      const deviceInfo = await this.device.getProperties();

      this.notifyProgress(
        onProgress,
        20,
        `Connected to ${deviceInfo.model}`,
        'running',
        deviceInfo
      );

      // Step 2: Get all system properties (30%)
      this.notifyProgress(onProgress, 30, 'Gathering system properties...', 'running');
      const deviceProps = await this.device.getProperties();
      const systemInfoData: SystemInfoData = this.buildSystemInfoData(deviceInfo, deviceProps);

      let progressOffset = 40;
      const step = 60 / this.getEnabledComponentsCount();

      // Step 3: Get battery info (40-50%)
      if (this.config.includeBattery !== false) {
        this.notifyProgress(
          onProgress,
          progressOffset,
          'Reading battery information...',
          'running'
        );
        try {
          systemInfoData.battery = await this.getBatteryInfo();
        } catch (error) {
          this.logger.warn('Failed to acquire battery info', error);
          // Non rilanciamo l'errore, permettiamo l'acquisizione parziale
        }
        progressOffset += step;
      }

      // Step 5: Get network info (50-60%)
      if (this.config.includeNetwork !== false) {
        this.notifyProgress(
          onProgress,
          progressOffset,
          'Reading network information...',
          'running'
        );
        try {
          systemInfoData.network = await this.getNetworkInfo();
        } catch (error) {
          this.logger.warn('Failed to acquire network info', error);
        }
        progressOffset += step;
      }

      // Step 6: Get storage info (60-70%)
      if (this.config.includeStorage !== false) {
        this.notifyProgress(
          onProgress,
          progressOffset,
          'Reading storage information...',
          'running'
        );
        try {
          systemInfoData.storage = await this.getStorageInfo();
        } catch (error) {
          this.logger.warn('Failed to acquire storage info', error);
        }
        progressOffset += step;
      }

      // Step 7: Get memory info (70-80%)
      if (this.config.includeMemory !== false) {
        this.notifyProgress(onProgress, progressOffset, 'Reading memory information...', 'running');
        try {
          systemInfoData.memory = await this.getMemoryInfo();
        } catch (error) {
          this.logger.warn('Failed to acquire memory info', error);
        }
        progressOffset += step;
      }

      // Step 8: Get sensors (80-90%)
      if (this.config.includeSensors !== false) {
        this.notifyProgress(
          onProgress,
          progressOffset,
          'Reading sensors information...',
          'running'
        );
        try {
          systemInfoData.sensors = await this.getSensors();
        } catch (error) {
          this.logger.warn('Failed to acquire sensors info', error);
        }
        progressOffset += step;
      }

      // Step 9: Prepare export (90%)
      this.notifyProgress(onProgress, 90, 'Preparing export...', 'running');

      const jsonData = JSON.stringify(systemInfoData, null, 2);
      const jsonBytes = new TextEncoder().encode(jsonData);

      const fileName = this.generateFileName('system-info', 'json');

      let file: AcquisitionFile;
      if (this.config.computeHash) {
        const { writable, readable, hashPromise } = await hashingPassthrough('sha-256');
        bytesToStream(jsonBytes).pipeTo(writable).catch(err => this.logger.error('Hash pipe error', err));
        file = { fileName: fileName, fileSize: jsonBytes.length, stream: readable, hashPromise, description: 'System information', mimeType: 'application/json' };
      } else {
        file = { fileName: fileName, fileSize: jsonBytes.length, stream: bytesToStream(jsonBytes), description: 'System information', mimeType: 'application/json' };
      }

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      this.notifyProgress(onProgress, 100, 'System info acquisition completed!', 'completed');

      // Step 10: Build result
      const result: AcquisitionResult = {
        success: true,
        type: 'system_info',
        files: [file],
        startTime,
        endTime,
        duration,
        data: {
          deviceInfo,
          componentsCollected: {
            battery: !!systemInfoData.battery,
            network: !!systemInfoData.network,
            storage: !!systemInfoData.storage,
            memory: !!systemInfoData.memory,
            sensors: !!systemInfoData.sensors,
          },
        },
      };

      this.logger.info('System info acquisition completed', {
        fileName,
        fileSize: jsonBytes.length,
        duration,
      });

      return result;
    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error('System info acquisition failed', error);
      this.notifyProgress(onProgress, 0, `Error: ${errorMessage}`, 'failed');

      return {
        success: false,
        type: 'system_info',
        startTime,
        endTime,
        duration,
        error: errorMessage,
      };
    }
  }

  // ============================================================================
  // Adapters
  // ============================================================================

  private buildSystemInfoData(
    deviceInfo: DeviceProperties,
    systemProps: DeviceProperties
  ): SystemInfoData {
    return {
      device: {
        manufacturer: deviceInfo.manufacturer,
        model: deviceInfo.model,
        brand: deviceInfo.brand,
        androidVersion: deviceInfo.androidVersion,
        buildId: deviceInfo.buildId,
        sdkVersion: deviceInfo.sdkVersion,
        serialNumber: deviceInfo.serialNumber,
        bootloader: deviceInfo.bootloader,
        hardware: deviceInfo.hardware,
        fingerprint: deviceInfo.fingerprint,
      },
      systemProperties: systemProps,
      acquisitionTime: new Date().toISOString(),
    };
  }

  private buildBatteryinfo(output: string): BatteryInfo | PromiseLike<BatteryInfo> {
    return {
      level: this.extractNumber(output, 'level') ?? 0,
      temperature: (this.extractNumber(output, 'temperature') ?? 0) / 10,
      voltage: this.extractNumber(output, 'voltage') ?? 0,
      status: this.extractString(output, 'status') || 'Unknown',
      health: this.extractString(output, 'health') || '',
      technology: this.extractString(output, 'technology') || '',
      present: this.extractString(output, 'present') === 'true',
    };
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

  private buildNetworkInfo(output: string): NetworkInfo {
    return {
      wifiEnabled: output.includes('wifi_on=1'),
      mobileDataEnabled: output.includes('mobile_data=1'),
      airplaneModeOn: output.includes('airplane_mode_on=1'),
      activeNetworkType: this.extractActiveNetwork(output),
    };
  }

  private extractActiveNetwork(output: string): string | undefined {
    if (output.includes('wifi_on=1')) return 'WiFi';
    if (output.includes('mobile_data=1')) return 'Mobile Data';
    return undefined;
  }

  private buildMemoryInfo(output: string): MemoryInfo {
    const totalMatch = output.match(/Total RAM:\s+([^\n]+)/);
    const freeMatch = output.match(/Free RAM:\s+([^\n]+)/);
    const lowMemMatch = output.match(/Low Memory:\s+(\w+)/);
    const thresholdMatch = output.match(/Threshold:\s+([^\n]+)/);

    return {
      totalRam: totalMatch?.[1]?.trim() || 'Unknown',
      availableRam: freeMatch?.[1]?.trim() || 'Unknown',
      lowMemory: lowMemMatch?.[1] === 'true',
      threshold: thresholdMatch?.[1]?.trim() || 'Unknown',
    };
  }

  private buildStorageInfo(output: string): StorageInfo {
    const lines = output.split('\n').filter(l => l.trim());

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
      availableInternal,
    };
  }

  private buildSensorInfo(output: string): SensorInfo[] {
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
  }

  private extractValue(line: string, key: string): string {
    const regex = new RegExp(`${key}=([^,\\s]+)`);
    const match = line.match(regex);
    return match?.[1] || 'Unknown';
  }
  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private getEnabledComponentsCount(): number {
    let count = 0;
    if (this.config.includeBattery !== false) count++;
    if (this.config.includeNetwork !== false) count++;
    if (this.config.includeStorage !== false) count++;
    if (this.config.includeMemory !== false) count++;
    if (this.config.includeSensors !== false) count++;
    return count || 1;
  }

  async getBatteryInfo(): Promise<BatteryInfo> {
    try {
      const output = await new DumpsysCommand(this.device).exec({ service: 'battery' });
      return this.buildBatteryinfo(output);
    } catch (error) {
      this.logger.warn('Failed to get battery info', error);
      return this.buildBatteryinfo('');
    }
  }

  async getNetworkInfo(): Promise<NetworkInfo> {
    try {
      const output = await new GetNetworkInfoCommand(this.device).exec();
      return this.buildNetworkInfo(output);
    } catch (error) {
      this.logger.warn('Failed to get network info', error);
      return this.buildNetworkInfo('');
    }
  }

  async getStorageInfo(): Promise<StorageInfo> {
    try {
      const output = await new GetStorageInfoCommand(this.device).exec();
      return this.buildStorageInfo(output);
    } catch (error) {
      this.logger.warn('Failed to get storage info', error);
      return this.buildStorageInfo('');
    }
  }

  async getMemoryInfo(): Promise<MemoryInfo> {
    try {
      const output = await new DumpsysCommand(this.device).exec({ service: 'meminfo' });
      return this.buildMemoryInfo(output);
    } catch (error) {
      this.logger.warn('Failed to get memory info', error);
      return this.buildMemoryInfo('');
    }
  }

  async getSensors(): Promise<SensorInfo[]> {
    try {
      const output = await new DumpsysCommand(this.device).exec({ service: 'sensorservice' });
      return this.buildSensorInfo(output);
    } catch (error) {
      this.logger.warn('Failed to get sensors info', error);
      return [];
    }
  }
}