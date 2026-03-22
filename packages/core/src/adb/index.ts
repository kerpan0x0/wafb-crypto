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
}

export type { DeviceProperties } from './device';
export { Device } from './device';