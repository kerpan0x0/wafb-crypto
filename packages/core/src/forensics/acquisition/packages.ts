import { DumpsysCommand, PmCommand } from '../../adb/commands';
import type { ADBDevice } from '../../adb';
import { Acquirer } from './acquirer';
import type { AcquisitionConfig, AcquisitionProgress, AcquisitionResult } from '.';

export interface PackagesConfig extends AcquisitionConfig {
  includeSystem?: boolean;
  includeDetails?: boolean;
  includePermissions?: boolean;
}

// Certificate information stub (androidqf-compatible)
export interface PackageCertificate {
  Md5: string;
  Sha1: string;
  Sha256: string;
  ValidFrom: string;
  ValidTo: string;
  Issuer: string;
  Subject: string;
  SignatureAlgorithm: string;
  SerialNumber: string | null;
}

// File entry for a package (androidqf-compatible)
export interface PackageFile {
  path: string;
  local_name: string;
  md5: string;
  sha1: string;
  sha256: string;
  sha512: string;
  error: string;
  verified_certificate: boolean;
  certificate: PackageCertificate;
  certificate_error: string;
  trusted_certificate: boolean;
}

// Package info matching androidqf output format
export interface PackageInfo {
  name: string;
  files: PackageFile[];
  installer: string;
  uid: number;
  disabled: boolean;
  system: boolean;
  third_party: boolean;
}

export class PackagesAcquirer extends Acquirer {
  constructor(
    device: ADBDevice,
    private packagesConfig: PackagesConfig = {}
  ) {
    super(device, packagesConfig, 'packages');
  }

  async acquire(onProgress?: (progress: AcquisitionProgress) => void): Promise<AcquisitionResult> {
    const startTime = new Date();

    try {
      this.logger.info('Starting packages acquisition');

      this.notifyProgress(onProgress, 10, 'Reading device information...', 'running');
      const deviceInfo = await this.device.getProperties();

      this.notifyProgress(
        onProgress,
        20,
        `Connected to ${deviceInfo.model}`,
        'running',
        deviceInfo
      );

      // Step 1: Get all packages with file paths and UIDs
      this.notifyProgress(onProgress, 30, 'Listing installed packages...', 'running');
      const pmCommand = new PmCommand(this.device.adb);

      const packagesWithFilesOutput = await pmCommand.exec({
        includeSystem: this.packagesConfig.includeSystem,
        includeFiles: true,
        includeUid: true,
        timeout: this.config.timeout || 30000,
      });

      // Step 2: Get disabled packages list
      this.notifyProgress(onProgress, 40, 'Checking disabled packages...', 'running');
      const disabledOutput = await pmCommand.exec({
        disabledOnly: true,
        timeout: this.config.timeout || 30000,
      });

      const disabledPackages = new Set(
        disabledOutput
          .split('\n')
          .filter(line => line.startsWith('package:'))
          .map(line => line.replace('package:', '').trim())
          .filter(Boolean)
      );

      // Step 3: Parse packages with file paths and UIDs
      // Format: package:<path>=<name> uid:<uid>
      const parsedPackages = this.parsePmListWithFilesAndUid(packagesWithFilesOutput);

      this.logger.info(`Found ${parsedPackages.length} packages`);
      this.notifyProgress(onProgress, 50, `Found ${parsedPackages.length} packages`, 'running');

      // Step 4: Get split APK paths from dumpsys for each package
      const packages: PackageInfo[] = [];
      const progressStep = 40 / Math.max(parsedPackages.length, 1);

      for (let i = 0; i < parsedPackages.length; i++) {
        const { name, path: apkPath, uid } = parsedPackages[i];

        let filePaths: string[] = [apkPath];

        if (this.packagesConfig.includeDetails !== false) {
          try {
            const dumpsysOutput = await new DumpsysCommand(this.device.adb).exec({
              service: 'package',
              packageName: name,
              timeout: 100000,
            });

            // Extract all APK paths (base + splits) from dumpsys output
            const dumpsysPaths = this.extractApkPaths(dumpsysOutput, name);
            if (dumpsysPaths.length > 0) {
              filePaths = dumpsysPaths;
            }

            // Extract installer from dumpsys
            const installer = this.extractField(dumpsysOutput, 'installerPackageName');
            const isDisabled = disabledPackages.has(name);
            const isSystem = this.isSystemPackage(apkPath);

            packages.push({
              name,
              files: filePaths.map(p => this.createFileEntry(p)),
              installer: installer || 'null',
              uid,
              disabled: isDisabled,
              system: isSystem,
              third_party: !isSystem,
            });
          } catch (err) {
            this.logger.warn(`Failed to get info for ${name}`, err);
            const isDisabled = disabledPackages.has(name);
            const isSystem = this.isSystemPackage(apkPath);

            packages.push({
              name,
              files: filePaths.map(p => this.createFileEntry(p)),
              installer: 'null',
              uid,
              disabled: isDisabled,
              system: isSystem,
              third_party: !isSystem,
            });
          }
        } else {
          const isDisabled = disabledPackages.has(name);
          const isSystem = this.isSystemPackage(apkPath);

          packages.push({
            name,
            files: filePaths.map(p => this.createFileEntry(p)),
            installer: 'null',
            uid,
            disabled: isDisabled,
            system: isSystem,
            third_party: !isSystem,
          });
        }

        const currentProgress = 50 + (i + 1) * progressStep;
        this.notifyProgress(
          onProgress,
          Math.min(90, currentProgress),
          `Processing package ${i + 1}/${parsedPackages.length}...`,
          'running'
        );
      }

      // Step 5: Build result data
      this.notifyProgress(onProgress, 90, 'Preparing export...', 'running');

      const systemCount = packages.filter(p => p.system).length;
      const userCount = packages.length - systemCount;

      // Output direct array for MVT/androidqf compatibility
      const jsonData = JSON.stringify(packages, null, 4);
      const jsonBytes = new TextEncoder().encode(jsonData);

      const blob = new Blob([jsonBytes], { type: 'application/json' });
      const fileName = this.generateFileName('packages', 'json');

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      this.notifyProgress(onProgress, 100, 'Packages acquisition completed!', 'completed');

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
          deviceInfo,
        },
        blob,
      };

      if (this.config.computeHash) {
        result.hash = await this.computeHash(jsonBytes);
      }

      this.logger.info('Packages acquisition completed', {
        fileName,
        totalPackages: packages.length,
        duration,
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
        error: errorMessage,
      };
    }
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Parse output from `pm list packages -f -U`
   * Format: package:<path>=<name> uid:<uid>
   */
  private parsePmListWithFilesAndUid(
    output: string
  ): Array<{ name: string; path: string; uid: number }> {
    const results: Array<{ name: string; path: string; uid: number }> = [];

    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('package:')) continue;

      // Format: package:/path/to/app.apk=com.example.app uid:10123
      const withoutPrefix = trimmed.substring('package:'.length);

      // Extract uid from the end
      const uidMatch = withoutPrefix.match(/\s+uid:(\d+)$/);
      const uid = uidMatch ? parseInt(uidMatch[1], 10) : 0;

      // Remove the uid part
      const pathAndName = uidMatch ? withoutPrefix.substring(0, uidMatch.index!) : withoutPrefix;

      // Split path and name by the last '='
      const lastEqualsIdx = pathAndName.lastIndexOf('=');
      if (lastEqualsIdx === -1) continue;

      const path = pathAndName.substring(0, lastEqualsIdx);
      const name = pathAndName.substring(lastEqualsIdx + 1);

      if (name) {
        results.push({ name, path, uid });
      }
    }

    return results;
  }

  /**
   * Determine if a package is a system package based on its install path.
   * System packages reside outside /data/app/
   */
  private isSystemPackage(codePath: string): boolean {
    // Third-party (non-system) packages are installed under /data/app/
    return !codePath.startsWith('/data/app/');
  }

  /**
   * Extract all APK file paths from dumpsys package output.
   * Includes base APK and split APKs.
   */
  private extractApkPaths(dumpsysOutput: string, packageName: string): string[] {
    const paths: string[] = [];
    const lines = dumpsysOutput.split('\n');

    // Look for codePath to find the base directory
    const codePath = this.extractField(dumpsysOutput, 'codePath');

    // Look for individual APK paths in the dumpsys output
    // Pattern: path lines that end with .apk
    for (const line of lines) {
      const trimmed = line.trim();
      // Match lines like: /data/app/.../base.apk
      // or lines in the splits section
      if (trimmed.endsWith('.apk') && (trimmed.startsWith('/') || trimmed.includes('/'))) {
        // Clean up the path - it might be just the path or have a prefix
        const pathMatch = trimmed.match(/(\/\S+\.apk)/);
        if (pathMatch) {
          paths.push(pathMatch[1]);
        }
      }
    }

    // If we found paths, return them deduplicated
    if (paths.length > 0) {
      return [...new Set(paths)];
    }

    // Fallback: if codePath points to a directory, add base.apk
    if (codePath) {
      if (codePath.endsWith('.apk')) {
        return [codePath];
      }
      return [`${codePath}/base.apk`];
    }

    return [];
  }

  /**
   * Create an empty file entry stub matching the androidqf format.
   * Certificate and hash fields are left empty (same as androidqf).
   */
  private createFileEntry(path: string): PackageFile {
    return {
      path,
      local_name: '',
      md5: '',
      sha1: '',
      sha256: '',
      sha512: '',
      error: '',
      verified_certificate: false,
      certificate: {
        Md5: '',
        Sha1: '',
        Sha256: '',
        ValidFrom: '0001-01-01T00:00:00Z',
        ValidTo: '0001-01-01T00:00:00Z',
        Issuer: '',
        Subject: '',
        SignatureAlgorithm: '',
        SerialNumber: null,
      },
      certificate_error: '',
      trusted_certificate: false,
    };
  }

  private extractField(output: string, field: string): string | null {
    const regex = new RegExp(`${field}=([^\\s]+)`, 'i');
    const match = output.match(regex);
    return match?.[1] || null;
  }
}
