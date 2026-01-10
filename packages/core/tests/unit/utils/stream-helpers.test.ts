import { describe, it, expect, vi } from 'vitest';
import {
  readStreamAsText,
  readStreamAsBytes,
  concatUint8Arrays,
  retry
} from '../../../src/utils/stream-helpers';

describe('Stream Helpers', () => {
  describe('readStreamAsText', () => {
    it('should read stream and return text', async () => {
      const mockStream = {
        getReader: () => ({
          read: vi.fn()
            .mockResolvedValueOnce({ 
              done: false, 
              value: new TextEncoder().encode('Hello ') 
            })
            .mockResolvedValueOnce({ 
              done: false, 
              value: new TextEncoder().encode('World') 
            })
            .mockResolvedValueOnce({ 
              done: true, 
              value: undefined 
            }),
          releaseLock: vi.fn()
        })
      };

      const result = await readStreamAsText(mockStream);
      expect(result).toBe('Hello World');
    });

    it('should handle empty stream', async () => {
      const mockStream = {
        getReader: () => ({
          read: vi.fn().mockResolvedValueOnce({ done: true, value: undefined }),
          releaseLock: vi.fn()
        })
      };

      const result = await readStreamAsText(mockStream);
      expect(result).toBe('');
    });

    it('should handle wrapped values', async () => {
      const mockStream = {
        getReader: () => ({
          read: vi.fn()
            .mockResolvedValueOnce({ 
              done: false, 
              value: { value: new TextEncoder().encode('wrapped') }
            })
            .mockResolvedValueOnce({ 
              done: true, 
              value: undefined 
            }),
          releaseLock: vi.fn()
        })
      };

      const result = await readStreamAsText(mockStream);
      expect(result).toBe('wrapped');
    });
  });

  describe('readStreamAsBytes', () => {
    it('should read stream and return Uint8Array', async () => {
      const chunk1 = new Uint8Array([1, 2, 3]);
      const chunk2 = new Uint8Array([4, 5, 6]);

      const mockStream = {
        getReader: () => ({
          read: vi.fn()
            .mockResolvedValueOnce({ done: false, value: chunk1 })
            .mockResolvedValueOnce({ done: false, value: chunk2 })
            .mockResolvedValueOnce({ done: true, value: undefined }),
          releaseLock: vi.fn()
        })
      };

      const result = await readStreamAsBytes(mockStream);
      expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
    });

    it('should handle empty stream', async () => {
      const mockStream = {
        getReader: () => ({
          read: vi.fn().mockResolvedValueOnce({ done: true, value: undefined }),
          releaseLock: vi.fn()
        })
      };

      const result = await readStreamAsBytes(mockStream);
      expect(result).toEqual(new Uint8Array([]));
    });
  });

  describe('concatUint8Arrays', () => {
    it('should concatenate multiple arrays', () => {
      const arrays = [
        new Uint8Array([1, 2]),
        new Uint8Array([3, 4, 5]),
        new Uint8Array([6])
      ];

      const result = concatUint8Arrays(arrays);
      expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
    });

    it('should handle empty array list', () => {
      const result = concatUint8Arrays([]);
      expect(result).toEqual(new Uint8Array([]));
    });

    it('should handle single array', () => {
      const result = concatUint8Arrays([new Uint8Array([1, 2, 3])]);
      expect(result).toEqual(new Uint8Array([1, 2, 3]));
    });
  });

  describe('retry', () => {
    it('should succeed on first attempt', async () => {
      const operation = vi.fn().mockResolvedValue('success');
      
      const result = await retry(operation, {
        attempts: 3,
        delay: 10
      });

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValueOnce('success');

      const result = await retry(operation, {
        attempts: 3,
        delay: 10
      });

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should throw last error after all attempts', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('persistent failure'));

      await expect(
        retry(operation, { attempts: 3, delay: 10 })
      ).rejects.toThrow('persistent failure');

      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should call onRetry callback', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce('success');

      const onRetry = vi.fn();

      await retry(operation, {
        attempts: 3,
        delay: 10,
        onRetry
      });

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
    });

    it('should wait between retries', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce('success');

      const start = Date.now();
      
      await retry(operation, {
        attempts: 3,
        delay: 50
      });

      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(45); // Con un po' di tolleranza
    });
  });
});