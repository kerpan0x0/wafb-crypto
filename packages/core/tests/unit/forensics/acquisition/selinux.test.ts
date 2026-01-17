import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SELinuxAcquirer } from '../../../../src/forensics/acquisition/selinux';
import type { SELinuxConfig } from '../../../../src/forensics/acquisition/selinux';
import {
  setupAcquirerDOMMocks,
  createMockProgressCallback
} from '../../../helpers/test-helpers';

describe('SELinuxAcquirer', () => {
  let acquirer: SELinuxAcquirer;
  let mockDevice: any;
  let domMocks: any;

  beforeEach(() => {
    // Setup DOM mocks for download functionality
    domMocks = setupAcquirerDOMMocks();

    // Create mock device with SELinux command responses
    mockDevice = createMockADBDeviceWithSELinuxCommands({
      getenforce: 'Enforcing',
      policyVersion: '30',
      processContexts: `LABEL                          USER     PID   PPID     VSZ    RSS WCHAN            ADDR S NAME
u:r:init:s0                        root       1      0   17936   2048 0                   0 S init
u:r:system_server:s0               system  1234      1 3456789  98765 0                   0 S system_server
u:r:surfaceflinger:s0              system  2345      1  123456   5678 0                   0 S surfaceflinger`,
      fileContexts: `u:object_r:system_file:s0 /system/bin/app_process
u:object_r:system_file:s0 /system/bin/linker`,
      denials: `01-01 10:00:00.000  123  456 W audit: type=1400 audit(1234567890.123:456): avc: denied { read } for pid=1234 comm="untrusted_app" name="test" dev="sda" ino=12345 scontext=u:r:untrusted_app:s0 tcontext=u:object_r:system_file:s0 tclass=file permissive=0`
    });

    acquirer = new SELinuxAcquirer(mockDevice);
  });

  afterEach(() => {
    domMocks.cleanup();
  });

  describe('Basic Acquisition', () => {
    it('should successfully acquire SELinux information', async () => {
      const { callback, getLastProgress } = createMockProgressCallback();

      const result = await acquirer.acquire(callback);

      expect(result.success).toBe(true);
      expect(result.type).toBe('selinux');
      expect(result.fileName).toBeTruthy();
      expect(result.fileSize).toBeGreaterThan(0);

      const lastProgress = getLastProgress();
      expect(lastProgress?.status).toBe('completed');
      expect(lastProgress?.progress).toBe(100);
    });

    it('should include mode information', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('mode');
      expect(result.data?.mode).toBe('Enforcing');
    });

    it('should include policy version', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('policyVersion');
    });
  });

  describe('SELinux Mode Detection', () => {
    it('should detect Enforcing mode', async () => {
      const result = await acquirer.acquire();

      expect(result.data?.mode).toBe('Enforcing');
    });

    it('should detect Permissive mode', async () => {
      mockDevice = createMockADBDeviceWithSELinuxCommands({
        getenforce: 'Permissive'
      });
      acquirer = new SELinuxAcquirer(mockDevice);

      const result = await acquirer.acquire();

      expect(result.data?.mode).toBe('Permissive');
    });

    it('should handle unknown mode gracefully', async () => {
      mockDevice = createMockADBDeviceWithSELinuxCommands({
        getenforce: 'InvalidMode'
      });
      acquirer = new SELinuxAcquirer(mockDevice);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      // Should still complete even with unknown mode
    });
  });

  describe('Process Contexts', () => {
    it('should collect process contexts when enabled', async () => {
      const config: SELinuxConfig = { includeContexts: true };
      acquirer = new SELinuxAcquirer(mockDevice, config);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.data?.processContextsCount).toBeGreaterThan(0);
    });

    it('should skip process contexts when disabled', async () => {
      const config: SELinuxConfig = { includeContexts: false };
      acquirer = new SELinuxAcquirer(mockDevice, config);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.data?.processContextsCount).toBe(0);
    });

    it('should handle ps command failure gracefully', async () => {
      mockDevice = createMockADBDeviceWithSELinuxCommands({
        throwOnPs: true
      });
      acquirer = new SELinuxAcquirer(mockDevice);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.data?.processContextsCount).toBe(0);
    });
  });

describe('File Contexts', () => {
  it('should collect file contexts when enabled', async () => {
    const config: SELinuxConfig = { includeFileContexts: true };
    acquirer = new SELinuxAcquirer(mockDevice, config);

    const result = await acquirer.acquire();

    expect(result.success).toBe(true);
    expect(result.data?.fileContextsCount).toBeGreaterThan(0);
  });

  it('should format file contexts as separate lines', async () => {
    // Create a mock with realistic file context output
    mockDevice = createMockADBDeviceWithSELinuxCommands({
      fileContexts: `u:object_r:system_file:s0 bin
u:object_r:system_file:s0 lib
u:object_r:system_file:s0 etc`
    });
    
    acquirer = new SELinuxAcquirer(mockDevice);
    const result = await acquirer.acquire();

    expect(result.success).toBe(true);
    
    // Download blob should have been created
    expect(domMocks.createObjectURLSpy).toHaveBeenCalled();
    
    // Get the blob that was created
    const blobCall = domMocks.createObjectURLSpy.mock.calls[0];
    const blob = blobCall[0] as Blob;
    
    // Read blob content
    const text = await blob.text();
    const data = JSON.parse(text);
    
    // Check that fileContexts is an array of strings
    expect(Array.isArray(data.fileContexts)).toBe(true);
    
    // Each entry should be a separate string, not one big string with \n
    const hasProperLines = data.fileContexts.some((line: string) => {
      return line.includes('u:object_r:system_file:s0') && !line.includes('\n');
    });
    expect(hasProperLines).toBe(true);
  });

  it('should include path headers in file contexts', async () => {
    mockDevice = createMockADBDeviceWithSELinuxCommands({
      fileContexts: `u:object_r:system_file:s0 bin`
    });
    
    acquirer = new SELinuxAcquirer(mockDevice);
    const result = await acquirer.acquire();

    expect(result.success).toBe(true);
    
    const blobCall = domMocks.createObjectURLSpy.mock.calls[0];
    const blob = blobCall[0] as Blob;
    const text = await blob.text();
    const data = JSON.parse(text);
    
    // Should have path headers like "# /system"
    const hasHeaders = data.fileContexts.some((line: string) => line.startsWith('# /'));
    expect(hasHeaders).toBe(true);
  });

  it('should skip file contexts when disabled', async () => {
    const config: SELinuxConfig = { includeFileContexts: false };
    acquirer = new SELinuxAcquirer(mockDevice, config);

    const result = await acquirer.acquire();

    expect(result.success).toBe(true);
    expect(result.data?.fileContextsCount).toBe(0);
  });

  it('should handle empty output for non-existent paths', async () => {
    mockDevice = createMockADBDeviceWithSELinuxCommands({
      fileContexts: '' // Empty output
    });
    
    acquirer = new SELinuxAcquirer(mockDevice);
    const result = await acquirer.acquire();

    expect(result.success).toBe(true);
    // Should still succeed but with 0 contexts
  });
});

  describe('SELinux Denials', () => {
    it('should collect denials when enabled', async () => {
      const config: SELinuxConfig = { includeDenials: true };
      acquirer = new SELinuxAcquirer(mockDevice, config);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.data?.denialsCount).toBeGreaterThan(0);
    });

    it('should skip denials when disabled', async () => {
      const config: SELinuxConfig = { includeDenials: false };
      acquirer = new SELinuxAcquirer(mockDevice, config);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.data?.denialsCount).toBe(0);
    });

    it('should respect maxDenialLines limit', async () => {
      const config: SELinuxConfig = {
        includeDenials: true,
        maxDenialLines: 10
      };

      // Create device with many denials
      const manyDenials = Array(50).fill(
        '01-01 10:00:00.000  123  456 W audit: type=1400 audit(1234567890.123:456): avc: denied { read } for pid=1234'
      ).join('\n');

      mockDevice = createMockADBDeviceWithSELinuxCommands({
        denials: manyDenials
      });

      acquirer = new SELinuxAcquirer(mockDevice, config);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      // Should be limited to maxDenialLines
      expect(result.data?.denialsCount).toBeLessThanOrEqual(10);
    });

    it('should parse denial lines correctly', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      // Verifica che almeno un denial sia stato parsato
      expect(result.data?.denialsCount).toBeGreaterThan(0);
    });
  });

  describe('Progress Reporting', () => {
    it('should report progress at key milestones', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();

      await acquirer.acquire(callback);

      const history = getProgressHistory();

      // Should have multiple progress updates
      expect(history.length).toBeGreaterThan(5);

      // Check for key milestones
      expect(history.some(p => p.message.includes('device information'))).toBe(true);
      expect(history.some(p => p.message.includes('SELinux mode'))).toBe(true);
      expect(history.some(p => p.message.includes('completed'))).toBe(true);
    });

    it('should report correct progress percentages', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();

      await acquirer.acquire(callback);

      const history = getProgressHistory();
      const progressValues = history.map(p => p.progress);

      // Progress should be monotonically increasing
      for (let i = 1; i < progressValues.length; i++) {
        expect(progressValues[i]).toBeGreaterThanOrEqual(progressValues[i - 1]);
      }

      // Final progress should be 100
      expect(progressValues[progressValues.length - 1]).toBe(100);
    });
  });

  describe('Error Handling', () => {
    it('should handle getenforce command failure', async () => {
      mockDevice = createMockADBDeviceWithSELinuxCommands({
        throwOnGetenforce: true
      });
      acquirer = new SELinuxAcquirer(mockDevice);

      const result = await acquirer.acquire();

      // Should still succeed with unknown mode
      expect(result.success).toBe(true);
    });

    it('should handle file read failures gracefully', async () => {
      mockDevice = createMockADBDeviceWithSELinuxCommands({
        throwOnFileRead: true
      });
      acquirer = new SELinuxAcquirer(mockDevice);

      const result = await acquirer.acquire();

      // Should complete even if file reads fail
      expect(result.success).toBe(true);
    });

    it('should report acquisition failure on critical error', async () => {
      mockDevice = createMockADBDeviceWithSELinuxCommands({
        throwOnDeviceInfo: true
      });
      acquirer = new SELinuxAcquirer(mockDevice);

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  describe('Hash Computation', () => {
    it('should compute hash when requested', async () => {
      const config: SELinuxConfig = { computeHash: true };
      acquirer = new SELinuxAcquirer(mockDevice, config);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.hash).toBeTruthy();
      expect(result.hash).toHaveLength(64); // SHA-256 hex string
    });

    it('should not compute hash when not requested', async () => {
      const config: SELinuxConfig = { computeHash: false };
      acquirer = new SELinuxAcquirer(mockDevice, config);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.hash).toBeUndefined();
    });
  });

  describe('Output Format', () => {
    it('should generate valid filename', async () => {
      const result = await acquirer.acquire();

      expect(result.fileName).toMatch(/^selinux-.*\.json$/);
      expect(result.fileName).toContain('Test Device');
    });

    it('should create downloadable blob', async () => {
      await acquirer.acquire();

      expect(domMocks.createObjectURLSpy).toHaveBeenCalled();
      expect(domMocks.mockAnchor.click).toHaveBeenCalled();
    });
  });
});

// Helper function to create mock device with SELinux command responses
function createMockADBDeviceWithSELinuxCommands(options: {
  getenforce?: string;
  policyVersion?: string;
  processContexts?: string;
  fileContexts?: string;
  denials?: string;
  throwOnGetenforce?: boolean;
  throwOnFileRead?: boolean;
  throwOnPs?: boolean;
  throwOnDeviceInfo?: boolean;
} = {}) {
  const {
    getenforce = 'Enforcing',
    policyVersion = '30',
    processContexts = '',
    fileContexts = '',
    denials = '',
    throwOnGetenforce = false,
    throwOnFileRead = false,
    throwOnPs = false,
    throwOnDeviceInfo = false
  } = options;

  const mockShellSpawn = vi.fn().mockImplementation((command: string) => {
    // Handle getenforce
    if (command === 'getenforce') {
      if (throwOnGetenforce) {
        return Promise.reject(new Error('getenforce failed'));
      }
      return Promise.resolve({
        stdout: createMockReadableStream(getenforce),
        stderr: createMockReadableStream(''),
        stdin: new WritableStream(),
        exit: Promise.resolve({ code: 0 })
      });
    }

    // Handle ps -A -Z (note the order matters!)
    if (command.includes('ps') && command.includes('-A') && command.includes('-Z')) {
      if (throwOnPs) {
        return Promise.reject(new Error('ps failed'));
      }
      return Promise.resolve({
        stdout: createMockReadableStream(processContexts),
        stderr: createMockReadableStream(''),
        stdin: new WritableStream(),
        exit: Promise.resolve({ code: 0 })
      });
    }

    // Handle ls -Z for specific paths
    if (command.includes('ls') && command.includes('-Z')) {
      return Promise.resolve({
        stdout: createMockReadableStream(fileContexts),
        stderr: createMockReadableStream(''),
        stdin: new WritableStream(),
        exit: Promise.resolve({ code: 0 })
      });
    }

    // Handle logcat for denials - must match exact pattern used in code
    if (command.includes('logcat') && command.includes('-d') && command.includes('-b all')) {
      return Promise.resolve({
        stdout: createMockReadableStream(denials),
        stderr: createMockReadableStream(''),
        stdin: new WritableStream(),
        exit: Promise.resolve({ code: 0 })
      });
    }

    // Handle getprop
    if (command === 'getprop') {
      return Promise.resolve({
        stdout: createMockReadableStream(
          `[ro.build.version.release]: [13]
[ro.build.id]: [TP1A.220905.004]
[ro.product.model]: [Test Device]
[ro.product.manufacturer]: [Test Manufacturer]
[ro.product.brand]: [Test]
[ro.build.version.sdk]: [33]
[ro.build.selinux]: [${policyVersion}]`
        ),
        stderr: createMockReadableStream(''),
        stdin: new WritableStream(),
        exit: Promise.resolve({ code: 0 })
      });
    }

    // Default empty response
    return Promise.resolve({
      stdout: createMockReadableStream(''),
      stderr: createMockReadableStream(''),
      stdin: new WritableStream(),
      exit: Promise.resolve({ code: 0 })
    });
  });

  const mockSync = vi.fn().mockImplementation(() => {
    if (throwOnFileRead) {
      return Promise.reject(new Error('File read failed'));
    }

    return Promise.resolve({
      read: vi.fn().mockReturnValue(
        createMockReadableStream(
          new TextEncoder().encode(`androidboot.selinux=enforcing policy_version=${policyVersion}`)
        )
      ),
      dispose: vi.fn().mockResolvedValue(undefined)
    });
  });

  const mockAdb = {
    subprocess: {
      shellProtocol: {
        spawn: mockShellSpawn
      }
    },
    sync: mockSync,
    close: vi.fn().mockResolvedValue(undefined)
  };

  return {
    adb: mockAdb as any,
    getProperties: vi.fn().mockImplementation(() => {
      if (throwOnDeviceInfo) {
        return Promise.reject(new Error('Failed to get device info'));
      }
      return Promise.resolve({
        androidVersion: '13',
        buildId: 'TP1A.220905.004',
        model: 'Test Device',
        manufacturer: 'Test Manufacturer',
        brand: 'Test',
        sdkVersion: 33,
        serialNumber: 'TEST123'
      });
    }),
    info: {
      productName: 'Test Device',
      manufacturerName: 'Test Manufacturer',
      serialNumber: 'TEST123',
      vendorId: 0x18D1,
      productId: 0x4EE7
    },
    isConnected: vi.fn().mockReturnValue(true),
    disconnect: vi.fn().mockResolvedValue(undefined)
  };
}

function createMockReadableStream(content: string | Uint8Array) {
  const data = typeof content === 'string'
    ? new TextEncoder().encode(content)
    : content;

  return {
    getReader: () => {
      let readCount = 0;
      return {
        read: async () => {
          if (readCount === 0) {
            readCount++;
            return { done: false, value: data };
          }
          return { done: true, value: undefined };
        },
        releaseLock: vi.fn()
      };
    }
  };
}