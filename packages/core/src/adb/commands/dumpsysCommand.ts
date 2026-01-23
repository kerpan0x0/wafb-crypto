import type { Adb } from '@yume-chan/adb';
import { ADBCommands, CommandOptions } from '.';
import { ShellCommand } from './shellCommand';

export interface DumpsysOptions extends CommandOptions {
  service?: string;
}

export class DumpsysListCommand implements ADBCommands<string> {
  constructor(private adb: Adb) {}

  async exec(options: CommandOptions = {}): Promise<string> {
    return await new ShellCommand(this.adb, 'dumpsys -l').exec(options);
  }
}

export class DumpsysActivityServicesCommand implements ADBCommands<string> {
  constructor(private adb: Adb) {}

  async exec(options: CommandOptions = {}): Promise<string> {
    return await new ShellCommand(this.adb, 'dumpsys activity services').exec(options);
  }
}

export class DumpsysServiceCommand implements ADBCommands<string> {
  constructor(private adb: Adb) {}

  async exec(options: DumpsysOptions): Promise<string> {
    if (!options.service) {
      throw new Error('Service name is required');
    }
    return await new ShellCommand(this.adb, `dumpsys ${options.service}`).exec(options);
  }
}