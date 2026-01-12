import type { Adb } from '@yume-chan/adb';
import type { ConnectionOptions, DeviceInfo } from './base';
import { Adb as AdbClass } from '@yume-chan/adb';
import { AdbDaemonWebUsbDeviceManager } from '@yume-chan/adb-daemon-webusb';
import { AdbDaemonTransport } from '@yume-chan/adb';
import AdbWebCredentialStore from '@yume-chan/adb-credential-web';
import { ADBDevice } from './device';
import { ADBConnectionError, ADBDeviceNotFoundError } from '../utils/errors';
import { Logger } from '../utils/logger';

export class ADBConnection {
  private credentialStore: AdbWebCredentialStore;
  private deviceManager: AdbDaemonWebUsbDeviceManager;
  private device: any = null;
  private adb: Adb | null = null;
  private logger: Logger;
  private connectionState: 'disconnected' | 'connecting' | 'connected' = 'disconnected';

  constructor() {
    this.logger = new Logger('ADBConnection');
    
    // Usa il manager browser built-in
    const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
    if (!manager) {
      throw new ADBConnectionError('WebUSB is not supported in this browser');
    }
    this.deviceManager = manager;
    this.credentialStore = new AdbWebCredentialStore('wafb-adb-credentials');
  }

  async connect(options: ConnectionOptions = {}): Promise<ADBDevice> {
    const { retryAttempts = 3, retryDelay = 1000 } = options;

    if (this.connectionState === 'connected') {
      throw new ADBConnectionError('Device already connected');
    }

    this.connectionState = 'connecting';
    this.logger.info('Requesting USB device access...');

    try {
      // Step 1: Request device tramite il manager
      this.device = await this.deviceManager.requestDevice();
      
      if (!this.device) {
        throw new ADBDeviceNotFoundError('No device selected');
      }

      // Ottieni informazioni sul dispositivo
      const deviceInfo = this.getDeviceInfoFromDevice(this.device);

      this.logger.info('USB device selected', {
        product: deviceInfo.productName,
        serial: deviceInfo.serialNumber
      });

      // Step 2: Connetti con retry logic
      let lastError: Error | null = null;
      for (let attempt = 1; attempt <= retryAttempts; attempt++) {
        try {
          // Connetti al device daemon
          const connection = await this.device.connect();
          
          // Crea transport
          const transport = await AdbDaemonTransport.authenticate({
            serial: deviceInfo.serialNumber,
            connection,
            credentialStore: this.credentialStore,
          });

          // Crea istanza Adb
          this.adb = new AdbClass(transport);
          
          this.connectionState = 'connected';
          this.logger.info('ADB connection established');
          
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
      this.device = null;
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

  private getDeviceInfoFromDevice(device: any): DeviceInfo {
    // Il device manager ritorna un oggetto con .raw che contiene USBDevice
    const raw = device.raw as USBDevice;
    
    return {
      productName: raw.productName || 'Unknown Device',
      manufacturerName: raw.manufacturerName || 'Unknown Manufacturer',
      serialNumber: raw.serialNumber || 'unknown',
      vendorId: raw.vendorId,
      productId: raw.productId
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}