import type { Adb } from '@yume-chan/adb';
import { ADBCommandError } from '../../utils/errors';
import { Logger } from '../../utils/logger';
import { ADBCommands, CommandOptions } from '.';

/**@internal */
export class ShellCommand implements ADBCommands<string> {
  private logger: Logger;

  constructor(private adb: Adb, private command: string) {
    this.logger = new Logger('ShellCommand');
    this.command = command;
  }

  async exec(options: CommandOptions = { timeout: 5000 }): Promise<string> {
    const { timeout, idleTimeout = 5000 } = options; // Default idle timeout: 5 seconds
    this.logger.debug('Executing shell command', {
      command: this.command,
      timeout,
      idleTimeout
    });

    try {
      const execute = async (): Promise<string> => {
        if (!this.adb.subprocess.shellProtocol) {
          throw new Error('Shell protocol not available');
        }

        const shellSocket = await this.adb.subprocess.shellProtocol.spawn(this.command);
        const reader = shellSocket.stdout.getReader();

        const chunks: Uint8Array[] = [];
        let lastDataTime = Date.now();

        // Read loop with idle timeout
        while (true) {
          const readPromise = reader.read();
          const idlePromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Idle timeout')), idleTimeout)
          );

          try {
            const { done, value } = await Promise.race([readPromise, idlePromise]);

            if (done) {
              this.logger.debug('Stream signaled done');
              break;
            }

            if (value) {
              chunks.push(value);
              lastDataTime = Date.now();
            }
          } catch (error) {
            // Idle timeout triggered – assume command finished
            const idleMs = Date.now() - lastDataTime;
            this.logger.debug(`Idle timeout after ${idleMs}ms, forcing completion`);
            break;
          }
        }

        reader.releaseLock();

        // Concatenate all received chunks
        const totalLength = chunks.reduce((acc, arr) => acc + arr.byteLength, 0);
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.byteLength;
        }

        return new TextDecoder().decode(combined);
      };

      // Apply global timeout if specified
      if (timeout) {
        return await this.withTimeout(execute(), timeout, this.command);
      }

      return await execute();
    } catch (error) {
      this.logger.error('Command execution failed', { command: this.command, error });
      throw new ADBCommandError(
        `Failed to execute command "${this.command}": ${(error as Error).message}`
      );
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, command: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new ADBCommandError(`Command "${command}" timed out after ${ms}ms`)),
          ms
        )
      ),
    ]);
  }
}