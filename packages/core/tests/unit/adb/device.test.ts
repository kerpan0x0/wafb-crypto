import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ADBDevice } from '../../../src/adb/device';
import type { Adb } from '@yume-chan/adb';
import type { DeviceInfo } from '../../../src/adb/connection';

const mockDeviceInfo: DeviceInfo = {
  productName: 'Test Device',
  manufacturerName: 'Test Manufacturer',
  serialNumber: 'TEST123',
  vendorId: 0x18D1,
  productId: 0x4EE7
};

// Helper per creare mock shell socket
const createMockShellSocket = (output: string) => ({
  stdout: {
    getReader: () => {
      let readCount = 0;
      return {
        read: async () => {
          if (readCount === 0) {
            readCount++;
            return { done: false, value: new TextEncoder().encode(output) };
          }
          return { done: true, value: undefined };
        },
        releaseLock: vi.fn()
      };
    }
  },
  stderr: new ReadableStream(),
  stdin: new WritableStream(),
  exit: Promise.resolve({ code: 0 })
});

const createMockAdb = () => ({
  subprocess: {
    shellProtocol: {
      spawn: vi.fn()
    },
    spawn: vi.fn()
  },
  sync: vi.fn(),
  close: vi.fn()
} as unknown as Adb);

const mockConnection = {
  disconnect: vi.fn(),
  isConnected: vi.fn().mockReturnValue(true)
} as any;

describe('ADBDevice', () => {
  let device: ADBDevice;
  let mockAdb: Adb;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdb = createMockAdb();
    device = new ADBDevice(mockAdb, mockDeviceInfo, mockConnection);
  });

  describe('getProperties', () => {
    it('should return device properties', async () => {
      const output = `[ro.build.version.release]: [13]
[ro.build.id]: [TP1A.220905.004]
[ro.product.model]: [Pixel 6]
[ro.product.manufacturer]: [Google]
[ro.product.brand]: [google]
[ro.build.version.sdk]: [33]`;

      (mockAdb.subprocess.shellProtocol as any).spawn.mockResolvedValue(
        createMockShellSocket(output)
      );

      const props = await device.getProperties();

      expect(props.androidVersion).toBe('13');
      expect(props.buildId).toBe('TP1A.220905.004');
      expect(props.model).toBe('Pixel 6');
      expect(props.manufacturer).toBe('Google');
      expect(props.sdkVersion).toBe(33);
    });

    it('should use fallback values for missing properties', async () => {
      (mockAdb.subprocess.shellProtocol as any).spawn.mockResolvedValue(
        createMockShellSocket('')
      );

      const props = await device.getProperties();

      expect(props.androidVersion).toBe('Unknown');
      expect(props.model).toBe(mockDeviceInfo.productName);
      expect(props.manufacturer).toBe(mockDeviceInfo.manufacturerName);
    });
  });

  describe('isRooted', () => {
    it('should return true if device is rooted', async () => {
      (mockAdb.subprocess.shellProtocol as any).spawn.mockResolvedValue(
        createMockShellSocket('uid=0(root) gid=0(root)')
      );

      const isRooted = await device.isRooted();
      expect(isRooted).toBe(true);
    });

    it('should return false if device is not rooted', async () => {
      (mockAdb.subprocess.shellProtocol as any).spawn.mockResolvedValue(
        createMockShellSocket('uid=2000(shell)')
      );

      const isRooted = await device.isRooted();
      expect(isRooted).toBe(false);
    });

    it('should return false if su command fails', async () => {
      (mockAdb.subprocess.shellProtocol as any).spawn.mockRejectedValue(
        new Error('su not found')
      );

      const isRooted = await device.isRooted();
      expect(isRooted).toBe(false);
    });
  });

  describe('getBatteryInfo', () => {
    it('should return battery information', async () => {
      const output = `Current Battery Service state:
  level: 85
  temperature: 280
  voltage: 4200
  status: 2`;

      (mockAdb.subprocess.shellProtocol as any).spawn.mockResolvedValue(
        createMockShellSocket(output)
      );

      const batteryInfo = await device.getBatteryInfo();

      expect(batteryInfo.level).toBe(85);
      expect(batteryInfo.temperature).toBe(28); // 280 / 10
      expect(batteryInfo.voltage).toBe(4200);
      expect(batteryInfo.status).toBe('2');
    });
  });

  describe('disconnect', () => {
    it('should call connection disconnect', async () => {
      await device.disconnect();
      expect(mockConnection.disconnect).toHaveBeenCalled();
    });
  });

  describe('isConnected', () => {
    it('should return connection status', () => {
      expect(device.isConnected()).toBe(true);

      mockConnection.isConnected.mockReturnValue(false);
      expect(device.isConnected()).toBe(false);
    });
  });
});