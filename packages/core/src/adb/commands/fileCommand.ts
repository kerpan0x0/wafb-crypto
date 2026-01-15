import type { Adb } from '@yume-chan/adb';
import { ADBCommandError } from '../../utils/errors';
import { Logger } from '../../utils/logger';
import type { CommandArgs } from '.';
import { ADBCommands } from '.';
import { ShellCommand } from './shellCommand';
import { readStreamAsBytes } from '../..';


export class WriteFileCommand implements ADBCommands<void> {
  private logger: Logger;

  constructor(private adb: Adb) {
    this.logger = new Logger('WriteFileCommand');
  }

  async exec(args: CommandArgs): Promise<void> {
    const filePath = args.path;
    const sync = await this.adb.sync();


    try {
      await sync.write({
        filename: filePath,
        file: new ReadableStream({
          start(controller) {
            controller.enqueue(args['content']);
            controller.close();
          }
        }) as any
      });
    } catch (error) {
      throw new ADBCommandError(`Failed to write file "${filePath}": ${(error as Error).message}`);
    } finally {
      await this.closeSyncService(sync);
    }
  }

  private async closeSyncService(sync: any): Promise<void> {
    try {
      if (typeof sync.dispose === 'function') {
        await sync.dispose();
      } else if (typeof sync.close === 'function') {
        await sync.close();
      }
    } catch (error) {
      this.logger.warn('Failed to close sync service', { error });
    }
  }
}

export class ReadFileCommand implements ADBCommands<Uint8Array> {
  private logger: Logger;

  constructor(private adb: Adb) {
    this.logger = new Logger('ReadFileCommand');
  }
  async exec(args: CommandArgs): Promise<Uint8Array> {
    const filePath = args.path.toString();

    const sync = await this.adb.sync();

    try {
      const readable = await sync.read(filePath);
      return await readStreamAsBytes(readable as any);
    } catch (error) {
      throw new ADBCommandError(`Failed to read file "${filePath}": ${(error as Error).message}`);
    } finally {
      await this.closeSyncService(sync);
    }
  }

  private async closeSyncService(sync: any): Promise<void> {
    try {
      if (typeof sync.dispose === 'function') {
        await sync.dispose();
      } else if (typeof sync.close === 'function') {
        await sync.close();
      }
    } catch (error) {
      this.logger.warn('Failed to close sync service', { error });
    }
  }
}

export class DeleteFileCommand implements ADBCommands<void> {
  constructor(private adb: Adb) { }

  async exec(args: CommandArgs): Promise<void> {
    await new ShellCommand(this.adb, `rm ${args.path}`).exec();
  }
}


