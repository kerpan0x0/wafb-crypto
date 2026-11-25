/**
 * Single definition of how each acquisition module is run (RF10).
 *
 * In WAFB 0.3.1 the wizard and the advanced page carried two diverging copies
 * of this table (e.g. hashing on in one, off in the other). Both pages now
 * build their ModuleTask list here and hand it to the shared SessionCoordinator.
 *
 * `computeHash` is off for every acquirer: the coordinator computes the single
 * authoritative SHA-256 on the stream it receives, with the same component
 * (hashingPassthrough). File-listing hashes computed on the device are a
 * different quantity and stay inside the file-listing JSON.
 */
import {
  BackupAcquirer,
  BugreportAcquirer,
  DumpsysAcquirer,
  EnvAcquirer,
  FileAcquirer,
  LogAcquirer,
  LogcatAcquirer,
  MountAcquirer,
  PackagesAcquirer,
  ProcessAcquirer,
  RootBinariesAcquirer,
  SELinuxAcquirer,
  ServicesAcquirer,
  SettingsAcquirer,
  SystemInfoAcquirer,
  TmpAcquirer,
} from '@wafb/core';
import type {
  AcquisitionConfig,
  AcquisitionProgress,
  AcquisitionResult,
  AcquisitionType,
  Device,
  ModuleTask,
} from '@wafb/core';

interface AcquirerLike {
  acquire(onProgress?: (p: AcquisitionProgress) => void): Promise<AcquisitionResult>;
}
type AcquirerCtor = new (device: Device, config: AcquisitionConfig & Record<string, unknown>) => AcquirerLike;

const MODULES: Partial<Record<AcquisitionType, { Class: AcquirerCtor; options: Record<string, unknown> }>> = {
  backup: { Class: BackupAcquirer as unknown as AcquirerCtor, options: { type: 'full' } },
  bugreport: { Class: BugreportAcquirer as unknown as AcquirerCtor, options: { cleanupAfter: true } },
  logcat: { Class: LogcatAcquirer as unknown as AcquirerCtor, options: { buffer: 'all', format: 'threadtime' } },
  packages: {
    Class: PackagesAcquirer as unknown as AcquirerCtor,
    options: { includeSystem: true, includeDetails: true, downloadApks: true },
  },
  system_info: {
    Class: SystemInfoAcquirer as unknown as AcquirerCtor,
    options: { includeBattery: true, includeNetwork: false, includeStorage: true, includeMemory: true, includeSensors: true },
  },
  rootBinaries: { Class: RootBinariesAcquirer as unknown as AcquirerCtor, options: {} },
  env: { Class: EnvAcquirer as unknown as AcquirerCtor, options: {} },
  selinux: {
    Class: SELinuxAcquirer as unknown as AcquirerCtor,
    options: { includeContexts: true, includeFileContexts: true, includeDenials: true, maxDenialLines: 100 },
  },
  mount: { Class: MountAcquirer as unknown as AcquirerCtor, options: {} },
  settings: { Class: SettingsAcquirer as unknown as AcquirerCtor, options: {} },
  process: {
    Class: ProcessAcquirer as unknown as AcquirerCtor,
    options: { includeThreads: true, includeSELinuxContext: true },
  },
  services: {
    Class: ServicesAcquirer as unknown as AcquirerCtor,
    options: { includeSystemServices: true, includeUserServices: true, includeServiceDetails: true },
  },
  logs: { Class: LogAcquirer as unknown as AcquirerCtor, options: { includeSystemLogs: true } },
  files: {
    Class: FileAcquirer as unknown as AcquirerCtor,
    options: {
      downloadFiles: false,
      maxStatBatchSize: 30,
      maxHashBatchSize: 15,
      parallelScans: 3,
      computeFileHashes: true,
      hashAlgorithms: ['sha256'],
      maxHashFileSize: 10 * 1024 * 1024,
      excludeHashPaths: ['/system', '/vendor', '/product', '/apex', '/proc'],
      hashMethod: 'auto',
      timeout: 600000,
    },
  },
  tmp: { Class: TmpAcquirer as unknown as AcquirerCtor, options: {} },
  dumpsys: { Class: DumpsysAcquirer as unknown as AcquirerCtor, options: {} },
};

export function isModuleSupported(type: AcquisitionType): boolean {
  return MODULES[type] !== undefined;
}

/** Builds the task list for the coordinator, in the given order. */
export function buildModuleTasks(device: Device, modules: readonly AcquisitionType[]): ModuleTask[] {
  return modules.map(module => {
    const def = MODULES[module];
    if (!def) return { module };
    return {
      module,
      run: ({ signal, onProgress }) =>
        new def.Class(device, { ...def.options, computeHash: false, signal }).acquire(onProgress),
    };
  });
}
