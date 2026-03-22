import { DeviceCommand, ShellOptions } from '.';
import { Device } from '../adb';


export interface PsOptions extends ShellOptions {
  all?: boolean;
  selinux?: boolean;
  threads?: boolean;
  filter?: string;
  customFormat?: string[];
  pids?: number[];
  tree?: boolean;
}


export class PsCommand implements DeviceCommand<string> {
  constructor(private device: Device) { }


  async exec(options: PsOptions = {}): Promise<string> {
    const command = this.buildCommand(options);
    return (await this.device.shell(command, { ...options })).stdout;
  }


  private buildCommand(options: PsOptions): string {
    const parts: string[] = ['ps'];

    if (options.all !== false) {
      parts.push('-A');
    }

    if (options.selinux !== false) {
      parts.push('-Z');
    }

    if (options.threads) {
      parts.push('-T');
    }

    if (options.tree) {
      parts.push('-H');
    }

    if (options.customFormat && options.customFormat.length > 0) {
      const columns = options.customFormat.join(',');
      parts.push(`-o ${columns}`);
    }

    if (options.pids && options.pids.length > 0) {
      parts.push(`-p ${options.pids.join(',')}`);
    }

    let command = parts.join(' ');

    if (options.filter) {
      command += ` | grep "${options.filter}"`;
    }

    return command;
  }
}