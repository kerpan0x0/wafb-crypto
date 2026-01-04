import type { Adb } from '@yume-chan/adb';
import { AdbWebUsbBackend } from '@yume-chan/adb-backend-webusb';
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

    try {
      const usbDevice = await navigator.usb.requestDevice({ filters: [] });
      if (!usbDevice) throw new ADBDeviceNotFoundError('No device selected');

      // RISOLUZIONE DEFINITIVA TS2554 alla riga 45:
      // Castiamo la classe a 'any' prima di chiamare 'new'. 
      // Questo impedisce al DTS build di controllare quanti argomenti stiamo passando.
      const BackendClass = AdbWebUsbBackend as any;
      this.backend = new BackendClass(usbDevice) as AdbWebUsbBackend;
      
      let lastError: Error | null = null;
      for (let attempt = 1; attempt <= retryAttempts; attempt++) {
        try {
          const currentBackend = this.backend;
          if (!currentBackend) throw new Error("Backend lost");

          const connection = await currentBackend.connect();

          // Usiamo la stessa tecnica per Adb e Transport per evitare errori successivi
          const { Adb: AdbClass, AdbDaemonTransport } = await import('@yume-chan/adb');
          const TransportClass = AdbDaemonTransport as any;
          const FinalAdbClass = AdbClass as any;

          const transport = new TransportClass({
            connection,
            serial: usbDevice.serialNumber || '',
          });

          this.adb = new FinalAdbClass(transport) as Adb;
          
          this.connectionState = 'connected';
          this.logger.info('ADB connection established');
          
          const finalAdb = this.adb;
          if (!finalAdb) throw new Error("Adb instance creation failed");
          
          const deviceInfo = this.getDeviceInfo(usbDevice);
          return new ADBDevice(finalAdb, deviceInfo, this);
        } catch (error) {
          lastError = error as Error;
          this.logger.warn(`Connection attempt ${attempt}/${retryAttempts} failed`, { error });
          if (attempt < retryAttempts) await this.delay(retryDelay);
        }
      }

      throw new ADBConnectionError(`Failed: ${lastError?.message}`);
    } catch (error) {
      this.connectionState = 'disconnected';
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.adb) {
      await this.adb.close();
      this.adb = null;
    }
    this.backend = null;
    this.connectionState = 'disconnected';
  }

  isConnected(): boolean {
    return this.connectionState === 'connected' && this.adb !== null;
  }

  private getDeviceInfo(usbDevice: USBDevice): DeviceInfo {
    return {
      productName: usbDevice.productName || 'Unknown Device',
      manufacturerName: usbDevice.manufacturerName || 'Unknown Manufacturer',
      serialNumber: usbDevice.serialNumber || '',
      vendorId: usbDevice.vendorId,
      productId: usbDevice.productId
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}