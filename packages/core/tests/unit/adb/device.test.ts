import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Device } from '../../../src/adb/device';
import {
  createMockAdb,
  createMockDeviceInfo,
  createMockConnection,
  createMockShellSocket
} from '../../helpers/test-helpers';
import type { Adb } from '@yume-chan/adb';

describe('ADBDevice - Refactored', () => {
  let device: Device;
  let mockAdb: Adb;
  let mockConnection: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdb = createMockAdb() as unknown as Adb;
    mockConnection = createMockConnection();
    device = new Device(
      mockAdb, 
      createMockDeviceInfo(), 
      mockConnection
    );
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
      expect(props.model).toBe('Test Device');
      expect(props.manufacturer).toBe('Test Manufacturer');
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