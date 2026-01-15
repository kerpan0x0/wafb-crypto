import type { Adb } from '@yume-chan/adb';
import { ADBCommandError } from '../../utils/errors';
import { Logger } from '../../utils/logger';
import { readStreamAsText } from '../../utils/stream-helpers';
import { ADBCommands, CommandOptions } from '.';


/**@internal */
export class ShellCommand implements ADBCommands<string> {
  private logger: Logger;

  constructor(private adb: Adb, private command: string) {
    this.logger = new Logger('ShellCommand');
    this.command = command;
  }

  async exec(options: CommandOptions = { timeout: 5000 }): Promise<string> {
    const { timeout } = options;
    this.logger.debug('Executing shell command', { command: this.command, timeout });

    try {
      const execute = async (): Promise<string> => {
        if (!this.adb.subprocess.shellProtocol) {
          throw new Error("Shell protocol not available");
        }
        const shellSocket = await this.adb.subprocess.shellProtocol.spawn(this.command);
        const output = await readStreamAsText(shellSocket.stdout);
        return output;
      };

      if (timeout) {
        return await this.withTimeout(execute(), timeout, this.command);
      }

      return await execute();
    } catch (error) {
      this.logger.error('Command execution failed', { command: this.command, error });
      throw new ADBCommandError(`Failed to execute command "${this.command}": ${(error as Error).message}`);
    }
  }

  // TODO: This is a decorator refactor to decorator 
  private withTimeout<T>(promise: Promise<T>, ms: number, command: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(
        () => reject(new ADBCommandError(`Command "${command}" timed out after ${ms}ms`)),
        ms
      )
      )
    ]);
  }
}
