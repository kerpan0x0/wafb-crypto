import type { Adb } from '@yume-chan/adb';
import { ADBCommands, CommandOptions } from '.';
import { ShellCommand } from './shellCommand';


export interface PsOptions extends CommandOptions {
  all?: boolean;
  selinux?: boolean;
  threads?: boolean;
  filter?: string;
  customFormat?: string[];
  pids?: number[];
  tree?: boolean;
}


export class PsCommand implements ADBCommands<string> {
  constructor(private adb: Adb) { }


  async exec(options: PsOptions = {}): Promise<string> {
    const command = this.buildCommand(options);
    return await new ShellCommand(this.adb, command).exec(options);
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