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

  constructor(private context: string) { }

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

    if (Logger.logs.length > Logger.maxLogs) {
      Logger.logs.shift();
    }

    // 1. Selezioniamo il metodo corretto
    const logFn = level === 'error' ? console.error :
      level === 'warn' ? console.warn :
        level === 'debug' ? console.debug :
          console.info; // Usiamo info per i messaggi standard

    const timestamp = entry.timestamp.toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${this.context}]`;

    const styles = {
      debug: 'color: gray',
      info: 'color: #2196F3',
      warn: 'color: #FF9800; font-weight: bold',
      error: 'color: #F44336; font-weight: bold'
    };

    if (data) {
      logFn(`%c${prefix}`, styles[level], message, data);
    } else {
      logFn(`%c${prefix}`, styles[level], message);
    }
  }
}
