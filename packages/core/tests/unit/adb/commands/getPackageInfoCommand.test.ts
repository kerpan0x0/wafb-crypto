import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GetPackageInfoCommand } from '../../../../src/adb/commands/';
import type { Adb } from '@yume-chan/adb';
import { createMockAdb, createMockShellSocket, MOCK_PACKAGE_INFO } from './test-helpers';

describe('GetPackageInfoCommand', () => {
  let mockAdb: Adb;
  let command: GetPackageInfoCommand;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('exec', () => {
    it('should parse package information correctly', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_PACKAGE_INFO));
      command = new GetPackageInfoCommand(mockAdb);

      const result = await command.exec({ packageName: 'com.example.app' });

      expect(result).not.toBeNull();
      expect(result?.packageName).toBe('com.example.app');
      expect(result?.versionName).toBe('1.0.0');
      expect(result?.versionCode).toBe('100');
      expect(result?.targetSdk).toBe(33);
      expect(result?.minSdk).toBe(21);
    });

    it('should parse install times correctly', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_PACKAGE_INFO));
      command = new GetPackageInfoCommand(mockAdb);

      const result = await command.exec({ packageName: 'com.example.app' });

      // Times are parsed as the first word only (date part)
      expect(result?.firstInstallTime).toBe('2025-01-10');
      expect(result?.lastUpdateTime).toBe('2025-01-15');
    });

    it('should parse install location correctly', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_PACKAGE_INFO));
      command = new GetPackageInfoCommand(mockAdb);

      const result = await command.exec({ packageName: 'com.example.app' });

      expect(result?.installLocation).toBe('/data/app/com.example.app-hash');
    });

    it('should extract permissions when includePermissions is true', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_PACKAGE_INFO));
      command = new GetPackageInfoCommand(mockAdb);

      const result = await command.exec(
        { packageName: 'com.example.app' },
        { includePermissions: true }
      );

      expect(result?.permissions).toBeDefined();
      expect(result?.permissions).toContain('android.permission.INTERNET');
      expect(result?.permissions).toContain('android.permission.ACCESS_NETWORK_STATE');
      expect(result?.permissions).toContain('android.permission.CAMERA');
      expect(result?.permissions?.length).toBe(3);
    });

    it('should not extract permissions when includePermissions is false', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_PACKAGE_INFO));
      command = new GetPackageInfoCommand(mockAdb);

      const result = await command.exec(
        { packageName: 'com.example.app' },
        { includePermissions: false }
      );

      expect(result?.permissions).toBeUndefined();
    });

    it('should return null for non-existent package', async () => {
      mockAdb = createMockAdb(createMockShellSocket(''));
      command = new GetPackageInfoCommand(mockAdb);

      const result = await command.exec({ packageName: 'com.nonexistent.app' });

      expect(result).toBeNull();
    });

    it('should return null when dumpsys fails', async () => {
      mockAdb = createMockAdb();
      (mockAdb.subprocess.shellProtocol.spawn as any).mockRejectedValue(
        new Error('Package not found')
      );
      command = new GetPackageInfoCommand(mockAdb);

      const result = await command.exec({ packageName: 'com.example.app' });

      expect(result).toBeNull();
    });

    it('should handle package without targetSdk', async () => {
      const packageInfoWithoutTargetSdk = MOCK_PACKAGE_INFO.replace('targetSdk=33', '');
      mockAdb = createMockAdb(createMockShellSocket(packageInfoWithoutTargetSdk));
      command = new GetPackageInfoCommand(mockAdb);

      const result = await command.exec({ packageName: 'com.example.app' });

      expect(result?.targetSdk).toBeUndefined();
      expect(result?.minSdk).toBe(21);
    });

    it('should handle package without minSdk', async () => {
      const packageInfoWithoutMinSdk = MOCK_PACKAGE_INFO.replace('minSdk=21', '');
      mockAdb = createMockAdb(createMockShellSocket(packageInfoWithoutMinSdk));
      command = new GetPackageInfoCommand(mockAdb);

      const result = await command.exec({ packageName: 'com.example.app' });

      expect(result?.minSdk).toBeUndefined();
      expect(result?.targetSdk).toBe(33);
    });

    it('should use custom timeout', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_PACKAGE_INFO));
      command = new GetPackageInfoCommand(mockAdb);

      await command.exec({ packageName: 'com.example.app' }, { timeout: 15000 });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        'dumpsys package com.example.app'
      );
    });

    it('should use default timeout of 10000ms', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_PACKAGE_INFO));
      command = new GetPackageInfoCommand(mockAdb);

      await command.exec({ packageName: 'com.example.app' });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        'dumpsys package com.example.app'
      );
    });

    it('should handle package with version name containing spaces', async () => {
      const packageInfoWithSpaces = MOCK_PACKAGE_INFO.replace(
        'versionName=1.0.0',
        'versionName=1.0.0 Beta'
      );
      mockAdb = createMockAdb(createMockShellSocket(packageInfoWithSpaces));
      command = new GetPackageInfoCommand(mockAdb);

      const result = await command.exec({ packageName: 'com.example.app' });

      // Should only capture up to the first space
      expect(result?.versionName).toBe('1.0.0');
    });

    it('should handle package with missing versionName', async () => {
      const packageInfoWithoutVersion = MOCK_PACKAGE_INFO.replace('versionName=1.0.0', '');
      mockAdb = createMockAdb(createMockShellSocket(packageInfoWithoutVersion));
      command = new GetPackageInfoCommand(mockAdb);

      const result = await command.exec({ packageName: 'com.example.app' });

      expect(result?.versionName).toBe('Unknown');
    });

    it('should handle package with missing versionCode', async () => {
      const packageInfoWithoutCode = MOCK_PACKAGE_INFO.replace('versionCode=100', '');
      mockAdb = createMockAdb(createMockShellSocket(packageInfoWithoutCode));
      command = new GetPackageInfoCommand(mockAdb);

      const result = await command.exec({ packageName: 'com.example.app' });

      expect(result?.versionCode).toBe('Unknown');
    });

    it('should extract permissions only in permissions section', async () => {
      const complexOutput = `
      Packages:
        Package [com.test.app]:
          versionCode=1 minSdk=21 targetSdk=30
          versionName=1.0
          codePath=/data/app/test
          firstInstallTime=2025-01-01 10:00:00
          lastUpdateTime=2025-01-01 10:00:00
          requested permissions:
            android.permission.INTERNET: granted=true
            android.permission.CAMERA: granted=true
            android.permission.WRITE_STORAGE: granted=false
          install permissions:
            android.permission.SHOULD_NOT_APPEAR
      `;
      mockAdb = createMockAdb(createMockShellSocket(complexOutput));
      command = new GetPackageInfoCommand(mockAdb);

      const result = await command.exec(
        { packageName: 'com.test.app' },
        { includePermissions: true }
      );

      expect(result?.permissions).toContain('android.permission.INTERNET');
      expect(result?.permissions).toContain('android.permission.CAMERA');
      expect(result?.permissions).toContain('android.permission.WRITE_STORAGE');
      expect(result?.permissions).toHaveLength(3);
    });

    it('should handle empty permissions section', async () => {
      const outputWithoutPermissions = `
      Packages:
        Package [com.test.app]:
          versionCode=1 minSdk=21 targetSdk=30
          versionName=1.0
          codePath=/data/app/test
          firstInstallTime=2025-01-01 10:00:00
          lastUpdateTime=2025-01-01 10:00:00
          requested permissions:
      `;
      mockAdb = createMockAdb(createMockShellSocket(outputWithoutPermissions));
      command = new GetPackageInfoCommand(mockAdb);

      const result = await command.exec(
        { packageName: 'com.test.app' },
        { includePermissions: true }
      );

      expect(result?.permissions).toEqual([]);
    });

    it('should call dumpsys with correct package name', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_PACKAGE_INFO));
      command = new GetPackageInfoCommand(mockAdb);

      await command.exec({ packageName: 'com.example.myapp' });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        'dumpsys package com.example.myapp'
      );
    });

    it('should handle invalid SDK numbers gracefully', async () => {
      const invalidSdkOutput = MOCK_PACKAGE_INFO.replace(
        'versionCode=100 minSdk=21 targetSdk=33',
        'versionCode=100 minSdk=abc targetSdk=xyz'
      );
      mockAdb = createMockAdb(createMockShellSocket(invalidSdkOutput));
      command = new GetPackageInfoCommand(mockAdb);

      const result = await command.exec({ packageName: 'com.example.app' });

      expect(result?.minSdk).toBeUndefined();
      expect(result?.targetSdk).toBeUndefined();
    });
  });
});
