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

const mockAdb = {
  subprocess: {
    spawn: vi.fn()
  },
  sync: vi.fn(),
  close: vi.fn()
} as unknown as Adb;

const mockConnection = {
  disconnect: vi.fn(),
  isConnected: vi.fn().mockReturnValue(true)
} as any;

describe('ADBDevice', () => {
  let device: ADBDevice;

  beforeEach(() => {
    vi.clearAllMocks();
    device = new ADBDevice(mockAdb, mockDeviceInfo, mockConnection);
  });

  describe('getProperties', () => {
    it('should return device properties', async () => {
      const mockProcess = {
        stdout: new ReadableStream({
          start(controller) {
            const output = `[ro.build.version.release]: [13]
[ro.build.id]: [TP1A.220905.004]
[ro.product.model]: [Pixel 6]
[ro.product.manufacturer]: [Google]
[ro.product.brand]: [google]
[ro.build.version.sdk]: [33]`;
            controller.enqueue(new TextEncoder().encode(output));
            controller.close();
          }
        }),
        exit: Promise.resolve({ code: 0 })
      };

      (mockAdb.subprocess.spawn as any).mockResolvedValue(mockProcess);

      const props = await device.getProperties();

      expect(props.androidVersion).toBe('13');
      expect(props.buildId).toBe('TP1A.220905.004');
      expect(props.model).toBe('Pixel 6');
      expect(props.manufacturer).toBe('Google');
      expect(props.sdkVersion).toBe(33);
    });

    it('should use fallback values for missing properties', async () => {
      const mockProcess = {
        stdout: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(''));
            controller.close();
          }
        }),
        exit: Promise.resolve({ code: 0 })
      };

      (mockAdb.subprocess.spawn as any).mockResolvedValue(mockProcess);

      const props = await device.getProperties();

      expect(props.androidVersion).toBe('Unknown');
      expect(props.model).toBe(mockDeviceInfo.productName);
      expect(props.manufacturer).toBe(mockDeviceInfo.manufacturerName);
    });
  });

  describe('isRooted', () => {
    it('should return true if device is rooted', async () => {
      const mockProcess = {
        stdout: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('uid=0(root) gid=0(root)'));
            controller.close();
          }
        }),
        exit: Promise.resolve({ code: 0 })
      };

      (mockAdb.subprocess.spawn as any).mockResolvedValue(mockProcess);

      const isRooted = await device.isRooted();
      expect(isRooted).toBe(true);
    });

    it('should return false if device is not rooted', async () => {
      const mockProcess = {
        stdout: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('uid=2000(shell)'));
            controller.close();
          }
        }),
        exit: Promise.resolve({ code: 0 })
      };

      (mockAdb.subprocess.spawn as any).mockResolvedValue(mockProcess);

      const isRooted = await device.isRooted();
      expect(isRooted).toBe(false);
    });

    it('should return false if su command fails', async () => {
      (mockAdb.subprocess.spawn as any).mockRejectedValue(new Error('su not found'));

      const isRooted = await device.isRooted();
      expect(isRooted).toBe(false);
    });
  });

  describe('getBatteryInfo', () => {
    it('should return battery information', async () => {
      const mockProcess = {
        stdout: new ReadableStream({
          start(controller) {
            const output = `Current Battery Service state:
  level: 85
  temperature: 280
  voltage: 4200
  status: 2`;
            controller.enqueue(new TextEncoder().encode(output));
            controller.close();
          }
        }),
        exit: Promise.resolve({ code: 0 })
      };

      (mockAdb.subprocess.spawn as any).mockResolvedValue(mockProcess);

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