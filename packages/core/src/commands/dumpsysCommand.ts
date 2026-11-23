import { DeviceCommand, ShellOptions } from '.';
import { Logger } from '../utils/logger';
import { Device } from '../adb';

export type DumpsysService =
  | 'battery'
  | 'package'
  | 'activity'
  | 'window'
  | 'display'
  | 'wifi'
  | 'netstats'
  | 'meminfo'
  | 'cpuinfo'
  | 'telephony.registry'
  | 'alarm'
  | 'notification'
  | 'usagestats'
  | 'location'
  | 'connectivity'
  | 'bluetooth_manager'
  | 'power'
  | 'batterystats'
  | 'sensorservice';


export interface DumpsysOptions extends ShellOptions {
  service?: DumpsysService | string;
  packageName?: string;
  args?: string[];
}

export interface DumpsysStream {
  /** Raw stdout stream from `dumpsys`, wrapped with an idle timeout so the
   *  ZIP writer is not left hanging on devices that never send EOF. */
  stream: ReadableStream<Uint8Array>;
  /** Resolves with the process exit code when the command finishes. */
  exited: Promise<number>;
  /** How the stdout source ended, with exit code. Always settles. */
  outcome?: Promise<import('../utils/source-monitor').SourceOutcome>;
}

export class DumpsysCommand implements DeviceCommand<string> {
  private logger: Logger;

  constructor(private device: Device) {
    this.logger = new Logger('DumpsysCommand');
  }

  async exec(options: DumpsysOptions): Promise<string> {
    const { service, packageName, args } = options;
    this.logger.debug('Executing dumpsys command', { service, packageName, args });

    const command = this.buildCommand(service, packageName, args);

    try {
      const output = (await this.device.shell(command, { ...options })).stdout;

      this.logger.debug('Dumpsys command completed', {
        service,
        outputLength: output.length
      });

      return output;
    } catch (error) {
      this.logger.error('Dumpsys command failed', { service, error });
      throw error;
    }
  }

  private buildCommand(
    service?: string,
    packageName?: string,
    args: string[] = []
  ): string {
    let command = `dumpsys`;

    if (service) {
      command += ` ${service}`
    }

    if (packageName) {
      command += ` ${packageName}`;
    }

    if (args && args.length > 0) {
      command += ` ${args.join(' ')}`;
    }

    return command;
  }
}
/**
 * Streams the full `dumpsys` output without buffering in memory.
 * Returns a {@link DumpsysStream} so the caller can pipe stdout directly
 * to a ZIP entry. ShellCommand.spawn() already wraps the stream with an
 * idle timeout via wrapWithIdleTimeout in stream-helpers.
 */
export class DumpsysStreamCommand implements DeviceCommand<DumpsysStream> {
  private logger: Logger;

  constructor(private device: Device) {
    this.logger = new Logger('DumpsysStreamCommand');
  }

  async exec(options: ShellOptions & { signal?: AbortSignal } = {}): Promise<DumpsysStream> {
    this.logger.debug('Executing dumpsys stream command');
    const { stdout, exited, outcome } = await this.device.spawn('dumpsys', undefined, options.signal);
    return { stream: stdout, exited, outcome };
  }
}
