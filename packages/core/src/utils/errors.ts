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
