import { Acquirer, AcquisitionConfig, AcquisitionProgress, AcquisitionResult } from ".";
import { ADBDevice } from "../..";
import { CmdCommand } from "../../adb/commands";

export interface SettingsConfig extends AcquisitionConfig {
}

export class SettingsAcquirer extends Acquirer {
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

            namespaces.map(async ns => {
                this.logger.info(`Acquiring settings for namespace: ${ns}`);

                const output = await new CmdCommand(this.device.adb).exec({ namespace: `${ns}` });

                this.logger.debug(`Settings data for namespace ${ns}: ${output}`);
                const blob = new Blob([output], { type: 'text/plain' });
                this.downloadBlob(blob, `settings_${ns}.txt`);

                this.notifyProgress(
                    onProgress,
                    50 + (namespaces.indexOf(ns) + 1) * (50 / namespaces.length),
                    `Acquired settings for namespace: ${ns}`,
                    'running'
                );
            });

            // Step 3: Compute hash if required
            if (this.computeHash) {
                this.notifyProgress(
                    onProgress,
                    90,
                    'Computing hashes for settings data...',
                    'running'
                );

                settingsData.forEach(item => {
                    this.computeHash(new TextEncoder().encode(item.data))
                        .then(hash => {
                            this.logger.info(`Computed SHA-256 hash for ${item.namespace} settings: ${hash}`);
                        })
                        .catch(error => {
                            this.logger.error(`Failed to compute hash for ${item.namespace} settings`, { error });
                        });
                });
            }

            // Step 5: Complete acquisition
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