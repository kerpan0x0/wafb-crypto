import type { ShellOptions } from '../adb';

export type { ShellOptions };

/**
 * Base interface for all device commands.
 * A command encapsulates a single operation on an {@link ADBDevice}
 * and returns a typed result.
 */
export interface DeviceCommand<Out> {
  exec(options?: ShellOptions): Promise<Out>;
}

// ── Commands ──────────────────────────────────────────────────────────────────

export { WhichCommand } from './whichCommand';
export { BugreportCommand, BugreportzCommand } from './bugreportCommand';
export type { BugreportStream } from './bugreportCommand';
export { ReadFileCommand, WriteFileCommand, DeleteFileCommand } from './fileCommand';
export { GetNetworkInfoCommand, GetStorageInfoCommand } from './getSystemProperty';
export { DumpsysCommand, DumpsysStreamCommand } from './dumpsysCommand';
export type { DumpsysOptions, DumpsysStream } from './dumpsysCommand';
export { PmCommand } from './pmCommand';
export { EnvCommand } from './envCommand';
export { GetLogcatCommand } from './logcatCommand';
export { GetenforceCommand } from './getenforceCommand';
export { PsCommand } from './psCommand';
export { LsCommand } from './lsCommand';
export { MountCommand, ProcMountCommand } from './mountCommand';
export { CmdCommand } from './cmdCommand';
export { TestFileCommand } from './testCommand';
export { StatCommand, StatBatchCommand } from './statCommand';
export type { StatOptions, StatBatchOptions } from './statCommand';
export { FindCommand } from './findCommand';
export { HashCommand, HashBatchCommand } from './hashCommand';
export type { HashOptions, HashBatchOptions } from './hashCommand';
export { BackupCommand } from './backupCommand';
export type { BackupStream } from './backupCommand';