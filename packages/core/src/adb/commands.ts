import type { Adb } from '@yume-chan/adb';
import { Logger } from '../utils/logger';
import { ADBCommandError } from '../utils/errors';

export interface ShellOptions {
  timeout?: number;
}

export class ADBCommands {
  private logger: Logger;

  constructor(private adb: Adb) {
    this.logger = new Logger('ADBCommands');
  }

  /**
   * Esegue un comando shell usando spawn
   */
  async shell(command: string, _options: ShellOptions = {}): Promise<string> {
    this.logger.debug('Executing shell command', { command });

    try {
      const subprocess = (this.adb.subprocess as any);
      const process = await subprocess.spawn(command);
      
      let stdout = '';
      const reader = process.stdout.getReader();
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            const data = (value as any).value || value;
            stdout += new TextDecoder().decode(data);
          }
        }
      } finally {
        reader.releaseLock();
      }

      await process.exit;
      return stdout;
    } catch (error) {
      this.logger.error('Command execution failed', { command, error });
      throw new ADBCommandError(`Failed to execute command "${command}": ${(error as Error).message}`);
    }
  }

  /**
   * Ottiene tutte le proprietà del sistema
   */
  async getprop(): Promise<Record<string, string>> {
    const output = await this.shell('getprop');
    const props: Record<string, string> = {};
    const regex = /\[([^\]]+)\]:\s*\[([^\]]*)\]/g;
    let match;
    while ((match = regex.exec(output)) !== null) {
      if (match && match[1] && match[2] !== undefined) props[match[1]] = match[2];
    }
    return props;
  }

  /**
   * Lista tutti i package installati
   */
  async listPackages(options: { includeSystem?: boolean } = {}): Promise<string[]> {
    const { includeSystem = true } = options;
    const command = includeSystem ? 'pm list packages' : 'pm list packages -3';
    const output = await this.shell(command);
    return output.split('\n')
      .filter(l => l.startsWith('package:'))
      .map(l => l.replace('package:', '').trim())
      .filter(Boolean);
  }

  /**
   * Ottiene informazioni dettagliate su un package
   */
  async getPackageInfo(packageName: string) {
    try {
      const output = await this.shell(`dumpsys package ${packageName}`);
      return {
        versionName: this.extractField(output, 'versionName') || 'Unknown',
        versionCode: this.extractField(output, 'versionCode') || 'Unknown',
        installLocation: this.extractField(output, 'codePath') || 'Unknown',
        firstInstallTime: this.extractField(output, 'firstInstallTime') || 'Unknown',
        lastUpdateTime: this.extractField(output, 'lastUpdateTime') || 'Unknown'
      };
    } catch { return null; }
  }

  /**
   * Ottiene il path dell'APK
   */
  async getPackagePath(packageName: string): Promise<string | null> {
    try {
      const output = await this.shell(`pm path ${packageName}`);
      const match = output.match(/package:(.+)/);
      return (match && match[1]) ? match[1].trim() : null;
    } catch { return null; }
  }

  /**
   * Legge un file
   */
  async readFile(path: string): Promise<Uint8Array> {
    const sync = await this.adb.sync();
    try {
      const chunks: Uint8Array[] = [];
      const readable = await (sync.read(path) as any);
      const reader = readable.getReader();
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            const data = value.value || value;
            chunks.push(data instanceof Uint8Array ? data : new Uint8Array(data));
          }
        }
      } finally {
        reader.releaseLock();
      }
      
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return result;
    } finally {
      await sync.dispose();
    }
  }

  /**
   * Scrive un file
   */
  async writeFile(path: string, content: Uint8Array): Promise<void> {
    const sync = await this.adb.sync();
    try {
      await sync.write({
        filename: path,
        file: new ReadableStream({
          start(controller) {
            controller.enqueue(content);
            controller.close();
          }
        }) as any
      });
    } finally {
      await sync.dispose();
    }
  }

  /**
   * Prende uno screenshot
   */
  async screenshot(): Promise<Uint8Array> {
    const tempPath = '/sdcard/screen.png';
    await this.shell(`screencap -p ${tempPath}`);
    const content = await this.readFile(tempPath);
    await this.shell(`rm ${tempPath}`);
    return content;
  }

  /**
   * Helper per estrarre campi (Ora usato da getPackageInfo)
   */
  private extractField(output: string, field: string): string | null {
    const regex = new RegExp(`${field}=([^\\s]+)`, 'i');
    const match = output.match(regex);
    return (match && match[1]) ? match[1] : null;
  }
}