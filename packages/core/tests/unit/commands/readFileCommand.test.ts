import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReadFileCommand } from '../../../src/commands';
import { ADBCommandError } from '../../../src/utils/errors';
import { createMockDevice, createMockSync, createMockReadableStream, type MockDevice } from '../../helpers/test-helpers';

describe('ReadFileCommand', () => {
  let device: MockDevice;
  let command: ReadFileCommand;
  let mockSync: ReturnType<typeof createMockSync>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSync = createMockSync();
    device = createMockDevice();
    device.sync.mockResolvedValue(mockSync);
    command = new ReadFileCommand(device as any);
  });

  describe('exec', () => {
    it('should read file content successfully', async () => {
      const fileContent = new TextEncoder().encode('Hello, World!');
      mockSync.read.mockReturnValue(createMockReadableStream(fileContent));

      const result = await command.exec({ path: '/sdcard/test.txt' });

      expect(new TextDecoder().decode(result)).toBe('Hello, World!');
      expect(mockSync.read).toHaveBeenCalledWith('/sdcard/test.txt');
      expect(mockSync.dispose).toHaveBeenCalled();
    });

    it('should read binary file content', async () => {
      const binaryData = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      mockSync.read.mockReturnValue(createMockReadableStream(binaryData));

      const result = await command.exec({ path: '/sdcard/image.png' });

      expect(result).toEqual(binaryData);
      expect(mockSync.read).toHaveBeenCalledWith('/sdcard/image.png');
    });

    it('should read empty file', async () => {
      const emptyData = new Uint8Array(0);
      mockSync.read.mockReturnValue(createMockReadableStream(emptyData));

      const result = await command.exec({ path: '/sdcard/empty.txt' });

      expect(result.length).toBe(0);
      expect(mockSync.dispose).toHaveBeenCalled();
    });

    it('should throw ADBCommandError when file does not exist', async () => {
      mockSync.read.mockImplementation(() => { throw new Error('File not found'); });

      await expect(command.exec({ path: '/invalid/path.txt' })).rejects.toThrow(ADBCommandError);
      await expect(command.exec({ path: '/invalid/path.txt' })).rejects.toThrow(
        /Failed to read file "\/invalid\/path.txt"/
      );
      expect(mockSync.dispose).toHaveBeenCalled();
    });

    it('should throw ADBCommandError on permission denied', async () => {
      mockSync.read.mockImplementation(() => { throw new Error('Permission denied'); });

      await expect(command.exec({ path: '/data/restricted.txt' })).rejects.toThrow(ADBCommandError);
      await expect(command.exec({ path: '/data/restricted.txt' })).rejects.toThrow(/Permission denied/);
    });

    it('should read file with spaces in path', async () => {
      const fileContent = new TextEncoder().encode('content with spaces');
      mockSync.read.mockReturnValue(createMockReadableStream(fileContent));

      const result = await command.exec({ path: '/sdcard/My Documents/file name.txt' });

      expect(new TextDecoder().decode(result)).toBe('content with spaces');
      expect(mockSync.read).toHaveBeenCalledWith('/sdcard/My Documents/file name.txt');
    });

    it('should read large file content', async () => {
      const largeContent = new Uint8Array(1024 * 1024);
      for (let i = 0; i < largeContent.length; i++) largeContent[i] = i % 256;
      mockSync.read.mockReturnValue(createMockReadableStream(largeContent));

      const result = await command.exec({ path: '/sdcard/large.bin' });

      expect(result.length).toBe(1024 * 1024);
    });

    it('should close sync service with dispose method', async () => {
      mockSync.read.mockReturnValue(createMockReadableStream(new TextEncoder().encode('test')));

      await command.exec({ path: '/sdcard/test.txt' });

      expect(mockSync.dispose).toHaveBeenCalled();
      expect(mockSync.close).not.toHaveBeenCalled();
    });

    it('should close sync service with close method if dispose is not available', async () => {
      mockSync.read.mockReturnValue(createMockReadableStream(new TextEncoder().encode('test')));
      delete (mockSync as any).dispose;

      await command.exec({ path: '/sdcard/test.txt' });

      expect(mockSync.close).toHaveBeenCalled();
    });

    it('should handle sync service close errors gracefully', async () => {
      mockSync.read.mockReturnValue(createMockReadableStream(new TextEncoder().encode('test')));
      mockSync.dispose.mockRejectedValue(new Error('Close failed'));

      const result = await command.exec({ path: '/sdcard/test.txt' });

      expect(new TextDecoder().decode(result)).toBe('test');
    });

    it('should close sync service even when read fails', async () => {
      mockSync.read.mockImplementation(() => { throw new Error('Read error'); });

      await expect(command.exec({ path: '/sdcard/fail.txt' })).rejects.toThrow();
      expect(mockSync.dispose).toHaveBeenCalled();
    });
  });
});