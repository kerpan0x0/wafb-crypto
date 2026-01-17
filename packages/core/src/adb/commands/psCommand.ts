import type { Adb } from '@yume-chan/adb';
import type { PsOptions } from '.';
import { ADBCommands } from '.';
import { ShellCommand } from './shellCommand';


export class PsCommand implements ADBCommands<string> {
  constructor(private adb: Adb) { }

  async exec(options: PsOptions = {}): Promise<string> {
    const command = 'ps';
    const args: string[] = [];

    if (options.all !== false) args.push('-A');
    if (options.selinux !== false) args.push('-Z')

    let fullCommand = `${command} ${args.join(' ')}`.trim();

    // If a filter is provided, pipe the output to grep
    if (options.filter) {
      fullCommand += ` | grep "${options.filter}"`;
    }

    return await new ShellCommand(this.adb, fullCommand).exec(options);
  }
}