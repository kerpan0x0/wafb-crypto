import type { Adb } from '@yume-chan/adb';
import type { LogcatOptions } from '.';
import { ADBCommands } from '.';
import { ShellCommand } from './shellCommand';


export class GetLogCatCommand implements ADBCommands<string> {

  constructor(private adb: Adb) { }

  async exec(options: LogcatOptions = {}): Promise<string> {
    const command = 'logcat';
    const args = [];

    if (options.dump !== false) args.push('-d');
    if (options.buffer) args.push(`-b ${options.buffer}`);
    if (options.maxLines) args.push(`-t ${options.maxLines}`);
    if (options.filter) args.push(options.filter);

    return await new ShellCommand(this.adb, `${command} ${args.join(' ')}`).exec(options);
  }
}
