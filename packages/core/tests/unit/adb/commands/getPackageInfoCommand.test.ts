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
    it('should return raw package information', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_PACKAGE_INFO));
      command = new GetPackageInfoCommand(mockAdb);

      const result = await command.exec({ packageName: 'com.example.app' });

      expect(result).toBe(MOCK_PACKAGE_INFO);
      expect(result).toContain('com.example.app');
      expect(result).toContain('versionName=1.0.0');
      expect(result).toContain('versionCode=100');
    });

    it('should return raw output containing install times', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_PACKAGE_INFO));
      command = new GetPackageInfoCommand(mockAdb);

      const result = await command.exec({ packageName: 'com.example.app' });

      expect(result).toContain('firstInstallTime=2025-01-10');
      expect(result).toContain('lastUpdateTime=2025-01-15');
    });

    it('should return raw output containing install location', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_PACKAGE_INFO));
      command = new GetPackageInfoCommand(mockAdb);

      const result = await command.exec({ packageName: 'com.example.app' });

      expect(result).toContain('codePath=/data/app/com.example.app-hash');
    });

    it('should return raw output with permissions', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_PACKAGE_INFO));
      command = new GetPackageInfoCommand(mockAdb);

      const result = await command.exec({ packageName: 'com.example.app' });

      expect(result).toContain('android.permission.INTERNET');
      expect(result).toContain('android.permission.ACCESS_NETWORK_STATE');
      expect(result).toContain('android.permission.CAMERA');
    });

    it('should return raw output regardless of options', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_PACKAGE_INFO));
      command = new GetPackageInfoCommand(mockAdb);

      const result = await command.exec({ packageName: 'com.example.app' });

      expect(result).toBe(MOCK_PACKAGE_INFO);
    });

    it('should return empty string for non-existent package', async () => {
      mockAdb = createMockAdb(createMockShellSocket(''));
      command = new GetPackageInfoCommand(mockAdb);

      const result = await command.exec({ packageName: 'com.nonexistent.app' });

      expect(result).toBe('');
    });

    it('should return empty string when dumpsys fails', async () => {
      mockAdb = createMockAdb();
      (mockAdb.subprocess.shellProtocol.spawn as any).mockRejectedValue(
        new Error('Package not found')
      );
      command = new GetPackageInfoCommand(mockAdb);

      const result = await command.exec({ packageName: 'com.example.app' });

      expect(result).toBe('');
    });

    it('should return raw output without targetSdk', async () => {
      const packageInfoWithoutTargetSdk = MOCK_PACKAGE_INFO.replace('targetSdk=33', '');
      mockAdb = createMockAdb(createMockShellSocket(packageInfoWithoutTargetSdk));
      command = new GetPackageInfoCommand(mockAdb);

      const result = await command.exec({ packageName: 'com.example.app' });

      expect(result).toBe(packageInfoWithoutTargetSdk);
      expect(result).not.toContain('targetSdk=');
      expect(result).toContain('minSdk=21');
    });

    it('should return raw output without minSdk', async () => {
      const packageInfoWithoutMinSdk = MOCK_PACKAGE_INFO.replace('minSdk=21', '');
      mockAdb = createMockAdb(createMockShellSocket(packageInfoWithoutMinSdk));
      command = new GetPackageInfoCommand(mockAdb);

      const result = await command.exec({ packageName: 'com.example.app' });

      expect(result).toBe(packageInfoWithoutMinSdk);
      expect(result).not.toContain('minSdk=');
      expect(result).toContain('targetSdk=33');
    });

    it('should use custom timeout', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_PACKAGE_INFO));
      command = new GetPackageInfoCommand(mockAdb);

      await command.exec({ packageName: 'com.example.app', timeout: 15000 });

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

    it('should return raw output with spaces in version', async () => {
      const packageInfoWithSpaces = MOCK_PACKAGE_INFO.replace(
        'versionName=1.0.0',
        'versionName=1.0.0 Beta'
      );
      mockAdb = createMockAdb(createMockShellSocket(packageInfoWithSpaces));
      command = new GetPackageInfoCommand(mockAdb);

      const result = await command.exec({ packageName: 'com.example.app' });

      expect(result).toBe(packageInfoWithSpaces);
      expect(result).toContain('versionName=1.0.0 Beta');
    });

    it('should return raw output without versionName', async () => {
      const packageInfoWithoutVersion = MOCK_PACKAGE_INFO.replace('versionName=1.0.0', '');
      mockAdb = createMockAdb(createMockShellSocket(packageInfoWithoutVersion));
      command = new GetPackageInfoCommand(mockAdb);

      const result = await command.exec({ packageName: 'com.example.app' });

      expect(result).toBe(packageInfoWithoutVersion);
      expect(result).not.toContain('versionName=');
    });

    it('should return raw output without versionCode', async () => {
      const packageInfoWithoutCode = MOCK_PACKAGE_INFO.replace('versionCode=100', '');
      mockAdb = createMockAdb(createMockShellSocket(packageInfoWithoutCode));
      command = new GetPackageInfoCommand(mockAdb);

      const result = await command.exec({ packageName: 'com.example.app' });

      expect(result).toBe(packageInfoWithoutCode);
      expect(result).not.toContain('versionCode=');
    });

    it('should return raw output with complex permissions', async () => {
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

      const result = await command.exec({ packageName: 'com.test.app' });

      expect(result).toBe(complexOutput);
      expect(result).toContain('android.permission.INTERNET');
      expect(result).toContain('android.permission.CAMERA');
      expect(result).toContain('android.permission.WRITE_STORAGE');
    });

    it('should return raw output with empty permissions', async () => {
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

      const result = await command.exec({ packageName: 'com.test.app' });

      expect(result).toBe(outputWithoutPermissions);
      expect(result).toContain('requested permissions:');
    });

    it('should call dumpsys with correct package name', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_PACKAGE_INFO));
      command = new GetPackageInfoCommand(mockAdb);

      await command.exec({ packageName: 'com.example.myapp' });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        'dumpsys package com.example.myapp'
      );
    });

    it('should return raw output with invalid SDK numbers', async () => {
      const invalidSdkOutput = MOCK_PACKAGE_INFO.replace(
        'versionCode=100 minSdk=21 targetSdk=33',
        'versionCode=100 minSdk=abc targetSdk=xyz'
      );
      mockAdb = createMockAdb(createMockShellSocket(invalidSdkOutput));
      command = new GetPackageInfoCommand(mockAdb);

      const result = await command.exec({ packageName: 'com.example.app' });

      expect(result).toBe(invalidSdkOutput);
      expect(result).toContain('minSdk=abc');
      expect(result).toContain('targetSdk=xyz');
    });
  });
});
