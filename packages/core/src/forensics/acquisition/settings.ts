import { Acquirer, AcquisitionConfig, AcquisitionProgress, AcquisitionResult, AcquisitionFile } from '.';
import { ADBDevice } from '../..';
import { CmdCommand } from '../../adb/commands';

export interface SettingsConfig extends AcquisitionConfig { }

export class SettingsAcquirer extends Acquirer {
  constructor(device: ADBDevice, config: SettingsConfig = {}) {
    super(device, config, 'settings');
  }

  async acquire(onProgress?: (progress: AcquisitionProgress) => void): Promise<AcquisitionResult> {
    const startTime = new Date();

    try {
      this.logger.info('Starting settings acquisition');

      // Step 1: Get device info
      this.notifyProgress(onProgress, 10, 'Reading device information...', 'running');
      const deviceInfo = await this.device.getProperties();

      this.notifyProgress(
        onProgress,
        30,
        `Connected to ${deviceInfo.model}`,
        'running',
        deviceInfo
      );

      // Step 2: Acquire settings data from all namespaces
      this.notifyProgress(onProgress, 50, 'Acquiring settings data...', 'running');

      const namespaces = ['global', 'system', 'secure'];
      const settingsData: { namespace: string; data: string }[] = [];

      for (const ns of namespaces) {
        this.logger.info(`Acquiring settings for namespace: ${ns}`);

        const output = await new CmdCommand(this.device.adb).exec({ namespace: `${ns}` });

        this.logger.debug(`Settings data for namespace ${ns}: ${output}`);
        settingsData.push({ namespace: ns, data: output });

        this.notifyProgress(
          onProgress,
          50 + (namespaces.indexOf(ns) + 1) * (30 / namespaces.length),
          `Acquired settings for namespace: ${ns}`,
          'running'
        );
      }

      // Step 3: Create combined JSON blob
      this.notifyProgress(onProgress, 85, 'Preparing export...', 'running');

      const combinedData = {
        deviceInfo,
        acquisitionTime: new Date().toISOString(),
        settings: Object.fromEntries(settingsData.map(item => [item.namespace, item.data])),
      };

      const jsonData = JSON.stringify(combinedData, null, 2);
      const jsonBytes = new TextEncoder().encode(jsonData);

      const blob = new Blob([jsonBytes], { type: 'application/json' });
      const fileName = this.generateFileName('settings', 'json');

      const file: AcquisitionFile = {
        fileName: fileName,
        fileSize: blob.size,
        blob: blob,
        description: 'System settings database',
        mimeType: blob.type,
      };

      if (this.config.computeHash) {
        this.notifyProgress(onProgress, 90, 'Computing hash...', 'running');
        const blobBytes = new Uint8Array(await blob.arrayBuffer());
        file.hash = await this.computeHash(blobBytes);
      }

      // Step 5: Complete acquisition
      this.notifyProgress(onProgress, 100, 'Settings acquisition completed', 'completed');

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      this.logger.info(`Settings acquisition completed in ${duration} ms`);

      const result: AcquisitionResult = {
        success: true,
        type: 'settings',
        files: [file],
        startTime,
        endTime,
        duration,
        data: settingsData,
      };

      return result;
    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      this.logger.error('Settings acquisition failed', { error });

      return {
        success: false,
        type: 'settings',
        startTime,
        endTime,
        duration,
        error: (error as Error).message,
      };
    }
  }
}
