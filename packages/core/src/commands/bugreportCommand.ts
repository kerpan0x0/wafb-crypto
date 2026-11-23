import type { DeviceCommand } from '.';
import { Device, ShellOptions } from '../adb';

/**
 * Legacy `bugreport` command — available on all Android versions.
 *
 * Runs `bugreport` without redirection so the output flows through the ADB
 * shell channel directly to the caller as a ReadableStream.  No file is
 * created on the device.
 */
export interface BugreportStream {
  /** Raw stdout stream from `bugreport`. Pipe directly to a ZIP entry. */
  stream: ReadableStream<Uint8Array>;
  /** Resolves with the process exit code when the command finishes. */
  exited: Promise<number>;
  /** How the stdout source ended, with exit code. Always settles. */
  outcome?: Promise<import('../utils/source-monitor').SourceOutcome>;
}

export class BugreportCommand implements DeviceCommand<BugreportStream> {
  constructor(private device: Device) { }

  async exec(options: ShellOptions & { signal?: AbortSignal } = {}): Promise<BugreportStream> {
    const { stdout, exited, outcome } = await this.device.spawn('bugreport', options.idleTimeout, options.signal);
    return { stream: stdout, exited, outcome };
  }
}

/**
 * `bugreportz` — available on Android 7+.
 *
 * Writes a compressed zip to device storage and prints `OK:/path/to/file.zip`
 * on stdout.  The file must be downloaded separately with ReadFileCommand.
 */
export class BugreportzCommand implements DeviceCommand<string> {
  constructor(private device: Device) { }

  async exec(options: ShellOptions = {}): Promise<string> {
    return (await this.device.shell('bugreportz', { ...options})).stdout;
  }
}
