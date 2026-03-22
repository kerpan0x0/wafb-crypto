import { DeviceCommand, ShellOptions } from '.';
import { Device } from '../adb';

export interface LsOptions extends ShellOptions {
  path?: string;
  all?: boolean;
  long?: boolean;
  recursive?: boolean;
  selinux?: boolean;
  filter?: string;
}

export class LsCommand implements DeviceCommand<string> {
  constructor(private device: Device) { }

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

    return (await this.device.shell(fullCommand, { ...options })).stdout;
  }
}