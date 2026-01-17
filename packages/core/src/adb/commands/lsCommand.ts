import type { Adb } from '@yume-chan/adb';
import { ADBCommands, LsOptions } from '.';
import { ShellCommand } from './shellCommand';


export class LsCommand implements ADBCommands<string> {
  constructor(private adb: Adb) { }

  async exec(options: LsOptions = {}): Promise<string> {
    const command = 'ls';
    const args: string[] = [];

    if (options.all) args.push('-a');
    if (options.long) args.push('-l');
    if (options.recursive) args.push('-R');
    if (options.selinux) args.push('-Z')
    
    // Add the path if provided, otherwise it lists the current directory
    const targetPath = options.path ? options.path : '';
    
    let fullCommand = `${command} ${args.join(' ')} ${targetPath}`.trim();

    // Pipe to grep if a filter is requested
    if (options.filter) {
      fullCommand += ` | grep "${options.filter}"`;
    }

    return await new ShellCommand(this.adb, fullCommand).exec(options);
  }
}