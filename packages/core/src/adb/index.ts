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

export type DeviceProperties = import('./device').DeviceProperties;
export { ADBDevice } from './device';
