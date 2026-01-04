import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ADBConnection } from '../../../src/adb/connection';
import { ADBConnectionError, ADBDeviceNotFoundError } from '../../../src/utils/errors';

// Mock WebUSB API
const mockUSBDevice = {
  productName: 'Test Device',
  manufacturerName: 'Test Manufacturer',
  serialNumber: 'TEST123',
  vendorId: 0x18D1,
  productId: 0x4EE7,
  configuration: {
    interfaces: [
      {
        interfaceNumber: 0,
        alternates: [
          {
            interfaceClass: 0xFF,
            interfaceSubclass: 0x42,
            interfaceProtocol: 1,
            endpoints: [
              { direction: 'in', endpointNumber: 1, packetSize: 512 },
              { direction: 'out', endpointNumber: 2, packetSize: 512 }
            ]
          }
        ]
      }
    ]
  },
  opened: false,
  open: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  selectConfiguration: vi.fn().mockResolvedValue(undefined),
  claimInterface: vi.fn().mockResolvedValue(undefined),
  transferIn: vi.fn(),
  transferOut: vi.fn()
};

describe('ADBConnection', () => {
  let connection: ADBConnection;

  beforeEach(() => {
    connection = new ADBConnection();
    
    // Mock navigator.usb
    global.navigator = {
      usb: {
        requestDevice: vi.fn().mockResolvedValue(mockUSBDevice)
      }
    } as any;

    // Reset mocks
    vi.clearAllMocks();
    mockUSBDevice.opened = false;
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
      expect(device.info.serialNumber).toBe('TEST123');
      expect(connection.isConnected()).toBe(true);
    });

    it('should throw error if already connected', async () => {
      await connection.connect();

      await expect(connection.connect()).rejects.toThrow(ADBConnectionError);
      await expect(connection.connect()).rejects.toThrow('already connected');
    });

    it('should throw ADBDeviceNotFoundError when user cancels device selection', async () => {
      const notFoundError = new DOMException('No device selected', 'NotFoundError');
      (global.navigator.usb.requestDevice as any).mockRejectedValueOnce(notFoundError);

      await expect(connection.connect()).rejects.toThrow(ADBDeviceNotFoundError);
    });

    it('should retry connection on failure', async () => {
      let attempts = 0;
      mockUSBDevice.open.mockImplementation(() => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Connection failed');
        }
        return Promise.resolve();
      });

      const device = await connection.connect({ retryAttempts: 3, retryDelay: 10 });

      expect(device).toBeDefined();
      expect(attempts).toBe(2);
    });

    it('should throw error after max retry attempts', async () => {
      mockUSBDevice.open.mockRejectedValue(new Error('Connection failed'));

      await expect(
        connection.connect({ retryAttempts: 2, retryDelay: 10 })
      ).rejects.toThrow(ADBConnectionError);
    });

    it('should throw error if ADB interface not found', async () => {
      const deviceWithoutADB = {
        ...mockUSBDevice,
        configuration: {
          interfaces: [
            {
              interfaceNumber: 0,
              alternates: [
                {
                  interfaceClass: 0x08, // Mass storage, not ADB
                  interfaceSubclass: 0x06,
                  interfaceProtocol: 0x50,
                  endpoints: []
                }
              ]
            }
          ]
        }
      };

      (global.navigator.usb.requestDevice as any).mockResolvedValueOnce(deviceWithoutADB);

      await expect(connection.connect()).rejects.toThrow(ADBDeviceNotFoundError);
      await expect(connection.connect()).rejects.toThrow('ADB interface not found');
    });

    it('should handle timeout', async () => {
      (global.navigator.usb.requestDevice as any).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(mockUSBDevice), 100))
      );

      await expect(
        connection.connect({ timeout: 50 })
      ).rejects.toThrow();
    });
  });

  describe('disconnect', () => {
    it('should successfully disconnect device', async () => {
      await connection.connect();
      mockUSBDevice.opened = true;

      await connection.disconnect();

      expect(mockUSBDevice.close).toHaveBeenCalled();
      expect(connection.isConnected()).toBe(false);
    });

    it('should handle disconnect when not connected', async () => {
      await expect(connection.disconnect()).resolves.not.toThrow();
    });

    it('should throw error if disconnect fails', async () => {
      await connection.connect();
      mockUSBDevice.close.mockRejectedValueOnce(new Error('Close failed'));

      await expect(connection.disconnect()).rejects.toThrow(ADBConnectionError);
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