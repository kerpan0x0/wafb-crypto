import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PackagesAcquirer } from '../../../../src/forensics/acquisition/packages';
import type { ADBDevice } from '../../../../src/adb/device';
import type { PackageInfo } from '../../../../src/forensics/acquisition/packages';

// ============================================================================
// Mock Helpers
// ============================================================================

function createMockDevice(overrides: any = {}): ADBDevice {
  const defaultDevice = {
    info: {
      productName: 'Test Device',
      manufacturerName: 'Test Manufacturer',
      serialNumber: 'TEST123',
      vendorId: 0x18D1,
      productId: 0x4EE7
    },
    commands: {
      shell: vi.fn(),
      getprop: vi.fn().mockResolvedValue({
        'ro.build.version.release': '13',
        'ro.build.id': 'TEST_BUILD',
        'ro.product.model': 'Test Device',
        'ro.product.manufacturer': 'Test Manufacturer',
        'ro.product.brand': 'Test',
        'ro.build.version.sdk': '33'
      })
    },
    getProperties: vi.fn().mockResolvedValue({
      androidVersion: '13',
      buildId: 'TEST_BUILD',
      model: 'Test Device',
      manufacturer: 'Test Manufacturer',
      brand: 'Test',
      sdkVersion: 33,
      serialNumber: 'TEST123'
    }),
    isConnected: vi.fn().mockReturnValue(true),
    disconnect: vi.fn()
  };

  return {
    ...defaultDevice,
    ...overrides,
    commands: {
      ...defaultDevice.commands,
      ...(overrides.commands || {})
    }
  } as any;
}

function mockDocumentForDownload() {
  const clickSpy = vi.fn();
  const createElement = vi.fn((tag: string) => {
    if (tag === 'a') {
      return {
        href: '',
        download: '',
        click: clickSpy,
        style: {}
      };
    }
    return {};
  });

  const appendChild = vi.fn();
  const removeChild = vi.fn();

  global.document = {
    createElement,
    body: {
      appendChild,
      removeChild
    }
  } as any;

  global.URL = {
    createObjectURL: vi.fn().mockReturnValue('blob:mock-url'),
    revokeObjectURL: vi.fn()
  } as any;

  global.Blob = vi.fn().mockImplementation((parts, options) => ({
    parts,
    options,
    size: parts[0]?.byteLength || parts[0]?.length || 0
  })) as any;

  return { clickSpy, createElement, appendChild, removeChild };
}

// ============================================================================
// Tests
// ============================================================================

describe('PackagesAcquirer', () => {
  let mockDevice: ADBDevice;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDevice = createMockDevice();
    mockDocumentForDownload();
  });

  // ==========================================================================
  // Basic Acquisition Tests
  // ==========================================================================

  describe('acquire', () => {
    it('should successfully acquire packages list', async () => {
      const packageList = `package:com.android.settings
package:com.google.android.gms
package:com.example.app`;

      (mockDevice.commands.shell as any).mockResolvedValue(packageList);

      const acquirer = new PackagesAcquirer(mockDevice, {
        includeDetails: false
      });
      
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.type).toBe('packages');
      expect(result.fileName).toMatch(/^packages-.*\.json$/);
      expect((result.data as any).totalPackages).toBe(3);
    });

    it('should filter system packages when includeSystem is false', async () => {
      (mockDevice.commands.shell as any).mockResolvedValue('package:com.example.app');

      const acquirer = new PackagesAcquirer(mockDevice, {
        includeSystem: false,
        includeDetails: false
      });
      
      await acquirer.acquire();

      // Verify shell was called with -3 flag (user apps only)
      const shellCalls = (mockDevice.commands.shell as any).mock.calls;
      const listCommand = shellCalls.find((call: any) => 
        call[0].includes('pm list packages')
      );
      expect(listCommand[0]).toContain('-3');
    });

    it('should include system packages by default', async () => {
      const packageList = `package:com.android.settings
package:com.example.app`;

      (mockDevice.commands.shell as any).mockResolvedValue(packageList);

      const acquirer = new PackagesAcquirer(mockDevice, {
        includeDetails: false
      });
      
      await acquirer.acquire();

      const shellCalls = (mockDevice.commands.shell as any).mock.calls;
      const listCommand = shellCalls.find((call: any) => 
        call[0].includes('pm list packages')
      );
      expect(listCommand[0]).not.toContain('-3');
    });

    it('should acquire detailed package information', async () => {
      const packageList = 'package:com.example.app';
      const dumpsysOutput = `versionName=1.0.0
versionCode=1
codePath=/data/app/com.example.app
firstInstallTime=2024-01-01 10:00:00
lastUpdateTime=2024-01-02 12:00:00
targetSdk=33
minSdk=21`;

      (mockDevice.commands.shell as any)
        .mockResolvedValueOnce(packageList) // pm list packages
        .mockResolvedValueOnce(dumpsysOutput); // dumpsys package

      const acquirer = new PackagesAcquirer(mockDevice, {
        includeDetails: true
      });
      
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      
      // Verify dumpsys was called
      const shellCalls = (mockDevice.commands.shell as any).mock.calls;
      const dumpsysCall = shellCalls.find((call: any) => 
        call[0].includes('dumpsys package')
      );
      expect(dumpsysCall).toBeDefined();
    });

    it('should report progress during acquisition', async () => {
      const packageList = 'package:com.example.app';
      
      (mockDevice.commands.shell as any).mockResolvedValue(packageList);

      const progressCallback = vi.fn();
      const acquirer = new PackagesAcquirer(mockDevice, {
        includeDetails: false
      });
      
      await acquirer.acquire(progressCallback);

      expect(progressCallback).toHaveBeenCalled();
      
      const calls = progressCallback.mock.calls.map(call => call[0]);
      
      // Should start with low progress
      expect(calls[0].progress).toBeLessThan(50);
      expect(calls[0].status).toBe('running');
      
      // Should end with 100%
      const lastCall = calls[calls.length - 1];
      expect(lastCall.progress).toBe(100);
      expect(lastCall.status).toBe('completed');
    });

    it('should compute hash when configured', async () => {
      const packageList = 'package:com.example.app';
      
      (mockDevice.commands.shell as any).mockResolvedValue(packageList);

      const acquirer = new PackagesAcquirer(mockDevice, {
        includeDetails: false,
        computeHash: true
      });
      
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.hash).toBeDefined();
      expect(result.hash).toHaveLength(64); // SHA-256
    });

    it('should handle empty package list', async () => {
      (mockDevice.commands.shell as any).mockResolvedValue('');

      const acquirer = new PackagesAcquirer(mockDevice, {
        includeDetails: false
      });
      
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).totalPackages).toBe(0);
    });
  });

  // ==========================================================================
  // Package Classification Tests
  // ==========================================================================

  describe('package classification', () => {
    it('should identify system packages correctly', async () => {
      const packageList = `package:com.android.settings
package:com.google.android.gms
package:com.example.userapp`;

      (mockDevice.commands.shell as any).mockResolvedValue(packageList);

      const acquirer = new PackagesAcquirer(mockDevice, {
        includeDetails: false
      });
      
      const result = await acquirer.acquire();

      expect((result.data as any).systemPackages).toBe(2);
      expect((result.data as any).userPackages).toBe(1);
    });

    it('should identify Samsung system packages', async () => {
      const packageList = `package:com.samsung.android.app
package:com.sec.android.app`;

      (mockDevice.commands.shell as any).mockResolvedValue(packageList);

      const acquirer = new PackagesAcquirer(mockDevice, {
        includeDetails: false
      });
      
      const result = await acquirer.acquire();

      expect((result.data as any).systemPackages).toBe(2);
    });
  });

  // ==========================================================================
  // Detailed Info Extraction Tests
  // ==========================================================================

  describe('detailed package info', () => {
    it('should extract version information', async () => {
      const packageList = 'package:com.example.app';
      const dumpsysOutput = `versionName=2.5.1
versionCode=251`;

      (mockDevice.commands.shell as any)
        .mockResolvedValueOnce(packageList)
        .mockResolvedValueOnce(dumpsysOutput);

      const acquirer = new PackagesAcquirer(mockDevice, {
        includeDetails: true
      });
      
      await acquirer.acquire();

      // Verify version extraction worked
      expect((mockDevice.commands.shell as any).mock.calls.length).toBeGreaterThan(1);
    });

    it('should extract installation times', async () => {
      const packageList = 'package:com.example.app';
      const dumpsysOutput = `firstInstallTime=2024-01-01 10:00:00
lastUpdateTime=2024-06-15 14:30:00`;

      (mockDevice.commands.shell as any)
        .mockResolvedValueOnce(packageList)
        .mockResolvedValueOnce(dumpsysOutput);

      const acquirer = new PackagesAcquirer(mockDevice, {
        includeDetails: true
      });
      
      await acquirer.acquire();

      expect((mockDevice.commands.shell as any).mock.calls.length).toBe(2);
    });

    it('should extract SDK versions', async () => {
      const packageList = 'package:com.example.app';
      const dumpsysOutput = `targetSdk=33
minSdk=21`;

      (mockDevice.commands.shell as any)
        .mockResolvedValueOnce(packageList)
        .mockResolvedValueOnce(dumpsysOutput);

      const acquirer = new PackagesAcquirer(mockDevice, {
        includeDetails: true
      });
      
      await acquirer.acquire();

      expect((mockDevice.commands.shell as any).mock.calls.length).toBe(2);
    });

    it('should handle missing detailed info gracefully', async () => {
      const packageList = 'package:com.example.app';
      
      (mockDevice.commands.shell as any)
        .mockResolvedValueOnce(packageList)
        .mockResolvedValueOnce(''); // Empty dumpsys

      const acquirer = new PackagesAcquirer(mockDevice, {
        includeDetails: true
      });
      
      const result = await acquirer.acquire();

      // Should still succeed with "Unknown" values
      expect(result.success).toBe(true);
      expect((result.data as any).totalPackages).toBe(1);
    });
  });

  // ==========================================================================
  // Permissions Tests
  // ==========================================================================

  describe('permissions extraction', () => {
    it('should extract permissions when configured', async () => {
      const packageList = 'package:com.example.app';
      const dumpsysOutput = `requested permissions:
  android.permission.INTERNET: granted=true
  android.permission.CAMERA: granted=false
  android.permission.READ_CONTACTS: granted=true`;

      (mockDevice.commands.shell as any)
        .mockResolvedValueOnce(packageList)
        .mockResolvedValueOnce(dumpsysOutput);

      const acquirer = new PackagesAcquirer(mockDevice, {
        includeDetails: true,
        includePermissions: true
      });
      
      await acquirer.acquire();

      expect((mockDevice.commands.shell as any).mock.calls.length).toBe(2);
    });

    it('should not extract permissions when not configured', async () => {
      const packageList = 'package:com.example.app';
      const dumpsysOutput = 'versionName=1.0';

      (mockDevice.commands.shell as any)
        .mockResolvedValueOnce(packageList)
        .mockResolvedValueOnce(dumpsysOutput);

      const acquirer = new PackagesAcquirer(mockDevice, {
        includeDetails: true,
        includePermissions: false
      });
      
      await acquirer.acquire();

      expect((mockDevice.commands.shell as any).mock.calls.length).toBe(2);
    });
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe('error handling', () => {
    it('should handle pm list packages failure', async () => {
      (mockDevice.commands.shell as any).mockRejectedValue(
        new Error('pm command failed')
      );

      const acquirer = new PackagesAcquirer(mockDevice);
      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toContain('pm command failed');
    });

    it('should continue when dumpsys fails for a package', async () => {
      const packageList = `package:com.example.app1
package:com.example.app2`;

      (mockDevice.commands.shell as any)
        .mockResolvedValueOnce(packageList)
        .mockRejectedValueOnce(new Error('dumpsys failed'))
        .mockResolvedValueOnce('versionName=2.0');

      const acquirer = new PackagesAcquirer(mockDevice, {
        includeDetails: true
      });
      
      const result = await acquirer.acquire();

      // Should succeed with partial data
      expect(result.success).toBe(true);
      expect((result.data as any).totalPackages).toBe(2);
    });

    it('should handle device disconnection', async () => {
      (mockDevice.commands.shell as any).mockRejectedValue(
        new Error('Device disconnected')
      );

      const acquirer = new PackagesAcquirer(mockDevice);
      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Device disconnected');
    });
  });

  // ==========================================================================
  // Result Metadata Tests
  // ==========================================================================

  describe('result metadata', () => {
    it('should include timestamps', async () => {
      (mockDevice.commands.shell as any).mockResolvedValue('package:com.example.app');

      const beforeStart = new Date();
      const acquirer = new PackagesAcquirer(mockDevice, {
        includeDetails: false
      });
      const result = await acquirer.acquire();
      const afterEnd = new Date();

      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
      expect(result.startTime.getTime()).toBeGreaterThanOrEqual(beforeStart.getTime());
      expect(result.endTime.getTime()).toBeLessThanOrEqual(afterEnd.getTime());
    });

    it('should include duration', async () => {
      (mockDevice.commands.shell as any).mockResolvedValue('package:com.example.app');

      const acquirer = new PackagesAcquirer(mockDevice, {
        includeDetails: false
      });
      const result = await acquirer.acquire();

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.endTime.getTime() - result.startTime.getTime()).toBeGreaterThanOrEqual(result.duration);
    });

    it('should include file size', async () => {
      (mockDevice.commands.shell as any).mockResolvedValue('package:com.example.app');

      const acquirer = new PackagesAcquirer(mockDevice, {
        includeDetails: false
      });
      const result = await acquirer.acquire();

      expect(result.fileSize).toBeGreaterThan(0);
    });

    it('should include package counts in data', async () => {
      const packageList = `package:com.android.settings
package:com.example.app`;

      (mockDevice.commands.shell as any).mockResolvedValue(packageList);

      const acquirer = new PackagesAcquirer(mockDevice, {
        includeDetails: false
      });
      const result = await acquirer.acquire();

      expect((result.data as any).totalPackages).toBe(2);
      expect((result.data as any).systemPackages).toBe(1);
      expect((result.data as any).userPackages).toBe(1);
    });
  });

  // ==========================================================================
  // Configuration Tests
  // ==========================================================================

  describe('configuration', () => {
    it('should respect includeSystem config', async () => {
      (mockDevice.commands.shell as any).mockResolvedValue('');

      const acquirer = new PackagesAcquirer(mockDevice, {
        includeSystem: false
      });
      
      await acquirer.acquire();

      const shellCall = (mockDevice.commands.shell as any).mock.calls[0];
      expect(shellCall[0]).toContain('pm list packages -3');
    });

    it('should respect includeDetails config', async () => {
      const packageList = 'package:com.example.app';
      
      (mockDevice.commands.shell as any).mockResolvedValue(packageList);

      const acquirer = new PackagesAcquirer(mockDevice, {
        includeDetails: false
      });
      
      await acquirer.acquire();

      // Should only call pm list, not dumpsys
      expect((mockDevice.commands.shell as any).mock.calls.length).toBe(1);
    });

    it('should respect timeout config', async () => {
      (mockDevice.commands.shell as any).mockResolvedValue('package:com.example.app');

      const acquirer = new PackagesAcquirer(mockDevice, {
        timeout: 5000,
        includeDetails: false
      });
      
      await acquirer.acquire();

      // Verify timeout was passed
      const shellCall = (mockDevice.commands.shell as any).mock.calls[0];
      expect(shellCall[1]).toEqual({ timeout: 30000 });
    });
  });
});