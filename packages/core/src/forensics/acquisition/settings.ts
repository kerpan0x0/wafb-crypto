import { Acquirer, AcquisitionConfig, AcquisitionProgress, AcquisitionResult } from ".";
import { ADBDevice } from "../..";
import { CmdCommand } from "../../adb/commands";

export interface SettingsConfig extends AcquisitionConfig {
}

export class SettingAcquirer extends Acquirer {
    constructor(
        device: ADBDevice,
        settingsConfig: SettingsConfig = {}
    ) {
        super(device, settingsConfig, 'settings');
    }

    async acquire(
        onProgress?: (progress: AcquisitionProgress) => void
    ): Promise<AcquisitionResult> {
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

            // Step 2: Acquire settings data
            this.notifyProgress(
                onProgress,
                50,
                'Acquiring settings data...',
                'running'
            );

            const namespaces = ['global', 'system', 'secure'];
            const settingsData: { namespace: string; data: string }[] = [];

            namespaces.forEach(async ns => {
                this.logger.info(`Acquiring settings for namespace: ${ns}`);

                const output = await new CmdCommand(this.device.adb).exec({ namespace: `${ns}` });
                settingsData.push({ namespace: ns, data: output });

                this.notifyProgress(
                    onProgress,
                    50 + (namespaces.indexOf(ns) + 1) * (50 / namespaces.length),
                    `Acquired settings for namespace: ${ns}`,
                    'running'
                );
            });

            // Step 3: create blog and trigger download

            settingsData.map(item => {
                this.logger.debug(`Settings data for namespace ${item.namespace}: ${item.data}`);
                const blob = new Blob([item.data], { type: 'text/plain' });
                this.downloadBlob(blob, `settings_${item.namespace}.txt`);

            });

            this.notifyProgress(
                onProgress,
                100,
                'Set    tings acquisition completed',
                'completed'
            );
            
            const endTime = new Date();
            const duration = endTime.getTime() - startTime.getTime();

            this.logger.info(`Settings acquisition completed in ${duration} ms`);

            const result: AcquisitionResult = {
                success: true,
                type: 'settings',
                startTime,
                endTime,
                duration,
                data: settingsData
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
                error: (error as Error).message
            };
        }
    }
}