import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileAcquirer } from '../../../../src/forensics/acquisition/files';
import {
  createMockDeviceForFileAcquirer,
  createMockDeviceForAcquirer,
  setupAcquirerDOMMocks,
  createMockProgressCallback,
  createMockSync,
  MOCK_FIND_OUTPUT,
  MOCK_STAT_BATCH_OUTPUT,
  readStream,
} from '../../../helpers/test-helpers';
import type { MockDevice } from '../../../helpers/test-helpers';

async function drainAndHash(result: any, fileIndex = 0): Promise<string | undefined> {
  const file = result.files?.[fileIndex] ?? result.files![fileIndex];
  if (!file?.hashPromise) return undefined;
  // Drain the stream so TransformStream.flush() fires and hashPromise resolves
  if (file.stream) {
    const reader = (file.stream as ReadableStream<Uint8Array>).getReader();
    while (!(await reader.read()).done) {}
  }
  return file.hashPromise;
}


describe('FileAcquirer', () => {
  let device: MockDevice;
  let acquirer: FileAcquirer;
  let domMocks: ReturnType<typeof setupAcquirerDOMMocks>;

  beforeEach(() => {
    vi.clearAllMocks();
    device = createMockDeviceForFileAcquirer();
    domMocks = setupAcquirerDOMMocks();
    acquirer = new FileAcquirer(device as any);
  });

  afterEach(() => {
    domMocks.cleanup();
  });

  describe('constructor', () => {
    it('should create instance with default config', () => {
      expect(acquirer).toBeInstanceOf(FileAcquirer);
    });

    it('should create instance with custom config', () => {
      expect(new FileAcquirer(device as any, {
        downloadFiles: true,
        computeFileHashes: true,
        hashAlgorithms: ['sha256'] as ('md5' | 'sha1' | 'sha256' | 'sha512')[],
      })).toBeInstanceOf(FileAcquirer);
    });

    it('should accept additional paths in config', () => {
      expect(new FileAcquirer(device as any, {
        additionalPaths: ['/data/custom', '/mnt/external'],
      })).toBeInstanceOf(FileAcquirer);
    });
  });

  describe('acquire', () => {
    it('should successfully acquire file metadata', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.type).toBe('files');
      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should call device.getProperties to get device info', async () => {
      await acquirer.acquire();
      expect(device.getProperties).toHaveBeenCalled();
    });

    it('should scan default folders for files', async () => {
      await acquirer.acquire();
      expect(device.shell).toHaveBeenCalledWith(expect.stringContaining('find'), expect.anything());
    });

    it('should collect file metadata using stat', async () => {
      await acquirer.acquire();
      expect(device.shell).toHaveBeenCalledWith(expect.stringContaining('stat'), expect.anything());
    });

    it('should report progress during acquisition', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();
      await acquirer.acquire(callback);

      const history = getProgressHistory();
      expect(history.length).toBeGreaterThan(0);
      expect(history[history.length - 1].progress).toBe(100);
      expect(history[history.length - 1].status).toBe('completed');
    });

    it('should include device information in progress callback', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();
      await acquirer.acquire(callback);

      const withDeviceInfo = getProgressHistory().find(p => p.deviceInfo !== undefined);
      expect(withDeviceInfo).toBeDefined();
    });

    it('should create JSON blob with file metadata', async () => {
      const result = await acquirer.acquire();
      expect(result.files[0].stream).toBeInstanceOf(ReadableStream);
      expect(result.files[0].mimeType).toBe('application/json');
    });

    it('should generate correct filename', async () => {
      const result = await acquirer.acquire();
      expect(result.files[0].fileName).toContain('files');
      expect(result.files[0].fileName).toContain('.json');
    });

    it('should include file count in result data', async () => {
      const result = await acquirer.acquire();
      expect(typeof result.data.totalFiles).toBe('number');
      expect(result.data.totalFiles).toBeGreaterThanOrEqual(0);
    });

    it('should include total size in result data', async () => {
      const result = await acquirer.acquire();
      expect(typeof result.data.totalSize).toBe('number');
      expect(result.data.totalSize).toBeGreaterThanOrEqual(0);
    });

    it('should calculate duration correctly', async () => {
      const result = await acquirer.acquire();
      expect(result.duration).toBe(result.endTime.getTime() - result.startTime.getTime());
    });

    it('should handle errors during acquisition', async () => {
      device.getProperties.mockRejectedValueOnce(new Error('File scan failed'));

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.type).toBe('files');
      expect(result.error).toBe('File scan failed');
    });

    it('should handle empty find results', async () => {
      const emptyDevice = createMockDeviceForFileAcquirer({ findOutput: '', statBatchOutput: '' });
      const result = await new FileAcquirer(emptyDevice as any).acquire();

      expect(result.success).toBe(true);
      expect(result.data.totalFiles).toBe(0);
    });

    it('should compute hash when configured', async () => {
      const result = await new FileAcquirer(device as any, { computeHash: true }).acquire();
      expect(result.success).toBe(true);
      expect(await drainAndHash(result, 0)).toBeDefined();
    });

    it('should include hash algorithms in result data when enabled', async () => {
      const result = await new FileAcquirer(device as any, {
        computeFileHashes: true,
        hashAlgorithms: ['sha256'],
      }).acquire();

      expect(result.success).toBe(true);
      expect(result.data.hashAlgorithms).toContain('sha256');
    });

    it('should not include hash algorithms when disabled', async () => {
      const result = await new FileAcquirer(device as any, { computeFileHashes: false }).acquire();
      expect(result.data.hashAlgorithms).toEqual([]);
    });
  });

  describe('file downloading', () => {
    it('should download files when downloadFiles is true', async () => {
      acquirer = new FileAcquirer(device as any, { downloadFiles: true });
      const mockFileContent = new TextEncoder().encode('file content');
      device.sync.mockResolvedValue(createMockSync(mockFileContent));

      const { callback, getProgressHistory } = createMockProgressCallback();
      const result = await acquirer.acquire(callback);

      expect(result.success).toBe(true);
      expect(result.data.downloadedFiles).toBe(true);
      expect(getProgressHistory().some(p => p.message?.includes('Downloading'))).toBe(true);
    });

    it('should not download files when downloadFiles is false', async () => {
      const result = await new FileAcquirer(device as any, { downloadFiles: false }).acquire();

      expect(result.success).toBe(true);
      expect(result.data.downloadedFiles).toBe(false);
    });

    it('should respect maxTotalSize limit when downloading', async () => {
      acquirer = new FileAcquirer(device as any, { downloadFiles: true, maxTotalSize: 1000 });
      device.sync.mockResolvedValue(createMockSync(new TextEncoder().encode('x'.repeat(2000))));

      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
    });

    it('should handle file download errors gracefully', async () => {
      acquirer = new FileAcquirer(device as any, { downloadFiles: true });
      device.sync.mockRejectedValue(new Error('Permission denied'));

      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
    });
  });

  describe('file hashing', () => {
    it('should include filesHashed count when computeFileHashes is true', async () => {
      const result = await new FileAcquirer(device as any, {
        computeFileHashes: true,
        hashAlgorithms: ['sha256'],
      }).acquire();

      expect(result.success).toBe(true);
      expect(result.data.filesHashed).toBeGreaterThanOrEqual(0);
      expect(result.data.hashAlgorithms).toContain('sha256');
    });

    it('should have zero filesHashed when computeFileHashes is false', async () => {
      const result = await new FileAcquirer(device as any, { computeFileHashes: false }).acquire();

      expect(result.data.filesHashed).toBe(0);
      expect(result.data.hashAlgorithms).toEqual([]);
    });

    it('should track total bytes hashed', async () => {
      const result = await new FileAcquirer(device as any, {
        computeFileHashes: true,
        hashAlgorithms: ['sha256'],
      }).acquire();

      expect(typeof result.data.totalBytesHashed).toBe('number');
      expect(result.data.totalBytesHashed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('additional paths', () => {
    it('should scan additional paths when provided', async () => {
      acquirer = new FileAcquirer(device as any, {
        additionalPaths: ['/data/custom', '/mnt/external'],
      });
      await acquirer.acquire();

      expect(device.shell).toHaveBeenCalledWith(expect.stringContaining('find'), expect.anything());
    });
  });

  describe('result metadata', () => {
    it('should include fileName in result', async () => {
      const result = await acquirer.acquire();
      expect(result.files[0].fileName).toContain('files');
      expect(result.files[0].fileName).toContain('.json');
    });

    it('should include fileSize in result', async () => {
      const result = await acquirer.acquire();
      expect(typeof result.files[0].fileSize).toBe('number');
      expect(result.files[0].fileSize).toBeGreaterThan(0);
    });

    it('should include timestamps in result', async () => {
      const result = await acquirer.acquire();
      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
      expect(result.endTime.getTime()).toBeGreaterThanOrEqual(result.startTime.getTime());
    });
  });
});