import { GetPackageInfoCommand, ListPackageCommand } from '../../adb/commands';
import type { ADBDevice } from '../../adb/device';
import { Acquirer } from './acquirer';
import type {
  AcquisitionConfig,
  AcquisitionProgress,
  AcquisitionResult
} from '.';

export interface PackagesConfig extends AcquisitionConfig {
  includeSystem?: boolean;
  includeDetails?: boolean;
  includePermissions?: boolean;
}

export interface PackageInfo {
  packageName: string;
  versionName: string;
  versionCode: string;
  installLocation: string;
  firstInstallTime: string;
  lastUpdateTime: string;
  isSystemApp: boolean;
  permissions?: string[];
  targetSdk?: number;
  minSdk?: number;
}

export interface PackagesData {
  totalPackages: number;
  systemPackages: number;
  userPackages: number;
  packages: PackageInfo[];
  deviceInfo: any;
  acquisitionTime: string;
}

/**
 * Acquirer per lista pacchetti installati
 */
export class PackagesAcquirer extends Acquirer {
  constructor(
    device: ADBDevice,
    private packagesConfig: PackagesConfig = {}
  ) {
    super(device, packagesConfig, 'packages');
  }

  async acquire(
    onProgress?: (progress: AcquisitionProgress) => void
  ): Promise<AcquisitionResult> {
    const startTime = new Date();
    
    try {
      this.logger.info('Starting packages acquisition');
      
      // Step 1: Get device info
      this.notifyProgress(onProgress, 10, 'Reading device information...', 'running');
      const deviceInfo = await this.device.getProperties();
      
      this.notifyProgress(
        onProgress,
        20,
        `Connected to ${deviceInfo.model}`,
        'running',
        deviceInfo
      );

      // Step 2: List all packages
      this.notifyProgress(onProgress, 30, 'Listing installed packages...', 'running');
      const packageNames = await new ListPackageCommand(this.device.adb).exec({
        includeSystem: this.packagesConfig.includeSystem,
        timeout: this.config.timeout || 30000
      });
      
      this.logger.info(`Found ${packageNames.length} packages`);
      
      this.notifyProgress(
        onProgress,
        50,
        `Found ${packageNames.length} packages`,
        'running'
      );

      // Step 3: Get detailed info if requested
      const packages: PackageInfo[] = [];
      
      if (this.packagesConfig.includeDetails !== false) {
        this.notifyProgress(
          onProgress,
          60,
          'Gathering detailed package information...',
          'running'
        );
        
        const progressStep = 30 / packageNames.length;
        
        for (let i = 0; i < packageNames.length; i++) {
          const packageName = packageNames[i];
          
          try {
            const info = await new GetPackageInfoCommand(this.device.adb).exec({ packageName: packageName }, {
              includePermissions: this.packagesConfig.includePermissions,
              timeout: 10000
            });
            
            if (info) {
              // Aggiungi solo il campo isSystemApp (logica specifica)
              packages.push({
                ...info,
                isSystemApp: this.isSystemPackage(packageName)
              });
            } else {
              packages.push(this.createBasicPackageInfo(packageName));
            }
          } catch (err) {
            this.logger.warn(`Failed to get info for ${packageName}`, err);
            packages.push(this.createBasicPackageInfo(packageName));
          }
          
          const currentProgress = 60 + (i + 1) * progressStep;
          this.notifyProgress(
            onProgress,
            Math.min(90, currentProgress),
            `Processing package ${i + 1}/${packageNames.length}...`,
            'running'
          );
        }
      } else {
        // Just basic list without details
        for (const packageName of packageNames) {
          packages.push(this.createBasicPackageInfo(packageName));
        }
      }

      // Step 4: Build result data
      this.notifyProgress(onProgress, 90, 'Preparing export...', 'running');
      
      const systemCount = packages.filter(p => p.isSystemApp).length;
      const userCount = packages.length - systemCount;
      
      const packagesData: PackagesData = {
        totalPackages: packages.length,
        systemPackages: systemCount,
        userPackages: userCount,
        packages,
        deviceInfo,
        acquisitionTime: new Date().toISOString()
      };

      // Step 5: Convert to JSON and create blob
      const jsonData = JSON.stringify(packagesData, null, 2);
      const jsonBytes = new TextEncoder().encode(jsonData);
      
      const blob = new Blob([jsonBytes], { type: 'application/json' });
      const fileName = this.generateFileName('packages', 'json', deviceInfo.model);
      
      this.downloadBlob(blob, fileName);

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      this.notifyProgress(onProgress, 100, 'Packages acquisition completed!', 'completed');

      // Step 6: Build result
      const result: AcquisitionResult = {
        success: true,
        type: 'packages',
        fileName,
        fileSize: jsonBytes.length,
        startTime,
        endTime,
        duration,
        data: {
          totalPackages: packages.length,
          systemPackages: systemCount,
          userPackages: userCount,
          deviceInfo
        }
      };

      if (this.config.computeHash) {
        result.hash = await this.computeHash(jsonBytes);
      }

      this.logger.info('Packages acquisition completed', {
        fileName,
        totalPackages: packages.length,
        duration
      });

      return result;

    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      this.logger.error('Packages acquisition failed', error);
      this.notifyProgress(onProgress, 0, `Error: ${errorMessage}`, 'failed');

      return {
        success: false,
        type: 'packages',
        startTime,
        endTime,
        duration,
        error: errorMessage
      };
    }
  }

  // ============================================================================
  // PRIVATE HELPERS - ONLY PACKAGE-SPECIFIC LOGIC
  // ============================================================================

  /**
   * Create basic package info (fallback when detailed info fails)
   */
  private createBasicPackageInfo(packageName: string): PackageInfo {
    return {
      packageName,
      versionName: 'Unknown',
      versionCode: 'Unknown',
      installLocation: 'Unknown',
      firstInstallTime: 'Unknown',
      lastUpdateTime: 'Unknown',
      isSystemApp: this.isSystemPackage(packageName)
    };
  }

  /**
   * Determine if a package is a system package
   */
  private isSystemPackage(packageName: string): boolean {
    const systemPrefixes = [
      'com.android.',
      'com.google.android.',
      'android.',
      'com.qualcomm.',
      'com.samsung.',
      'com.sec.'
    ];
    
    return systemPrefixes.some(prefix => packageName.startsWith(prefix));
  }
}