export interface ADBCommands<Out> {
  exec(options?: CommandOptions): Promise<Out>;
}

export interface CommandOptions {
  timeout?: number;
  idleTimeout?: number;
  /**
   * When true, throw an {@link ADBCommandError} if the shell exits with a
   * non-zero return code.  The error will carry both `exitCode` and `stderr`.
   * @default false
   */
  throwOnError?: boolean;
}

/**
 * Full result returned by {@link ShellCommand.exec}.
 * Consumers that only need stdout can use the `.stdout` field directly.
 */
export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// +------------------------ Export Commands ------------------------------------------------
export { ShellCommand } from './shellCommand';
export { WhichCommand, RootBinariesCommand } from './whichCommand';
export { BugreportCommand, BugreportzCommand } from './bugreportCommand';
export { ReadFileCommand, WriteFileCommand, DeleteFileCommand } from './fileCommand';
export { GetNetworkInfoCommand, GetStorageInfoCommand } from './getSystemProperty';
export { DumpsysCommand, DumpsysStreamCommand } from './dumpsysCommand';
export type { DumpsysOptions, DumpsysStream } from './dumpsysCommand';
export { GetPropCommand } from './getDevicePropertyCommand';
export { PmCommand } from './pmCommand';
export { IsRootedCommand } from './isRootedCommand';
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
