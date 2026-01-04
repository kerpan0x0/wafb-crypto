// packages/core/src/adb/connection.ts - VERSIONE SEMPLIFICATA
import type { Adb } from '@yume-chan/adb';
import { AdbWebUsbBackend } from '@yume-chan/adb-backend-webusb';
import { Adb as AdbClass, AdbDaemonTransport } from '@yume-chan/adb';
import { ADBDevice } from './device';
import { ADBConnectionError, ADBDeviceNotFoundError } from '../utils/errors';
import { Logger } from '../utils/logger';

export interface ConnectionOptions {
  retryAttempts?: number;
  retryDelay?: number;
}

export interface DeviceInfo {
  productName: string;
  manufacturerName: string;
  serialNumber: string;
  vendorId: number;
  productId: number;
}

export class ADBConnection {
  private backend: AdbWebUsbBackend | null = null;
  private adb: Adb | null = null;
  private logger: Logger;
  private connectionState: 'disconnected' | 'connecting' | 'connected' = 'disconnected';

  constructor() {
    this.logger = new Logger('ADBConnection');
  }

  async connect(options: ConnectionOptions = {}): Promise<ADBDevice> {
    const { retryAttempts = 3, retryDelay = 1000 } = options;

    if (this.connectionState === 'connected') {
      throw new ADBConnectionError('Device already connected');
    }

    this.connectionState = 'connecting';
    this.logger.info('Requesting USB device access...');

    try {
      // Richiedi dispositivo USB
      const usbDevice = await navigator.usb.requestDevice({ filters: [] });
      if (!usbDevice) {
        throw new ADBDeviceNotFoundError('No device selected');
      }

      this.logger.info('USB device selected', {
        product: usbDevice.productName,
        serial: usbDevice.serialNumber
      });

      // Crea backend WebUSB
      // @ts-ignore - AdbWebUsbBackend constructor signature mismatch
      this.backend = new AdbWebUsbBackend(usbDevice);

      // Retry loop
      let lastError: Error | null = null;
      for (let attempt = 1; attempt <= retryAttempts; attempt++) {
        try {
          // Connetti al backend
          const connection = await this.backend.connect();
          
          // Crea transport ADB
          const transport = new AdbDaemonTransport({
            connection: connection as any,
            serial: usbDevice.serialNumber || 'unknown',
          } as any);

          // Crea istanza Adb
          this.adb = new AdbClass(transport as any);
          
          this.connectionState = 'connected';
          this.logger.info('ADB connection established');
          
          const deviceInfo = this.getDeviceInfo(usbDevice);
          return new ADBDevice(this.adb, deviceInfo, this);

        } catch (error) {
          lastError = error as Error;
          this.logger.warn(`Connection attempt ${attempt}/${retryAttempts} failed`, { error });
          
          if (attempt < retryAttempts) {
            await this.delay(retryDelay);
          }
        }
      }

      throw new ADBConnectionError(
        `Failed to establish ADB connection after ${retryAttempts} attempts: ${lastError?.message}`
      );

    } catch (error) {
      this.connectionState = 'disconnected';
      
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        throw new ADBDeviceNotFoundError('No device selected by user');
      }
      
      if (error instanceof ADBConnectionError || error instanceof ADBDeviceNotFoundError) {
        throw error;
      }
      
      throw new ADBConnectionError(`Connection failed: ${(error as Error).message}`);
    }
  }

  async disconnect(): Promise<void> {
    this.logger.info('Disconnecting device...');

    try {
      if (this.adb) {
        await this.adb.close();
        this.adb = null;
      }
      this.backend = null;
      this.connectionState = 'disconnected';
      this.logger.info('Device disconnected successfully');
    } catch (error) {
      this.logger.error('Error during disconnect', { error });
      throw new ADBConnectionError(`Disconnect failed: ${(error as Error).message}`);
    }
  }

  isConnected(): boolean {
    return this.connectionState === 'connected' && this.adb !== null;
  }

  getConnectionState(): 'disconnected' | 'connecting' | 'connected' {
    return this.connectionState;
  }

  private getDeviceInfo(usbDevice: USBDevice): DeviceInfo {
    return {
      productName: usbDevice.productName || 'Unknown Device',
      manufacturerName: usbDevice.manufacturerName || 'Unknown Manufacturer',
      serialNumber: usbDevice.serialNumber || 'unknown',
      vendorId: usbDevice.vendorId,
      productId: usbDevice.productId
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}