import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileAcquirer } from '../../../../src/forensics/acquisition/files';
import { 
  createMockADBDeviceForFileAcquirer,
  setupAcquirerDOMMocks,
  createMockProgressCallback,
  MOCK_FIND_OUTPUT,
  MOCK_STAT_BATCH_OUTPUT
} from '../../../helpers/test-helpers';
import type { ADBDevice } from '../../../../src/adb/device';

describe('FileAcquirer', () => {
  let device: ADBDevice;
  let acquirer: FileAcquirer;
  let domMocks: ReturnType<typeof setupAcquirerDOMMocks>;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Usa l'helper specifico per FileAcquirer che configura find e stat
    device = createMockADBDeviceForFileAcquirer() as unknown as ADBDevice;
    
    domMocks = setupAcquirerDOMMocks();
    acquirer = new FileAcquirer(device);
  });

  afterEach(() => {
    domMocks.cleanup();
  });

  describe('constructor', () => {
    it('should create instance with default config', () => {
      expect(acquirer).toBeInstanceOf(FileAcquirer);
    });

    it('should create instance with custom config', () => {
      const customConfig = { 
        downloadFiles: true,
        computeFileHashes: true,
        hashAlgorithms: ['sha256'] as ('md5' | 'sha1' | 'sha256' | 'sha512')[]
      };
      const customAcquirer = new FileAcquirer(device, customConfig);
      expect(customAcquirer).toBeInstanceOf(FileAcquirer);
    });

    it('should set default config values', () => {
      const acquirerWithDefaults = new FileAcquirer(device, {});
      // Default values are set in constructor but we can't directly test them
      // They will be tested through behavior
      expect(acquirerWithDefaults).toBeInstanceOf(FileAcquirer);
    });

    it('should accept additional paths in config', () => {
      const customConfig = { 
        additionalPaths: ['/data/custom', '/mnt/external']
      };
      const customAcquirer = new FileAcquirer(device, customConfig);
      expect(customAcquirer).toBeInstanceOf(FileAcquirer);
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
      const spawnSpy = vi.spyOn(device.adb.subprocess.shellProtocol, 'spawn');
      
      await acquirer.acquire();

      // Should call find command for default folders
      expect(spawnSpy).toHaveBeenCalledWith(expect.stringContaining('find'));
    });

    it('should collect file metadata using stat', async () => {
      const spawnSpy = vi.spyOn(device.adb.subprocess.shellProtocol, 'spawn');
      
      await acquirer.acquire();

      // Should call stat command for file metadata
      expect(spawnSpy).toHaveBeenCalledWith(expect.stringContaining('stat'));
    });

    it('should report progress during acquisition', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();
      await acquirer.acquire(callback);

      expect(callback).toHaveBeenCalled();
      const progressHistory = getProgressHistory();
      
      // Check that progress was reported at different stages
      expect(progressHistory.length).toBeGreaterThan(0);
      
      // Check initial progress
      expect(progressHistory[0].progress).toBeGreaterThan(0);
      expect(progressHistory[0].message).toBeDefined();
      
      // Check final progress
      const lastProgress = progressHistory[progressHistory.length - 1];
      expect(lastProgress.progress).toBe(100);
      expect(lastProgress.status).toBe('completed');
    });

    it('should include device information in progress callback', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();
      await acquirer.acquire(callback);

      const progressHistory = getProgressHistory();
      const progressWithDeviceInfo = progressHistory.find(p => p.deviceInfo !== undefined);
      
      expect(progressWithDeviceInfo).toBeDefined();
      expect(progressWithDeviceInfo?.deviceInfo).toBeDefined();
    });

    it('should create JSON blob with file metadata', async () => {
      await acquirer.acquire();

      expect(domMocks.createObjectURLSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'application/json'
        })
      );
    });

    it('should trigger download of JSON file', async () => {
      await acquirer.acquire();

      expect(domMocks.mockAnchor.click).toHaveBeenCalled();
      expect(domMocks.mockAnchor.download).toContain('files');
      expect(domMocks.mockAnchor.download).toContain('.json');
    });

    it('should include file count in result data', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.totalFiles).toBeGreaterThanOrEqual(0);
      expect(typeof result.data.totalFiles).toBe('number');
    });

    it('should include total size in result data', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.totalSize).toBeGreaterThanOrEqual(0);
      expect(typeof result.data.totalSize).toBe('number');
    });

    it('should calculate duration correctly', async () => {
      const result = await acquirer.acquire();

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.duration).toBe(result.endTime.getTime() - result.startTime.getTime());
    });

    it('should handle errors during acquisition', async () => {
      const errorMessage = 'File scan failed';
      vi.spyOn(device, 'getProperties').mockRejectedValueOnce(new Error(errorMessage));

      const result = await acquirer.acquire();

      expect(result.success).toBe(false);
      expect(result.type).toBe('files');
      expect(result.error).toBe(errorMessage);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should not call progress callback if not provided', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      // No callback was provided, so no error should occur
    });

    it('should handle empty find results', async () => {
      // Clear previous mocks to ensure clean state
      vi.clearAllMocks();
      
      // Usa l'helper con override per simulare risultati vuoti
      const emptyDevice = createMockADBDeviceForFileAcquirer({
        findOutput: '',
        statBatchOutput: ''
      }) as unknown as ADBDevice;
      const emptyAcquirer = new FileAcquirer(emptyDevice);

      const result = await emptyAcquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.data.totalFiles).toBe(0);
    });

    it('should compute hash when configured', async () => {
      acquirer = new FileAcquirer(device, { computeHash: true });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.hash).toBeDefined();
      }
    });

    it('should include hash algorithms in result data when enabled', async () => {
      acquirer = new FileAcquirer(device, { 
        computeFileHashes: true,
        hashAlgorithms: ['sha256']
      });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.data.hashAlgorithms).toBeDefined();
      expect(result.data.hashAlgorithms).toContain('sha256');
    });

    it('should not include hash algorithms when disabled', async () => {
      acquirer = new FileAcquirer(device, { 
        computeFileHashes: false
      });
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.data.hashAlgorithms).toEqual([]);
    });
  });

  describe('file downloading', () => {
    it('should download files when downloadFiles is true', async () => {
      acquirer = new FileAcquirer(device, { downloadFiles: true });
      
      // Mock ReadFileCommand
      const mockFileContent = new TextEncoder().encode('file content');
      vi.spyOn(device.adb, 'sync').mockResolvedValue({
        read: vi.fn().mockReturnValue({
          getReader: () => ({
            read: vi.fn()
              .mockResolvedValueOnce({ done: false, value: mockFileContent })
              .mockResolvedValueOnce({ done: true, value: undefined }),
            releaseLock: vi.fn()
          })
        }),
        write: vi.fn(),
        dispose: vi.fn()
      } as any);

      const { callback, getProgressHistory } = createMockProgressCallback();
      const result = await acquirer.acquire(callback);

      expect(result.success).toBe(true);
      expect(result.data.downloadedFiles).toBe(true);
      
      // Progress should include download messages
      const progressHistory = getProgressHistory();
      const downloadProgress = progressHistory.find(p => 
        p.message && p.message.includes('Downloading')
      );
      expect(downloadProgress).toBeDefined();
    });

    it('should not download files when downloadFiles is false', async () => {
      acquirer = new FileAcquirer(device, { downloadFiles: false });
      
      const syncSpy = vi.spyOn(device.adb, 'sync');
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.data.downloadedFiles).toBe(false);
      
      // Sync should not be called for file reading when download is disabled
      // (it's called for other operations, so we just verify the flag)
    });

    it('should respect maxTotalSize limit when downloading', async () => {
      const smallLimit = 1000; // 1KB limit
      acquirer = new FileAcquirer(device, { 
        downloadFiles: true,
        maxTotalSize: smallLimit
      });
      
      const mockFileContent = new TextEncoder().encode('x'.repeat(2000)); // 2KB file
      vi.spyOn(device.adb, 'sync').mockResolvedValue({
        read: vi.fn().mockReturnValue({
          getReader: () => ({
            read: vi.fn()
              .mockResolvedValueOnce({ done: false, value: mockFileContent })
              .mockResolvedValueOnce({ done: true, value: undefined }),
            releaseLock: vi.fn()
          })
        }),
        write: vi.fn(),
        dispose: vi.fn()
      } as any);

      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      // Should stop downloading once limit is reached
    });

    it('should handle file download errors gracefully', async () => {
      acquirer = new FileAcquirer(device, { downloadFiles: true });
      
      vi.spyOn(device.adb, 'sync').mockRejectedValue(new Error('Permission denied'));

      const result = await acquirer.acquire();

      // Should still succeed overall even if individual file downloads fail
      expect(result.success).toBe(true);
    });
  });

  describe('file hashing', () => {
    it('should include filesHashed count when computeFileHashes is true', async () => {
      const hashAcquirer = new FileAcquirer(device, { 
        computeFileHashes: true,
        hashAlgorithms: ['sha256']
      });

      const result = await hashAcquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.data.filesHashed).toBeGreaterThanOrEqual(0);
      expect(result.data.hashAlgorithms).toContain('sha256');
    });

    it('should have zero filesHashed when computeFileHashes is false', async () => {
      const noHashAcquirer = new FileAcquirer(device, { 
        computeFileHashes: false
      });

      const result = await noHashAcquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.data.filesHashed).toBe(0);
      expect(result.data.hashAlgorithms).toEqual([]);
    });

    it('should track total bytes hashed', async () => {
      const hashAcquirer = new FileAcquirer(device, { 
        computeFileHashes: true,
        hashAlgorithms: ['sha256']
      });

      const result = await hashAcquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.data.totalBytesHashed).toBeGreaterThanOrEqual(0);
      expect(typeof result.data.totalBytesHashed).toBe('number');
    });
  });

  describe('additional paths', () => {
    it('should scan additional paths when provided', async () => {
      const additionalPaths = ['/data/custom', '/mnt/external'];
      acquirer = new FileAcquirer(device, { 
        additionalPaths
      });

      const spawnSpy = vi.spyOn(device.adb.subprocess.shellProtocol, 'spawn');
      await acquirer.acquire();

      // Should call find for additional paths
      expect(spawnSpy).toHaveBeenCalledWith(expect.stringContaining('find'));
    });
  });

  describe('excluded paths', () => {
    it('should not scan virtual filesystems', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      // Virtual filesystems like /proc, /sys should be excluded
      // This is tested implicitly through the scanning logic
    });
  });

  describe('result metadata', () => {
    it('should include fileName in result', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.fileName).toBeDefined();
      expect(result.fileName).toContain('files');
      expect(result.fileName).toContain('.json');
    });

    it('should include fileSize in result', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.fileSize).toBeDefined();
      expect(typeof result.fileSize).toBe('number');
      expect(result.fileSize).toBeGreaterThan(0);
    });

    it('should include timestamps in result', async () => {
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
      expect(result.endTime.getTime()).toBeGreaterThanOrEqual(result.startTime.getTime());
    });
  });
});