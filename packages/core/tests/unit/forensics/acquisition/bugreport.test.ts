// packages/core/tests/unit/forensics/acquisition/bugreport.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BugreportAcquirer } from '../../../../src/forensics/acquisition/bugreport';
import type { ADBDevice } from '../../../../src/adb/device';

// ============================================================================
// Mock Helpers
// ============================================================================

/**
 * Crea un mock device completo per i test
 */
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
      }),
      readFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4]))
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

/**
 * Mock di document.createElement per i test di download
 */
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
    size: parts[0]?.byteLength || 0
  })) as any;

  return { clickSpy, createElement, appendChild, removeChild };
}

// ============================================================================
// Tests
// ============================================================================

describe('BugreportAcquirer', () => {
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
    it('should successfully generate bugreport', async () => {
      // Mock bugreportz disponibile
      (mockDevice.commands.shell as any)
        .mockResolvedValueOnce('/system/bin/bugreportz') // which bugreportz
        .mockResolvedValueOnce('OK:/data/user_de/0/com.android.shell/files/bugreports/bugreport.zip'); // bugreportz

      const acquirer = new BugreportAcquirer(mockDevice);
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.type).toBe('bugreport');
      expect(result.fileName).toMatch(/^bugreport-.*\.zip$/);
      expect(result.fileSize).toBe(4);
      expect(result.duration).toBeGreaterThan(0);
      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
    });

    it('should report progress during acquisition', async () => {
      (mockDevice.commands.shell as any)
        .mockResolvedValueOnce('/system/bin/bugreportz')
        .mockResolvedValueOnce('OK:/data/bugreport.zip');

      const progressCallback = vi.fn();
      const acquirer = new BugreportAcquirer(mockDevice);

      await acquirer.acquire(progressCallback);

      expect(progressCallback).toHaveBeenCalled();

      // Verifica che sia stato chiamato con diversi stati
      const calls = progressCallback.mock.calls.map(call => call[0]);

      // Dovrebbe iniziare con progress basso
      expect(calls[0].progress).toBeLessThan(50);
      expect(calls[0].status).toBe('running');

      // Dovrebbe finire con progress 100
      const lastCall = calls[calls.length - 1];
      expect(lastCall.progress).toBe(100);
      expect(lastCall.status).toBe('completed');
    });

    it('should compute hashes when configured', async () => {
      (mockDevice.commands.shell as any)
        .mockResolvedValueOnce('/system/bin/bugreportz')
        .mockResolvedValueOnce('OK:/data/bugreport.zip');

      const acquirer = new BugreportAcquirer(mockDevice, {
        computeHash: true
      });

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.hash).toBeDefined();
      expect(result.hash).toHaveLength(64); // SHA-256 hash length
    });

    it('should handle bugreport generation errors', async () => {
      (mockDevice.commands.shell as any)
        .mockResolvedValueOnce('/system/bin/bugreportz')
        .mockRejectedValueOnce(new Error('Bugreport generation failed'));

      const acquirer = new BugreportAcquirer(mockDevice);
      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Bugreport generation failed');
    });

    it('should cleanup temporary files when configured', async () => {
      (mockDevice.commands.shell as any)
        .mockResolvedValueOnce('/system/bin/bugreportz')
        .mockResolvedValueOnce('OK:/data/bugreport.zip')
        .mockResolvedValueOnce(''); // rm command

      const acquirer = new BugreportAcquirer(mockDevice, {
        cleanupAfter: true
      });

      await acquirer.acquire();

      expect(acquirer.wasCleanupPerformed()).toBe(true);
    });

    it('should skip hash computation when disabled', async () => {
      (mockDevice.commands.shell as any)
        .mockResolvedValueOnce('/system/bin/bugreportz')
        .mockResolvedValueOnce('OK:/data/bugreport.zip');

      const acquirer = new BugreportAcquirer(mockDevice, {
        computeHash: false
      });

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.hash).toBeUndefined();
    });

    it('should include device info in result', async () => {
      (mockDevice.commands.shell as any)
        .mockResolvedValueOnce('/system/bin/bugreportz')
        .mockResolvedValueOnce('OK:/data/bugreport.zip');

      const acquirer = new BugreportAcquirer(mockDevice);
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect((result.data as any).deviceInfo).toBeDefined();
      expect((result.data as any).deviceInfo.model).toBe('Test Device');
    });

    it('should fallback to legacy bugreport if bugreportz fails', async () => {
      // Mock: bugreportz non disponibile
      (mockDevice.commands.shell as any)
        .mockRejectedValueOnce(new Error('which: bugreportz: not found')) // which bugreportz
        .mockResolvedValueOnce('') // bugreport > file
        .mockResolvedValueOnce(''); // rm (cleanup)

      const acquirer = new BugreportAcquirer(mockDevice);
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.fileName).toMatch(/\.txt$/); // Legacy usa .txt
      expect((result.data as any).format).toBe('text');
    });
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe('error handling', () => {
    it('should handle device disconnection', async () => {
      (mockDevice.commands.shell as any)
        .mockResolvedValueOnce('/system/bin/bugreportz')
        .mockRejectedValueOnce(new Error('Device disconnected'));

      const acquirer = new BugreportAcquirer(mockDevice);
      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Device disconnected');
    });

    it('should handle timeout', async () => {
      // Mock diretto dell'errore di timeout
      (mockDevice.commands.shell as any)
        .mockResolvedValueOnce('/system/bin/bugreportz')
        .mockRejectedValueOnce(
          new Error('Command "bugreportz" timed out after 180000ms')
        );

      const acquirer = new BugreportAcquirer(mockDevice);
      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/timeout|timed out/i);
    });

    it('should handle shell command errors', async () => {
      (mockDevice.commands.shell as any)
        .mockRejectedValueOnce(new Error('which: command not found'))
        .mockRejectedValueOnce(new Error('Shell error'));

      const acquirer = new BugreportAcquirer(mockDevice);
      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle file read errors', async () => {
      (mockDevice.commands.shell as any)
        .mockResolvedValueOnce('/system/bin/bugreportz')
        .mockResolvedValueOnce('OK:/data/bugreport.zip');

      (mockDevice.commands.readFile as any)
        .mockRejectedValueOnce(new Error('Failed to read file'));

      const acquirer = new BugreportAcquirer(mockDevice);
      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to read file');
    });

    it('should attempt cleanup even when acquisition fails', async () => {
      // Simula un errore durante il download ma dopo la generazione
      (mockDevice.commands.shell as any)
        .mockRejectedValueOnce(new Error('which: bugreportz: not found')) // which fails
        .mockResolvedValueOnce('') // bugreport succeeds
        .mockResolvedValueOnce(''); // cleanup rm succeeds

      (mockDevice.commands.readFile as any)
        .mockRejectedValueOnce(new Error('Read failed'));

      const acquirer = new BugreportAcquirer(mockDevice, {
        cleanupAfter: true
      });

      const result = await acquirer.acquire();

      // L'acquisizione fallisce
      expect(result.success).toBe(false);

      // Ma il cleanup DEVE essere stato tentato (CRITICAL per forensics!)
      expect((result.data as any).cleanupPerformed).toBe(true);

      // Verifica che rm sia stato chiamato
      const shellCalls = (mockDevice.commands.shell as any).mock.calls;
      const rmCall = shellCalls.find((call: any) => call[0] && call[0].includes('rm'));
      expect(rmCall).toBeDefined();
    });

    it('should report when cleanup fails (CRITICAL for forensics)', async () => {
      // Simula cleanup failure
      (mockDevice.commands.shell as any)
        .mockRejectedValueOnce(new Error('which: bugreportz: not found'))
        .mockResolvedValueOnce('') // bugreport succeeds
        .mockRejectedValueOnce(new Error('rm: permission denied')); // cleanup FAILS!

      const acquirer = new BugreportAcquirer(mockDevice, {
        cleanupAfter: true
      });

      const result = await acquirer.acquire();

      // L'acquisizione RIESCE anche se il cleanup fallisce
      expect(result.success).toBe(true);

      // Ma cleanupPerformed DEVE essere false
      expect((result.data as any).cleanupPerformed).toBe(false);
      expect(acquirer.wasCleanupPerformed()).toBe(false);

      // Questo è un caso CRITICO in forensics - il file rimane sul dispositivo!
    });
  });

  // ==========================================================================
  // Progress Reporting Tests
  // ==========================================================================

  describe('progress reporting', () => {
    it('should report initial progress', async () => {
      (mockDevice.commands.shell as any)
        .mockResolvedValueOnce('/system/bin/bugreportz')
        .mockResolvedValueOnce('OK:/data/bugreport.zip');

      const progressCallback = vi.fn();
      const acquirer = new BugreportAcquirer(mockDevice);

      await acquirer.acquire(progressCallback);

      const firstCall = progressCallback.mock.calls[0][0];
      expect(firstCall.progress).toBeGreaterThanOrEqual(0);
      expect(firstCall.message).toBeDefined();
      expect(firstCall.status).toBe('running');
    });

    it('should report completion progress', async () => {
      (mockDevice.commands.shell as any)
        .mockResolvedValueOnce('/system/bin/bugreportz')
        .mockResolvedValueOnce('OK:/data/bugreport.zip');

      const progressCallback = vi.fn();
      const acquirer = new BugreportAcquirer(mockDevice);

      await acquirer.acquire(progressCallback);

      const lastCall = progressCallback.mock.calls[progressCallback.mock.calls.length - 1][0];
      expect(lastCall.progress).toBe(100);
      expect(lastCall.status).toBe('completed');
    });

    it('should report progress updates during generation', async () => {
      (mockDevice.commands.shell as any)
        .mockResolvedValueOnce('/system/bin/bugreportz')
        .mockResolvedValueOnce('OK:/data/bugreport.zip');

      const progressCallback = vi.fn();
      const acquirer = new BugreportAcquirer(mockDevice);

      await acquirer.acquire(progressCallback);

      // Dovrebbe aver chiamato il callback più volte
      expect(progressCallback.mock.calls.length).toBeGreaterThan(3);

      // Il progresso dovrebbe aumentare
      const progresses = progressCallback.mock.calls.map((call: any) => call[0].progress);
      for (let i = 1; i < progresses.length; i++) {
        expect(progresses[i]).toBeGreaterThanOrEqual(progresses[i - 1]);
      }
    });
  });

  // ==========================================================================
  // Configuration Tests
  // ==========================================================================

  describe('configuration', () => {
    it('should respect computeHash config', async () => {
      (mockDevice.commands.shell as any)
        .mockResolvedValueOnce('/system/bin/bugreportz')
        .mockResolvedValueOnce('OK:/data/bugreport.zip');

      const acquirerWithHash = new BugreportAcquirer(mockDevice, {
        computeHash: true
      });

      const resultWithHash = await acquirerWithHash.acquire();
      expect(resultWithHash.hash).toBeDefined();

      // Reset mocks
      vi.clearAllMocks();
      mockDevice = createMockDevice();
      (mockDevice.commands.shell as any)
        .mockResolvedValueOnce('/system/bin/bugreportz')
        .mockResolvedValueOnce('OK:/data/bugreport.zip');

      const acquirerWithoutHash = new BugreportAcquirer(mockDevice, {
        computeHash: false
      });

      const resultWithoutHash = await acquirerWithoutHash.acquire();
      expect(resultWithoutHash.hash).toBeUndefined();
    });

    it('should respect timeout config', async () => {
      (mockDevice.commands.shell as any)
        .mockResolvedValueOnce('/system/bin/bugreportz')
        .mockResolvedValueOnce('OK:/data/bugreport.zip');

      const acquirer = new BugreportAcquirer(mockDevice, {
        timeout: 5000
      });

      // Il test passa se non va in timeout
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
    });

    it('should respect cleanupAfter config', async () => {
      // Test con cleanupAfter=true
      (mockDevice.commands.shell as any)
        .mockRejectedValueOnce(new Error('which: bugreportz: not found'))
        .mockResolvedValueOnce('') // bugreport
        .mockResolvedValueOnce(''); // rm

      const acquirerWithCleanup = new BugreportAcquirer(mockDevice, {
        cleanupAfter: true
      });

      const resultWithCleanup = await acquirerWithCleanup.acquire();
      expect(resultWithCleanup.success).toBe(true);
      expect((resultWithCleanup.data as any).cleanupPerformed).toBe(true);

      // Reset mocks
      vi.clearAllMocks();
      mockDevice = createMockDevice();
      mockDocumentForDownload();

      // Test con cleanupAfter=false (NON raccomandato per forensics!)
      (mockDevice.commands.shell as any)
        .mockRejectedValueOnce(new Error('which: bugreportz: not found'))
        .mockResolvedValueOnce(''); // solo bugreport, NO rm

      const acquirerWithoutCleanup = new BugreportAcquirer(mockDevice, {
        cleanupAfter: false
      });

      const resultWithoutCleanup = await acquirerWithoutCleanup.acquire();
      expect(resultWithoutCleanup.success).toBe(true);
      expect((resultWithoutCleanup.data as any).cleanupPerformed).toBe(false);

      // Verifica che rm NON sia stato chiamato
      const shellCalls = (mockDevice.commands.shell as any).mock.calls;
      const rmCalls = shellCalls.filter((call: any) =>
        call[0] && call[0].includes('rm')
      );
      expect(rmCalls.length).toBe(0);
    });
  });

  // ==========================================================================
  // Metadata Tests
  // ==========================================================================

  describe('metadata', () => {
    it('should include acquisition timestamps', async () => {
      (mockDevice.commands.shell as any)
        .mockResolvedValueOnce('/system/bin/bugreportz')
        .mockResolvedValueOnce('OK:/data/bugreport.zip');

      const beforeStart = new Date();
      const acquirer = new BugreportAcquirer(mockDevice);
      const result = await acquirer.acquire();
      const afterEnd = new Date();

      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
      expect(result.startTime.getTime()).toBeGreaterThanOrEqual(beforeStart.getTime());
      expect(result.endTime.getTime()).toBeLessThanOrEqual(afterEnd.getTime());
    });

    it('should include duration', async () => {
      (mockDevice.commands.shell as any)
        .mockResolvedValueOnce('/system/bin/bugreportz')
        .mockResolvedValueOnce('OK:/data/bugreport.zip');

      const acquirer = new BugreportAcquirer(mockDevice);
      const result = await acquirer.acquire();

      // Duration potrebbe essere 0 in test veloci, quindi >= 0
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.endTime.getTime() - result.startTime.getTime()).toBeGreaterThanOrEqual(result.duration);
    });

    it('should include file size in metadata', async () => {
      (mockDevice.commands.shell as any)
        .mockResolvedValueOnce('/system/bin/bugreportz')
        .mockResolvedValueOnce('OK:/data/bugreport.zip');

      const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      (mockDevice.commands.readFile as any).mockResolvedValue(testData);

      const acquirer = new BugreportAcquirer(mockDevice);
      const result = await acquirer.acquire();

      expect(result.fileSize).toBe(testData.length);
    });
  });

  // ==========================================================================
  // Bugreportz Parsing Tests
  // ==========================================================================

  describe('bugreportz parsing', () => {
    it('should parse valid bugreportz output', async () => {
      (mockDevice.commands.shell as any)
        .mockResolvedValueOnce('/system/bin/bugreportz')
        .mockResolvedValueOnce('OK:/data/user_de/0/com.android.shell/files/bugreports/bugreport-2024-01-09.zip');

      const acquirer = new BugreportAcquirer(mockDevice);
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).format).toBe('zip');
    });

    it('should handle bugreportz output with whitespace', async () => {
      (mockDevice.commands.shell as any)
        .mockResolvedValueOnce('/system/bin/bugreportz')
        .mockResolvedValueOnce('  OK:/data/bugreport.zip  \n');

      const acquirer = new BugreportAcquirer(mockDevice);
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
    });

    it('should handle bugreportz output with extra info', async () => {
      (mockDevice.commands.shell as any)
        .mockResolvedValueOnce('/system/bin/bugreportz')
        .mockResolvedValueOnce('Generating bugreport...\nOK:/data/bugreport.zip\nDone.');

      const acquirer = new BugreportAcquirer(mockDevice);
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
    });
  });
});