export interface DeviceInfo {
  productName: string;
  manufacturerName: string;
  serialNumber: string;
  vendorId: number;
  productId: number;
}

export interface ConnectionOptions {
  retryAttempts?: number;
  retryDelay?: number;
  timeout?: number;
}

export interface ShellOptions {
  timeout?: number;
  idleTimeout?: number;
  throwOnError?: boolean;
}

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SpawnResult {
  stdout: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  /**
   * How the stdout source ended (EOF, idle timeout, cancellation, transport
   * error) together with the exit code when observed. Always settles; never
   * rejects. Optional so that mocks and legacy callers keep compiling.
   */
  outcome?: Promise<SourceOutcome>;
  /** Bounded tail of stderr, available once the process ends. */
  stderrTail?: Promise<string>;
}

import type { SourceOutcome } from '../utils/source-monitor';

export type { DeviceProperties } from './device';
export { Device } from './device';