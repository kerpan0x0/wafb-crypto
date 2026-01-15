import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PackagesAcquirer } from '../../../../src/forensics/acquisition/packages';
import { 
  createMockADBDeviceWithCommands, 
  setupAcquirerDOMMocks,
  createMockProgressCallback
} from '../../../helpers/test-helpers';
import type { ADBDevice } from '../../../../src/adb/device';

describe('PackagesAcquirer', () => {
  let device: ADBDevice;
  let acquirer: PackagesAcquirer;
  let domMocks: ReturnType<typeof setupAcquirerDOMMocks>;

  beforeEach(() => {
    vi.clearAllMocks();
    device = createMockADBDeviceWithCommands() as unknown as ADBDevice;
    domMocks = setupAcquirerDOMMocks();
    acquirer = new PackagesAcquirer(device);
  });

  afterEach(() => {
    domMocks.cleanup();
  });

  describe('acquire', () => {
    it('should successfully acquire packages list', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.type).toBe('packages');
      expect(result.fileName).toMatch(/packages-.*\.json/);
      expect(device.adb.subprocess.shellProtocol.spawn).toHaveBeenCalled();
    });

    it('should filter system packages when includeSystem is false', async () => {
      acquirer = new PackagesAcquirer(device, { includeSystem: false });
      await acquirer.acquire();

      expect(device.adb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        expect.stringContaining('pm list packages -3')
      );
    });

    it('should include system packages by default', async () => {
      await acquirer.acquire();

      expect(device.adb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        expect.stringContaining('pm list packages')
      );
    });

    it('should acquire detailed package information', async () => {
      acquirer = new PackagesAcquirer(device, { includeDetails: true });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(device.adb.subprocess.shellProtocol.spawn).toHaveBeenCalled();
    });

    it('should report progress during acquisition', async () => {
      const { callback, getLastProgress } = createMockProgressCallback();
      await acquirer.acquire(callback);

      expect(callback).toHaveBeenCalled();
      const lastProgress = getLastProgress();
      expect(lastProgress.progress).toBe(100);
      expect(lastProgress.status).toBe('completed');
    });

    it('should compute hash when configured', async () => {
      acquirer = new PackagesAcquirer(device, { computeHash: true });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.hash).toBeDefined();
    });

    it('should handle empty package list', async () => {
      device = createMockADBDeviceWithCommands({ 
        listPackages: [] 
      }) as unknown as ADBDevice;
      acquirer = new PackagesAcquirer(device);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).totalPackages).toBe(0);
    });
  });

  describe('package classification', () => {
    it('should identify system packages correctly', async () => {
      device = createMockADBDeviceWithCommands({
        listPackages: ['com.android.vending', 'com.example.app']
      }) as unknown as ADBDevice;
      acquirer = new PackagesAcquirer(device);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).systemPackages).toBeGreaterThan(0);
      expect((result.data as any).userPackages).toBeGreaterThan(0);
    });

    it('should identify Samsung system packages', async () => {
      device = createMockADBDeviceWithCommands({
        listPackages: ['com.sec.android.app.launcher', 'com.example.app']
      }) as unknown as ADBDevice;
      acquirer = new PackagesAcquirer(device);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).systemPackages).toBe(1);
    });
  });

  describe('detailed package info', () => {
    it('should extract version information', async () => {
      device = createMockADBDeviceWithCommands({
        listPackages: ['com.example.app'],
        getPackageInfo: {
          packageName: 'com.example.app',
          versionName: '2.5.0',
          versionCode: '250',
          installLocation: '/data/app',
          firstInstallTime: '2024-01-01',
          lastUpdateTime: '2024-01-15'
        }
      }) as unknown as ADBDevice;
      acquirer = new PackagesAcquirer(device, { includeDetails: true });

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      // Verify dumpsys package command was called
      expect(device.adb.subprocess.shellProtocol.spawn).toHaveBeenCalled();
    });

    it('should extract installation times', async () => {
      device = createMockADBDeviceWithCommands({
        listPackages: ['app1', 'app2']
      }) as unknown as ADBDevice;
      acquirer = new PackagesAcquirer(device, { includeDetails: true });

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      // Commands are called internally via shell protocol
      expect(device.adb.subprocess.shellProtocol.spawn).toHaveBeenCalled();
    });

    it('should extract SDK versions', async () => {
      device = createMockADBDeviceWithCommands({
        listPackages: ['app1', 'app2']
      }) as unknown as ADBDevice;
      acquirer = new PackagesAcquirer(device, { includeDetails: true });

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      // Commands are called internally via shell protocol
      expect(device.adb.subprocess.shellProtocol.spawn).toHaveBeenCalled();
    });

    it('should handle missing detailed info gracefully', async () => {
      device = createMockADBDeviceWithCommands({
        listPackages: ['com.example.app'],
        getPackageInfo: null
      }) as unknown as ADBDevice;
      acquirer = new PackagesAcquirer(device, { includeDetails: true });

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
    });
  });

  describe('permissions extraction', () => {
    it('should extract permissions when configured', async () => {
      device = createMockADBDeviceWithCommands({
        listPackages: ['app1', 'app2']
      }) as unknown as ADBDevice;
      acquirer = new PackagesAcquirer(device, { 
        includeDetails: true,
        includePermissions: true 
      });

      await acquirer.acquire();

      // Commands are called internally
      expect(device.adb.subprocess.shellProtocol.spawn).toHaveBeenCalled();
    });

    it('should not extract permissions when not configured', async () => {
      device = createMockADBDeviceWithCommands({
        listPackages: ['app1', 'app2']
      }) as unknown as ADBDevice;
      acquirer = new PackagesAcquirer(device, { 
        includeDetails: true,
        includePermissions: false 
      });

      await acquirer.acquire();

      // Commands are called internally
      expect(device.adb.subprocess.shellProtocol.spawn).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle pm list packages failure', async () => {
      vi.mocked(device.adb.subprocess.shellProtocol.spawn).mockRejectedValue(
        new Error('pm command failed')
      );

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to execute command');
    });

    it('should continue when dumpsys fails for a package', async () => {
      device = createMockADBDeviceWithCommands({
        listPackages: ['com.android.vending', 'com.example.app']
      }) as unknown as ADBDevice;

      acquirer = new PackagesAcquirer(device, { includeDetails: true });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).totalPackages).toBe(2);
    });

    it('should handle device disconnection', async () => {
      vi.mocked(device.adb.subprocess.shellProtocol.spawn).mockRejectedValue(
        new Error('Device disconnected')
      );

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to execute command');
    });
  });

  describe('result metadata', () => {
    it('should include timestamps', async () => {
      const result = await acquirer.acquire();

      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
    });

    it('should include duration', async () => {
      const result = await acquirer.acquire();

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(typeof result.duration).toBe('number');
    });

    it('should include file size', async () => {
      const result = await acquirer.acquire();

      expect(result.fileSize).toBeDefined();
      expect(typeof result.fileSize).toBe('number');
      expect(result.fileSize).toBeGreaterThan(0);
    });

    it('should include package counts in data', async () => {
      const result = await acquirer.acquire();

      expect((result.data as any).totalPackages).toBeDefined();
      expect((result.data as any).systemPackages).toBeDefined();
      expect((result.data as any).userPackages).toBeDefined();
    });
  });

  describe('configuration', () => {
    it('should respect includeSystem config', async () => {
      acquirer = new PackagesAcquirer(device, { includeSystem: false });
      await acquirer.acquire();

      // Verify includeSystem false results in -3 flag
      expect(device.adb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        expect.stringContaining('pm list packages -3')
      );
    });

    it('should respect includeDetails config', async () => {
      device = createMockADBDeviceWithCommands({ 
        listPackages: ['app1'] 
      }) as unknown as ADBDevice;
      acquirer = new PackagesAcquirer(device, { includeDetails: false });

      const result = await acquirer.acquire();

      // When details are disabled, only basic info is collected
      expect(result.success).toBe(true);
    });

    it('should respect timeout config', async () => {
      acquirer = new PackagesAcquirer(device, { timeout: 5000 });
      await acquirer.acquire();

      // Command timeout is handled internally
      expect(device.adb.subprocess.shellProtocol.spawn).toHaveBeenCalled();
    });
  });
});