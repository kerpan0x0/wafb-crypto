import type { Adb } from '@yume-chan/adb';
import type { CommandArgs, CommandOptions } from '.';
import { ADBCommands } from '.';
import { ShellCommand } from './shellCommand';


export class WhichCommand implements ADBCommands<boolean> {

  constructor(private adb: Adb) { }

  async exec(args: CommandArgs, options: CommandOptions = {}): Promise<boolean> {
    try {
      await new ShellCommand(this.adb, `which ${args.command}`).exec(options);
      return true;
    } catch (error) {
      return false;
    }
  }
}

export class RootBinariesCommand implements ADBCommands<string> {

  constructor(private adb: Adb) { }

  // TODO REFACTOR is a which command -a 
  async exec(args: CommandArgs): Promise<string> {
    const output = await new ShellCommand(this.adb, `which -a ${args.binary}`).exec();
    return output;
  }
}


