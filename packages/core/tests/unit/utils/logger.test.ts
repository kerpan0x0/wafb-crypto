import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger } from '../../../src/utils/logger';

describe('Logger', () => {
  let logger: Logger;
  let consoleLogSpy: any;
  let consoleWarnSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    Logger.clearLogs();
    Logger.setLogLevel('debug');
    logger = new Logger('TestContext');
    
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('should log debug messages', () => {
    logger.debug('Debug message');

    const logs = Logger.getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe('debug');
    expect(logs[0].message).toBe('Debug message');
    expect(logs[0].context).toBe('TestContext');
  });

  it('should log info messages', () => {
    logger.info('Info message', { data: 'test' });

    const logs = Logger.getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe('info');
    expect(logs[0].data).toEqual({ data: 'test' });
  });

  it('should log warn messages', () => {
    logger.warn('Warning message');

    const logs = Logger.getLogs();
    expect(logs[0].level).toBe('warn');
    expect(consoleWarnSpy).toHaveBeenCalled();
  });

  it('should log error messages', () => {
    logger.error('Error message');

    const logs = Logger.getLogs();
    expect(logs[0].level).toBe('error');
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('should respect log level', () => {
    Logger.setLogLevel('warn');
    
    logger.debug('Debug message');
    logger.info('Info message');
    logger.warn('Warning message');

    const logs = Logger.getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe('warn');
  });

  it('should limit number of stored logs', () => {
    Logger.clearLogs();
    
    // Log more than maxLogs (1000)
    for (let i = 0; i < 1100; i++) {
      logger.info(`Message ${i}`);
    }

    const logs = Logger.getLogs();
    expect(logs.length).toBeLessThanOrEqual(1000);
  });

  it('should clear logs', () => {
    logger.info('Test message');
    expect(Logger.getLogs()).toHaveLength(1);

    Logger.clearLogs();
    expect(Logger.getLogs()).toHaveLength(0);
  });

  it('should include timestamp in logs', () => {
    logger.info('Test message');

    const logs = Logger.getLogs();
    expect(logs[0].timestamp).toBeInstanceOf(Date);
  });
});
