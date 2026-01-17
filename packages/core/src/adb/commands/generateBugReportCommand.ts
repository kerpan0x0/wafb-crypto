import type { Adb } from '@yume-chan/adb';
import type { CommandOptions } from '.';
import { ADBCommands } from '.';
import { ShellCommand } from './shellCommand';

export interface BugReportOptions extends CommandOptions {
  outputPath: string,
}

export class GenerateBugReportCommand implements ADBCommands<string> {
  constructor(private adb: Adb) { }

  async exec(options: BugReportOptions): Promise<string> {
    await new ShellCommand(this.adb, `bugreport > ${options.outputPath}`).exec({ timeout: options.timeout });
    return options.outputPath;
  }
}

export class GenerateBugReportzCommand implements ADBCommands<string> {
  constructor(private adb: Adb) { }

  async exec(options: BugReportOptions): Promise<string> {
    await new ShellCommand(this.adb, `bugreportz > ${options.outputPath}`).exec({ timeout: options.timeout });
    return options.outputPath;
  }
}
