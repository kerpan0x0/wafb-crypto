import { ADBCommandError } from '../utils/errors';
import { Logger } from '../utils/logger';
import { DeviceCommand } from '.';
import { readStreamAsBytes } from '..';
import { Device, ShellOptions } from '../adb';

export interface FileOptions extends ShellOptions {
  path: string,
}

export interface WriteFileOptions extends FileOptions {
  content: Uint8Array,
}

export class WriteFileCommand implements DeviceCommand<void> {
  private logger: Logger;

  constructor(private device: Device) {
    this.logger = new Logger('WriteFileCommand');
  }

  async exec(option: WriteFileOptions): Promise<void> {
    const filePath = option.path;
    const sync = await this.device.sync();


    try {
      await sync.write({
        filename: filePath,
        file: new ReadableStream({
          start(controller) {
            controller.enqueue(option.content);
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

export class ReadFileCommand implements DeviceCommand<Uint8Array> {
  private logger: Logger;

  constructor(private device: Device) {
    this.logger = new Logger('ReadFileCommand');
  }
  async exec(option: FileOptions): Promise<Uint8Array> {
    const filePath = option.path.toString();

    const sync = await this.device.sync();

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

export class DeleteFileCommand implements DeviceCommand<void> {
  constructor(private device: Device) { }

  async exec(option: FileOptions): Promise<void> {
    (await this.device.shell(`rm ${option.path}`));
  }
}
