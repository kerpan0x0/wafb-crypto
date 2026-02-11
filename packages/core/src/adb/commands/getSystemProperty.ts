import { Adb } from "@yume-chan/adb";
import { Logger } from "../..";
import { ADBCommands, CommandOptions } from ".";
import { ShellCommand } from "./shellCommand";


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
