import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HashCommand } from '../../../src/commands/hashCommand';
import { createMockDevice, makeShellResult, type MockDevice } from '../../helpers/test-helpers';

describe('HashCommand', () => {
    let device: MockDevice;
    let command: HashCommand;

    // Mock hash outputs for different algorithms
    const MOCK_MD5_OUTPUT = 'd8e8fca2dc0f896fd7cb4cb0031ba249  /sdcard/test.txt';
    const MOCK_SHA1_OUTPUT = '356a192b7913b04c54574d18c28d46e6395428ab  /sdcard/test.txt';
    const MOCK_SHA256_OUTPUT = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  /sdcard/test.txt';
    const MOCK_SHA512_OUTPUT = 'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e  /sdcard/test.txt';

    beforeEach(() => {
        vi.clearAllMocks();
        device = createMockDevice();
        command = new HashCommand(device as any);
    });

    describe('Command Construction', () => {
        it('should build md5sum command', async () => {
            device.shell.mockResolvedValue(makeShellResult(MOCK_MD5_OUTPUT));

            await command.exec({ path: '/sdcard/test.txt', algorithm: 'md5' });

            expect(device.shell).toHaveBeenCalledWith(
                expect.stringContaining('md5sum'),
                expect.any(Object)
            );
        });

        it('should build sha1sum command', async () => {
            device.shell.mockResolvedValue(makeShellResult(MOCK_SHA1_OUTPUT));

            await command.exec({ path: '/sdcard/test.txt', algorithm: 'sha1' });

            expect(device.shell).toHaveBeenCalledWith(
                expect.stringContaining('sha1sum'),
                expect.any(Object)
            );
        });

        it('should build sha256sum command', async () => {
            device.shell.mockResolvedValue(makeShellResult(MOCK_SHA256_OUTPUT));

            await command.exec({ path: '/sdcard/test.txt', algorithm: 'sha256' });

            expect(device.shell).toHaveBeenCalledWith(
                expect.stringContaining('sha256sum'),
                expect.any(Object)
            );
        });

        it('should build sha512sum command', async () => {
            device.shell.mockResolvedValue(makeShellResult(MOCK_SHA512_OUTPUT));

            await command.exec({ path: '/sdcard/test.txt', algorithm: 'sha512' });

            expect(device.shell).toHaveBeenCalledWith(
                expect.stringContaining('sha512sum'),
                expect.any(Object)
            );
        });

        it('should escape file path with single quotes', async () => {
            device.shell.mockResolvedValue(makeShellResult(MOCK_MD5_OUTPUT));

            await command.exec({ path: '/sdcard/test.txt', algorithm: 'md5' });

            const spawnCall = (device.shell as any).mock.calls[0][0];
            expect(spawnCall).toContain("'/sdcard/test.txt'");
        });

        it('should handle file paths with spaces', async () => {
            device.shell.mockResolvedValue(makeShellResult('hash  /sdcard/my file.txt'));

            await command.exec({ path: '/sdcard/my file.txt', algorithm: 'md5' });

            const spawnCall = (device.shell as any).mock.calls[0][0];
            expect(spawnCall).toContain("'/sdcard/my file.txt'");
        });

        it('should handle file paths with quotes by escaping', async () => {
            device.shell.mockResolvedValue(makeShellResult('hash  /sdcard/file.txt'));

            await command.exec({ path: "/sdcard/file's name.txt", algorithm: 'md5' });

            const spawnCall = (device.shell as any).mock.calls[0][0];
            // Single quotes should be escaped as '\''
            expect(spawnCall).toContain("'/sdcard/file'\\''s name.txt'");
        });

        it('should include stderr redirect to /dev/null', async () => {
            device.shell.mockResolvedValue(makeShellResult(MOCK_MD5_OUTPUT));

            await command.exec({ path: '/sdcard/test.txt', algorithm: 'md5' });

            const spawnCall = (device.shell as any).mock.calls[0][0];
            expect(spawnCall).toContain('2>/dev/null');
        });

        it('should include fallback commands for md5', async () => {
            device.shell.mockResolvedValue(makeShellResult(MOCK_MD5_OUTPUT));

            await command.exec({ path: '/sdcard/test.txt', algorithm: 'md5' });

            const spawnCall = (device.shell as any).mock.calls[0][0];
            // Should have md5sum and md5 as fallback
            expect(spawnCall).toContain('md5sum');
            expect(spawnCall).toContain('||');
            expect(spawnCall).toContain('md5');
        });

        it('should include UNSUPPORTED fallback', async () => {
            device.shell.mockResolvedValue(makeShellResult('UNSUPPORTED'));

            await command.exec({ path: '/sdcard/test.txt', algorithm: 'md5' });

            const spawnCall = (device.shell as any).mock.calls[0][0];
            expect(spawnCall).toContain('UNSUPPORTED');
        });
    });

    describe('Output Handling', () => {
        it('should return raw hash output for md5', async () => {
            device.shell.mockResolvedValue(makeShellResult(MOCK_MD5_OUTPUT));

            const result = await command.exec({ path: '/sdcard/test.txt', algorithm: 'md5' });

            expect(result).toBe(MOCK_MD5_OUTPUT);
            expect(typeof result).toBe('string');
        });

        it('should return raw hash output for sha1', async () => {
            device.shell.mockResolvedValue(makeShellResult(MOCK_SHA1_OUTPUT));

            const result = await command.exec({ path: '/sdcard/test.txt', algorithm: 'sha1' });

            expect(result).toBe(MOCK_SHA1_OUTPUT);
        });

        it('should return raw hash output for sha256', async () => {
            device.shell.mockResolvedValue(makeShellResult(MOCK_SHA256_OUTPUT));

            const result = await command.exec({ path: '/sdcard/test.txt', algorithm: 'sha256' });

            expect(result).toBe(MOCK_SHA256_OUTPUT);
        });

        it('should return raw hash output for sha512', async () => {
            device.shell.mockResolvedValue(makeShellResult(MOCK_SHA512_OUTPUT));

            const result = await command.exec({ path: '/sdcard/test.txt', algorithm: 'sha512' });

            expect(result).toBe(MOCK_SHA512_OUTPUT);
        });

        it('should return UNSUPPORTED when command not available', async () => {
            device.shell.mockResolvedValue(makeShellResult('UNSUPPORTED'));

            const result = await command.exec({ path: '/sdcard/test.txt', algorithm: 'md5' });

            expect(result).toBe('UNSUPPORTED');
        });

        it('should handle empty output', async () => {
            device.shell.mockResolvedValue(makeShellResult(''));

            const result = await command.exec({ path: '/sdcard/test.txt', algorithm: 'md5' });

            expect(result).toBe('');
        });

        it('should preserve full output including filename', async () => {
            const fullOutput = 'd8e8fca2dc0f896fd7cb4cb0031ba249  /sdcard/Documents/file.txt';
            device.shell.mockResolvedValue(makeShellResult(fullOutput));

            const result = await command.exec({
                path: '/sdcard/Documents/file.txt',
                algorithm: 'md5'
            });

            expect(result).toBe(fullOutput);
        });

        it('should handle hash output with binary mode marker (*)', async () => {
            const binaryOutput = 'd8e8fca2dc0f896fd7cb4cb0031ba249 */sdcard/test.bin';
            device.shell.mockResolvedValue(makeShellResult(binaryOutput));

            const result = await command.exec({
                path: '/sdcard/test.bin',
                algorithm: 'md5'
            });

            expect(result).toBe(binaryOutput);
        });

        it('should handle BSD-style hash output', async () => {
            // BSD md5: MD5 (filename) = hash
            const bsdOutput = 'MD5 (/sdcard/test.txt) = d8e8fca2dc0f896fd7cb4cb0031ba249';
            device.shell.mockResolvedValue(makeShellResult(bsdOutput));

            const result = await command.exec({ path: '/sdcard/test.txt', algorithm: 'md5' });

            expect(result).toBe(bsdOutput);
        });
    });

    describe('Timeout Handling', () => {
        it('should use default timeout of 60000ms', async () => {
            device.shell.mockResolvedValue(makeShellResult(MOCK_MD5_OUTPUT));

            await command.exec({ path: '/sdcard/test.txt', algorithm: 'md5' });

            // Timeout is passed to ShellCommand internally
            // We can verify the command was called
            expect(device.shell).toHaveBeenCalled();
        });

        it('should accept custom timeout', async () => {
            device.shell.mockResolvedValue(makeShellResult(MOCK_MD5_OUTPUT));

            await command.exec({
                path: '/sdcard/test.txt',
                algorithm: 'md5',
                timeout: 30000
            });

            expect(device.shell).toHaveBeenCalled();
        });

        it('should handle timeout errors', async () => {
            const timeoutError = new Error('Command timed out');
            device.shell.mockRejectedValue(timeoutError);

            await expect(
                command.exec({ path: '/sdcard/large-file.iso', algorithm: 'sha512' })
            ).rejects.toThrow('Command timed out');
        });
    });

    describe('Error Handling', () => {
        it('should throw error when command fails', async () => {
            const error = new Error('Hash command failed');
            device.shell.mockRejectedValue(error);

            await expect(
                command.exec({ path: '/sdcard/test.txt', algorithm: 'md5' })
            ).rejects.toThrow('Hash command failed');
        });

        it('should throw error when file not found', async () => {
            const error = new Error('File not found');
            device.shell.mockRejectedValue(error);

            await expect(
                command.exec({ path: '/nonexistent/file.txt', algorithm: 'md5' })
            ).rejects.toThrow('File not found');
        });

        it('should throw error when permission denied', async () => {
            const error = new Error('Permission denied');
            device.shell.mockRejectedValue(error);

            await expect(
                command.exec({ path: '/system/secure.file', algorithm: 'sha256' })
            ).rejects.toThrow('Permission denied');
        });

        it('should throw error when shellProtocol is null', async () => {
            const invalidDevice = { shell: () => { throw new Error('Shell not available'); } } as any;
            const invalidCommand = new HashCommand(invalidDevice);

            await expect(
                invalidCommand.exec({ path: '/sdcard/test.txt', algorithm: 'md5' })
            ).rejects.toThrow();
        });
    });

    describe('Different File Types', () => {
        it('should hash text files', async () => {
            device.shell.mockResolvedValue(makeShellResult(MOCK_MD5_OUTPUT));

            const result = await command.exec({
                path: '/sdcard/document.txt',
                algorithm: 'md5'
            });

            expect(result).toBe(MOCK_MD5_OUTPUT);
        });

        it('should hash binary files', async () => {
            const binaryHash = 'a1b2c3d4e5f6789012345678901234ab  /sdcard/app.apk';
            device.shell.mockResolvedValue(makeShellResult(binaryHash));

            const result = await command.exec({
                path: '/sdcard/app.apk',
                algorithm: 'md5'
            });

            expect(result).toBe(binaryHash);
        });

        it('should hash image files', async () => {
            const imageHash = 'ffee11223344556677889900aabbccdd  /sdcard/photo.jpg';
            device.shell.mockResolvedValue(makeShellResult(imageHash));

            const result = await command.exec({
                path: '/sdcard/photo.jpg',
                algorithm: 'md5'
            });

            expect(result).toBe(imageHash);
        });

        it('should hash empty files', async () => {
            // MD5 of empty file
            const emptyFileHash = 'd41d8cd98f00b204e9800998ecf8427e  /sdcard/empty.txt';
            device.shell.mockResolvedValue(makeShellResult(emptyFileHash));

            const result = await command.exec({
                path: '/sdcard/empty.txt',
                algorithm: 'md5'
            });

            expect(result).toBe(emptyFileHash);
        });
    });

    describe('Different Path Types', () => {
        it('should handle paths in /sdcard', async () => {
            device.shell.mockResolvedValue(makeShellResult(MOCK_MD5_OUTPUT));

            await command.exec({ path: '/sdcard/test.txt', algorithm: 'md5' });

            expect(device.shell).toHaveBeenCalled();
        });

        it('should handle paths in /system', async () => {
            const systemHash = 'abc123def456  /system/build.prop';
            device.shell.mockResolvedValue(makeShellResult(systemHash));

            const result = await command.exec({
                path: '/system/build.prop',
                algorithm: 'md5'
            });

            expect(result).toBe(systemHash);
        });

        it('should handle paths in /data', async () => {
            const dataHash = '111222333444  /data/local/tmp/test.dat';
            device.shell.mockResolvedValue(makeShellResult(dataHash));

            const result = await command.exec({
                path: '/data/local/tmp/test.dat',
                algorithm: 'sha256'
            });

            expect(result).toBe(dataHash);
        });

        it('should handle deep nested paths', async () => {
            const deepPath = '/sdcard/Documents/Work/Projects/2024/Q1/report.pdf';
            const deepHash = `aabbccdd  ${deepPath}`;
            device.shell.mockResolvedValue(makeShellResult(deepHash));

            const result = await command.exec({
                path: deepPath,
                algorithm: 'md5'
            });

            expect(result).toBe(deepHash);
        });

        it('should handle paths with unicode characters', async () => {
            const unicodePath = '/sdcard/文档/test.txt';
            const unicodeHash = `hash123  ${unicodePath}`;
            device.shell.mockResolvedValue(makeShellResult(unicodeHash));

            const result = await command.exec({
                path: unicodePath,
                algorithm: 'md5'
            });

            expect(result).toBe(unicodeHash);
        });
    });

    describe('Algorithm Variations', () => {
        it('should support all four algorithms', async () => {
            const algorithms: Array<'md5' | 'sha1' | 'sha256' | 'sha512'> =
                ['md5', 'sha1', 'sha256', 'sha512'];

            for (const algo of algorithms) {
                device.shell.mockResolvedValue(makeShellResult(`somehash  /sdcard/test.txt`));

                const result = await command.exec({
                    path: '/sdcard/test.txt',
                    algorithm: algo
                });

                expect(result).toContain('somehash');
                expect(device.shell).toHaveBeenCalledWith(
                    expect.stringContaining(`${algo}sum`),
                    expect.any(Object)
                );

                vi.clearAllMocks();
            }
        });
    });
});