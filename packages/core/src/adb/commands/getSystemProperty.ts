import { Adb } from "@yume-chan/adb";
import { Logger } from "../..";
import { ADBCommands, CommandOptions } from ".";
import { ShellCommand } from "./shellCommand";

export class GetBatteryInfoCommand implements ADBCommands<string> {
  private logger: Logger;

  constructor(private adb: Adb) {
    this.logger = new Logger('GetBatteryInfoCommand');
  }

  async exec(): Promise<string> {
    try {
      return await new ShellCommand(this.adb, 'dumpsys battery').exec();
    } catch (error) {
      this.logger.warn('Failed to get battery info', error);
      return '';
    }
  }
}

export class GetMemoryInfoCommand implements ADBCommands<string> {
  private logger: Logger;

  constructor(private adb: Adb) {
    this.logger = new Logger('GetMemoryInfoCommand');
  }

  async exec(): Promise<string> {
    try {
      return await new ShellCommand(this.adb, 'dumpsys meminfo').exec();
    } catch (error) {
      this.logger.warn('Failed to get memory info', error);
      return '';
    }
  }
}

export class GetNetworkInfoCommand implements ADBCommands<string> {
  private logger: Logger;

  constructor(private adb: Adb) {
    this.logger = new Logger('GetNetworkInfoCommand');
  }

  async exec(): Promise<string> {
    try {
      return await new ShellCommand(this.adb, 'settings list global').exec();
    } catch (error) {
      this.logger.warn('Failed to get network info', error);
      return '';
    }
  }
}

export class GetStorageInfoCommand implements ADBCommands<string> {
  private logger: Logger;
  constructor(private adb: Adb) {
    this.logger = new Logger('GetStorageInfoCommand');
  }

  async exec(): Promise<string> {
    try {
      return await new ShellCommand(this.adb, 'df /data /sdcard 2>/dev/null || df').exec();

    } catch (error) {
      this.logger.warn('Failed to get storage info', error);
      return '';
    }
  }
}

export class GetSensorsCommand implements ADBCommands<string> {
  private logger: Logger;

  constructor(private adb: Adb) {
    this.logger = new Logger('GetSensorsCommand');
  }

  async exec(): Promise<string> {
    try {
      return await new ShellCommand(this.adb, 'dumpsys sensorservice').exec();
    } catch (error) {
      this.logger.warn('Failed to get sensors info', error);
      return '';
    }
  }
}