import { DeviceCommand } from '.';
import { Device, ShellOptions } from '../adb';
import { ADBCommandError } from '../utils/errors';

export interface BackupOptions extends ShellOptions { 
  type: string; 
  buPath: string;
}

export interface BackupStream {
  stream: ReadableStream<Uint8Array>;
  exited: Promise<number>;
}

/**
 * Wraps Android's `bu backup` shell command.
 *
 * Returns a raw `ReadableStream` from the command's stdout so the caller
 * can pipe the backup data directly to disk without buffering it in memory.
 *
 * No file is created on the device — `bu backup` writes to stdout and the
 * data flows through the ADB shell channel directly to the browser.
 */
export class BackupCommand implements DeviceCommand<BackupStream> {
  constructor(private device: Device) {}

  async exec(options: BackupOptions): Promise<BackupStream> {
    const { type, buPath } = options;

    if (!buPath) {
      throw new ADBCommandError('BackupCommand: buPath must not be empty');
    }

    const cmd = this.buildCommand(buPath, type);
    // bu backup requires user confirmation on the device (password dialog).
    // Use a 5-minute idle timeout so the stream is not closed before the
    // user has a chance to interact with the prompt.
    const { stdout, exited } = await this.device.spawn(cmd, 300000);

    return { stream: stdout, exited };
  }

  private buildCommand(buPath: string, type: string): string {
    if (type === 'all') {
      return `${buPath} backup -all -nosystem`;
    }
    return `${buPath} backup ${type}`;
  }
}