import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  DumpsysListCommand, 
  DumpsysActivityServicesCommand,
  DumpsysServiceCommand 
} from '../../../../src/adb/commands';
import type { Adb } from '@yume-chan/adb';
import { 
  createMockAdb, 
  createMockShellSocket 
} from './test-helpers';

describe('DumpsysCommands', () => {
  let mockAdb: Adb;

  const MOCK_DUMPSYS_LIST = `Currently running services:
  SurfaceFlinger
  accessibility
  account
  activity
  alarm
  android.security.keystore
  appops
  audio
  battery
  bluetooth_manager
  connectivity
  device_policy
  display
  input
  location
  media.audio_policy
  notification
  package
  power
  statusbar
  telephony.registry
  user
  wifi
  window`;

  const MOCK_ACTIVITY_SERVICES = `ACTIVITY MANAGER SERVICES (dumpsys activity services)
  User 0:
    ServiceRecord{abc1234 u0 com.android.systemui/.SystemUIService}
      app=ProcessRecord{def5678 1234:com.android.systemui/u0a10}
      packageName=com.android.systemui
      processName=com.android.systemui
      baseDir=/system/priv-app/SystemUI/SystemUI.apk
      
    ServiceRecord{xyz9999 u0 com.example.app/.MyService}
      app=null
      packageName=com.example.app
      processName=com.example.app
      baseDir=/data/app/com.example.app/base.apk`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('DumpsysListCommand', () => {
    it('should execute dumpsys -l command', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_DUMPSYS_LIST)) as unknown as Adb;
      const command = new DumpsysListCommand(mockAdb);

      const result = await command.exec();

      expect(result).toBe(MOCK_DUMPSYS_LIST);
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('dumpsys -l');
    });

    it('should return list of service names', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_DUMPSYS_LIST)) as unknown as Adb;
      const command = new DumpsysListCommand(mockAdb);

      const result = await command.exec();

      expect(result).toContain('SurfaceFlinger');
      expect(result).toContain('activity');
      expect(result).toContain('package');
      expect(result).toContain('window');
    });

    it('should handle empty service list', async () => {
      mockAdb = createMockAdb(createMockShellSocket('')) as unknown as Adb;
      const command = new DumpsysListCommand(mockAdb);

      const result = await command.exec();

      expect(result).toBe('');
    });

    it('should respect timeout option', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_DUMPSYS_LIST)) as unknown as Adb;
      const command = new DumpsysListCommand(mockAdb);

      await command.exec({ timeout: 5000 });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('dumpsys -l');
    });

    it('should handle command failure', async () => {
      mockAdb = createMockAdb() as unknown as Adb;
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockRejectedValue(
        new Error('Command failed')
      );
      const command = new DumpsysListCommand(mockAdb);

      await expect(command.exec()).rejects.toThrow('Command failed');
    });
  });

  describe('DumpsysActivityServicesCommand', () => {
    it('should execute dumpsys activity services command', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_ACTIVITY_SERVICES)) as unknown as Adb;
      const command = new DumpsysActivityServicesCommand(mockAdb);

      const result = await command.exec();

      expect(result).toBe(MOCK_ACTIVITY_SERVICES);
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        'dumpsys activity services'
      );
    });

    it('should return detailed service information', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_ACTIVITY_SERVICES)) as unknown as Adb;
      const command = new DumpsysActivityServicesCommand(mockAdb);

      const result = await command.exec();

      expect(result).toContain('ServiceRecord');
      expect(result).toContain('com.android.systemui');
      expect(result).toContain('ProcessRecord');
    });

    it('should handle empty output', async () => {
      mockAdb = createMockAdb(createMockShellSocket('')) as unknown as Adb;
      const command = new DumpsysActivityServicesCommand(mockAdb);

      const result = await command.exec();

      expect(result).toBe('');
    });

    it('should respect timeout option', async () => {
      mockAdb = createMockAdb(createMockShellSocket(MOCK_ACTIVITY_SERVICES)) as unknown as Adb;
      const command = new DumpsysActivityServicesCommand(mockAdb);

      await command.exec({ timeout: 10000 });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(
        'dumpsys activity services'
      );
    });

    it('should handle multiple users', async () => {
      const multiUserOutput = `User 0:
  ServiceRecord{abc u0 service1}
User 10:
  ServiceRecord{def u10 service2}`;

      mockAdb = createMockAdb(createMockShellSocket(multiUserOutput)) as unknown as Adb;
      const command = new DumpsysActivityServicesCommand(mockAdb);

      const result = await command.exec();

      expect(result).toContain('User 0:');
      expect(result).toContain('User 10:');
    });
  });

  describe('DumpsysServiceCommand', () => {
    it('should execute dumpsys for specific service', async () => {
      const mockOutput = 'Service: activity\nState: running';
      mockAdb = createMockAdb(createMockShellSocket(mockOutput)) as unknown as Adb;
      const command = new DumpsysServiceCommand(mockAdb);

      const result = await command.exec({ service: 'activity' });

      expect(result).toBe(mockOutput);
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('dumpsys activity');
    });

    it('should throw error if service name not provided', async () => {
      mockAdb = createMockAdb() as unknown as Adb;
      const command = new DumpsysServiceCommand(mockAdb);

      await expect(command.exec({})).rejects.toThrow('Service name is required');
    });

    it('should handle various service names', async () => {
      const services = ['activity', 'package', 'battery', 'wifi', 'location'];

      for (const service of services) {
        mockAdb = createMockAdb(createMockShellSocket(`Service: ${service}`)) as unknown as Adb;
        const command = new DumpsysServiceCommand(mockAdb);

        await command.exec({ service });

        expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith(`dumpsys ${service}`);
      }
    });

    it('should respect timeout option', async () => {
      mockAdb = createMockAdb(createMockShellSocket('data')) as unknown as Adb;
      const command = new DumpsysServiceCommand(mockAdb);

      await command.exec({ service: 'activity', timeout: 5000 });

      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledWith('dumpsys activity');
    });

    it('should handle service not found', async () => {
      mockAdb = createMockAdb(createMockShellSocket('Can\'t find service: invalid')) as unknown as Adb;
      const command = new DumpsysServiceCommand(mockAdb);

      const result = await command.exec({ service: 'invalid' });

      expect(result).toContain('Can\'t find service');
    });

    it('should handle complex service output', async () => {
      const complexOutput = `Service: package
  Current state: running
  Process ID: 1234
  Memory usage: 50MB
  Active since: 2024-01-01 10:00:00`;

      mockAdb = createMockAdb(createMockShellSocket(complexOutput)) as unknown as Adb;
      const command = new DumpsysServiceCommand(mockAdb);

      const result = await command.exec({ service: 'package' });

      expect(result).toBe(complexOutput);
      expect(result).toContain('Current state: running');
      expect(result).toContain('Process ID: 1234');
    });
  });

  describe('Integration', () => {
    it('should work together to get service information', async () => {
      // First, list all services
      mockAdb = createMockAdb(createMockShellSocket(MOCK_DUMPSYS_LIST)) as unknown as Adb;
      const listCommand = new DumpsysListCommand(mockAdb);
      const servicesList = await listCommand.exec();

      expect(servicesList).toContain('activity');

      // Then get detailed info
      mockAdb = createMockAdb(createMockShellSocket(MOCK_ACTIVITY_SERVICES)) as unknown as Adb;
      const activityCommand = new DumpsysActivityServicesCommand(mockAdb);
      const details = await activityCommand.exec();

      expect(details).toContain('ServiceRecord');
    });

    it('should handle sequential calls', async () => {
      // Create new mock for each call to avoid stream exhaustion
      mockAdb = createMockAdb() as unknown as Adb;
      vi.mocked(mockAdb.subprocess.shellProtocol.spawn).mockImplementation(() => 
        Promise.resolve(createMockShellSocket(MOCK_DUMPSYS_LIST))
      );
      
      const command = new DumpsysListCommand(mockAdb);

      const result1 = await command.exec();
      const result2 = await command.exec();

      expect(result1).toBe(MOCK_DUMPSYS_LIST);
      expect(result2).toBe(MOCK_DUMPSYS_LIST);
      expect(mockAdb.subprocess.shellProtocol.spawn).toHaveBeenCalledTimes(2);
    });
  });
});