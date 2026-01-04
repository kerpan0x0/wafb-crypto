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
  constructor(message: string) {
    super(message);
    this.name = 'ADBCommandError';
    Object.setPrototypeOf(this, ADBCommandError.prototype);
  }
}
