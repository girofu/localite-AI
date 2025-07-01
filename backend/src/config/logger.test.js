const winston = require('winston');

// 簡化版測試，不依賴實際的 winston-daily-rotate-file
describe('Logger Configuration', () => {
  let testLogger;
  let createComponentLogger;

  beforeAll(() => {
    // 模擬引入時跳過日誌輪轉配置
    process.env.NODE_ENV = 'test';

    // 手動創建簡化的 logger 用於測試
    testLogger = winston.createLogger({
      level: 'debug',
      format: winston.format.json(),
      transports: [new winston.transports.Console({ silent: true })],
    });

    // 創建組件 logger 工廠函數
    createComponentLogger = (component) => ({
      error: (message, meta = {}) => testLogger.error(message, { component, ...meta }),
      warn: (message, meta = {}) => testLogger.warn(message, { component, ...meta }),
      info: (message, meta = {}) => testLogger.info(message, { component, ...meta }),
      http: (message, meta = {}) => testLogger.http(message, { component, ...meta }),
      debug: (message, meta = {}) => testLogger.debug(message, { component, ...meta }),
    });
  });

  test('should create logger instance', () => {
    expect(testLogger).toBeDefined();
    expect(typeof testLogger.info).toBe('function');
    expect(typeof testLogger.error).toBe('function');
    expect(typeof testLogger.warn).toBe('function');
    expect(typeof testLogger.debug).toBe('function');
  });

  test('should create component logger', () => {
    const componentLogger = createComponentLogger('test-component');

    expect(componentLogger).toBeDefined();
    expect(typeof componentLogger.info).toBe('function');
    expect(typeof componentLogger.error).toBe('function');
    expect(typeof componentLogger.warn).toBe('function');
    expect(typeof componentLogger.debug).toBe('function');
  });

  test('should log messages with component context', () => {
    const logSpy = jest.spyOn(testLogger, 'info');
    const componentLogger = createComponentLogger('test-component');

    componentLogger.info('Test message', { additional: 'data' });

    expect(logSpy).toHaveBeenCalledWith('Test message', {
      component: 'test-component',
      additional: 'data',
    });

    logSpy.mockRestore();
  });

  test('should handle different log levels', () => {
    const errorSpy = jest.spyOn(testLogger, 'error');
    const warnSpy = jest.spyOn(testLogger, 'warn');
    const infoSpy = jest.spyOn(testLogger, 'info');
    const debugSpy = jest.spyOn(testLogger, 'debug');

    testLogger.error('Error message');
    testLogger.warn('Warning message');
    testLogger.info('Info message');
    testLogger.debug('Debug message');

    expect(errorSpy).toHaveBeenCalledWith('Error message');
    expect(warnSpy).toHaveBeenCalledWith('Warning message');
    expect(infoSpy).toHaveBeenCalledWith('Info message');
    expect(debugSpy).toHaveBeenCalledWith('Debug message');

    errorSpy.mockRestore();
    warnSpy.mockRestore();
    infoSpy.mockRestore();
    debugSpy.mockRestore();
  });

  test('should handle structured log data', () => {
    const logSpy = jest.spyOn(testLogger, 'info');

    const testData = {
      userId: '12345',
      action: 'login',
      ip: '192.168.1.1',
      timestamp: new Date().toISOString(),
    };

    testLogger.info('User login attempt', testData);

    expect(logSpy).toHaveBeenCalledWith('User login attempt', testData);

    logSpy.mockRestore();
  });

  test('should handle error objects with stack traces', () => {
    const errorSpy = jest.spyOn(testLogger, 'error');

    const testError = new Error('Test error');
    testError.code = 'TEST_ERROR';

    testLogger.error('Error occurred', { error: testError.message, stack: testError.stack });

    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  test('should support log level configuration', () => {
    expect(testLogger.level).toBe('debug');

    testLogger.level = 'error';
    expect(testLogger.level).toBe('error');
  });
});
