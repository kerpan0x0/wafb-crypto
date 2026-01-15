import type { Adb } from '@yume-chan/adb';
import type { ListPackageOptions } from '.';
import { ADBCommands } from '.';
import { ShellCommand } from './shellCommand';


export class ListPackageCommand implements ADBCommands<string[]> {

  constructor(private adb: Adb) {
  }

  async exec(options: ListPackageOptions = {}): Promise<string[]> {
    const { includeSystem = true, timeout = 30000 } = options;
    const command = includeSystem ? 'pm list packages' : 'pm list packages -3';
    const output = await new ShellCommand(this.adb, command).exec({ timeout });

    return output
      .split('\n')
      .filter(line => line.startsWith('package:'))
      .map(line => line.replace('package:', '').trim())
      .filter(Boolean);
  }
}
