export interface ADBCommands<Out> {
    exec(args?: CommandArgs, options?: CommandOptions): Promise<Out>;
}

export interface CommandArgs {
    [key: string]: string;
}

// +------------------------ Command Options ----------------------------------------------------
export interface CommandOptions {
    timeout?: number;
}

export interface LogcatOptions extends CommandOptions {
    buffer?: 'main' | 'system' | 'radio' | 'events' | 'crash' | 'default' | 'all';
    filter?: string;
    maxLines?: number;
    dump?: boolean;
}

export interface ListPackageOptions extends CommandOptions {
    includeSystem?: boolean;
}

export interface PackageInfoOptions extends CommandOptions {
    includePermissions?: boolean;
}

export interface PsOptions extends CommandOptions {
  all?: boolean;
  filter?: string;
  selinux?: boolean;
}

export interface LsOptions extends CommandOptions {
  path?: string;
  all?: boolean;
  long?: boolean;
  recursive?: boolean;
  selinux?: boolean;
  filter?: string;
}
// ---------------------------------------------------------------------------

// +------------------------ Command Output Types ------------------------------------------------
export interface BatteryInfo {
    level: number;
    temperature: number;
    voltage: number;
    status: string;
    health?: string;
    technology?: string;
    present?: boolean;
}

export interface NetworkInfo {
    wifiEnabled: boolean;
    mobileDataEnabled: boolean;
    airplaneModeOn: boolean;
    activeNetworkType?: string;
    ipAddress?: string;
    macAddress?: string;
}

export interface StorageInfo {
    totalInternal: string;
    availableInternal: string;
    totalExternal?: string;
    availableExternal?: string;
}

export interface MemoryInfo {
    totalRam: string;
    availableRam: string;
    lowMemory: boolean;
    threshold: string;
}

export interface SensorInfo {
    name: string;
    type: string;
    vendor?: string;
    version?: string;
    power?: string;
    maxRange?: string;
}

export interface PackageInfoResult {
    packageName: string;
    versionName: string;
    versionCode: string;
    installLocation: string;
    firstInstallTime: string;
    lastUpdateTime: string;
    targetSdk?: number;
    minSdk?: number;
    permissions?: string[];
}
// ---------------------------------------------------------------------------

// +------------------------ Export Commands ------------------------------------------------
export { WhichCommand, RootBinariesCommand } from './whichCommand';
export { GenerateBugReportCommand, GenerateBugReportzCommand } from './generateBugReportCommand';
export {
    ReadFileCommand,
    WriteFileCommand,
    DeleteFileCommand,
} from './fileCommand';
export {
    GetPropCommand,
    GetBatteryInfoCommand,
    GetNetworkInfoCommand,
    GetStorageInfoCommand,
    GetMemoryInfoCommand,
    GetSensorsCommand,
    GetPackageInfoCommand
} from './getDeviceProperty';
export { IsRootedCommand } from './isRootedCommand';
export { EnvCommand } from './envCommand';
export { GetLogcatCommand } from './logcatCommand';
export { ListPackageCommand } from './listPackageCommand';
export { GetenforceCommand } from './getenforceCommand'
export { PsCommand } from './psCommand'
export { LsCommand } from './lsCommand';
export { MountCommand, ProcMountCommand } from './mountCommand';
