import type { ADBDevice } from '../../adb/device';
import { Logger } from '../../utils/logger';
import type {
  AcquisitionConfig,
  AcquisitionProgress,
  AcquisitionResult
} from './types';

/**
 * Opzioni specifiche per Packages
 */
export interface PackagesConfig extends AcquisitionConfig {
  /**
   * Se includere i pacchetti di sistema
   */
  includeSystem?: boolean;
  
  /**
   * Se includere informazioni dettagliate per ogni pacchetto
   */
  includeDetails?: boolean;
  
  /**
   * Se includere le permissions per ogni pacchetto
   */
  includePermissions?: boolean;
}

/**
 * Informazioni su un singolo pacchetto
 */
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

/**
 * Risultato dell'acquisizione pacchetti
 */
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
export class PackagesAcquirer {
  private logger: Logger;
  
  constructor(
    private device: ADBDevice,
    private config: PackagesConfig = {}
  ) {
    this.logger = new Logger('PackagesAcquirer');
  }

  /**
   * Esegue l'acquisizione della lista pacchetti
   */
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
      const packageNames = await this.listPackages();
      
      this.logger.info(`Found ${packageNames.length} packages`);
      
      this.notifyProgress(
        onProgress,
        50,
        `Found ${packageNames.length} packages`,
        'running'
      );

      // Step 3: Get detailed info if requested
      const packages: PackageInfo[] = [];
      
      if (this.config.includeDetails !== false) {
        this.notifyProgress(
          onProgress,
          60,
          'Gathering detailed package information...',
          'running'
        );
        
        const progressStep = 30 / packageNames.length; // 30% for details (60-90)
        
        for (let i = 0; i < packageNames.length; i++) {
          const packageName = packageNames[i];
          
          try {
            const info = await this.getPackageInfo(packageName);
            if (info) {
              packages.push(info);
            } else {
              // If getPackageInfo returns null, add basic info
              packages.push({
                packageName,
                versionName: 'Unknown',
                versionCode: 'Unknown',
                installLocation: 'Unknown',
                firstInstallTime: 'Unknown',
                lastUpdateTime: 'Unknown',
                isSystemApp: this.isSystemPackage(packageName)
              });
            }
          } catch (err) {
            this.logger.warn(`Failed to get info for ${packageName}`, err);
            // Add basic info even if detailed info fails
            packages.push({
              packageName,
              versionName: 'Unknown',
              versionCode: 'Unknown',
              installLocation: 'Unknown',
              firstInstallTime: 'Unknown',
              lastUpdateTime: 'Unknown',
              isSystemApp: this.isSystemPackage(packageName)
            });
          }
          
          // Update progress
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
          packages.push({
            packageName,
            versionName: 'N/A',
            versionCode: 'N/A',
            installLocation: 'N/A',
            firstInstallTime: 'N/A',
            lastUpdateTime: 'N/A',
            isSystemApp: this.isSystemPackage(packageName)
          });
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
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `packages-${deviceInfo.model}-${timestamp}.json`;
      
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

      // Compute hash if requested
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

  /**
   * Lista tutti i pacchetti installati
   */
  private async listPackages(): Promise<string[]> {
    const includeSystem = this.config.includeSystem !== false;
    const command = includeSystem ? 'pm list packages' : 'pm list packages -3';
    
    const output = await this.device.commands.shell(command, {
      timeout: 30000 // 30 seconds
    });

    return output
      .split('\n')
      .filter(line => line.startsWith('package:'))
      .map(line => line.replace('package:', '').trim())
      .filter(Boolean);
  }

  /**
   * Ottiene informazioni dettagliate su un pacchetto
   */
  private async getPackageInfo(packageName: string): Promise<PackageInfo | null> {
    try {
      const output = await this.device.commands.shell(
        `dumpsys package ${packageName}`,
        { timeout: 10000 }
      );
      
      if (!output || output.trim().length === 0) {
        return null;
      }

      const info: PackageInfo = {
        packageName,
        versionName: this.extractField(output, 'versionName') || 'Unknown',
        versionCode: this.extractField(output, 'versionCode') || 'Unknown',
        installLocation: this.extractField(output, 'codePath') || 'Unknown',
        firstInstallTime: this.extractField(output, 'firstInstallTime') || 'Unknown',
        lastUpdateTime: this.extractField(output, 'lastUpdateTime') || 'Unknown',
        isSystemApp: this.isSystemPackage(packageName),
        targetSdk: this.extractNumber(output, 'targetSdk'),
        minSdk: this.extractNumber(output, 'minSdk')
      };

      // Extract permissions if requested
      if (this.config.includePermissions) {
        info.permissions = this.extractPermissions(output);
      }

      return info;
    } catch (error) {
      this.logger.debug(`Failed to get package info for ${packageName}`, error);
      return null;
    }
  }

  /**
   * Determina se un pacchetto è di sistema
   */
  private isSystemPackage(packageName: string): boolean {
    // Common system package prefixes
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

  /**
   * Estrae un campo dal dumpsys output
   */
  private extractField(output: string, field: string): string | null {
    const regex = new RegExp(`${field}=([^\\s]+)`, 'i');
    const match = output.match(regex);
    return match?.[1] || null;
  }

  /**
   * Estrae un numero dal dumpsys output
   */
  private extractNumber(output: string, field: string): number | undefined {
    const value = this.extractField(output, field);
    if (!value) return undefined;
    
    const num = parseInt(value, 10);
    return isNaN(num) ? undefined : num;
  }

  /**
   * Estrae le permissions dal dumpsys output
   */
  private extractPermissions(output: string): string[] {
    const permissions: string[] = [];
    const lines = output.split('\n');
    let inPermissionsSection = false;
    
    for (const line of lines) {
      if (line.includes('requested permissions:')) {
        inPermissionsSection = true;
        continue;
      }
      
      if (inPermissionsSection) {
        if (line.trim().startsWith('android.permission.')) {
          const permission = line.trim().split(':')[0];
          if (permission) {
            permissions.push(permission);
          }
        } else if (!line.trim().startsWith('android.') && line.trim().length > 0) {
          // End of permissions section
          break;
        }
      }
    }
    
    return permissions;
  }

  /**
   * Download blob come file
   */
  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Calcola hash SHA-256
   */
  private async computeHash(data: Uint8Array): Promise<string> {
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      throw new Error('Web Crypto API not available');
    }

    const normalizedData = new Uint8Array(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', normalizedData);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Helper per notificare progresso
   */
  private notifyProgress(
    onProgress: ((progress: AcquisitionProgress) => void) | undefined,
    progress: number,
    message: string,
    status: AcquisitionProgress['status'],
    deviceInfo?: AcquisitionProgress['deviceInfo']
  ): void {
    if (onProgress) {
      onProgress({
        progress: Math.min(100, Math.max(0, progress)),
        message,
        status,
        deviceInfo
      });
    }
  }
}