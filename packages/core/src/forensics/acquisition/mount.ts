import { Acquirer, AcquisitionConfig, AcquisitionProgress, AcquisitionResult } from ".";
import { ADBDevice } from "../../adb";
import { MountCommand, ProcMountCommand } from "../../adb/commands";

export class MountAcquirer extends Acquirer {

    constructor(
        device: ADBDevice,
        acquisitionConfig: AcquisitionConfig = {}
    ) {
        super(device, acquisitionConfig, 'mount');
    }

    async acquire(
        onProgress?: (progress: AcquisitionProgress) => void
    ): Promise<AcquisitionResult> {
        const startTime = new Date();

        try {
            this.logger.info('Starting mount acquisition');

            this.notifyProgress(onProgress, 10, 'Reading device information...', 'running');
            const deviceInfo = await this.device.getProperties();

            this.notifyProgress(
                onProgress,
                20,
                `Connected to ${deviceInfo.model}`,
                'running',
                deviceInfo
            );

            this.notifyProgress(
                onProgress,
                30,
                'Run Mount command.',
                'running'
            );

            const mountOutput = await new MountCommand(this.device.adb).exec();
            const mountData = mountOutput.split('\n').map(line => line.trim()).filter(line => line !== '');

            this.notifyProgress(
                onProgress,
                50,
                'Run ProcMount command.',
                'running'
            );
            const procMountOutput = await new ProcMountCommand(this.device.adb).exec();
            const procMountData = procMountOutput.split('\n').map(line => line.trim()).filter(line => line !== '');
            this.notifyProgress(
                onProgress,
                70,
                'Processing mount data.',
                'running'
            );

            const combinedMountsSet = new Set<string>([...mountData, ...procMountData]);
            const combinedMounts = Array.from(combinedMountsSet);

            const mountJson = JSON.stringify(combinedMounts, null, 2);

            this.notifyProgress(
                onProgress,
                90,
                'Preparing download.',
                'running'
            );

            const blob = new Blob([mountJson], { type: 'application/json' });

            const fileName = await this.generateFileName(
                'mounts',
                'json',
                deviceInfo.model.replace(/\s+/g, '_')
            );

            this.notifyProgress(
                onProgress,
                100,
                'Mount acquisition completed successfully.',
                'completed'
            );

            this.downloadBlob(blob, fileName);

            const endTime = new Date();
            const result: AcquisitionResult = {
                success: true,
                type: this.acquisitionType,
                fileName,
                startTime,
                endTime,
                duration: endTime.getTime() - startTime.getTime(),
                data: {
                    totalMounts: combinedMounts.length,
                },
            };

            // Compute hash if requested
            if (this.config.computeHash) {
                result.hash = await this.computeHash(new TextEncoder().encode(mountJson));
            }

            return result;
        } catch (error) {
            const endTime = new Date();
            const duration = endTime.getTime() - startTime.getTime();
            const errorMessage = error instanceof Error ? error.message : String(error);

            this.logger.error('Mount acquisition failed', { error: errorMessage });

            this.notifyProgress(
                onProgress,
                100,
                `Mount acquisition failed: ${errorMessage}`,
                'failed'
            );

            return {
                success: false,
                type: this.acquisitionType,
                startTime,
                endTime,
                duration,
                error: errorMessage,
            };
        } finally {
            const endTime = new Date();
            this.logger.info(
                `Mount acquisition finished in ${((endTime.getTime() - startTime.getTime()) / 1000).toFixed(2)} seconds`
            );
        }
    }
}