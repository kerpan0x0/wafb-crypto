import type { Adb, AdbSync } from '@yume-chan/adb';
import type { ADBConnection } from './connection';
import { Logger } from '../utils/logger';
import { DeviceInfo } from '.';
import { Shell } from './shell';
import type { ShellResult, SpawnResult, ShellOptions } from '.';

export interface DeviceProperties {
  androidVersion: string;
  buildId: string;
  model: string;
  manufacturer: string;
  brand: string;
  sdkVersion: number;
  serialNumber: string;
  policyVersion?: string;
  bootloader?: string;
  hardware?: string;
  fingerprint?: string;
}

export class Device {
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

  // ---------------------------------------------------------------------------
  // Transport — used internally by Command classes
  // ---------------------------------------------------------------------------

  /**
   * Executes a shell command and returns the buffered result.
   * Command classes call this instead of constructing ShellCommand directly.
   */
  shell(cmd: string, opts: ShellOptions = {}): Promise<ShellResult> {
    return new Shell(this.adb, cmd).exec(opts);
  }

  /**
   * Spawns a shell command and returns a streaming result.
   * Use for large outputs that should not be buffered in memory.
   */
  spawn(cmd: string, idleTimeout?: number): Promise<SpawnResult> {
    return new Shell(this.adb, cmd).spawn(idleTimeout);
  }

  sync(): Promise<AdbSync> {
    return this.adb.sync();
  }

  // ---------------------------------------------------------------------------
  // Device API
  // ---------------------------------------------------------------------------

  async getProperties(): Promise<DeviceProperties> {
    this.logger.debug('Fetching device properties...');

    const output = (await this.shell('getprop')).stdout;
    const props: Record<string, string> = {};
    const regex = /\[([^\]]+)\]:\s*\[([^\]]*)\]/g;

    let match;
    while ((match = regex.exec(output)) !== null) {
      if (match[1] && match[2] !== undefined) {
        props[match[1]] = match[2];
      }
    }

    return {
      androidVersion: props['ro.build.version.release'] || 'Unknown',
      buildId: props['ro.build.id'] || 'Unknown',
      model: props['ro.product.model'] || this.info.productName || 'Unknown',
      manufacturer: props['ro.product.manufacturer'] || this.info.manufacturerName || 'Unknown',
      brand: props['ro.product.brand'] || 'Unknown',
      sdkVersion: parseInt(props['ro.build.version.sdk'] || '0', 10),
      serialNumber: this.info.serialNumber || 'Unknown',
      policyVersion:
        props['ro.build.selinux'] ||
        props['ro.boot.selinux'] ||
        props['selinux.reload_policy'],
      bootloader: props['ro.bootloader'],
      hardware: props['ro.hardware'],
      fingerprint: props['ro.build.fingerprint'],
    };
  }

  async isRooted(): Promise<boolean> {
    try {
      const output = (await this.shell('su -c "id"')).stdout;
      return output.includes('uid=0');
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