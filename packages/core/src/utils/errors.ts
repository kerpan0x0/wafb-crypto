export class ADBError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ADBError';
    Object.setPrototypeOf(this, ADBError.prototype);
  }
}

export class ADBConnectionError extends ADBError {
  constructor(message: string) {
    super(message);
    this.name = 'ADBConnectionError';
    Object.setPrototypeOf(this, ADBConnectionError.prototype);
  }
}

export class ADBDeviceNotFoundError extends ADBError {
  constructor(message: string) {
    super(message);
    this.name = 'ADBDeviceNotFoundError';
    Object.setPrototypeOf(this, ADBDeviceNotFoundError.prototype);
  }
}

export class ADBCommandError extends ADBError {
  public readonly exitCode: number | undefined;
  public readonly stderr: string | undefined;

  constructor(message: string, exitCode?: number, stderr?: string) {
    super(message);
    this.name = 'ADBCommandError';
    this.exitCode = exitCode;
    this.stderr = stderr;
    Object.setPrototypeOf(this, ADBCommandError.prototype);
  }
}

// ============================================================================
// Errors introduced by the protected-acquisition extension
// ============================================================================

/**
 * Raised when a streaming source produces no data for longer than the idle
 * window *and* the remote process has not reported an exit. In WAFB 0.3.1 this
 * situation was turned into a regular end-of-stream, which made a truncated
 * artefact indistinguishable from a complete one.
 */
export class SourceIdleTimeoutError extends ADBError {
  public readonly idleMs: number;
  public readonly bytesBeforeTimeout: number;

  constructor(idleMs: number, bytesBeforeTimeout: number) {
    super(`Source produced no data for ${idleMs} ms and did not report an exit`);
    this.name = 'SourceIdleTimeoutError';
    this.idleMs = idleMs;
    this.bytesBeforeTimeout = bytesBeforeTimeout;
    Object.setPrototypeOf(this, SourceIdleTimeoutError.prototype);
  }
}

/** Raised on every pending operation when the session owner aborts. */
export class AcquisitionAbortedError extends Error {
  constructor(message = 'Acquisition cancelled') {
    super(message);
    this.name = 'AbortError';
    Object.setPrototypeOf(this, AcquisitionAbortedError.prototype);
  }
}

export function isAbortError(err: unknown): boolean {
  return (
    err instanceof AcquisitionAbortedError ||
    (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError')
  );
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}
