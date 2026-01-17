import type { Adb } from '@yume-chan/adb';
import { ADBCommands, CommandOptions } from '.';
import { ShellCommand } from './shellCommand';

export interface LogcatOptions extends CommandOptions {
  buffer?: 'main' | 'system' | 'radio' | 'events' | 'crash' | 'default' | 'all';
  filter?: string;
  maxLines?: number;
  dump?: boolean;
}

export class GetLogcatCommand implements ADBCommands<string> {

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
