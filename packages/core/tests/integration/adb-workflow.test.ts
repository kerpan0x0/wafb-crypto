import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADBConnection } from '../../src/adb/connection';
import { Logger } from '../../src/utils/logger';

/**
 * Integration test che richiede un dispositivo Android reale connesso.
 * Questi test vengono eseguiti solo in un ambiente con dispositivo fisico.
 */
describe.skip('ADB Integration Workflow', () => {
  let connection: ADBConnection;

  beforeAll(() => {
    Logger.setLogLevel('debug');
    connection = new ADBConnection();
  });

  afterAll(async () => {
    if (connection.isConnected()) {
      await connection.disconnect();
    }
  });

  it('should complete full device workflow', async () => {
    // Connect
    const device = await connection.connect({ timeout: 60000 });
    expect(device).toBeDefined();
    expect(device.isConnected()).toBe(true);

    // Get properties
    const props = await device.getProperties();
    expect(props.androidVersion).toBeTruthy();
    expect(props.model).toBeTruthy();

    // Check root
    const isRooted = await device.isRooted();
    expect(typeof isRooted).toBe('boolean');

    // Get battery info
    const battery = await device.getBatteryInfo();
    expect(battery.level).toBeGreaterThanOrEqual(0);
    expect(battery.level).toBeLessThanOrEqual(100);

    // List packages
    const packages = await device.commands.listPackages();
    expect(packages.length).toBeGreaterThan(0);

    // Get system logs
    const logs = await device.commands.getLogcat({ maxLines: 10 });
    expect(logs).toBeTruthy();

    // Disconnect
    await device.disconnect();
    expect(device.isConnected()).toBe(false);
  }, 120000); // 2 minute timeout for integration test
});