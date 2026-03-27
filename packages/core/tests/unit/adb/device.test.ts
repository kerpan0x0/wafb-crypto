import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Device } from '../../../src/adb';
import type { DeviceInfo } from '../../../src/adb';

// ── Inline Adb mock (no external helper needed) ───────────────────────────────

function createMockAdb() {
  const mockShellSocket = {
    stdout: new ReadableStream({
      start(controller) { controller.close(); }
    }),
    stderr: new ReadableStream({
      start(controller) { controller.close(); }
    }),
    exited: Promise.resolve(0),
  };

  return {
    subprocess: {
      shellProtocol: {
        spawn: vi.fn().mockResolvedValue(mockShellSocket),
      },
    },
    sync: vi.fn().mockResolvedValue({
      dispose: vi.fn(),
    }),
  };
}

function createMockConnection() {
  return {
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
  };
}

const MOCK_DEVICE_INFO: DeviceInfo = {
  serialNumber: 'TEST123',
  productName: 'Test Device',
  manufacturerName: 'Test Manufacturer',
  vendorId: 0x18d1,
  productId: 0x4ee7,
};

const MOCK_GETPROP_OUTPUT = `[ro.build.version.release]: [13]
[ro.build.id]: [TP1A.220905.004]
[ro.product.model]: [Pixel 7]
[ro.product.manufacturer]: [Google]
[ro.product.brand]: [google]
[ro.build.version.sdk]: [33]
[ro.bootloader]: [bootloader-v1]
[ro.hardware]: [qcom]
[ro.build.fingerprint]: [google/test/fingerprint]`;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ADBDevice - Refactored', () => {
  let mockAdb: ReturnType<typeof createMockAdb>;
  let mockConnection: ReturnType<typeof createMockConnection>;
  let device: Device;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdb = createMockAdb();
    mockConnection = createMockConnection();
    device = new Device(mockAdb as any, MOCK_DEVICE_INFO, mockConnection as any);
  });

  describe('getProperties', () => {
    it('should return device properties', async () => {
      // getprop is called via device.shell → Shell → adb.subprocess.shellProtocol.spawn
      const enc = new TextEncoder();
      const makeStream = (content: string) => new ReadableStream({
        start(controller) {
          controller.enqueue(enc.encode(content));
          controller.close();
        }
      });

      mockAdb.subprocess.shellProtocol.spawn.mockResolvedValue({
        stdout: makeStream(MOCK_GETPROP_OUTPUT),
        stderr: makeStream(''),
        exited: Promise.resolve(0),
      });

      const props = await device.getProperties();

      expect(props.model).toBe('Pixel 7');
      expect(props.manufacturer).toBe('Google');
      expect(props.androidVersion).toBe('13');
      expect(props.buildId).toBe('TP1A.220905.004');
      expect(props.sdkVersion).toBe(33);
      expect(props.serialNumber).toBe('TEST123');
    });

    it('should use fallback values for missing properties', async () => {
      const enc = new TextEncoder();
      mockAdb.subprocess.shellProtocol.spawn.mockResolvedValue({
        stdout: new ReadableStream({ start(c) { c.enqueue(enc.encode('')); c.close(); } }),
        stderr: new ReadableStream({ start(c) { c.close(); } }),
        exited: Promise.resolve(0),
      });

      const props = await device.getProperties();

      expect(props.model).toBe('Test Device');       // falls back to deviceInfo.productName
      expect(props.manufacturer).toBe('Test Manufacturer'); // falls back to deviceInfo.manufacturerName
      expect(props.androidVersion).toBe('Unknown');
      expect(props.serialNumber).toBe('TEST123');
    });
  });

  describe('isRooted', () => {
    it('should return true if device is rooted', async () => {
      const enc = new TextEncoder();
      mockAdb.subprocess.shellProtocol.spawn.mockResolvedValue({
        stdout: new ReadableStream({ start(c) { c.enqueue(enc.encode('uid=0(root) gid=0(root)')); c.close(); } }),
        stderr: new ReadableStream({ start(c) { c.close(); } }),
        exited: Promise.resolve(0),
      });

      expect(await device.isRooted()).toBe(true);
    });

    it('should return false if device is not rooted', async () => {
      const enc = new TextEncoder();
      mockAdb.subprocess.shellProtocol.spawn.mockResolvedValue({
        stdout: new ReadableStream({ start(c) { c.enqueue(enc.encode('uid=2000(shell) gid=2000(shell)')); c.close(); } }),
        stderr: new ReadableStream({ start(c) { c.close(); } }),
        exited: Promise.resolve(0),
      });

      expect(await device.isRooted()).toBe(false);
    });

    it('should return false if su command fails', async () => {
      mockAdb.subprocess.shellProtocol.spawn.mockRejectedValue(new Error('Permission denied'));
      expect(await device.isRooted()).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('should call connection disconnect', async () => {
      await device.disconnect();
      expect(mockConnection.disconnect).toHaveBeenCalledOnce();
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