import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WriteFileCommand } from '../../../../src/adb/commands/';
import { ADBCommandError } from '../../../../src/utils/errors';
import type { Adb } from '@yume-chan/adb';
import { createMockAdb, createMockSync } from './test-helpers';

describe('WriteFileCommand', () => {
  let mockAdb: Adb;
  let command: WriteFileCommand;
  let mockSync: ReturnType<typeof createMockSync>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSync = createMockSync();
  });

  describe('exec', () => {
    it('should write file content successfully', async () => {
      mockAdb = createMockAdb();
      (mockAdb.sync as any).mockResolvedValue(mockSync);
      command = new WriteFileCommand(mockAdb);

      const content = new TextEncoder().encode('Hello, World!');
      await command.exec({ path: '/sdcard/test.txt', content });

      expect(mockSync.write).toHaveBeenCalledWith(
        expect.objectContaining({
          filename: '/sdcard/test.txt',
          file: expect.any(ReadableStream)
        })
      );
      expect(mockSync.dispose).toHaveBeenCalled();
    });

    it('should write binary content', async () => {
      mockAdb = createMockAdb();
      (mockAdb.sync as any).mockResolvedValue(mockSync);
      command = new WriteFileCommand(mockAdb);

      const binaryData = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      await command.exec({ path: '/sdcard/image.png', content: binaryData });

      expect(mockSync.write).toHaveBeenCalledWith(
        expect.objectContaining({
          filename: '/sdcard/image.png'
        })
      );
      expect(mockSync.dispose).toHaveBeenCalled();
    });

    it('should write empty file', async () => {
      mockAdb = createMockAdb();
      (mockAdb.sync as any).mockResolvedValue(mockSync);
      command = new WriteFileCommand(mockAdb);

      const emptyContent = new Uint8Array(0);
      await command.exec({ path: '/sdcard/empty.txt', content: emptyContent });

      expect(mockSync.write).toHaveBeenCalledWith(
        expect.objectContaining({
          filename: '/sdcard/empty.txt'
        })
      );
      expect(mockSync.dispose).toHaveBeenCalled();
    });

    it('should throw ADBCommandError on write failure', async () => {
      mockSync.write.mockRejectedValue(new Error('Write failed'));
      mockAdb = createMockAdb();
      (mockAdb.sync as any).mockResolvedValue(mockSync);
      command = new WriteFileCommand(mockAdb);

      const content = new TextEncoder().encode('test');
      await expect(command.exec({ path: '/sdcard/fail.txt', content })).rejects.toThrow(
        ADBCommandError
      );
      await expect(command.exec({ path: '/sdcard/fail.txt', content })).rejects.toThrow(
        /Failed to write file "\/sdcard\/fail.txt"/
      );
      expect(mockSync.dispose).toHaveBeenCalled();
    });

    it('should throw ADBCommandError on permission denied', async () => {
      mockSync.write.mockRejectedValue(new Error('Permission denied'));
      mockAdb = createMockAdb();
      (mockAdb.sync as any).mockResolvedValue(mockSync);
      command = new WriteFileCommand(mockAdb);

      const content = new TextEncoder().encode('test');
      await expect(command.exec({ path: '/data/restricted.txt', content })).rejects.toThrow(
        ADBCommandError
      );
      await expect(command.exec({ path: '/data/restricted.txt', content })).rejects.toThrow(
        /Permission denied/
      );
    });

    it('should write file with spaces in path', async () => {
      mockAdb = createMockAdb();
      (mockAdb.sync as any).mockResolvedValue(mockSync);
      command = new WriteFileCommand(mockAdb);

      const content = new TextEncoder().encode('content with spaces');
      await command.exec({ path: '/sdcard/My Documents/file name.txt', content });

      expect(mockSync.write).toHaveBeenCalledWith(
        expect.objectContaining({
          filename: '/sdcard/My Documents/file name.txt'
        })
      );
    });

    it('should write large file content', async () => {
      mockAdb = createMockAdb();
      (mockAdb.sync as any).mockResolvedValue(mockSync);
      command = new WriteFileCommand(mockAdb);

      const largeContent = new Uint8Array(1024 * 1024); // 1MB
      for (let i = 0; i < largeContent.length; i++) {
        largeContent[i] = i % 256;
      }

      await command.exec({ path: '/sdcard/large.bin', content: largeContent });

      expect(mockSync.write).toHaveBeenCalled();
      expect(mockSync.dispose).toHaveBeenCalled();
    });

    it('should create ReadableStream with content', async () => {
      mockAdb = createMockAdb();
      (mockAdb.sync as any).mockResolvedValue(mockSync);
      command = new WriteFileCommand(mockAdb);

      const content = new TextEncoder().encode('stream test');
      await command.exec({ path: '/sdcard/stream.txt', content });

      const writeCall = mockSync.write.mock.calls[0][0];
      expect(writeCall.file).toBeInstanceOf(ReadableStream);
    });

    it('should close sync service with dispose method', async () => {
      mockAdb = createMockAdb();
      (mockAdb.sync as any).mockResolvedValue(mockSync);
      command = new WriteFileCommand(mockAdb);

      const content = new TextEncoder().encode('test');
      await command.exec({ path: '/sdcard/test.txt', content });

      expect(mockSync.dispose).toHaveBeenCalled();
      expect(mockSync.close).not.toHaveBeenCalled();
    });

    it('should close sync service with close method if dispose is not available', async () => {
      delete (mockSync as any).dispose;
      mockAdb = createMockAdb();
      (mockAdb.sync as any).mockResolvedValue(mockSync);
      command = new WriteFileCommand(mockAdb);

      const content = new TextEncoder().encode('test');
      await command.exec({ path: '/sdcard/test.txt', content });

      expect(mockSync.close).toHaveBeenCalled();
    });

    it('should handle sync service close errors gracefully', async () => {
      mockSync.dispose.mockRejectedValue(new Error('Close failed'));
      mockAdb = createMockAdb();
      (mockAdb.sync as any).mockResolvedValue(mockSync);
      command = new WriteFileCommand(mockAdb);

      const content = new TextEncoder().encode('test');
      // Should not throw even if close fails
      await expect(command.exec({ path: '/sdcard/test.txt', content })).resolves.not.toThrow();
    });

    it('should close sync service even when write fails', async () => {
      mockSync.write.mockRejectedValue(new Error('Write error'));
      mockAdb = createMockAdb();
      (mockAdb.sync as any).mockResolvedValue(mockSync);
      command = new WriteFileCommand(mockAdb);

      const content = new TextEncoder().encode('test');
      await expect(command.exec({ path: '/sdcard/fail.txt', content })).rejects.toThrow();

      expect(mockSync.dispose).toHaveBeenCalled();
    });

    it('should overwrite existing file', async () => {
      mockAdb = createMockAdb();
      (mockAdb.sync as any).mockResolvedValue(mockSync);
      command = new WriteFileCommand(mockAdb);

      const newContent = new TextEncoder().encode('new content');
      await command.exec({ path: '/sdcard/existing.txt', content: newContent });

      expect(mockSync.write).toHaveBeenCalledWith(
        expect.objectContaining({
          filename: '/sdcard/existing.txt'
        })
      );
    });

    it('should write JSON content', async () => {
      mockAdb = createMockAdb();
      (mockAdb.sync as any).mockResolvedValue(mockSync);
      command = new WriteFileCommand(mockAdb);

      const jsonData = { name: 'test', value: 123 };
      const jsonContent = new TextEncoder().encode(JSON.stringify(jsonData, null, 2));
      await command.exec({ path: '/sdcard/data.json', content: jsonContent });

      expect(mockSync.write).toHaveBeenCalledWith(
        expect.objectContaining({
          filename: '/sdcard/data.json'
        })
      );
    });
  });
});
