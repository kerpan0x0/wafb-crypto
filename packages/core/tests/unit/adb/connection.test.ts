import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ADBConnection } from '../../../src/adb/connection';
import { ADBConnectionError, ADBDeviceNotFoundError } from '../../../src/utils/errors';
import { AdbDaemonWebUsbDeviceManager } from '@yume-chan/adb-daemon-webusb';
import { Adb, AdbDaemonTransport } from '@yume-chan/adb';

// Initial mocks
vi.mock('@yume-chan/adb-daemon-webusb', () => {
  const mockManager = {
    requestDevice: vi.fn(),
    getDevices: vi.fn().mockResolvedValue([]),
  };
  return {
    AdbDaemonWebUsbDeviceManager: {
      BROWSER: mockManager
    }
  };
});

vi.mock('@yume-chan/adb', () => ({
  Adb: vi.fn(),
  AdbDaemonTransport: {
    authenticate: vi.fn()
  }
}));

describe('ADBConnection', () => {
  let connection: ADBConnection;
  let mockWrappedDevice: any;
  
  const mockUSBDeviceRaw = {
    productName: 'Test Device',
    manufacturerName: 'Test Manufacturer',
    serialNumber: 'TEST123',
    vendorId: 0x18D1,
    productId: 0x4EE7
  };

  beforeEach(() => {
    vi.resetAllMocks();
    
    // Create a fresh mock device for every test
    mockWrappedDevice = {
      raw: mockUSBDeviceRaw,
      connect: vi.fn().mockResolvedValue({
        readable: {},
        writable: {},
        close: vi.fn()
      })
    };

    // Setup manager mock
    const manager = AdbDaemonWebUsbDeviceManager.BROWSER as any;
    manager.requestDevice.mockResolvedValue(mockWrappedDevice);
    manager.getDevices.mockResolvedValue([mockWrappedDevice]);

    // Setup Adb mock
    vi.mocked(Adb).mockImplementation(() => ({
      close: vi.fn().mockResolvedValue(undefined)
    } as any));

    vi.mocked(AdbDaemonTransport.authenticate).mockResolvedValue({
      close: vi.fn()
    } as any);
    
    connection = new ADBConnection();
  });

  afterEach(async () => {
    if (connection.isConnected()) {
      await connection.disconnect();
    }
  });

  describe('connect', () => {
    it('should successfully connect to a device', async () => {
      const device = await connection.connect();

      expect(device).toBeDefined();
      expect(device.info.productName).toBe('Test Device');
      expect(connection.isConnected()).toBe(true);
    });

    it('should throw error if already connected', async () => {
      await connection.connect();
      await expect(connection.connect()).rejects.toThrow(ADBConnectionError);
    });

    it('should throw ADBDeviceNotFoundError when user cancels device selection', async () => {
      const manager = AdbDaemonWebUsbDeviceManager.BROWSER as any;
      manager.requestDevice.mockResolvedValue(null);

      await expect(connection.connect()).rejects.toThrow(ADBDeviceNotFoundError);
    });

    it('should handle DOMException NotFoundError correctly', async () => {
        const manager = AdbDaemonWebUsbDeviceManager.BROWSER as any;
        const notFoundError = new DOMException('No device selected', 'NotFoundError');
        manager.requestDevice.mockRejectedValue(notFoundError);
  
        await expect(connection.connect()).rejects.toThrow(ADBDeviceNotFoundError);
    });

    it('should retry connection on failure', async () => {
      let attempts = 0;
      mockWrappedDevice.connect.mockImplementation(() => {
        attempts++;
        if (attempts < 2) throw new Error('USB communication failed');
        return Promise.resolve({ readable: {}, writable: {}, close: vi.fn() });
      });

      const device = await connection.connect({ retryAttempts: 3, retryDelay: 1 });
      expect(device).toBeDefined();
      expect(attempts).toBe(2);
    });

    it('should throw error after max retry attempts', async () => {
      mockWrappedDevice.connect.mockRejectedValue(new Error('Persistent failure'));

      await expect(
        connection.connect({ retryAttempts: 2, retryDelay: 1 })
      ).rejects.toThrow(ADBConnectionError);
    });
  });

  describe('disconnect', () => {
    it('should successfully disconnect device', async () => {
      await connection.connect();
      await connection.disconnect();
      expect(connection.isConnected()).toBe(false);
    });

    it('should handle disconnect when not connected', async () => {
      await expect(connection.disconnect()).resolves.not.toThrow();
    });
  });

  describe('getConnectionState', () => {
    it('should return disconnected initially', () => {
      expect(connection.getConnectionState()).toBe('disconnected');
    });

    it('should return connected after successful connection', async () => {
      await connection.connect();
      expect(connection.getConnectionState()).toBe('connected');
    });

    it('should return disconnected after disconnect', async () => {
      await connection.connect();
      await connection.disconnect();
      expect(connection.getConnectionState()).toBe('disconnected');
    });
  });
});