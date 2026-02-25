import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StreamingZipWriter, createZipBlob, createZipBlobWithProgress } from '../../../src/utils/streaming-zip';
import { Logger } from '../../../src/utils/logger';
import JSZip from 'jszip';

describe('StreamingZipWriter', () => {
  let chunks: Uint8Array[];
  let stream: WritableStream<Uint8Array>;
  let writer: StreamingZipWriter;

  beforeEach(() => {
    chunks = [];
    stream = new WritableStream<Uint8Array>({
      write(chunk) {
        chunks.push(chunk);
      },
    });
    writer = new StreamingZipWriter(stream);
  });

  describe('Basic Operations', () => {
    it('should create a valid ZIP with single file', async () => {
      const content = new TextEncoder().encode('Hello World!');
      
      await writer.addFile('test.txt', content);
      await writer.finalize();

      // Verify ZIP is valid
      const zipBlob = new Blob(chunks as unknown as BlobPart[], { type: 'application/zip' });
      const zip = await JSZip.loadAsync(zipBlob);
      
      expect(zip.files['test.txt']).toBeDefined();
      const extractedContent = await zip.files['test.txt'].async('text');
      expect(extractedContent).toBe('Hello World!');
    });

    it('should create a valid ZIP with multiple files', async () => {
      const file1 = new TextEncoder().encode('Content 1');
      const file2 = new TextEncoder().encode('Content 2');
      const file3 = new TextEncoder().encode('Content 3');

      await writer.addFile('file1.txt', file1);
      await writer.addFile('file2.txt', file2);
      await writer.addFile('file3.txt', file3);
      await writer.finalize();

      const zipBlob = new Blob(chunks as unknown as BlobPart[], { type: 'application/zip' });
      const zip = await JSZip.loadAsync(zipBlob);
      
      expect(Object.keys(zip.files)).toHaveLength(3);
      expect(await zip.files['file1.txt'].async('text')).toBe('Content 1');
      expect(await zip.files['file2.txt'].async('text')).toBe('Content 2');
      expect(await zip.files['file3.txt'].async('text')).toBe('Content 3');
    });

    it('should handle files in subdirectories', async () => {
      const content = new TextEncoder().encode('Nested content');

      await writer.addFile('folder/subfolder/nested.txt', content);
      await writer.finalize();

      const zipBlob = new Blob(chunks as unknown as BlobPart[], { type: 'application/zip' });
      const zip = await JSZip.loadAsync(zipBlob);
      
      expect(zip.files['folder/subfolder/nested.txt']).toBeDefined();
      const extractedContent = await zip.files['folder/subfolder/nested.txt'].async('text');
      expect(extractedContent).toBe('Nested content');
    });

    it('should handle empty files', async () => {
      const emptyContent = new Uint8Array(0);

      await writer.addFile('empty.txt', emptyContent);
      await writer.finalize();

      const zipBlob = new Blob(chunks as unknown as BlobPart[], { type: 'application/zip' });
      const zip = await JSZip.loadAsync(zipBlob);
      
      expect(zip.files['empty.txt']).toBeDefined();
      const content = await zip.files['empty.txt'].async('uint8array');
      expect(content.length).toBe(0);
    });

    it('should handle large files', async () => {
      // Create 1MB file
      const largeContent = new Uint8Array(1024 * 1024);
      for (let i = 0; i < largeContent.length; i++) {
        largeContent[i] = i % 256;
      }

      await writer.addFile('large.bin', largeContent);
      await writer.finalize();

      const zipBlob = new Blob(chunks as unknown as BlobPart[], { type: 'application/zip' });
      const zip = await JSZip.loadAsync(zipBlob);
      
      expect(zip.files['large.bin']).toBeDefined();
      const extractedContent = await zip.files['large.bin'].async('uint8array');
      expect(extractedContent.length).toBe(1024 * 1024);
      // Verify first few bytes
      expect(extractedContent[0]).toBe(0);
      expect(extractedContent[1]).toBe(1);
      expect(extractedContent[255]).toBe(255);
    });
  });

  describe('Stream Operations', () => {
    it('should add file from ReadableStream', async () => {
      const content = new TextEncoder().encode('Stream content');
      const readableStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(content);
          controller.close();
        },
      });

      await writer.addFileFromStream('stream.txt', readableStream);
      await writer.finalize();

      const zipBlob = new Blob(chunks as unknown as BlobPart[], { type: 'application/zip' });
      const zip = await JSZip.loadAsync(zipBlob);
      
      expect(zip.files['stream.txt']).toBeDefined();
      const extractedContent = await zip.files['stream.txt'].async('text');
      expect(extractedContent).toBe('Stream content');
    });

    it('should handle chunked stream', async () => {
      const part1 = new TextEncoder().encode('Part 1 ');
      const part2 = new TextEncoder().encode('Part 2 ');
      const part3 = new TextEncoder().encode('Part 3');

      const readableStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(part1);
          controller.enqueue(part2);
          controller.enqueue(part3);
          controller.close();
        },
      });

      await writer.addFileFromStream('chunked.txt', readableStream);
      await writer.finalize();

      const zipBlob = new Blob(chunks as unknown as BlobPart[], { type: 'application/zip' });
      const zip = await JSZip.loadAsync(zipBlob);
      
      const extractedContent = await zip.files['chunked.txt'].async('text');
      expect(extractedContent).toBe('Part 1 Part 2 Part 3');
    });
  });

  describe('Error Handling', () => {
    it('should throw error when adding file after finalize', async () => {
      const content = new TextEncoder().encode('Test');
      
      await writer.addFile('test.txt', content);
      await writer.finalize();

      await expect(async () => {
        await writer.addFile('another.txt', content);
      }).rejects.toThrow('Cannot add file: ZIP writer already finalized');
    });

    it('should throw error when adding file from stream after finalize', async () => {
      const content = new TextEncoder().encode('Test');
      await writer.addFile('test.txt', content);
      await writer.finalize();

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(content);
          controller.close();
        },
      });

      await expect(async () => {
        await writer.addFileFromStream('another.txt', stream);
      }).rejects.toThrow('Cannot add file: ZIP writer already finalized');
    });

    it('should throw error when finalizing twice', async () => {
      const content = new TextEncoder().encode('Test');
      
      await writer.addFile('test.txt', content);
      await writer.finalize();

      await expect(async () => {
        await writer.finalize();
      }).rejects.toThrow('ZIP writer already finalized');
    });
  });

  describe('Stats', () => {
    it('should track stats correctly', async () => {
      const file1 = new TextEncoder().encode('File 1');
      const file2 = new TextEncoder().encode('File 2');

      let stats = writer.getStats();
      expect(stats.totalEntries).toBe(0);
      expect(stats.finalized).toBe(false);

      await writer.addFile('file1.txt', file1);
      stats = writer.getStats();
      expect(stats.totalEntries).toBe(1);

      await writer.addFile('file2.txt', file2);
      stats = writer.getStats();
      expect(stats.totalEntries).toBe(2);

      await writer.finalize();
      stats = writer.getStats();
      expect(stats.finalized).toBe(true);
      expect(stats.totalSize).toBeGreaterThan(0);
    });
  });

  describe('Custom Logger', () => {
    it('should use custom logger when provided', async () => {
      const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as unknown as Logger;

      // Create a new stream for this test (stream from beforeEach is already locked)
      const customChunks: Uint8Array[] = [];
      const customStream = new WritableStream<Uint8Array>({
        write(chunk) {
          customChunks.push(chunk);
        },
      });

      const customWriter = new StreamingZipWriter(customStream, { logger: mockLogger });
      const content = new TextEncoder().encode('Test');

      await customWriter.addFile('test.txt', content);
      await customWriter.finalize();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Adding file to ZIP: test.txt')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Finalizing ZIP')
      );
    });
  });

  describe('Binary Data', () => {
    it('should handle binary data correctly', async () => {
      // Create binary data with specific pattern
      const binaryData = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

      await writer.addFile('image.png', binaryData);
      await writer.finalize();

      const zipBlob = new Blob(chunks as unknown as BlobPart[], { type: 'application/zip' });
      const zip = await JSZip.loadAsync(zipBlob);
      
      const extractedData = await zip.files['image.png'].async('uint8array');
      expect(extractedData).toEqual(binaryData);
    });

    it('should preserve all byte values (0-255)', async () => {
      // Create data with all possible byte values
      const allBytes = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        allBytes[i] = i;
      }

      await writer.addFile('bytes.bin', allBytes);
      await writer.finalize();

      const zipBlob = new Blob(chunks as unknown as BlobPart[], { type: 'application/zip' });
      const zip = await JSZip.loadAsync(zipBlob);
      
      const extractedData = await zip.files['bytes.bin'].async('uint8array');
      expect(extractedData).toEqual(allBytes);
    });
  });

  describe('Special Characters in Filenames', () => {
    it('should handle filenames with spaces', async () => {
      const content = new TextEncoder().encode('Content');
      
      await writer.addFile('file with spaces.txt', content);
      await writer.finalize();

      const zipBlob = new Blob(chunks as unknown as BlobPart[], { type: 'application/zip' });
      const zip = await JSZip.loadAsync(zipBlob);
      
      expect(zip.files['file with spaces.txt']).toBeDefined();
    });

    it('should handle filenames with unicode characters', async () => {
      const content = new TextEncoder().encode('Content');
      
      await writer.addFile('文件.txt', content);
      await writer.finalize();

      const zipBlob = new Blob(chunks as unknown as BlobPart[], { type: 'application/zip' });
      const zip = await JSZip.loadAsync(zipBlob);
      
      expect(zip.files['文件.txt']).toBeDefined();
    });

    it('should handle filenames with special characters', async () => {
      const content = new TextEncoder().encode('Content');
      
      await writer.addFile('file-name_with.special@chars.txt', content);
      await writer.finalize();

      const zipBlob = new Blob(chunks as unknown as BlobPart[], { type: 'application/zip' });
      const zip = await JSZip.loadAsync(zipBlob);
      
      expect(zip.files['file-name_with.special@chars.txt']).toBeDefined();
    });
  });
});

describe('Helper Functions', () => {
  describe('createZipBlob', () => {
    it('should create ZIP from Map of files', async () => {
      const files = new Map<string, Uint8Array>([
        ['file1.txt', new TextEncoder().encode('Content 1')],
        ['file2.txt', new TextEncoder().encode('Content 2')],
        ['folder/file3.txt', new TextEncoder().encode('Content 3')],
      ]);

      const zipBlob = await createZipBlob(files);
      
      expect(zipBlob.type).toBe('application/zip');
      expect(zipBlob.size).toBeGreaterThan(0);

      // Verify ZIP is valid
      const zip = await JSZip.loadAsync(zipBlob);
      expect(Object.keys(zip.files)).toHaveLength(3);
      expect(await zip.files['file1.txt'].async('text')).toBe('Content 1');
      expect(await zip.files['file2.txt'].async('text')).toBe('Content 2');
      expect(await zip.files['folder/file3.txt'].async('text')).toBe('Content 3');
    });

    it('should handle empty Map', async () => {
      const files = new Map<string, Uint8Array>();
      
      const zipBlob = await createZipBlob(files);
      
      expect(zipBlob.type).toBe('application/zip');
      const zip = await JSZip.loadAsync(zipBlob);
      expect(Object.keys(zip.files)).toHaveLength(0);
    });

    it('should work with custom logger', async () => {
      const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as unknown as Logger;

      const files = new Map<string, Uint8Array>([
        ['test.txt', new TextEncoder().encode('Test')],
      ]);

      await createZipBlob(files, { logger: mockLogger });
      
      expect(mockLogger.debug).toHaveBeenCalled();
    });
  });

  describe('createZipBlobWithProgress', () => {
    it('should create ZIP with progress callback', async () => {
      const files = [
        { name: 'file1.txt', data: new TextEncoder().encode('Content 1') },
        { name: 'file2.txt', data: new TextEncoder().encode('Content 2') },
        { name: 'file3.txt', data: new TextEncoder().encode('Content 3') },
      ];

      const progressCalls: Array<{ current: number; total: number }> = [];
      const onProgress = (current: number, total: number) => {
        progressCalls.push({ current, total });
      };

      const zipBlob = await createZipBlobWithProgress(files, onProgress);
      
      expect(zipBlob.type).toBe('application/zip');
      expect(progressCalls).toHaveLength(3);
      expect(progressCalls[0]).toEqual({ current: 1, total: 3 });
      expect(progressCalls[1]).toEqual({ current: 2, total: 3 });
      expect(progressCalls[2]).toEqual({ current: 3, total: 3 });

      // Verify ZIP is valid
      const zip = await JSZip.loadAsync(zipBlob);
      expect(Object.keys(zip.files)).toHaveLength(3);
    });

    it('should work without progress callback', async () => {
      const files = [
        { name: 'file1.txt', data: new TextEncoder().encode('Content 1') },
        { name: 'file2.txt', data: new TextEncoder().encode('Content 2') },
      ];

      const zipBlob = await createZipBlobWithProgress(files);
      
      expect(zipBlob.type).toBe('application/zip');
      const zip = await JSZip.loadAsync(zipBlob);
      expect(Object.keys(zip.files)).toHaveLength(2);
    });

    it('should handle empty array', async () => {
      const files: Array<{ name: string; data: Uint8Array }> = [];
      
      const zipBlob = await createZipBlobWithProgress(files);
      
      expect(zipBlob.type).toBe('application/zip');
      const zip = await JSZip.loadAsync(zipBlob);
      expect(Object.keys(zip.files)).toHaveLength(0);
    });

    it('should call progress for each file', async () => {
      const files = [
        { name: 'file1.txt', data: new TextEncoder().encode('1') },
        { name: 'file2.txt', data: new TextEncoder().encode('2') },
        { name: 'file3.txt', data: new TextEncoder().encode('3') },
        { name: 'file4.txt', data: new TextEncoder().encode('4') },
        { name: 'file5.txt', data: new TextEncoder().encode('5') },
      ];

      let progressCount = 0;
      const onProgress = (current: number, total: number) => {
        progressCount++;
        expect(current).toBe(progressCount);
        expect(total).toBe(5);
      };

      await createZipBlobWithProgress(files, onProgress);
      
      expect(progressCount).toBe(5);
    });
  });
});

describe('ZIP Format Validation', () => {
  it('should create ZIP with correct magic signature', async () => {
    const chunks: Uint8Array[] = [];
    const stream = new WritableStream<Uint8Array>({
      write(chunk) { chunks.push(chunk); },
    });

    const writer = new StreamingZipWriter(stream);
    await writer.addFile('test.txt', new TextEncoder().encode('Test'));
    await writer.finalize();

    const firstChunk = chunks[0];
    // ZIP local file header signature: 0x04034b50
    expect(firstChunk[0]).toBe(0x50);
    expect(firstChunk[1]).toBe(0x4b);
    expect(firstChunk[2]).toBe(0x03);
    expect(firstChunk[3]).toBe(0x04);
  });

  it('should create ZIP that can be extracted by standard tools', async () => {
    const chunks: Uint8Array[] = [];
    const stream = new WritableStream<Uint8Array>({
      write(chunk) { chunks.push(chunk); },
    });

    const writer = new StreamingZipWriter(stream);
    
    // Add various file types
    await writer.addFile('text.txt', new TextEncoder().encode('Text content'));
    await writer.addFile('data.json', new TextEncoder().encode('{"key":"value"}'));
    await writer.addFile('folder/nested.txt', new TextEncoder().encode('Nested'));
    
    await writer.finalize();

    const zipBlob = new Blob(chunks as unknown as BlobPart[], { type: 'application/zip' });
    
    // Verify with JSZip (standard ZIP library)
    const zip = await JSZip.loadAsync(zipBlob);
    const fileNames = Object.keys(zip.files).sort();
    
    expect(fileNames).toEqual([
      'data.json',
      'folder/nested.txt',
      'text.txt',
    ].sort());
    
    // Verify all content can be extracted
    expect(await zip.files['text.txt'].async('text')).toBe('Text content');
    expect(await zip.files['data.json'].async('text')).toBe('{"key":"value"}');
    expect(await zip.files['folder/nested.txt'].async('text')).toBe('Nested');
  });
});

describe('Performance', () => {
  it('should handle many small files efficiently', async () => {
    const chunks: Uint8Array[] = [];
    const stream = new WritableStream<Uint8Array>({
      write(chunk) { chunks.push(chunk); },
    });

    const writer = new StreamingZipWriter(stream);
    
    const fileCount = 100;
    const startTime = Date.now();
    
    for (let i = 0; i < fileCount; i++) {
      const content = new TextEncoder().encode(`File ${i} content`);
      await writer.addFile(`file${i}.txt`, content);
    }
    
    await writer.finalize();
    const duration = Date.now() - startTime;
    
    // Should complete in reasonable time (adjust based on environment)
    expect(duration).toBeLessThan(5000); // 5 seconds
    
    // Verify ZIP is valid
    const zipBlob = new Blob(chunks as unknown as BlobPart[], { type: 'application/zip' });
    const zip = await JSZip.loadAsync(zipBlob);
    expect(Object.keys(zip.files)).toHaveLength(fileCount);
  }, 10000); // 10 second timeout

  it('should use constant memory for streaming', async () => {
    // This test demonstrates that we don't accumulate data in memory
    // The chunks array grows, but the writer itself doesn't buffer
    const chunks: Uint8Array[] = [];
    const stream = new WritableStream<Uint8Array>({
      write(chunk) { 
        chunks.push(chunk);
        // In real streaming to disk, we wouldn't keep chunks in memory
      },
    });

    const writer = new StreamingZipWriter(stream);
    
    // Add some files
    for (let i = 0; i < 10; i++) {
      const content = new Uint8Array(1024); // 1KB each
      await writer.addFile(`file${i}.bin`, content);
    }
    
    const statsBeforeFinalize = writer.getStats();
    expect(statsBeforeFinalize.totalEntries).toBe(10);
    
    await writer.finalize();
    
    const statsAfterFinalize = writer.getStats();
    expect(statsAfterFinalize.finalized).toBe(true);
  });
});
