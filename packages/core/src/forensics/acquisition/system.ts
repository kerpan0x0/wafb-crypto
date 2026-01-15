import type { ADBDevice } from '../../adb/device';
import { Acquirer } from './acquirer';
import type {
	AcquisitionConfig,
	AcquisitionProgress,
	AcquisitionResult
} from '.';

import type {
	BatteryInfo,
	NetworkInfo,
	StorageInfo,
	MemoryInfo,
	SensorInfo
} from '../../adb/commands/index';
import { GetBatteryInfoCommand, GetMemoryInfoCommand, GetNetworkInfoCommand, GetPropCommand, GetSensorsCommand, GetStorageInfoCommand } from '../../adb/commands';

export interface SystemInfoConfig extends AcquisitionConfig {
	includeBattery?: boolean;
	includeNetwork?: boolean;
	includeStorage?: boolean;
	includeMemory?: boolean;
	includeSensors?: boolean;
}

export interface SystemInfoData {
	device: {
		manufacturer: string;
		model: string;
		brand: string;
		androidVersion: string;
		buildId: string;
		sdkVersion: number;
		serialNumber: string;
		bootloader?: string;
		hardware?: string;
		fingerprint?: string;
	};
	battery?: BatteryInfo;
	network?: NetworkInfo;
	storage?: StorageInfo;
	memory?: MemoryInfo;
	sensors?: SensorInfo[];
	systemProperties: Record<string, string>;
	acquisitionTime: string;
}

/**
 * Acquirer for System Information
 * 
 * DESIGN: Uses ADBDevice methods for device-level information
 * All types are centralized in adb/base.ts
 */
export class SystemInfoAcquirer extends Acquirer {
	constructor(
		device: ADBDevice,
		private systemConfig: SystemInfoConfig = {}
	) {
		super(device, systemConfig, 'system_info');
	}

	async acquire(
		onProgress?: (progress: AcquisitionProgress) => void
	): Promise<AcquisitionResult> {
		const startTime = new Date();

		try {
			this.logger.info('Starting system info acquisition');

			// Step 1: Get device properties (10%)
			this.notifyProgress(onProgress, 10, 'Reading device properties...', 'running');
			const deviceInfo = await this.device.getProperties();

			this.notifyProgress(
				onProgress,
				20,
				`Connected to ${deviceInfo.model}`,
				'running',
				deviceInfo
			);

			// Step 2: Get all system properties (30%)
			this.notifyProgress(onProgress, 30, 'Gathering system properties...', 'running');
			const systemProps = await new GetPropCommand(this.device.adb).exec({ timeout: this.config.timeout || 30000 });

			// Step 3: Build system info data
			const systemInfoData: SystemInfoData = {
				device: {
					manufacturer: deviceInfo.manufacturer,
					model: deviceInfo.model,
					brand: deviceInfo.brand,
					androidVersion: deviceInfo.androidVersion,
					buildId: deviceInfo.buildId,
					sdkVersion: deviceInfo.sdkVersion,
					serialNumber: deviceInfo.serialNumber,
					bootloader: systemProps['ro.bootloader'],
					hardware: systemProps['ro.hardware'],
					fingerprint: systemProps['ro.build.fingerprint']
				},
				systemProperties: systemProps,
				acquisitionTime: new Date().toISOString()
			};

			let progressOffset = 40;
			const step = 60 / this.getEnabledComponentsCount();

			// Step 4: Get battery info (40-50%)
			if (this.systemConfig.includeBattery !== false) {
				this.notifyProgress(onProgress, progressOffset, 'Reading battery information...', 'running');
				try {
					systemInfoData.battery = await this.getBatteryInfo();
				} catch (error) {
					this.logger.warn('Failed to acquire battery info', error);
					// Non rilanciamo l'errore, permettiamo l'acquisizione parziale
				}
				progressOffset += step;
			}

			// Step 5: Get network info (50-60%)
			if (this.systemConfig.includeNetwork !== false) {
				this.notifyProgress(onProgress, progressOffset, 'Reading network information...', 'running');
				try {
					systemInfoData.network = await this.getNetworkInfo();
				} catch (error) {
					this.logger.warn('Failed to acquire network info', error);
				}
				progressOffset += step;
			}

			// Step 6: Get storage info (60-70%)
			if (this.systemConfig.includeStorage !== false) {
				this.notifyProgress(onProgress, progressOffset, 'Reading storage information...', 'running');
				try {
					systemInfoData.storage = await this.getStorageInfo();
				} catch (error) {
					this.logger.warn('Failed to acquire storage info', error);
				}
				progressOffset += step;
			}

			// Step 7: Get memory info (70-80%)
			if (this.systemConfig.includeMemory !== false) {
				this.notifyProgress(onProgress, progressOffset, 'Reading memory information...', 'running');
				try {
					systemInfoData.memory = await this.getMemoryInfo();
				} catch (error) {
					this.logger.warn('Failed to acquire memory info', error);
				}
				progressOffset += step;
			}

			// Step 8: Get sensors (80-90%)
			if (this.systemConfig.includeSensors !== false) {
				this.notifyProgress(onProgress, progressOffset, 'Reading sensors information...', 'running');
				try {
					systemInfoData.sensors = await this.getSensors();
				} catch (error) {
					this.logger.warn('Failed to acquire sensors info', error);
				}
				progressOffset += step;
			}

			// Step 9: Prepare export (90%)
			this.notifyProgress(onProgress, 90, 'Preparing export...', 'running');

			const jsonData = JSON.stringify(systemInfoData, null, 2);
			const jsonBytes = new TextEncoder().encode(jsonData);

			const blob = new Blob([jsonBytes], { type: 'application/json' });
			const fileName = this.generateFileName('system-info', 'json', deviceInfo.model);

			this.downloadBlob(blob, fileName);

			const endTime = new Date();
			const duration = endTime.getTime() - startTime.getTime();

			this.notifyProgress(onProgress, 100, 'System info acquisition completed!', 'completed');

			// Step 10: Build result
			const result: AcquisitionResult = {
				success: true,
				type: 'system_info',
				fileName,
				fileSize: jsonBytes.length,
				startTime,
				endTime,
				duration,
				data: {
					deviceInfo,
					componentsCollected: {
						battery: !!systemInfoData.battery,
						network: !!systemInfoData.network,
						storage: !!systemInfoData.storage,
						memory: !!systemInfoData.memory,
						sensors: !!systemInfoData.sensors
					}
				}
			};

			if (this.config.computeHash) {
				result.hash = await this.computeHash(jsonBytes);
			}

			this.logger.info('System info acquisition completed', {
				fileName,
				fileSize: jsonBytes.length,
				duration
			});

			return result;

		} catch (error) {
			const endTime = new Date();
			const duration = endTime.getTime() - startTime.getTime();
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';

			this.logger.error('System info acquisition failed', error);
			this.notifyProgress(onProgress, 0, `Error: ${errorMessage}`, 'failed');

			return {
				success: false,
				type: 'system_info',
				startTime,
				endTime,
				duration,
				error: errorMessage
			};
		}
	}

	// ============================================================================
	// PRIVATE HELPERS
	// ============================================================================

	private getEnabledComponentsCount(): number {
		let count = 0;
		if (this.systemConfig.includeBattery !== false) count++;
		if (this.systemConfig.includeNetwork !== false) count++;
		if (this.systemConfig.includeStorage !== false) count++;
		if (this.systemConfig.includeMemory !== false) count++;
		if (this.systemConfig.includeSensors !== false) count++;
		return count || 1;
	}

	async getBatteryInfo(): Promise<BatteryInfo> {
		try {
			return await new GetBatteryInfoCommand(this.device.adb).exec();
		} catch (error) {
			this.logger.warn('Failed to get battery info', error);
			return {
				level: 0,
				temperature: 0,
				voltage: 0,
				status: 'Unknown'
			};
		}
	}

	async getNetworkInfo(): Promise<NetworkInfo> {
		try {
			return await new GetNetworkInfoCommand(this.device.adb).exec();
		} catch (error) {
			this.logger.warn('Failed to get network info', error);
			return {
				wifiEnabled: false,
				mobileDataEnabled: false,
				airplaneModeOn: false
			};
		}
	}

	async getStorageInfo(): Promise<StorageInfo> {
		try {
			return await new GetStorageInfoCommand(this.device.adb).exec();
		} catch (error) {
			this.logger.warn('Failed to get storage info', error);
			return {
				totalInternal: 'Unknown',
				availableInternal: 'Unknown'
			};
		}
	}

	async getMemoryInfo(): Promise<MemoryInfo> {
		try {
			return await new GetMemoryInfoCommand(this.device.adb).exec();
		} catch (error) {
			this.logger.warn('Failed to get memory info', error);
			return {
				totalRam: 'Unknown',
				availableRam: 'Unknown',
				lowMemory: false,
				threshold: 'Unknown'
			};
		}
	}

	async getSensors(): Promise<SensorInfo[]> {
		try {
			return await new GetSensorsCommand(this.device.adb).exec();
		} catch (error) {
			this.logger.warn('Failed to get sensors info', error);
			return [];
		}
	}
}