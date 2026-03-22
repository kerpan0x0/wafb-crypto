import type { Device } from '../../adb';
import { PmCommand, DumpsysCommand, ReadFileCommand } from '../../commands';
import { Acquirer } from './acquirer';
import type { AcquisitionConfig, AcquisitionProgress, AcquisitionResult, AcquisitionFile } from '.';


export interface PackagesConfig extends AcquisitionConfig {
  includeSystem?: boolean;
  includeDetails?: boolean;
  includePermissions?: boolean;
  downloadApks?: boolean;
  downloadOnlyThirdParty?: boolean;
  downloadAllSplits?: boolean;
  maxApkSize?: number;
  maxTotalSize?: number;
  parallelDownloads?: number;
}

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
  private readonly DEFAULT_MAX_APK_SIZE = 100 * 1024 * 1024;
  private readonly DEFAULT_MAX_TOTAL_SIZE = 500 * 1024 * 1024;
  private readonly DEFAULT_DOWNLOAD_ALL_SPLITS = false;

  constructor(
    device: Device,
    protected config: PackagesConfig = {}
  ) {
    super(device, config, 'packages');

    if (this.config.downloadApks === undefined) {
      this.config.downloadApks = true;
    }

    if (this.config.downloadOnlyThirdParty === undefined) {
      this.config.downloadOnlyThirdParty = true;
    }

    if (this.config.downloadAllSplits === undefined) {
      this.config.downloadAllSplits = this.DEFAULT_DOWNLOAD_ALL_SPLITS;
    }
  }

  async acquire(onProgress?: (progress: AcquisitionProgress) => void): Promise<AcquisitionResult> {
    const startTime = new Date();

    try {
      const mode = this.config.downloadAllSplits ? 'all splits' : 'smart selection';
      this.logger.info(`Starting packages acquisition (${mode})`);

      this.notifyProgress(onProgress, 10, 'Reading device information...', 'running');
      const deviceInfo = await this.device.getProperties();

      this.notifyProgress(onProgress, 20, `Connected to ${deviceInfo.model}`, 'running', deviceInfo);

      this.notifyProgress(onProgress, 25, 'Listing installed packages...', 'running');
      const pmCommand = new PmCommand(this.device);

      const packagesWithFilesOutput = await pmCommand.exec({
        includeSystem: this.config.includeSystem,
        includeFiles: true,
        includeUid: true,
        timeout: this.config.timeout || 30000,
      });

      this.notifyProgress(onProgress, 30, 'Checking disabled packages...', 'running');
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

      const parsedPackages = this.parsePmListWithFilesAndUid(packagesWithFilesOutput);

      this.logger.info(`Found ${parsedPackages.length} packages`);
      this.notifyProgress(onProgress, 35, `Found ${parsedPackages.length} packages`, 'running');

      const packages: PackageInfo[] = [];
      const progressStep = 15 / Math.max(parsedPackages.length, 1);

      for (let i = 0; i < parsedPackages.length; i++) {
        const { name, path: apkPath, uid } = parsedPackages[i];
        let filePaths: string[] = [apkPath];

        if (this.config.includeDetails !== false) {
          try {
            const dumpsysOutput = await new DumpsysCommand(this.device).exec({
              service: 'package',
              packageName: name,
              timeout: 100000,
            });

            const dumpsysPaths = this.extractApkPaths(dumpsysOutput, name);
            if (dumpsysPaths.length > 0) {
              filePaths = dumpsysPaths;
            }

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

        const currentProgress = 35 + (i + 1) * progressStep;
        this.notifyProgress(
          onProgress,
          Math.min(50, currentProgress),
          `Processing package ${i + 1}/${parsedPackages.length}...`,
          'running'
        );
      }

      this.notifyProgress(onProgress, 50, 'Metadata collection completed', 'running');

      const systemCount = packages.filter(p => p.system).length;
      const userCount = packages.length - systemCount;

      const files: AcquisitionFile[] = [];

      const jsonData = JSON.stringify(packages, null, 4);
      const jsonBlob = new Blob([jsonData], { type: 'application/json' });
      const jsonFileName = this.generateFileName('packages', 'json');

      const jsonFile: AcquisitionFile = {
        fileName: jsonFileName,
        fileSize: jsonBlob.size,
        blob: jsonBlob,
        description: 'Package metadata',
        mimeType: 'application/json',
      };

      if (this.config.computeHash) {
        jsonFile.hash = await this.computeHash(new Uint8Array(await jsonBlob.arrayBuffer()));
      }

      files.push(jsonFile);

      let downloadedCount = 0;

      if (this.config.downloadApks === true) {
        this.logger.info('Starting APK download');

        const packagesToDownload = this.filterPackagesForDownload(packages);

        if (packagesToDownload.length > 0) {
          this.notifyProgress(
            onProgress,
            50,
            `Downloading ${packagesToDownload.length} APKs...`,
            'running'
          );

          const { files: apkFiles, downloadedCount: count } =
            await this.createApksDirectory(packagesToDownload, onProgress);

          downloadedCount = count;

          files.push(...apkFiles);
        }
      }

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      this.notifyProgress(onProgress, 100, 'Packages acquisition completed!', 'completed');

      return {
        success: true,
        type: 'packages',
        files, 
        startTime,
        endTime,
        duration,
        data: {
          totalPackages: packages.length,
          systemPackages: systemCount,
          userPackages: userCount,
          downloadedApks: downloadedCount,
          deviceInfo,
        },
      };

    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error('Packages acquisition failed', error);
      this.notifyProgress(onProgress, 0, `Error: ${errorMessage}`, 'failed');

      return {
        success: false,
        type: 'packages',
        files: [],
        startTime,
        endTime,
        duration,
        error: errorMessage,
      };
    }
  }

  private async createApksDirectory(
    packagesToDownload: PackageInfo[],
    onProgress?: (progress: AcquisitionProgress) => void
  ): Promise<{ files: AcquisitionFile[]; downloadedCount: number }> {
    const maxTotalSize = this.config.maxTotalSize || this.DEFAULT_MAX_TOTAL_SIZE;
    const maxApkSize = this.config.maxApkSize || this.DEFAULT_MAX_APK_SIZE;
    const downloadAllSplits = this.config.downloadAllSplits || this.DEFAULT_DOWNLOAD_ALL_SPLITS;

    const files: AcquisitionFile[] = [];
    let downloadedCount = 0;
    let totalDownloadedSize = 0;
    const totalPackages = packagesToDownload.length;

    for (let i = 0; i < totalPackages; i++) {
      const pkg = packagesToDownload[i];

      if (totalDownloadedSize >= maxTotalSize) {
        this.logger.warn(`Reached max total size (${this.formatBytes(maxTotalSize)}), stopping`);
        break;
      }

      const progress = 55 + Math.round(((i + 1) / totalPackages) * 35);
      this.notifyProgress(
        onProgress,
        Math.min(90, progress),
        `Downloading ${pkg.name} (${i + 1}/${totalPackages})...`,
        'running'
      );

      try {
        if (pkg.files.length === 0) {
          this.logger.debug(`Skipping ${pkg.name}: no APK files found`);
          continue;
        }

        if (downloadAllSplits && pkg.files.length > 1) {
          this.logger.debug(`Downloading all ${pkg.files.length} APK files for ${pkg.name}`);

          let packageDownloaded = false;
          const sanitizedPkgName = this.sanitizeFileName(pkg.name);

          for (const file of pkg.files) {
            try {
              const apkData = await new ReadFileCommand(this.device).exec({
                path: file.path,
                timeout: 60000,
              });

              if (apkData.length > maxApkSize) {
                this.logger.warn(`Skipping ${file.path}: too large`);
                continue;
              }

              if (totalDownloadedSize + apkData.length > maxTotalSize) {
                this.logger.warn(`Would exceed max total size`);
                break;
              }

              const apkBlob = new Blob([apkData] as unknown as BlobPart[], { type: 'application/vnd.android.package-archive' });
              const apkName = file.path.split('/').pop() || 'unknown.apk';

              const apkFile: AcquisitionFile = {
                fileName: `apks/${sanitizedPkgName}/${apkName}`,
                fileSize: apkBlob.size,
                blob: apkBlob,
                description: `APK split for ${sanitizedPkgName}`,
                mimeType: 'application/vnd.android.package-archive',
              };

              if (this.config.computeHash) {
                apkFile.hash = await this.computeHash(apkData);
              }

              files.push(apkFile);
              totalDownloadedSize += apkData.length;
              packageDownloaded = true;

              this.logger.debug(`Added ${apkFile.fileName} (${this.formatBytes(apkData.length)})`);
            } catch (error) {
              this.logger.warn(`Failed to download ${file.path}:`, error);
            }
          }

          if (packageDownloaded) {
            downloadedCount++;
          }

        } else {
          const apkPath = this.selectBestApk(pkg.files);

          this.logger.debug(`Smart selection: ${apkPath}`);

          const apkData = await new ReadFileCommand(this.device).exec({
            path: apkPath,
            timeout: 60000,
          });

          if (apkData.length > maxApkSize) {
            this.logger.warn(`Skipping ${pkg.name}: too large`);
            continue;
          }

          if (totalDownloadedSize + apkData.length > maxTotalSize) {
            this.logger.warn(`Would exceed max total size`);
            break;
          }

          const apkBlob = new Blob([apkData] as unknown as BlobPart[], { type: 'application/vnd.android.package-archive' });
          const sanitizedName = this.sanitizeFileName(pkg.name);

          const apkFile: AcquisitionFile = {
            fileName: `apks/${sanitizedName}.apk`,
            fileSize: apkBlob.size,
            blob: apkBlob,
            description: `APK file for ${sanitizedName}`,
            mimeType: 'application/vnd.android.package-archive',
          };

          if (this.config.computeHash) {
            apkFile.hash = await this.computeHash(apkData);
          }

          files.push(apkFile);
          downloadedCount++;
          totalDownloadedSize += apkData.length;

          this.logger.info(`Added ${apkFile.fileName} (${this.formatBytes(apkData.length)})`);
        }
      } catch (error) {
        this.logger.warn(`Failed to download ${pkg.name}:`, error);
      }
    }

    this.logger.info(`APK download completed: ${downloadedCount} packages, ${this.formatBytes(totalDownloadedSize)}`);

    return { files, downloadedCount };
  }

  private selectBestApk(files: PackageFile[]): string {
    if (files.length === 0) {
      throw new Error('No APK files available');
    }

    if (files.length === 1) {
      return files[0].path;
    }

    const baseApk = files.find(f => f.path.endsWith('/base.apk'));
    if (baseApk) {
      this.logger.debug(`Found base.apk in ${files.length} files`);
      return baseApk.path;
    }

    const nonSplits = files.filter(f => {
      const path = f.path.toLowerCase();
      return !path.includes('split_config') &&
        !path.includes('split.config') &&
        !path.includes('.config.');
    });

    if (nonSplits.length > 0) {
      this.logger.debug(`Selected non-split APK`);
      return nonSplits[0].path;
    }

    this.logger.warn(`Using first file from ${files.length} candidates`);
    return files[0].path;
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private filterPackagesForDownload(packages: PackageInfo[]): PackageInfo[] {
    const downloadOnlyThirdParty = this.config.downloadOnlyThirdParty !== false;
    return packages.filter(pkg => {
      if (downloadOnlyThirdParty && pkg.system) return false;
      return pkg.files.length > 0;
    });
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  private parsePmListWithFilesAndUid(
    output: string
  ): Array<{ name: string; path: string; uid: number }> {
    const results: Array<{ name: string; path: string; uid: number }> = [];

    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('package:')) continue;

      const withoutPrefix = trimmed.substring('package:'.length);
      const uidMatch = withoutPrefix.match(/\s+uid:([\d,]+)$/);
      const uid = uidMatch ? parseInt(uidMatch[1].split(',')[0], 10) : 0;

      const pathAndName = uidMatch ? withoutPrefix.substring(0, uidMatch.index!) : withoutPrefix;
      const lastEqualsIdx = pathAndName.lastIndexOf('=');
      if (lastEqualsIdx === -1) continue;

      const path = pathAndName.substring(0, lastEqualsIdx);
      const name = pathAndName.substring(lastEqualsIdx + 1).trim();

      if (name) {
        results.push({ name, path, uid });
      }
    }

    return results;
  }

  private isSystemPackage(codePath: string): boolean {
    return !codePath.startsWith('/data/app/');
  }

  private extractApkPaths(dumpsysOutput: string, packageName: string): string[] {
    const paths: string[] = [];
    const lines = dumpsysOutput.split('\n');
    const codePath = this.extractField(dumpsysOutput, 'codePath');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.endsWith('.apk') && (trimmed.startsWith('/') || trimmed.includes('/'))) {
        const pathMatch = trimmed.match(/(\/\S+\.apk)/);
        if (pathMatch) {
          paths.push(pathMatch[1]);
        }
      }
    }

    if (paths.length > 0) {
      return [...new Set(paths)];
    }

    if (codePath) {
      if (codePath.endsWith('.apk')) {
        return [codePath];
      }
      return [`${codePath}/base.apk`];
    }

    return [];
  }

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

  private sanitizeFileName(packageName: string): string {
    const sanitized = packageName
      .trim()
      .replace(/\s+uid:[\d,]+/g, '')
      .replace(/\s+/g, '_')
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');

    if (sanitized !== packageName) {
      this.logger.debug(`Sanitized package name: "${packageName}" → "${sanitized}"`);
    }

    return sanitized;
  }
}
