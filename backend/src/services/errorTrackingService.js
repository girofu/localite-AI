const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');

/**
 * 錯誤追蹤和通知服務
 * 負責收集、分類、記錄和通知系統錯誤
 */
class ErrorTrackingService {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.environment = process.env.NODE_ENV || 'development';
    this.notificationThresholds = options.notificationThresholds || {
      critical: 1, // 立即通知
      high: 5, // 5分鐘內累積5次
      medium: 10, // 10分鐘內累積10次
      low: 50, // 1小時內累積50次
    };

    // 錯誤計數器（記憶體中的簡單實現）
    this.errorCounts = new Map();
    this.errorHistory = [];
    this.maxHistorySize = options.maxHistorySize || 1000;

    // 通知服務（可以是 Firebase、Email、Slack 等）
    this.notificationService = options.notificationService || null;

    logger.info('ErrorTrackingService initialized', {
      enabled: this.enabled,
      environment: this.environment,
      thresholds: this.notificationThresholds,
    });
  }

  /**
   * 記錄錯誤
   * @param {Error|string} error - 錯誤對象或錯誤訊息
   * @param {Object} context - 錯誤上下文資訊
   * @param {string} severity - 錯誤嚴重程度 (critical, high, medium, low)
   * @returns {string} 錯誤追蹤 ID
   */
  async trackError(error, context = {}, severity = 'medium') {
    if (!this.enabled) {
      return null;
    }

    const trackingId = uuidv4();
    const timestamp = new Date().toISOString();

    // 標準化錯誤資訊
    const errorInfo = this.normalizeError(error);

    const errorRecord = {
      trackingId,
      timestamp,
      severity,
      message: errorInfo.message,
      stack: errorInfo.stack,
      type: errorInfo.type,
      context: {
        ...context,
        environment: this.environment,
        userAgent: context.userAgent,
        userId: context.userId,
        requestId: context.requestId,
        route: context.route,
        method: context.method,
      },
    };

    // 記錄到日誌系統
    logger.error('Error tracked', errorRecord);

    // 儲存到歷史記錄
    this.addToHistory(errorRecord);

    // 更新錯誤計數
    this.updateErrorCount(errorInfo.signature, severity);

    // 檢查是否需要發送通知
    await this.checkNotificationThreshold(errorInfo.signature, severity, errorRecord);

    return trackingId;
  }

  /**
   * 標準化錯誤物件
   * @param {Error|string} error
   * @returns {Object} 標準化的錯誤資訊
   */
  normalizeError(error) {
    if (error instanceof Error) {
      return {
        message: error.message,
        stack: error.stack,
        type: error.constructor.name,
        signature: this.generateErrorSignature(error.message, error.stack),
      };
    }

    if (typeof error === 'string') {
      return {
        message: error,
        stack: null,
        type: 'CustomError',
        signature: this.generateErrorSignature(error),
      };
    }

    return {
      message: 'Unknown error',
      stack: null,
      type: 'UnknownError',
      signature: 'unknown_error',
    };
  }

  /**
   * 生成錯誤簽名（用於分組相似錯誤）
   * @param {string} message
   * @param {string} stack
   * @returns {string}
   */
  generateErrorSignature(message, stack = '') {
    // 簡化的簽名生成邏輯
    const cleanMessage = message.replace(/\d+/g, 'N').substring(0, 100);
    const stackLines = stack ? stack.split('\n').slice(0, 3).join('|') : '';
    return `${cleanMessage}|${stackLines}`.replace(/[^a-zA-Z0-9|_-]/g, '').substring(0, 200);
  }

  /**
   * 添加錯誤到歷史記錄
   * @param {Object} errorRecord
   */
  addToHistory(errorRecord) {
    this.errorHistory.push(errorRecord);

    // 維護歷史記錄大小限制
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory.shift();
    }
  }

  /**
   * 更新錯誤計數
   * @param {string} signature
   * @param {string} severity
   */
  updateErrorCount(signature, severity) {
    const key = `${signature}:${severity}`;
    const current = this.errorCounts.get(key) || { count: 0, lastSeen: null };

    current.count += 1;
    current.lastSeen = new Date();

    this.errorCounts.set(key, current);
  }

  /**
   * 檢查是否需要發送通知
   * @param {string} signature
   * @param {string} severity
   * @param {Object} errorRecord
   */
  async checkNotificationThreshold(signature, severity, errorRecord) {
    const threshold = this.notificationThresholds[severity];
    if (!threshold) return;

    const key = `${signature}:${severity}`;
    const current = this.errorCounts.get(key);

    if (current && current.count >= threshold) {
      await this.sendNotification(severity, errorRecord, current.count);

      // 重置計數器以避免重複通知
      this.errorCounts.set(key, { count: 0, lastSeen: new Date() });
    }
  }

  /**
   * 發送錯誤通知
   * @param {string} severity
   * @param {Object} errorRecord
   * @param {number} count
   */
  async sendNotification(severity, errorRecord, count) {
    try {
      const notification = {
        title: `${severity.toUpperCase()} Error Alert`,
        message: `Error occurred ${count} times: ${errorRecord.message}`,
        data: {
          trackingId: errorRecord.trackingId,
          severity,
          count: count.toString(),
          environment: this.environment,
        },
      };

      // 記錄通知
      logger.warn('Error notification triggered', {
        severity,
        count,
        trackingId: errorRecord.trackingId,
        message: errorRecord.message,
      });

      // 如果有通知服務，發送通知
      if (this.notificationService && typeof this.notificationService.send === 'function') {
        await this.notificationService.send(notification);
      }
    } catch (notificationError) {
      logger.error('Failed to send error notification', {
        error: notificationError.message,
        originalError: errorRecord.message,
      });
    }
  }

  /**
   * 獲取錯誤統計
   * @param {Object} options
   * @returns {Object} 錯誤統計資訊
   */
  getErrorStats(options = {}) {
    const timeframe = options.timeframe || 3600000; // 預設1小時
    const now = new Date();
    const cutoff = new Date(now.getTime() - timeframe);

    const recentErrors = this.errorHistory.filter((error) => new Date(error.timestamp) >= cutoff);

    // 按嚴重程度分組
    const bySeverity = recentErrors.reduce((acc, error) => {
      acc[error.severity] = (acc[error.severity] || 0) + 1;
      return acc;
    }, {});

    // 按錯誤類型分組
    const byType = recentErrors.reduce((acc, error) => {
      acc[error.type] = (acc[error.type] || 0) + 1;
      return acc;
    }, {});

    // 最常見錯誤
    const errorFrequency = recentErrors.reduce((acc, error) => {
      const key = error.message.substring(0, 100);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const topErrors = Object.entries(errorFrequency)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([message, count]) => ({ message, count }));

    return {
      summary: {
        total: recentErrors.length,
        timeframe: `${timeframe / 1000}s`,
        environment: this.environment,
      },
      bySeverity,
      byType,
      topErrors,
      recentErrorsCount: recentErrors.length,
    };
  }

  /**
   * 獲取特定錯誤的詳細資訊
   * @param {string} trackingId
   * @returns {Object|null}
   */
  getErrorDetails(trackingId) {
    return this.errorHistory.find((error) => error.trackingId === trackingId) || null;
  }

  /**
   * 清理舊的錯誤記錄
   * @param {number} maxAge - 最大保留時間（毫秒）
   */
  cleanup(maxAge = 86400000) {
    // 預設24小時
    const cutoff = new Date(Date.now() - maxAge);

    this.errorHistory = this.errorHistory.filter((error) => new Date(error.timestamp) >= cutoff);

    // 清理錯誤計數器
    const activeKeys = [];
    this.errorCounts.forEach((value, key) => {
      if (value.lastSeen >= cutoff) {
        activeKeys.push(key);
      }
    });

    this.errorCounts.clear();
    activeKeys.forEach((key) => {
      this.errorCounts.set(key, { count: 0, lastSeen: new Date() });
    });

    logger.info('Error tracking cleanup completed', {
      remainingErrors: this.errorHistory.length,
      remainingCounters: this.errorCounts.size,
    });
  }

  /**
   * 設置通知服務
   * @param {Object} service
   */
  setNotificationService(service) {
    this.notificationService = service;
    logger.info('Notification service configured for error tracking');
  }

  /**
   * 獲取錯誤追蹤狀態
   * @returns {Object}
   */
  getStatus() {
    return {
      enabled: this.enabled,
      environment: this.environment,
      errorHistorySize: this.errorHistory.length,
      activeCounters: this.errorCounts.size,
      thresholds: this.notificationThresholds,
      hasNotificationService: !!this.notificationService,
    };
  }
}

module.exports = ErrorTrackingService;
