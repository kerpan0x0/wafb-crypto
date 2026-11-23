import type { Adb } from '@yume-chan/adb';
import { ADBCommandError } from '../utils/errors';
import { Logger } from '../utils/logger';
import type { ShellOptions, ShellResult, SpawnResult } from '.';
import { monitorSource } from '../utils/source-monitor';

/** @internal */
export class Shell {
  private logger: Logger;

  constructor(
    private adb: Adb,
    private command: string
  ) {
    this.logger = new Logger('Shell');
  }

  async exec(options: ShellOptions = { timeout: 5000 }): Promise<ShellResult> {
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
   *
   * The stdout stream is wrapped by {@link monitorSource}: an idle period
   * without an exit from the remote process is reported as an error, not as
   * end-of-stream, and `outcome` classifies how the source ended. Cancelling
   * the stream (or aborting `signal`) kills the remote process.
   *
   * stderr is drained concurrently — on the shell protocol both channels are
   * multiplexed on one socket, so leaving stderr unread can stall stdout. Only
   * a bounded tail is kept, for diagnostics.
   */
  async spawn(
    idleTimeout: number = 5000,
    signal?: AbortSignal
  ): Promise<SpawnResult> {
    if (!this.adb.subprocess.shellProtocol) {
      throw new ADBCommandError('Shell protocol not available');
    }

    const shellSocket = await this.adb.subprocess.shellProtocol.spawn(this.command);

    const exitedPromise: Promise<number> =
      (shellSocket as any).exited ?? Promise.resolve(0);

    const stderrTail = this.drainStderr((shellSocket as any).stderr);

    const { stream, outcome } = monitorSource(
      (shellSocket.stdout as any) as ReadableStream<Uint8Array>,
      {
        idleTimeoutMs: idleTimeout,
        exited: exitedPromise,
        signal,
        onStop: async () => {
          const kill = (shellSocket as any).kill;
          if (typeof kill === 'function') await kill.call(shellSocket);
        },
      }
    );

    return {
      stdout: stream,
      exited: exitedPromise,
      outcome,
      stderrTail,
    };
  }

  /** Reads stderr to completion, keeping only the last `maxBytes` bytes. */
  private async drainStderr(stream: any, maxBytes = 2048): Promise<string> {
    if (!stream || typeof stream.getReader !== 'function') return '';
    const reader = stream.getReader();
    let tail = new Uint8Array(0);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        const merged = new Uint8Array(tail.length + value.length);
        merged.set(tail);
        merged.set(value, tail.length);
        tail = merged.length > maxBytes ? merged.slice(merged.length - maxBytes) : merged;
      }
    } catch {
      /* transport closed — keep what we have */
    } finally {
      try { reader.releaseLock(); } catch { /* ignore */ }
    }
    return new TextDecoder().decode(tail);
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
      for(;;) {
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