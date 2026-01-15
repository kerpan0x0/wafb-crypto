import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReadFileCommand } from '../../../../src/adb/commands/';
import { ADBCommandError } from '../../../../src/utils/errors';
import type { Adb } from '@yume-chan/adb';
import { createMockAdb, createMockSync, createReadableStream } from './test-helpers';

describe('ReadFileCommand', () => {
  let mockAdb: Adb;
  let command: ReadFileCommand;
  let mockSync: ReturnType<typeof createMockSync>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSync = createMockSync();
  });

  describe('exec', () => {
    it('should read file content successfully', async () => {
      const fileContent = new TextEncoder().encode('Hello, World!');
      mockSync.read.mockReturnValue(createReadableStream(fileContent));
      mockAdb = createMockAdb();
      (mockAdb.sync as any).mockResolvedValue(mockSync);
      command = new ReadFileCommand(mockAdb);

      const result = await command.exec({ path: '/sdcard/test.txt' });

      expect(new TextDecoder().decode(result)).toBe('Hello, World!');
      expect(mockSync.read).toHaveBeenCalledWith('/sdcard/test.txt');
      expect(mockSync.dispose).toHaveBeenCalled();
    });

    it('should read binary file content', async () => {
      const binaryData = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      mockSync.read.mockReturnValue(createReadableStream(binaryData));
      mockAdb = createMockAdb();
      (mockAdb.sync as any).mockResolvedValue(mockSync);
      command = new ReadFileCommand(mockAdb);

      const result = await command.exec({ path: '/sdcard/image.png' });

      expect(result).toEqual(binaryData);
      expect(mockSync.read).toHaveBeenCalledWith('/sdcard/image.png');
    });

    it('should read empty file', async () => {
      const emptyData = new Uint8Array(0);
      mockSync.read.mockReturnValue(createReadableStream(emptyData));
      mockAdb = createMockAdb();
      (mockAdb.sync as any).mockResolvedValue(mockSync);
      command = new ReadFileCommand(mockAdb);

      const result = await command.exec({ path: '/sdcard/empty.txt' });

      expect(result.length).toBe(0);
      expect(mockSync.dispose).toHaveBeenCalled();
    });

    it('should throw ADBCommandError when file does not exist', async () => {
      mockSync.read.mockImplementation(() => {
        throw new Error('File not found');
      });
      mockAdb = createMockAdb();
      (mockAdb.sync as any).mockResolvedValue(mockSync);
      command = new ReadFileCommand(mockAdb);

      await expect(command.exec({ path: '/invalid/path.txt' })).rejects.toThrow(ADBCommandError);
      await expect(command.exec({ path: '/invalid/path.txt' })).rejects.toThrow(
        /Failed to read file "\/invalid\/path.txt"/
      );
      expect(mockSync.dispose).toHaveBeenCalled();
    });

    it('should throw ADBCommandError on permission denied', async () => {
      mockSync.read.mockImplementation(() => {
        throw new Error('Permission denied');
      });
      mockAdb = createMockAdb();
      (mockAdb.sync as any).mockResolvedValue(mockSync);
      command = new ReadFileCommand(mockAdb);

      await expect(command.exec({ path: '/data/restricted.txt' })).rejects.toThrow(
        ADBCommandError
      );
      await expect(command.exec({ path: '/data/restricted.txt' })).rejects.toThrow(
        /Permission denied/
      );
    });

    it('should read file with spaces in path', async () => {
      const fileContent = new TextEncoder().encode('content with spaces');
      mockSync.read.mockReturnValue(createReadableStream(fileContent));
      mockAdb = createMockAdb();
      (mockAdb.sync as any).mockResolvedValue(mockSync);
      command = new ReadFileCommand(mockAdb);

      const result = await command.exec({ path: '/sdcard/My Documents/file name.txt' });

      expect(new TextDecoder().decode(result)).toBe('content with spaces');
      expect(mockSync.read).toHaveBeenCalledWith('/sdcard/My Documents/file name.txt');
    });

    it('should read large file content', async () => {
      const largeContent = new Uint8Array(1024 * 1024); // 1MB
      for (let i = 0; i < largeContent.length; i++) {
        largeContent[i] = i % 256;
      }
      mockSync.read.mockReturnValue(createReadableStream(largeContent));
      mockAdb = createMockAdb();
      (mockAdb.sync as any).mockResolvedValue(mockSync);
      command = new ReadFileCommand(mockAdb);

      const result = await command.exec({ path: '/sdcard/large.bin' });

      expect(result.length).toBe(1024 * 1024);
      expect(result[0]).toBe(0);
      expect(result[1023]).toBe(1023 % 256);
    });

    it('should close sync service with dispose method', async () => {
      const fileContent = new TextEncoder().encode('test');
      mockSync.read.mockReturnValue(createReadableStream(fileContent));
      mockAdb = createMockAdb();
      (mockAdb.sync as any).mockResolvedValue(mockSync);
      command = new ReadFileCommand(mockAdb);

      await command.exec({ path: '/sdcard/test.txt' });

      expect(mockSync.dispose).toHaveBeenCalled();
      expect(mockSync.close).not.toHaveBeenCalled();
    });

    it('should close sync service with close method if dispose is not available', async () => {
      const fileContent = new TextEncoder().encode('test');
      mockSync.read.mockReturnValue(createReadableStream(fileContent));
      delete (mockSync as any).dispose;
      mockAdb = createMockAdb();
      (mockAdb.sync as any).mockResolvedValue(mockSync);
      command = new ReadFileCommand(mockAdb);

      await command.exec({ path: '/sdcard/test.txt' });

      expect(mockSync.close).toHaveBeenCalled();
    });

    it('should handle sync service close errors gracefully', async () => {
      const fileContent = new TextEncoder().encode('test');
      mockSync.read.mockReturnValue(createReadableStream(fileContent));
      mockSync.dispose.mockRejectedValue(new Error('Close failed'));
      mockAdb = createMockAdb();
      (mockAdb.sync as any).mockResolvedValue(mockSync);
      command = new ReadFileCommand(mockAdb);

      // Should not throw even if close fails
      const result = await command.exec({ path: '/sdcard/test.txt' });

      expect(new TextDecoder().decode(result)).toBe('test');
    });

    it('should close sync service even when read fails', async () => {
      mockSync.read.mockImplementation(() => {
        throw new Error('Read error');
      });
      mockAdb = createMockAdb();
      (mockAdb.sync as any).mockResolvedValue(mockSync);
      command = new ReadFileCommand(mockAdb);

      await expect(command.exec({ path: '/sdcard/fail.txt' })).rejects.toThrow();

      expect(mockSync.dispose).toHaveBeenCalled();
    });
  });
});
