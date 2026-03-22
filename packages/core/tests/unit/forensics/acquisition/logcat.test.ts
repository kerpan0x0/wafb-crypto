import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LogcatAcquirer } from '../../../../src/forensics/acquisition/logcat';
import {
  createMockDeviceForAcquirer,
  setupAcquirerDOMMocks,
  createMockProgressCallback,
  makeShellResult,
} from '../../../helpers/test-helpers';
import type { MockDevice } from '../../../helpers/test-helpers';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_LOGCAT = [
  '01-11 10:00:00.123  1234  5678 I ActivityManager: Start proc app',
  '01-11 10:00:01.456  1234  5678 W PackageManager: Warning message',
  '01-11 10:00:02.789  1234  5678 E AndroidRuntime: Fatal exception',
  '01-11 10:00:03.012  1234  5678 D SomeTag: Debug message',
  '01-11 10:00:04.345  1234  5678 V Verbose: Verbose message',
].join('\n');

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LogcatAcquirer', () => {
  let device: MockDevice;
  let acquirer: LogcatAcquirer;
  let domMocks: ReturnType<typeof setupAcquirerDOMMocks>;

  beforeEach(() => {
    vi.clearAllMocks();
    // logcatOutput is used by resolveShellOutput for any command.includes('logcat')
    device = createMockDeviceForAcquirer({ logcatOutput: MOCK_LOGCAT });
    domMocks = setupAcquirerDOMMocks();
    acquirer = new LogcatAcquirer(device as any);
  });

  afterEach(() => {
    domMocks.cleanup();
  });

  describe('acquire', () => {
    it('should successfully acquire logcat', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.type).toBe('logcat');
      expect(result.files[0].fileName).toBe('logcat.txt');
      expect(device.shell).toHaveBeenCalled();
    });

    it('should report progress during acquisition', async () => {
      const { callback, getLastProgress } = createMockProgressCallback();
      await acquirer.acquire(callback);

      expect(callback).toHaveBeenCalled();
      expect(getLastProgress().progress).toBe(100);
      expect(getLastProgress().status).toBe('completed');
    });

    it('should compute hash when configured', async () => {
      const result = await new LogcatAcquirer(device as any, { computeHash: true }).acquire();

      expect(result.success).toBe(true);
      expect(result.files[0].hash).toBeDefined();
    });

    it('should handle empty logcat output', async () => {
      device = createMockDeviceForAcquirer({ logcatOutput: '' });
      const result = await new LogcatAcquirer(device as any).acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).totalLines).toBe(0);
    });
  });

  describe('configuration', () => {
    it('should respect buffer configuration', async () => {
      const result = await new LogcatAcquirer(device as any, { buffer: 'system' }).acquire();
      expect(result.success).toBe(true);
    });

    it('should respect format configuration', async () => {
      const result = await new LogcatAcquirer(device as any, { format: 'brief' }).acquire();
      expect(result.success).toBe(true);
    });

    it('should respect maxLines configuration', async () => {
      const result = await new LogcatAcquirer(device as any, { maxLines: 100 }).acquire();
      expect(result.success).toBe(true);
    });

    it('should respect filter configuration', async () => {
      const result = await new LogcatAcquirer(device as any, { filter: 'ActivityManager:I' }).acquire();
      expect(result.success).toBe(true);
    });

    it('should disable dump mode when configured', async () => {
      const result = await new LogcatAcquirer(device as any, { dumpMode: false }).acquire();
      expect(result.success).toBe(true);
    });

    it('should combine multiple options', async () => {
      const result = await new LogcatAcquirer(device as any, {
        buffer: 'main',
        maxLines: 500,
        filter: '*:W',
      }).acquire();
      expect(result.success).toBe(true);
    });
  });

  describe('log analysis', () => {
    it('should count log lines correctly', async () => {
      expect((await acquirer.acquire()).data.totalLines).toBe(5);
    });

    it('should count errors correctly', async () => {
      expect((await acquirer.acquire()).data.errorCount).toBe(1);
    });

    it('should count warnings correctly', async () => {
      expect((await acquirer.acquire()).data.warningCount).toBe(1);
    });

    it('should handle logs without priority markers', async () => {
      device = createMockDeviceForAcquirer({ logcatOutput: 'Plain log line\nAnother plain line' });
      const result = await new LogcatAcquirer(device as any).acquire();

      expect(result.success).toBe(true);
      expect((result.data as any).totalLines).toBe(2);
    });
  });

  describe('error handling', () => {
    it('should handle logcat command failure', async () => {
      device.shell.mockRejectedValue(new Error('logcat command failed'));
      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toContain('logcat command failed');
    });

    it('should handle device disconnection', async () => {
      device.getProperties.mockRejectedValue(new Error('Device disconnected'));
      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Device disconnected');
    });

    it('should handle timeout', async () => {
      device.shell.mockRejectedValue(new Error('Command timed out'));
      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
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
      expect(typeof result.duration).toBe('number');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should include file size', async () => {
      const result = await acquirer.acquire();
      expect(typeof result.files[0].fileSize).toBe('number');
      expect(result.files[0].fileSize).toBeGreaterThan(0);
    });

    it('should include buffer in data', async () => {
      const result = await new LogcatAcquirer(device as any, { buffer: 'system' }).acquire();
      expect((result.data as any).buffer).toBe('system');
    });

    it('should default to all buffer', async () => {
      expect((await acquirer.acquire()).data.buffer).toBe('all');
    });
  });

  describe('output format', () => {
    it('should include metadata header in output', async () => {
      const text = await (await acquirer.acquire()).files[0].blob!.text();
      expect(text).toContain('# Logcat Acquisition Metadata');
    });

    it('should include JSON metadata section', async () => {
      const text = await (await acquirer.acquire()).files[0].blob!.text();
      expect(text).toContain('METADATA (JSON)');
    });

    it('should include original logcat output section', async () => {
      const text = await (await acquirer.acquire()).files[0].blob!.text();
      expect(text).toContain('LOGCAT OUTPUT');
    });
  });
});