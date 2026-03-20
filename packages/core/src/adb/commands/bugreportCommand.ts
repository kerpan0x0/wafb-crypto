import type { Adb } from '@yume-chan/adb';
import type { CommandOptions } from '.';
import { ADBCommands } from '.';
import { ShellCommand } from './shellCommand';

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
}

export class BugreportCommand implements ADBCommands<BugreportStream> {
  constructor(private adb: Adb) { }

  async exec(options: CommandOptions = {}): Promise<BugreportStream> {
    const { stdout, exited } = await new ShellCommand(this.adb, 'bugreport').spawn();
    return { stream: stdout, exited };
  }
}

/**
 * `bugreportz` — available on Android 7+.
 *
 * Writes a compressed zip to device storage and prints `OK:/path/to/file.zip`
 * on stdout.  The file must be downloaded separately with ReadFileCommand.
 */
export class BugreportzCommand implements ADBCommands<string> {
  constructor(private adb: Adb) { }

  async exec(options: CommandOptions = {}): Promise<string> {
    return (await new ShellCommand(this.adb, 'bugreportz').exec({ ...options })).stdout;
  }
}
