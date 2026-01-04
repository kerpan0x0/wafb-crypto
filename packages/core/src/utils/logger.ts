// packages/core/src/utils/logger.ts

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  context: string;
  message: string;
  data?: any;
}

export class Logger {
  private static logs: LogEntry[] = [];
  private static maxLogs = 1000;
  private static logLevel: LogLevel = 'info';

  constructor(private context: string) {}

  static setLogLevel(level: LogLevel): void {
    Logger.logLevel = level;
  }

  static getLogs(): LogEntry[] {
    return [...Logger.logs];
  }

  static clearLogs(): void {
    Logger.logs = [];
  }

  debug(message: string, data?: any): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: any): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: any): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: any): void {
    this.log('error', message, data);
  }

  private log(level: LogLevel, message: string, data?: any): void {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    const currentLevelIndex = levels.indexOf(Logger.logLevel);
    const messageLevelIndex = levels.indexOf(level);

    if (messageLevelIndex < currentLevelIndex) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      context: this.context,
      message,
      data
    };

    Logger.logs.push(entry);

    // Mantieni solo gli ultimi N log
    if (Logger.logs.length > Logger.maxLogs) {
      Logger.logs.shift();
    }

    // Console output
    const logMethod = level === 'error' ? console.error :
                      level === 'warn' ? console.warn :
                      level === 'debug' ? console.debug :
                      console.log;

    const timestamp = entry.timestamp.toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${this.context}]`;
    
    if (data) {
      logMethod(prefix, message, data);
    } else {
      logMethod(prefix, message);
    }
  }
}
