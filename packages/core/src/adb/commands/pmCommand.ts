import { ADBCommands, CommandOptions } from '.';
import { Adb, Logger } from '../..';
import { ShellCommand } from './shellCommand';

export interface PmOptions extends CommandOptions {
  includeSystem?: boolean;
  /** Include APK file paths (-f flag) */
  includeFiles?: boolean;
  /** Include UID (-U flag) */
  includeUid?: boolean;
  /** List only disabled packages (-d flag) */
  disabledOnly?: boolean;
}

export class PmCommand implements ADBCommands<string> {
  constructor(private adb: Adb) {}

  async exec(options: PmOptions = {}): Promise<string> {
    const {
      includeSystem = true,
      includeFiles = false,
      includeUid = false,
      disabledOnly = false,
      timeout = 30000,
    } = options;

    let command = 'pm list packages';

    if (includeFiles) command += ' -f';
    if (includeUid) command += ' -U';
    if (disabledOnly) command += ' -d';
    if (!includeSystem && !disabledOnly) command += ' -3';

    return (await new ShellCommand(this.adb, command).exec({ timeout })).stdout;
  }
}
