import type { Adb } from '@yume-chan/adb';
import type { CommandOptions } from '.';
import { ADBCommands } from '.';
import { ShellCommand } from './shellCommand';

export interface BugreportOptions extends CommandOptions {
  outputPath: string,
}

export class BugreportCommand implements ADBCommands<string> {
  constructor(private adb: Adb) { }

  async exec(options: BugreportOptions): Promise<string> {
    await new ShellCommand(this.adb, `bugreport > ${options.outputPath}`).exec({ timeout: options.timeout });
    return options.outputPath;
  }
}

export class BugreportzCommand implements ADBCommands<string> {
  constructor(private adb: Adb) { }

  async exec(options: CommandOptions): Promise<string> {
    return await new ShellCommand(this.adb, "bugreportz").exec({ timeout: options.timeout });
  }
}
