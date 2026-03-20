import type { Adb } from '@yume-chan/adb';
import { ADBCommandError } from '../../utils/errors';
import { Logger } from '../../utils/logger';
import { ADBCommands, CommandOptions, ShellResult } from '.';
import { wrapWithIdleTimeout } from '../../utils/stream-helpers';

/** @internal */
export class ShellCommand implements ADBCommands<ShellResult> {
  private logger: Logger;

  constructor(
    private adb: Adb,
    private command: string
  ) {
    this.logger = new Logger('ShellCommand');
  }

  async exec(options: CommandOptions = { timeout: 5000 }): Promise<ShellResult> {
    const { timeout, idleTimeout = 5000, throwOnError = false } = options;

    this.logger.debug('Executing shell command', { command: this.command, timeout, idleTimeout });

    try {
      const execute = (): Promise<ShellResult> => this.executeInner(idleTimeout, throwOnError);

      return timeout
        ? await this.withTimeout(execute(), timeout, this.command)
        : await execute();
    } catch (error) {
      if (error instanceof ADBCommandError) throw error;

      this.logger.error('Command execution failed', { command: this.command, error });
      throw new ADBCommandError(
        `Failed to execute command "${this.command}": ${(error as Error).message}`
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Public streaming API
  // ---------------------------------------------------------------------------

  /**
   * Spawns the command and returns the raw stdout stream without buffering.
   * Use this for large binary outputs (e.g. `bu backup`) where you want to
   * pipe stdout directly to a file writer.
   */
  async spawn(idleTimeout: number = 5000): Promise<{
    stdout: ReadableStream<Uint8Array>;
    exited: Promise<number>;
  }> {
    if (!this.adb.subprocess.shellProtocol) {
      throw new ADBCommandError('Shell protocol not available');
    }

    const shellSocket = await this.adb.subprocess.shellProtocol.spawn(this.command);

    const exitedPromise: Promise<number> =
      (shellSocket as any).exited ?? Promise.resolve(0);

    return {
      stdout: wrapWithIdleTimeout(
        (shellSocket.stdout as any) as ReadableStream<Uint8Array>,
        idleTimeout
      ),
      exited: exitedPromise,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async executeInner(idleTimeout: number, throwOnError: boolean): Promise<ShellResult> {
    if (!this.adb.subprocess.shellProtocol) {
      throw new Error('Shell protocol not available');
    }

    const shellSocket = await this.adb.subprocess.shellProtocol.spawn(this.command);

    // stdout/stderr are @yume-chan/stream-extra ReadableStream — cast to any
    // so drainStream can work with the native Web ReadableStream interface.
    // `exited` (Promise<number>) is the authoritative EOF signal; the per-stream
    // idle timeout is a safety net for devices that never close the streams.
    const exitedPromise: Promise<number> =
      (shellSocket as any).exited ?? Promise.resolve(0);

    const [stdoutBytes, stderrBytes, exitCode] = await Promise.all([
      this.drainStream((shellSocket.stdout as any), idleTimeout),
      this.drainStream((shellSocket.stderr as any), idleTimeout),
      exitedPromise,
    ]);

    const decoder = new TextDecoder();
    const stdout = decoder.decode(stdoutBytes);
    const stderr = decoder.decode(stderrBytes);

    this.logger.debug('Command completed', {
      command: this.command,
      exitCode,
      stderrLength: stderr.length,
    });

    if (throwOnError && exitCode !== 0) {
      throw new ADBCommandError(
        `Command "${this.command}" exited with code ${exitCode}${stderr ? `: ${stderr.trim()}` : ''}`,
        exitCode,
        stderr
      );
    }

    return { stdout, stderr, exitCode };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async drainStream(stream: any, idleTimeout: number): Promise<Uint8Array> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];

    try {
      while (true) {
        let idleTimer: ReturnType<typeof setTimeout> | undefined;

        const idlePromise = new Promise<{ done: true; value: undefined }>(resolve => {
          idleTimer = setTimeout(() => resolve({ done: true, value: undefined }), idleTimeout);
        });

        const { done, value } = await Promise.race([reader.read(), idlePromise]);

        if (idleTimer !== undefined) clearTimeout(idleTimer);

        if (done) break;
        if (value) chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    const totalLength = chunks.reduce((acc, c) => acc + c.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return combined;
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, command: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      promise.finally(() => { if (timer !== undefined) clearTimeout(timer); }),
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new ADBCommandError(`Command "${command}" timed out after ${ms}ms`)),
          ms
        );
      }),
    ]);
  }
}