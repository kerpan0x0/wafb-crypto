import type { Adb } from '@yume-chan/adb';
import { ShellCommand } from './shellCommand';
import { ADBCommands, CommandOptions } from '.';


export class GetenforceCommand implements ADBCommands<string> {
  constructor(private adb: Adb) {
  }

  async exec(options: CommandOptions = {}): Promise<string> {
    return await new ShellCommand(this.adb, `getenforce`).exec({ timeout: 5000});
  }
}
