import type { Adb } from '@yume-chan/adb';
import type { CommandArgs, CommandOptions } from '.';
import { ADBCommands } from '.';
import { ShellCommand } from './shellCommand';


export class GenerateBugReportCommand implements ADBCommands<string> {
  constructor(private adb: Adb) { }

  async exec(args: CommandArgs, options: CommandOptions = {}): Promise<string> {
    await new ShellCommand(this.adb, `bugreport > ${args.outputPath}`).exec({ timeout: options.timeout });
    return args.outputPath;
  }
}

export class GenerateBugReportzCommand implements ADBCommands<string> {
  constructor(private adb: Adb) { }

  async exec(args: CommandArgs, options: CommandOptions = {}): Promise<string> {
    await new ShellCommand(this.adb, `bugreportz > ${args.outputPath}`).exec({ timeout: options.timeout });
    return args.outputPath;
  }
}