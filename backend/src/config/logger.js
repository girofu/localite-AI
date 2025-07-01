const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

// 確保日誌目錄存在
const logDir = path.join(__dirname, '../../logs');

/**
 * 自定義日誌格式
 */
const customFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS',
  }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({
    level, message, timestamp, ...meta
  }) => {
    let log = `${timestamp} [${level.toUpperCase()}]`;

    // 如果有 service 信息
    if (meta.service) {
      log += ` [${meta.service}]`;
    }

    // 如果有 component 信息
    if (meta.component) {
      log += ` [${meta.component}]`;
    }

    log += `: ${message}`;

    // 添加額外的 metadata
    const extraMeta = { ...meta };
    delete extraMeta.service;
    delete extraMeta.component;
    delete extraMeta.timestamp;

    if (Object.keys(extraMeta).length > 0) {
      log += ` | ${JSON.stringify(extraMeta)}`;
    }

    return log;
  }),
);

/**
 * JSON 格式（用於日誌檔案）
 */
const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

/**
 * 建立日誌傳輸配置
 */
const createTransports = () => {
  const transports = [];

  // 錯誤日誌（每日輪轉）
  transports.push(
    new DailyRotateFile({
      filename: path.join(logDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '30d',
      format: jsonFormat,
      auditFile: path.join(logDir, 'error-audit.json'),
    }),
  );

  // 一般日誌（每日輪轉）
  transports.push(
    new DailyRotateFile({
      filename: path.join(logDir, 'app-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
      format: jsonFormat,
      auditFile: path.join(logDir, 'app-audit.json'),
    }),
  );

  // HTTP 請求日誌（每日輪轉）
  transports.push(
    new DailyRotateFile({
      filename: path.join(logDir, 'access-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'http',
      maxSize: '20m',
      maxFiles: '30d',
      format: jsonFormat,
      auditFile: path.join(logDir, 'access-audit.json'),
    }),
  );

  // 開發環境控制台輸出
  if (process.env.NODE_ENV !== 'production') {
    transports.push(
      new winston.transports.Console({
        format: winston.format.combine(winston.format.colorize(), customFormat),
      }),
    );
  }

  return transports;
};

/**
 * 建立 logger 實例
 */
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4,
  },
  defaultMeta: {
    service: 'localite-backend',
    environment: process.env.NODE_ENV || 'development',
    version: process.env.APP_VERSION || '1.0.0',
  },
  transports: createTransports(),
  exitOnError: false,
});

/**
 * 建立特定組件的 logger
 */
const createComponentLogger = (component) => ({
  error: (message, meta = {}) => logger.error(message, { component, ...meta }),
  warn: (message, meta = {}) => logger.warn(message, { component, ...meta }),
  info: (message, meta = {}) => logger.info(message, { component, ...meta }),
  http: (message, meta = {}) => logger.http(message, { component, ...meta }),
  debug: (message, meta = {}) => logger.debug(message, { component, ...meta }),
});

/**
 * 處理未捕獲的異常和 Promise 拒絕
 */
const setupGlobalErrorHandling = () => {
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', {
      error: error.message,
      stack: error.stack,
      type: 'uncaughtException',
    });

    // 優雅關閉
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection:', {
      reason: reason.toString(),
      promise: promise.toString(),
      type: 'unhandledRejection',
    });
  });
};

// 設置全域錯誤處理
setupGlobalErrorHandling();

module.exports = {
  logger,
  createComponentLogger,
};
