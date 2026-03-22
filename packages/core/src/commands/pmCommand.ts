import { DeviceCommand, ShellOptions } from '.';
import { Device } from '../adb';

export interface PmOptions extends ShellOptions {
  includeSystem?: boolean;
  /** Include APK file paths (-f flag) */
  includeFiles?: boolean;
  /** Include UID (-U flag) */
  includeUid?: boolean;
  /** List only disabled packages (-d flag) */
  disabledOnly?: boolean;
}

export class PmCommand implements DeviceCommand<string> {
  constructor(private device: Device) { }

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

    return (await this.device.shell(command, { ...options })).stdout;
  }
}
