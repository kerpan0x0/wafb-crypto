import type { Adb } from '@yume-chan/adb';
import type { CommandOptions } from '.';
import { ADBCommands } from '.';
import { ShellCommand } from './shellCommand';

export interface WhichOptions extends CommandOptions {
  command: string;
}

export class WhichCommand implements ADBCommands<boolean> {

  constructor(private adb: Adb) { }

  async exec(options: WhichOptions): Promise<boolean> {
    try {
      await new ShellCommand(this.adb, `which ${options.command}`).exec(options);
      return true;
    } catch (error) {
      return false;
    }
  }
}

// TODO REFACTOR is a which command -a 
export class RootBinariesCommand implements ADBCommands<string> {

  constructor(private adb: Adb) { }

  async exec(options: WhichOptions): Promise<string> {
    const output = await new ShellCommand(this.adb, `which -a ${options.command}`).exec(options);
    return output;
  }
}


