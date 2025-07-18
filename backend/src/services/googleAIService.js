const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const { logger } = require('../config/logger');

// 新增 Redis 連接
let redisConnection;
try {
  const redisConfig = require('../config/redis');
  redisConnection = redisConfig.redisConnection;
} catch (error) {
  logger.warn('Redis connection not available, using in-memory rate limiting');
}

// 新增：錯誤分類和處理常量
const ERROR_TYPES = {
  AUTHENTICATION: 'AUTHENTICATION',
  NETWORK: 'NETWORK',
  API_QUOTA: 'API_QUOTA',
  RATE_LIMIT: 'RATE_LIMIT',
  VALIDATION: 'VALIDATION',
  CONTENT_POLICY: 'CONTENT_POLICY',
  TIMEOUT: 'TIMEOUT',
  GENERIC: 'GENERIC',
  INTERNAL: 'INTERNAL',
  RESPONSE_PARSING: 'RESPONSE_PARSING',
  BLOCKED_PROMPT: 'BLOCKED_PROMPT',
  SAFETY_FILTER: 'SAFETY_FILTER',
};

const ERROR_RECOVERY_STRATEGIES = {
  RETRY_WITH_BACKOFF: 'retry_with_backoff',
  SWITCH_KEY: 'switch_key',
  IMMEDIATE_RETRY: 'immediate_retry',
  NO_RETRY: 'no_retry',
  DELAYED_RETRY: 'delayed_retry',
};

// 新增：錯誤處理配置
const ERROR_HANDLING_CONFIG = {
  maxRetryAttempts: 3,
  baseRetryDelay: 1000, // 1秒
  maxRetryDelay: 30000, // 30秒
  retryMultiplier: 2,
  timeoutMs: 30000,
  enableDetailedErrorLogging: process.env.NODE_ENV === 'development',
};

// 速率限制和配額配置
const RATE_LIMIT_CONFIG = {
  // 每分鐘請求限制
  requestsPerMinute: parseInt(process.env.GOOGLE_AI_RATE_LIMIT_PER_MINUTE, 10) || 60,
  // 每小時請求限制
  requestsPerHour: parseInt(process.env.GOOGLE_AI_RATE_LIMIT_PER_HOUR, 10) || 1000,
  // 每日配額限制
  dailyQuota: parseInt(process.env.GOOGLE_AI_DAILY_QUOTA, 10) || 10000,
  // 每月配額限制
  monthlyQuota: parseInt(process.env.GOOGLE_AI_MONTHLY_QUOTA, 10) || 100000,
  // 速率限制恢復時間（秒）
  rateLimitCooldown: parseInt(process.env.GOOGLE_AI_RATE_LIMIT_COOLDOWN, 10) || 60,
  // 配額重設時間（小時）
  quotaResetHours: parseInt(process.env.GOOGLE_AI_QUOTA_RESET_HOURS, 10) || 24,
};

// 成本控制配置
const COST_CONFIG = {
  // 基礎成本計算（每1000個字符的成本，單位：美元）
  costPerThousandChars: parseFloat(process.env.GOOGLE_AI_COST_PER_1K_CHARS) || 0.001,
  // 每日預算限制（美元）
  dailyBudget: parseFloat(process.env.GOOGLE_AI_DAILY_BUDGET) || 100,
  // 每月預算限制（美元）
  monthlyBudget: parseFloat(process.env.GOOGLE_AI_MONTHLY_BUDGET) || 1000,
  // 預算警告閾值（百分比）
  budgetWarningThreshold: parseFloat(process.env.GOOGLE_AI_BUDGET_WARNING_THRESHOLD) || 0.8,
  // 成本監控間隔（毫秒）
  costMonitoringInterval: parseInt(process.env.GOOGLE_AI_COST_MONITORING_INTERVAL, 10) || 60000,
};

// 記憶體快取用於備援
const memoryCache = new Map();

// 請求佇列和批次處理配置
const QUEUE_CONFIG = {
  maxQueueSize: parseInt(process.env.GOOGLE_AI_MAX_QUEUE_SIZE, 10) || 1000,
  batchSize: parseInt(process.env.GOOGLE_AI_BATCH_SIZE, 10) || 5,
  batchTimeout: parseInt(process.env.GOOGLE_AI_BATCH_TIMEOUT, 10) || 100, // 毫秒
  maxConcurrency: parseInt(process.env.GOOGLE_AI_MAX_CONCURRENCY, 10) || 10,
  backgroundProcessingInterval: parseInt(process.env.GOOGLE_AI_BACKGROUND_INTERVAL, 10) || 5000,
  priorityLevels: ['high', 'medium', 'low', 'background'],
};

// 請求優先級定義
const PRIORITY_LEVELS = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  BACKGROUND: 'background',
};

class GoogleAIService {
  constructor(apiKeys = null, options = {}) {
    // 從參數或環境變數中載入 API 金鑰
    this.apiKeys = this._loadApiKeys(apiKeys);
    if (!this.apiKeys || this.apiKeys.length === 0) {
      throw new Error('At least one Google AI API key is required.');
    }

    // 速率限制選項
    this.options = {
      enableRateLimit: options.enableRateLimit !== false,
      enableQuotaManagement: options.enableQuotaManagement !== false,
      useRedis: options.useRedis !== false && redisConnection,
      enableRequestQueue: options.enableRequestQueue !== false,
      enableBatchProcessing: options.enableBatchProcessing !== false,
      ...options,
    };

    // 初始化金鑰管理狀態
    this.currentKeyIndex = 0;
    this.keyStats = new Map();
    this.keyClients = new Map();

    // 新增：錯誤統計
    this.errorStats = {
      totalErrors: 0,
      errorsByType: {},
      recentErrors: [],
      errorsByKey: new Map(),
    };

    // 新增：請求佇列系統
    this.requestQueue = {
      high: [],
      medium: [],
      low: [],
      background: [],
    };

    // 新增：批次處理狀態
    this.batchProcessing = {
      isProcessing: false,
      currentBatch: [],
      pendingBatches: [],
      batchTimeout: null,
      concurrentRequests: 0,
      lastProcessTime: Date.now(),
    };

    // 新增：請求佇列統計
    this.queueStats = {
      totalQueued: 0,
      totalProcessed: 0,
      totalCompleted: 0,
      totalFailed: 0,
      averageWaitTime: 0,
      averageProcessingTime: 0,
      queueSizes: {
        high: 0,
        medium: 0,
        low: 0,
        background: 0,
      },
      batchStats: {
        totalBatches: 0,
        averageBatchSize: 0,
        completedBatches: 0,
        failedBatches: 0,
      },
    };

    // 新增：成本追蹤和控制
    this.costTracking = {
      totalCost: 0,
      dailyCost: 0,
      monthlyCost: 0,
      totalCharacters: 0,
      dailyCharacters: 0,
      monthlyCharacters: 0,
      lastDailyReset: new Date().toDateString(),
      lastMonthlyReset: new Date().getMonth(),
      costHistory: [],
      budgetAlerts: [],
      isOverBudget: false,
      isBudgetWarning: false,
    };

    // 新增：使用量統計
    this.usageStats = {
      totalRequests: 0,
      dailyRequests: 0,
      monthlyRequests: 0,
      requestsByPriority: {
        high: 0,
        medium: 0,
        low: 0,
        background: 0,
      },
      requestsByHour: new Array(24).fill(0),
      requestsByDay: new Array(7).fill(0),
      peakUsageTime: null,
      averageRequestSize: 0,
      costEfficiency: 0,
    };

    // 為每個金鑰初始化統計和客戶端
    this._initializeKeys();

    // 初始化速率限制管理器
    this._initializeRateLimiter();

    // 新增：初始化錯誤統計
    this._initializeErrorStats();

    // 新增：初始化請求佇列系統
    this._initializeRequestQueue();

    logger.info(`GoogleAIService initialized with ${this.apiKeys.length} API keys`, {
      rateLimit: this.options.enableRateLimit,
      quotaManagement: this.options.enableQuotaManagement,
      useRedis: this.options.useRedis,
      requestQueue: this.options.enableRequestQueue,
      batchProcessing: this.options.enableBatchProcessing,
      queueConfig: QUEUE_CONFIG,
    });
  }

  /**
   * 新增：初始化錯誤統計
   */
  _initializeErrorStats() {
    // 初始化每種錯誤類型的計數器
    Object.values(ERROR_TYPES).forEach(type => {
      this.errorStats.errorsByType[type] = 0;
    });

    // 為每個金鑰初始化錯誤統計
    for (let i = 0; i < this.apiKeys.length; i++) {
      this.errorStats.errorsByKey.set(i, {
        totalErrors: 0,
        errorsByType: {},
        lastError: null,
        lastErrorTime: null,
      });

      // 初始化每個金鑰的錯誤類型計數
      Object.values(ERROR_TYPES).forEach(type => {
        this.errorStats.errorsByKey.get(i).errorsByType[type] = 0;
      });
    }
  }

  /**
   * 新增：分析並分類錯誤
   */
  _analyzeError(error, keyIndex = null) {
    const errorMessage = error.message || error.toString();
    const errorCode = error.code || null;

    let errorType = ERROR_TYPES.GENERIC;
    let recoveryStrategy = ERROR_RECOVERY_STRATEGIES.RETRY_WITH_BACKOFF;
    let isRetryable = true;
    let retryDelay = ERROR_HANDLING_CONFIG.baseRetryDelay;

    // 分析錯誤類型
    if (errorCode === 'RATE_LIMIT_EXCEEDED' || errorMessage.includes('rate limit')) {
      errorType = ERROR_TYPES.RATE_LIMIT;
      recoveryStrategy = ERROR_RECOVERY_STRATEGIES.SWITCH_KEY;
      isRetryable = true;
      retryDelay = ERROR_HANDLING_CONFIG.baseRetryDelay * 2;
    } else if (errorCode === 'QUOTA_EXCEEDED' || errorMessage.includes('quota')) {
      errorType = ERROR_TYPES.API_QUOTA;
      recoveryStrategy = ERROR_RECOVERY_STRATEGIES.SWITCH_KEY;
      isRetryable = true;
      retryDelay = ERROR_HANDLING_CONFIG.baseRetryDelay * 3;
    } else if (
      errorMessage.includes('401') ||
      errorMessage.includes('authentication') ||
      errorMessage.includes('unauthorized')
    ) {
      errorType = ERROR_TYPES.AUTHENTICATION;
      recoveryStrategy = ERROR_RECOVERY_STRATEGIES.SWITCH_KEY;
      isRetryable = true;
    } else if (errorMessage.includes('timeout') || errorMessage.includes('TIMEOUT')) {
      errorType = ERROR_TYPES.TIMEOUT;
      recoveryStrategy = ERROR_RECOVERY_STRATEGIES.RETRY_WITH_BACKOFF;
      isRetryable = true;
      retryDelay = ERROR_HANDLING_CONFIG.baseRetryDelay * 1.5;
    } else if (
      errorMessage.includes('network') ||
      errorMessage.includes('connection') ||
      errorMessage.includes('ECONNRESET')
    ) {
      errorType = ERROR_TYPES.NETWORK;
      recoveryStrategy = ERROR_RECOVERY_STRATEGIES.RETRY_WITH_BACKOFF;
      isRetryable = true;
    } else if (
      errorMessage.includes('blocked') ||
      errorMessage.includes('safety') ||
      errorMessage.includes('policy')
    ) {
      errorType = ERROR_TYPES.CONTENT_POLICY;
      recoveryStrategy = ERROR_RECOVERY_STRATEGIES.NO_RETRY;
      isRetryable = false;
    } else if (errorMessage.includes('validation') || errorMessage.includes('invalid input')) {
      errorType = ERROR_TYPES.VALIDATION;
      recoveryStrategy = ERROR_RECOVERY_STRATEGIES.NO_RETRY;
      isRetryable = false;
    } else if (
      errorMessage.includes('parse') ||
      errorMessage.includes('json') ||
      errorMessage.includes('response')
    ) {
      errorType = ERROR_TYPES.RESPONSE_PARSING;
      recoveryStrategy = ERROR_RECOVERY_STRATEGIES.IMMEDIATE_RETRY;
      isRetryable = true;
    }

    // 建立結構化錯誤資訊
    const errorInfo = {
      type: errorType,
      originalError: error,
      message: errorMessage,
      code: errorCode,
      keyIndex,
      timestamp: new Date().toISOString(),
      recoveryStrategy,
      isRetryable,
      retryDelay,
      stack: error.stack,
    };

    // 記錄錯誤統計
    this._recordErrorStats(errorInfo);

    return errorInfo;
  }

  /**
   * 新增：記錄錯誤統計
   */
  _recordErrorStats(errorInfo) {
    // 更新全局錯誤統計
    this.errorStats.totalErrors++;
    this.errorStats.errorsByType[errorInfo.type]++;

    // 保持最近錯誤記錄（最多100個）
    this.errorStats.recentErrors.unshift(errorInfo);
    if (this.errorStats.recentErrors.length > 100) {
      this.errorStats.recentErrors.pop();
    }

    // 更新特定金鑰的錯誤統計
    if (errorInfo.keyIndex !== null && this.errorStats.errorsByKey.has(errorInfo.keyIndex)) {
      const keyErrorStats = this.errorStats.errorsByKey.get(errorInfo.keyIndex);
      keyErrorStats.totalErrors++;
      keyErrorStats.errorsByType[errorInfo.type]++;
      keyErrorStats.lastError = errorInfo;
      keyErrorStats.lastErrorTime = errorInfo.timestamp;
    }

    // 記錄詳細錯誤信息（僅在開發環境）
    if (ERROR_HANDLING_CONFIG.enableDetailedErrorLogging) {
      logger.error('Detailed error analysis', {
        errorType: errorInfo.type,
        keyIndex: errorInfo.keyIndex,
        message: errorInfo.message,
        recoveryStrategy: errorInfo.recoveryStrategy,
        isRetryable: errorInfo.isRetryable,
        stack: errorInfo.stack,
      });
    }
  }

  /**
   * 新增：驗證 API 回應
   */
  _validateResponse(response) {
    const validationResult = {
      isValid: true,
      errors: [],
      warnings: [],
    };

    try {
      // 基本結構驗證
      if (!response) {
        validationResult.isValid = false;
        validationResult.errors.push('Response is null or undefined');
        return validationResult;
      }

      if (!response.response) {
        validationResult.isValid = false;
        validationResult.errors.push('Missing response object');
        return validationResult;
      }

      // 檢查是否有text()方法
      if (!response.response.text || typeof response.response.text !== 'function') {
        validationResult.isValid = false;
        validationResult.errors.push('Response text method not available');
        return validationResult;
      }

      // 檢查安全性過濾
      if (response.response.promptFeedback) {
        const feedback = response.response.promptFeedback;
        if (feedback.blockReason) {
          validationResult.isValid = false;
          validationResult.errors.push(`Content blocked: ${feedback.blockReason}`);
        }
      }

      // 檢查候選回應
      if (response.response.candidates) {
        const { candidates } = response.response;
        if (candidates.length === 0) {
          validationResult.isValid = false;
          validationResult.errors.push('No response candidates available');
        } else {
          // 檢查第一個候選回應
          const firstCandidate = candidates[0];
          if (firstCandidate.finishReason === 'SAFETY') {
            validationResult.warnings.push('Response filtered for safety reasons');
          }
        }
      }

      return validationResult;
    } catch (error) {
      validationResult.isValid = false;
      validationResult.errors.push(`Response validation error: ${error.message}`);
      return validationResult;
    }
  }

  /**
   * 新增：處理 API 回應
   */
  async _processResponse(response, keyIndex) {
    const startTime = Date.now();

    try {
      // 驗證回應
      const validation = this._validateResponse(response);

      if (!validation.isValid) {
        const error = new Error(`Invalid response: ${validation.errors.join(', ')}`);
        error.code = 'RESPONSE_VALIDATION_FAILED';
        error.validationErrors = validation.errors;
        throw error;
      }

      // 記錄警告
      if (validation.warnings.length > 0) {
        logger.warn('Response validation warnings', {
          keyIndex,
          warnings: validation.warnings,
        });
      }

      // 提取文本內容
      const text = response.response.text();

      // 基本內容驗證
      if (!text || text.trim().length === 0) {
        const error = new Error('Empty response text');
        error.code = 'EMPTY_RESPONSE';
        throw error;
      }

      // 記錄成功處理
      const processingTime = Date.now() - startTime;
      logger.debug('Response processed successfully', {
        keyIndex,
        processingTime,
        textLength: text.length,
      });

      return {
        text,
        processingTime,
        keyIndex,
        warnings: validation.warnings,
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      logger.error('Response processing failed', {
        keyIndex,
        processingTime,
        error: error.message,
      });

      // 重新拋出增強的錯誤
      const enhancedError = new Error(`Response processing failed: ${error.message}`);
      enhancedError.code = 'RESPONSE_PROCESSING_FAILED';
      enhancedError.originalError = error;
      enhancedError.keyIndex = keyIndex;
      throw enhancedError;
    }
  }

  /**
   * 新增：計算重試延遲
   */

  /**
   * 新增：執行重試延遲
   */
  async _delayRetry(delayMs) {
    if (delayMs > 0) {
      logger.debug(`Retrying after ${delayMs}ms delay`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  /**
   * 新增：創建詳細錯誤回應
   */
  _createDetailedError(errorInfo, context = {}) {
    const error = new Error(errorInfo.message);
    error.code = errorInfo.code || errorInfo.type;
    error.type = errorInfo.type;
    error.keyIndex = errorInfo.keyIndex;
    error.timestamp = errorInfo.timestamp;
    error.recoveryStrategy = errorInfo.recoveryStrategy;
    error.isRetryable = errorInfo.isRetryable;
    error.context = context;
    error.originalError = errorInfo.originalError;

    return error;
  }

  /**
   * 初始化速率限制管理器
   */
  _initializeRateLimiter() {
    // 速率限制統計
    this.rateLimitStats = {
      totalRequests: 0,
      rateLimitedRequests: 0,
      quotaExceededRequests: 0,
      lastResetTime: Date.now(),
    };

    // 檢查 Redis 連接
    if (this.options.useRedis) {
      this._checkRedisConnection();
    }
  }

  /**
   * 檢查 Redis 連接狀態
   */
  async _checkRedisConnection() {
    try {
      if (redisConnection && redisConnection.isConnected) {
        await redisConnection.ping();
        logger.info('Redis connection verified for rate limiting');
      } else {
        logger.warn('Redis not connected, falling back to memory-based rate limiting');
        this.options.useRedis = false;
      }
    } catch (error) {
      logger.warn('Redis connection check failed, using memory-based rate limiting', {
        error: error.message,
      });
      this.options.useRedis = false;
    }
  }

  /**
   * 生成速率限制 Redis 鍵
   */
  _generateRateLimitKey(keyIndex, type, period) {
    const now = new Date();
    let timeKey;

    switch (period) {
      case 'minute':
        timeKey =
          `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-` +
          `${now.getHours()}-${now.getMinutes()}`;
        break;
      case 'hour':
        timeKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
        break;
      case 'day':
        timeKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
        break;
      case 'month':
        timeKey = `${now.getFullYear()}-${now.getMonth()}`;
        break;
      default:
        timeKey = 'unknown';
    }

    return `google_ai_${type}:${keyIndex}:${timeKey}`;
  }

  /**
   * 檢查速率限制
   */
  async _checkRateLimit(keyIndex) {
    if (!this.options.enableRateLimit) {
      return { allowed: true, reason: null };
    }

    try {
      const minuteKey = this._generateRateLimitKey(keyIndex, 'rate_minute', 'minute');
      const hourKey = this._generateRateLimitKey(keyIndex, 'rate_hour', 'hour');

      let minuteCount = 0;
      let hourCount = 0;

      if (this.options.useRedis) {
        // 使用 Redis 檢查
        const [minuteResult, hourResult] = await Promise.all([
          redisConnection.get(minuteKey),
          redisConnection.get(hourKey),
        ]);

        minuteCount = minuteResult ? parseInt(minuteResult, 10) : 0;
        hourCount = hourResult ? parseInt(hourResult, 10) : 0;
      } else {
        // 使用記憶體快取
        minuteCount = memoryCache.get(minuteKey) || 0;
        hourCount = memoryCache.get(hourKey) || 0;
      }

      // 檢查每分鐘限制
      if (minuteCount >= RATE_LIMIT_CONFIG.requestsPerMinute) {
        return {
          allowed: false,
          reason: 'minute_rate_limit_exceeded',
          retryAfter: 60,
          current: minuteCount,
          limit: RATE_LIMIT_CONFIG.requestsPerMinute,
        };
      }

      // 檢查每小時限制
      if (hourCount >= RATE_LIMIT_CONFIG.requestsPerHour) {
        return {
          allowed: false,
          reason: 'hour_rate_limit_exceeded',
          retryAfter: 3600,
          current: hourCount,
          limit: RATE_LIMIT_CONFIG.requestsPerHour,
        };
      }

      return { allowed: true, reason: null };
    } catch (error) {
      logger.error('Rate limit check failed', { error: error.message });
      // 發生錯誤時允許請求通過，但記錄錯誤
      return { allowed: true, reason: null };
    }
  }

  /**
   * 檢查配額限制
   */
  async _checkQuotaLimit(keyIndex) {
    if (!this.options.enableQuotaManagement) {
      return { allowed: true, reason: null };
    }

    try {
      const dayKey = this._generateRateLimitKey(keyIndex, 'quota_day', 'day');
      const monthKey = this._generateRateLimitKey(keyIndex, 'quota_month', 'month');

      let dayCount = 0;
      let monthCount = 0;

      if (this.options.useRedis) {
        // 使用 Redis 檢查
        const [dayResult, monthResult] = await Promise.all([
          redisConnection.get(dayKey),
          redisConnection.get(monthKey),
        ]);

        dayCount = dayResult ? parseInt(dayResult, 10) : 0;
        monthCount = monthResult ? parseInt(monthResult, 10) : 0;
      } else {
        // 使用記憶體快取
        dayCount = memoryCache.get(dayKey) || 0;
        monthCount = memoryCache.get(monthKey) || 0;
      }

      // 檢查每日配額
      if (dayCount >= RATE_LIMIT_CONFIG.dailyQuota) {
        return {
          allowed: false,
          reason: 'daily_quota_exceeded',
          current: dayCount,
          limit: RATE_LIMIT_CONFIG.dailyQuota,
        };
      }

      // 檢查每月配額
      if (monthCount >= RATE_LIMIT_CONFIG.monthlyQuota) {
        return {
          allowed: false,
          reason: 'monthly_quota_exceeded',
          current: monthCount,
          limit: RATE_LIMIT_CONFIG.monthlyQuota,
        };
      }

      return { allowed: true, reason: null };
    } catch (error) {
      logger.error('Quota limit check failed', { error: error.message });
      // 發生錯誤時允許請求通過，但記錄錯誤
      return { allowed: true, reason: null };
    }
  }

  /**
   * 增加速率限制和配額計數
   */
  async _incrementRateLimitAndQuota(keyIndex) {
    if (!this.options.enableRateLimit && !this.options.enableQuotaManagement) {
      return;
    }

    try {
      const keys = [];
      const expiries = [];

      if (this.options.enableRateLimit) {
        const minuteKey = this._generateRateLimitKey(keyIndex, 'rate_minute', 'minute');
        const hourKey = this._generateRateLimitKey(keyIndex, 'rate_hour', 'hour');
        keys.push(minuteKey, hourKey);
        expiries.push(60, 3600); // 1 分鐘和 1 小時過期
      }

      if (this.options.enableQuotaManagement) {
        const dayKey = this._generateRateLimitKey(keyIndex, 'quota_day', 'day');
        const monthKey = this._generateRateLimitKey(keyIndex, 'quota_month', 'month');
        keys.push(dayKey, monthKey);
        expiries.push(86400, 2592000); // 1 天和 30 天過期
      }

      if (this.options.useRedis) {
        // 使用 Redis 增加計數
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i];
          const expiry = expiries[i];

          await redisConnection.incr(key);
          await redisConnection.expire(key, expiry);
        }
      } else {
        // 使用記憶體快取
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i];
          const expiry = expiries[i];

          const current = memoryCache.get(key) || 0;
          memoryCache.set(key, current + 1);

          // 設定過期時間（簡化版本）
          setTimeout(() => {
            memoryCache.delete(key);
          }, expiry * 1000);
        }
      }

      // 更新統計
      this.rateLimitStats.totalRequests++;
    } catch (error) {
      logger.error('Failed to increment rate limit counters', { error: error.message });
    }
  }

  /**
   * 從環境變數或參數載入 API 金鑰
   */
  _loadApiKeys(providedKeys) {
    if (providedKeys) {
      const keysArray = Array.isArray(providedKeys) ? providedKeys : [providedKeys];
      return [...new Set(keysArray)]; // 去除重複的金鑰
    }

    // 嘗試從環境變數載入多個金鑰
    const keys = [];

    // 主要金鑰
    if (process.env.GOOGLE_AI_API_KEY) {
      keys.push(process.env.GOOGLE_AI_API_KEY);
    }

    // 額外的金鑰 (支援 GOOGLE_AI_API_KEY_1, GOOGLE_AI_API_KEY_2 等)
    let index = 1;
    while (process.env[`GOOGLE_AI_API_KEY_${index}`]) {
      keys.push(process.env[`GOOGLE_AI_API_KEY_${index}`]);
      index++;
    }

    // 從逗號分隔的單一環境變數載入
    if (process.env.GOOGLE_AI_API_KEYS) {
      const multiKeys = process.env.GOOGLE_AI_API_KEYS.split(',').map(key => key.trim());
      keys.push(...multiKeys);
    }

    return [...new Set(keys)]; // 去除重複的金鑰
  }

  /**
   * 初始化所有 API 金鑰的客戶端和統計
   */
  _initializeKeys() {
    this.apiKeys.forEach((key, index) => {
      try {
        const client = new GoogleGenerativeAI(key);
        const model = client.getGenerativeModel({
          model: 'gemini-pro',
          safetySettings: [
            {
              category: HarmCategory.HARM_CATEGORY_HARASSMENT,
              threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            },
            {
              category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
              threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            },
          ],
        });

        this.keyClients.set(index, { client, model });
        this.keyStats.set(index, {
          totalRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          lastUsed: null,
          status: 'active', // active, quota_exceeded, rate_limited, error, disabled
          consecutiveErrors: 0,
          lastError: null,
          rateLimit: {
            requestsPerMinute: 0,
            requestsPerHour: 0,
            minuteStart: Date.now(),
            hourStart: Date.now(),
          },
          quota: {
            dailyUsage: 0,
            monthlyUsage: 0,
            lastDailyReset: Date.now(),
            lastMonthlyReset: Date.now(),
          },
        });
      } catch (error) {
        logger.error(`Failed to initialize API key ${index}: ${error.message}`);
        this.keyStats.set(index, {
          totalRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          lastUsed: null,
          status: 'error',
          consecutiveErrors: 1,
          lastError: error.message,
          rateLimit: {
            requestsPerMinute: 0,
            requestsPerHour: 0,
            minuteStart: Date.now(),
            hourStart: Date.now(),
          },
          quota: {
            dailyUsage: 0,
            monthlyUsage: 0,
            lastDailyReset: Date.now(),
            lastMonthlyReset: Date.now(),
          },
        });
      }
    });
  }

  /**
   * 取得下一個可用的 API 金鑰
   */
  _getNextAvailableKey() {
    const availableKeys = [];

    // 尋找所有活躍的金鑰
    for (let i = 0; i < this.apiKeys.length; i++) {
      const stats = this.keyStats.get(i);
      if (stats && ['active', 'quota_exceeded', 'rate_limited'].includes(stats.status)) {
        availableKeys.push(i);
      }
    }

    if (availableKeys.length === 0) {
      // 如果沒有活躍的金鑰，嘗試重置有錯誤的金鑰狀態
      this._attemptKeyRecovery();

      // 重新檢查
      for (let i = 0; i < this.apiKeys.length; i++) {
        const stats = this.keyStats.get(i);
        if (stats && ['active', 'quota_exceeded', 'rate_limited'].includes(stats.status)) {
          availableKeys.push(i);
        }
      }
    }

    // 如果仍然沒有活躍金鑰，但有處於錯誤狀態的金鑰，嘗試使用它們
    if (availableKeys.length === 0) {
      for (let i = 0; i < this.apiKeys.length; i++) {
        const stats = this.keyStats.get(i);
        if (stats && ['error', 'quota_exceeded', 'rate_limited'].includes(stats.status)) {
          availableKeys.push(i);
        }
      }
    }

    if (availableKeys.length === 0) {
      throw new Error('No available API keys. All keys are disabled or have errors.');
    }

    // 使用輪替策略選擇金鑰
    const selectedIndex = this._selectKeyByStrategy(availableKeys);
    this.currentKeyIndex = selectedIndex;

    return selectedIndex;
  }

  /**
   * 根據策略選擇金鑰（輪替 + 負載均衡 + 速率限制考量）
   */
  _selectKeyByStrategy(availableKeys) {
    // 優先選擇沒有被速率限制或配額限制的金鑰
    const unrestricted = availableKeys.filter(keyIndex => {
      const stats = this.keyStats.get(keyIndex);
      return stats && stats.status === 'active';
    });

    const candidateKeys = unrestricted.length > 0 ? unrestricted : availableKeys;

    // 選擇使用次數最少的金鑰
    let selectedKey = candidateKeys[0];
    let minRequests = this.keyStats.get(selectedKey).totalRequests;

    for (const keyIndex of candidateKeys) {
      const stats = this.keyStats.get(keyIndex);
      if (stats.totalRequests < minRequests) {
        minRequests = stats.totalRequests;
        selectedKey = keyIndex;
      }
    }

    return selectedKey;
  }

  /**
   * 嘗試恢復有錯誤的金鑰
   */
  _attemptKeyRecovery() {
    const recoveryInterval = 5 * 60 * 1000; // 5 分鐘
    const now = Date.now();

    for (const [keyIndex, stats] of this.keyStats.entries()) {
      if (['error', 'rate_limited'].includes(stats.status) && stats.lastUsed) {
        if (now - stats.lastUsed > recoveryInterval) {
          logger.info(`Attempting to recover API key ${keyIndex} from ${stats.status} state`);
          stats.status = 'active';
          stats.consecutiveErrors = 0;
          stats.lastError = null;
        }
      }
    }
  }

  /**
   * 更新金鑰統計（包含速率限制和配額追蹤）
   */
  _updateKeyStats(keyIndex, success, error = null) {
    const stats = this.keyStats.get(keyIndex);
    if (!stats) return;

    stats.totalRequests++;
    stats.lastUsed = Date.now();

    // 更新每分鐘和每小時請求數統計
    const now = Date.now();

    // 重置每分鐘計數
    if (now - stats.rateLimit.minuteStart > 60000) {
      stats.rateLimit.requestsPerMinute = 0;
      stats.rateLimit.minuteStart = now;
    }
    stats.rateLimit.requestsPerMinute++;

    // 重置每小時計數
    if (now - stats.rateLimit.hourStart > 3600000) {
      stats.rateLimit.requestsPerHour = 0;
      stats.rateLimit.hourStart = now;
    }
    stats.rateLimit.requestsPerHour++;

    // 更新每日和每月配額統計
    const nowDate = new Date();
    const currentDay = nowDate.getDate();
    const currentMonth = nowDate.getMonth();

    const lastDailyReset = new Date(stats.quota.lastDailyReset);
    const lastMonthlyReset = new Date(stats.quota.lastMonthlyReset);

    // 重置每日配額
    if (
      currentDay !== lastDailyReset.getDate() ||
      nowDate.getMonth() !== lastDailyReset.getMonth() ||
      nowDate.getFullYear() !== lastDailyReset.getFullYear()
    ) {
      stats.quota.dailyUsage = 0;
      stats.quota.lastDailyReset = now;
    }

    // 重置每月配額
    if (
      currentMonth !== lastMonthlyReset.getMonth() ||
      nowDate.getFullYear() !== lastMonthlyReset.getFullYear()
    ) {
      stats.quota.monthlyUsage = 0;
      stats.quota.lastMonthlyReset = now;
    }

    if (success) {
      stats.successfulRequests++;
      stats.consecutiveErrors = 0;
      stats.lastError = null;

      // 更新配額使用量
      stats.quota.dailyUsage++;
      stats.quota.monthlyUsage++;

      // 從錯誤狀態恢復
      if (['error', 'rate_limited'].includes(stats.status)) {
        stats.status = 'active';
        logger.info(`API key ${keyIndex} recovered from ${stats.status} state`);
      }
    } else {
      stats.failedRequests++;
      stats.consecutiveErrors++;
      stats.lastError = error;

      // 分析錯誤類型並更新狀態
      if (error && typeof error === 'string') {
        if (error.includes('quota') || error.includes('QUOTA_EXCEEDED')) {
          stats.status = 'quota_exceeded';
          logger.warn(`API key ${keyIndex} quota exceeded`);
        } else if (error.includes('rate') || error.includes('RATE_LIMIT')) {
          stats.status = 'rate_limited';
          logger.warn(`API key ${keyIndex} rate limited`);
        } else if (stats.consecutiveErrors >= 3) {
          stats.status = 'error';
          logger.warn(`API key ${keyIndex} disabled due to consecutive errors: ${error}`);
        }
      } else if (stats.consecutiveErrors >= 3) {
        stats.status = 'error';
        logger.warn(`API key ${keyIndex} disabled due to consecutive errors: ${error}`);
      }
    }
  }

  /**
   * 增強版：生成內容的主要方法，帶有完整的錯誤處理和回應處理機制
   */
  async generateContent(prompt, options = {}) {
    const maxRetries = options.maxRetries || this.apiKeys.length;
    const enableTimeout = options.enableTimeout !== false;
    const requestStartTime = Date.now();

    let lastErrorInfo = null;
    let attemptCount = 0;
    const rateLimitedKeys = [];
    const quotaExceededKeys = [];
    const processedErrors = [];

    // 輸入驗證
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      const error = new Error('Invalid prompt: must be a non-empty string');
      error.code = 'VALIDATION_ERROR';
      throw error;
    }

    logger.info('Starting content generation', {
      promptLength: prompt.length,
      maxRetries,
      enableTimeout,
    });

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const attemptStartTime = Date.now();
      let keyIndex = null;

      try {
        keyIndex = this._getNextAvailableKey();

        // 如果已經檢查過此金鑰且被限制，跳過
        if (rateLimitedKeys.includes(keyIndex) || quotaExceededKeys.includes(keyIndex)) {
          continue;
        }

        // 檢查速率限制
        const rateLimitCheck = await this._checkRateLimit(keyIndex);
        if (!rateLimitCheck.allowed) {
          const error = new Error(`Rate limit exceeded: ${rateLimitCheck.reason}`);
          error.code = 'RATE_LIMIT_EXCEEDED';
          error.details = rateLimitCheck;

          this.rateLimitStats.rateLimitedRequests++;
          rateLimitedKeys.push(keyIndex);

          // 更新金鑰狀態
          const stats = this.keyStats.get(keyIndex);
          if (stats) {
            stats.status = 'rate_limited';
          }

          logger.warn(`API key ${keyIndex} rate limited`, rateLimitCheck);
          lastErrorInfo = this._analyzeError(error, keyIndex);
          continue;
        }

        // 檢查配額限制
        const quotaCheck = await this._checkQuotaLimit(keyIndex);
        if (!quotaCheck.allowed) {
          const error = new Error(`Quota exceeded: ${quotaCheck.reason}`);
          error.code = 'QUOTA_EXCEEDED';
          error.details = quotaCheck;

          this.rateLimitStats.quotaExceededRequests++;
          quotaExceededKeys.push(keyIndex);

          // 更新金鑰狀態
          const stats = this.keyStats.get(keyIndex);
          if (stats) {
            stats.status = 'quota_exceeded';
          }

          logger.warn(`API key ${keyIndex} quota exceeded`, quotaCheck);
          lastErrorInfo = this._analyzeError(error, keyIndex);
          continue;
        }

        const { model } = this.keyClients.get(keyIndex);
        attemptCount++;

        logger.debug(`Using API key ${keyIndex} for content generation (attempt ${attempt + 1})`);

        // 設定超時處理
        let result;
        if (enableTimeout) {
          result = await Promise.race([
            model.generateContent(prompt),
            new Promise((_, reject) => {
              setTimeout(() => {
                reject(new Error(`Request timeout after ${ERROR_HANDLING_CONFIG.timeoutMs}ms`));
              }, ERROR_HANDLING_CONFIG.timeoutMs);
            }),
          ]);
        } else {
          result = await model.generateContent(prompt);
        }

        // 處理 API 回應
        const processedResponse = await this._processResponse(result, keyIndex);

        // 增加速率限制和配額計數
        await this._incrementRateLimitAndQuota(keyIndex);

        // 成功時更新統計
        this._updateKeyStats(keyIndex, true);

        // 記錄成功信息
        const totalTime = Date.now() - requestStartTime;
        logger.info('Content generation successful', {
          keyIndex,
          attemptCount,
          totalTime,
          processingTime: processedResponse.processingTime,
          textLength: processedResponse.text.length,
        });

        return processedResponse.text;
      } catch (error) {
        const attemptTime = Date.now() - attemptStartTime;

        // 分析錯誤
        const errorInfo = this._analyzeError(error, keyIndex);
        lastErrorInfo = errorInfo;
        processedErrors.push(errorInfo);

        // 更新失敗統計
        this._updateKeyStats(keyIndex, false, errorInfo.message);

        logger.warn(`API key ${keyIndex} failed (attempt ${attempt + 1})`, {
          error: errorInfo.message,
          errorType: errorInfo.type,
          attemptTime,
          recoveryStrategy: errorInfo.recoveryStrategy,
        });

        // 根據錯誤類型決定是否重試
        if (!errorInfo.isRetryable) {
          logger.error('Non-retryable error encountered', {
            errorType: errorInfo.type,
            message: errorInfo.message,
          });
          throw this._createDetailedError(errorInfo, {
            prompt: prompt.substring(0, 100),
            attempt: attempt + 1,
            totalAttempts: maxRetries,
          });
        }

        // 如果是速率限制或配額相關錯誤，不再重試同一金鑰
        if (errorInfo.type === ERROR_TYPES.RATE_LIMIT) {
          rateLimitedKeys.push(keyIndex);
        } else if (errorInfo.type === ERROR_TYPES.API_QUOTA) {
          quotaExceededKeys.push(keyIndex);
        }

        // 如果還有重試次數，計算延遲並繼續
        if (attempt < maxRetries - 1) {
          const retryDelay = this._calculateRetryDelay(attempt, errorInfo);
          await this._delayRetry(retryDelay);
          continue;
        }
      }
    }

    // 檢查是否所有金鑰都被限制
    const allKeysRateLimited = rateLimitedKeys.length === this.apiKeys.length;
    const allKeysQuotaExceeded = quotaExceededKeys.length === this.apiKeys.length;

    if (allKeysRateLimited) {
      const error = new Error('Rate limit exceeded: All API keys are rate limited');
      error.code = 'ALL_KEYS_RATE_LIMITED';
      error.rateLimitedKeys = rateLimitedKeys;
      throw error;
    }

    if (allKeysQuotaExceeded) {
      const error = new Error('Quota exceeded: All API keys have exceeded their quota');
      error.code = 'ALL_KEYS_QUOTA_EXCEEDED';
      error.quotaExceededKeys = quotaExceededKeys;
      throw error;
    }

    // 所有重試都失敗
    const totalTime = Date.now() - requestStartTime;
    logger.error('All API keys failed to generate content', {
      totalTime,
      attemptCount,
      processedErrors: processedErrors.length,
      lastError: lastErrorInfo?.message,
    });

    const finalError = this._createDetailedError(
      {
        type: ERROR_TYPES.GENERIC,
        message: `Failed to generate content from Google AI after ${maxRetries} attempts`,
        isRetryable: false,
        originalError: lastErrorInfo?.originalError,
      },
      {
        prompt: prompt.substring(0, 100),
        totalAttempts: maxRetries,
        attemptCount,
        totalTime,
        processedErrors,
      }
    );

    throw finalError;
  }

  /**
   * 初始化請求佇列系統
   */
  _initializeRequestQueue() {
    if (!this.options.enableRequestQueue) {
      logger.info('Request queue disabled');
      return;
    }

    // 重設佇列統計
    this.queueStats.totalQueued = 0;
    this.queueStats.totalProcessed = 0;
    this.queueStats.totalCompleted = 0;
    this.queueStats.totalFailed = 0;
    this.queueStats.averageWaitTime = 0;
    this.queueStats.averageProcessingTime = 0;

    // 初始化佇列大小統計
    QUEUE_CONFIG.priorityLevels.forEach(priority => {
      this.queueStats.queueSizes[priority] = 0;
    });

    // 啟動背景處理器
    this._startBackgroundProcessor();

    logger.info('Request queue system initialized', {
      maxQueueSize: QUEUE_CONFIG.maxQueueSize,
      batchSize: QUEUE_CONFIG.batchSize,
      maxConcurrency: QUEUE_CONFIG.maxConcurrency,
      backgroundProcessingInterval: QUEUE_CONFIG.backgroundProcessingInterval,
    });
  }

  /**
   * 啟動背景處理器
   */
  _startBackgroundProcessor() {
    if (this.backgroundProcessorInterval) {
      clearInterval(this.backgroundProcessorInterval);
    }

    this.backgroundProcessorInterval = setInterval(() => {
      this._processBackgroundQueue();
    }, QUEUE_CONFIG.backgroundProcessingInterval);

    logger.debug('Background processor started');
  }

  /**
   * 處理背景佇列
   */
  async _processBackgroundQueue() {
    if (this.batchProcessing.isProcessing) {
      return;
    }

    const backgroundQueue = this.requestQueue.background;
    if (backgroundQueue.length === 0) {
      return;
    }

    const batchSize = Math.min(QUEUE_CONFIG.batchSize, backgroundQueue.length);
    const batch = backgroundQueue.splice(0, batchSize);

    if (batch.length > 0) {
      logger.debug(`Processing background batch of ${batch.length} requests`);
      await this._processBatch(batch, PRIORITY_LEVELS.BACKGROUND);
    }
  }

  /**
   * 新增請求到佇列
   */
  async _enqueueRequest(request) {
    const priority = request.priority || PRIORITY_LEVELS.MEDIUM;
    const queue = this.requestQueue[priority];

    if (!queue) {
      throw new Error(`Invalid priority level: ${priority}`);
    }

    // 檢查佇列大小限制
    const totalQueueSize = Object.values(this.requestQueue).reduce((sum, q) => sum + q.length, 0);

    if (totalQueueSize >= QUEUE_CONFIG.maxQueueSize) {
      throw new Error(`Queue full: ${totalQueueSize}/${QUEUE_CONFIG.maxQueueSize}`);
    }

    // 添加到佇列
    request.queuedAt = Date.now();
    queue.push(request);

    // 更新統計
    this.queueStats.totalQueued++;
    this.queueStats.queueSizes[priority]++;

    logger.debug(`Request queued with priority ${priority}`, {
      queueSize: queue.length,
      totalQueueSize: totalQueueSize + 1,
    });

    return request;
  }

  /**
   * 從佇列中獲取下一個請求
   */
  _dequeueRequest() {
    // 按優先級順序處理
    for (const priority of QUEUE_CONFIG.priorityLevels) {
      const queue = this.requestQueue[priority];
      if (queue.length > 0) {
        const request = queue.shift();
        this.queueStats.queueSizes[priority]--;
        return request;
      }
    }
    return null;
  }

  /**
   * 處理批次請求
   */
  async _processBatch(batch, priority) {
    if (batch.length === 0) {
      return;
    }

    this.batchProcessing.isProcessing = true;
    this.batchProcessing.currentBatch = batch;
    this.batchProcessing.lastProcessTime = Date.now();

    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const batchStartTime = Date.now();

    logger.info(`Processing batch ${batchId}`, {
      batchSize: batch.length,
      priority,
      concurrentRequests: this.batchProcessing.concurrentRequests,
    });

    try {
      // 更新批次統計
      this.queueStats.batchStats.totalBatches++;
      this.queueStats.batchStats.averageBatchSize =
        (this.queueStats.batchStats.averageBatchSize *
          (this.queueStats.batchStats.totalBatches - 1) +
          batch.length) /
        this.queueStats.batchStats.totalBatches;

      // 控制並發數量
      const concurrencyLimit = Math.min(
        QUEUE_CONFIG.maxConcurrency - this.batchProcessing.concurrentRequests,
        batch.length
      );

      const processingPromises = [];
      for (let i = 0; i < concurrencyLimit; i++) {
        if (batch[i]) {
          processingPromises.push(this._processQueuedRequest(batch[i]));
        }
      }

      const results = await Promise.allSettled(processingPromises);
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      const failureCount = results.filter(r => r.status === 'rejected').length;

      // 更新統計
      this.queueStats.totalProcessed += batch.length;
      this.queueStats.totalCompleted += successCount;
      this.queueStats.totalFailed += failureCount;

      if (successCount > 0) {
        this.queueStats.batchStats.completedBatches++;
      }
      if (failureCount > 0) {
        this.queueStats.batchStats.failedBatches++;
      }

      const batchProcessingTime = Date.now() - batchStartTime;
      this.queueStats.averageProcessingTime =
        (this.queueStats.averageProcessingTime * (this.queueStats.totalProcessed - batch.length) +
          batchProcessingTime) /
        this.queueStats.totalProcessed;

      logger.info(`Batch ${batchId} completed`, {
        processingTime: batchProcessingTime,
        successCount,
        failureCount,
        totalBatches: this.queueStats.batchStats.totalBatches,
      });
    } catch (error) {
      logger.error(`Batch ${batchId} processing failed`, {
        error: error.message,
        batchSize: batch.length,
      });
      this.queueStats.batchStats.failedBatches++;
    } finally {
      this.batchProcessing.isProcessing = false;
      this.batchProcessing.currentBatch = [];
    }
  }

  /**
   * 處理佇列中的單個請求
   */
  async _processQueuedRequest(request) {
    const requestStartTime = Date.now();
    this.batchProcessing.concurrentRequests++;

    try {
      const waitTime = requestStartTime - request.queuedAt;
      this.queueStats.averageWaitTime =
        (this.queueStats.averageWaitTime * (this.queueStats.totalProcessed - 1) + waitTime) /
        this.queueStats.totalProcessed;

      // 實際處理請求
      const result = await this._executeRequest(request);

      // 解析請求
      if (request.resolve) {
        request.resolve(result);
      }

      return result;
    } catch (error) {
      logger.error('Queued request processing failed', {
        requestId: request.id,
        error: error.message,
      });

      // 拒絕請求
      if (request.reject) {
        request.reject(error);
      }

      throw error;
    } finally {
      this.batchProcessing.concurrentRequests--;
    }
  }

  /**
   * 執行單個請求
   */
  async _executeRequest(request) {
    const { prompt, options } = request;
    return await this.generateContent(prompt, options);
  }

  /**
   * 使用佇列系統生成內容（新增的公共方法）
   */
  async generateContentWithQueue(prompt, options = {}) {
    const priority = options.priority || PRIORITY_LEVELS.MEDIUM;
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 如果未啟用佇列，直接調用原始方法
    if (!this.options.enableRequestQueue) {
      return await this.generateContent(prompt, options);
    }

    // 創建佇列請求
    const queueRequest = {
      id: requestId,
      prompt,
      options,
      priority,
      queuedAt: Date.now(),
      resolve: null,
      reject: null,
    };

    // 創建 Promise 用於等待結果
    const promise = new Promise((resolve, reject) => {
      queueRequest.resolve = resolve;
      queueRequest.reject = reject;
    });

    // 添加到佇列
    await this._enqueueRequest(queueRequest);

    // 如果是高優先級請求，立即處理
    if (priority === PRIORITY_LEVELS.HIGH) {
      this._processHighPriorityRequest(queueRequest);
    }

    return promise;
  }

  /**
   * 處理高優先級請求（即時處理）
   */
  async _processHighPriorityRequest(request) {
    // 從佇列中移除（如果存在）
    const queue = this.requestQueue[request.priority];
    const index = queue.findIndex(req => req.id === request.id);
    if (index !== -1) {
      queue.splice(index, 1);
      this.queueStats.queueSizes[request.priority]--;
    }

    // 立即處理
    try {
      const result = await this._processQueuedRequest(request);
      return result;
    } catch (error) {
      logger.error('High priority request processing failed', {
        requestId: request.id,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 增強的智能重試機制
   */
  _calculateRetryDelay(attempt, errorInfo) {
    const baseDelay = ERROR_HANDLING_CONFIG.baseRetryDelay;
    const maxDelay = ERROR_HANDLING_CONFIG.maxRetryDelay;
    const multiplier = ERROR_HANDLING_CONFIG.retryMultiplier;

    // 基於錯誤類型調整延遲
    let adjustedBaseDelay = baseDelay;
    let adjustedMultiplier = multiplier;

    switch (errorInfo.type) {
      case ERROR_TYPES.RATE_LIMIT:
        // 速率限制錯誤：更長的延遲
        adjustedBaseDelay = baseDelay * 2;
        adjustedMultiplier = multiplier * 1.5;
        break;
      case ERROR_TYPES.API_QUOTA:
        // 配額錯誤：更長的延遲
        adjustedBaseDelay = baseDelay * 3;
        adjustedMultiplier = multiplier * 2;
        break;
      case ERROR_TYPES.NETWORK:
        // 網路錯誤：適中的延遲
        adjustedBaseDelay = baseDelay * 1.5;
        break;
      case ERROR_TYPES.TIMEOUT:
        // 超時錯誤：短延遲
        adjustedBaseDelay = baseDelay * 0.5;
        break;
      default:
        // 使用預設值
        break;
    }

    // 計算指數退避延遲
    const exponentialDelay = adjustedBaseDelay * adjustedMultiplier ** attempt;

    // 添加隨機抖動（jitter）以避免雷鳴群體效應
    const jitter = Math.random() * 0.3 + 0.85; // 0.85-1.15 的隨機因子
    const finalDelay = Math.min(exponentialDelay * jitter, maxDelay);

    logger.debug('Calculated retry delay', {
      attempt,
      errorType: errorInfo.type,
      baseDelay: adjustedBaseDelay,
      exponentialDelay,
      jitter,
      finalDelay,
    });

    return finalDelay;
  }

  /**
   * 新增：獲取錯誤統計資訊
   */
  getErrorStatistics() {
    return {
      totalErrors: this.errorStats.totalErrors,
      errorsByType: { ...this.errorStats.errorsByType },
      recentErrors: this.errorStats.recentErrors.slice(0, 10), // 只返回最近10個錯誤
      keyErrorStats: Array.from(this.errorStats.errorsByKey.entries()).map(([keyIndex, stats]) => ({
        keyIndex,
        totalErrors: stats.totalErrors,
        errorsByType: { ...stats.errorsByType },
        lastError: stats.lastError
          ? {
              type: stats.lastError.type,
              message: stats.lastError.message,
              timestamp: stats.lastError.timestamp,
            }
          : null,
        lastErrorTime: stats.lastErrorTime,
      })),
    };
  }

  /**
   * 新增：獲取詳細錯誤報告
   */
  getDetailedErrorReport(options = {}) {
    const { includeStackTraces = false, errorTypes = null, keyIndex = null, limit = 50 } = options;

    let errors = this.errorStats.recentErrors;

    // 過濾錯誤類型
    if (errorTypes && Array.isArray(errorTypes)) {
      errors = errors.filter(error => errorTypes.includes(error.type));
    }

    // 過濾金鑰
    if (keyIndex !== null) {
      errors = errors.filter(error => error.keyIndex === keyIndex);
    }

    // 限制數量
    errors = errors.slice(0, limit);

    return {
      totalErrors: this.errorStats.totalErrors,
      filteredErrors: errors.map(error => ({
        type: error.type,
        message: error.message,
        code: error.code,
        keyIndex: error.keyIndex,
        timestamp: error.timestamp,
        recoveryStrategy: error.recoveryStrategy,
        isRetryable: error.isRetryable,
        retryDelay: error.retryDelay,
        stack: includeStackTraces ? error.stack : undefined,
      })),
      summary: {
        errorsByType: { ...this.errorStats.errorsByType },
        errorsByKey: Array.from(this.errorStats.errorsByKey.entries()).map(([keyIndex, stats]) => ({
          keyIndex,
          totalErrors: stats.totalErrors,
          errorRate: this.keyStats.get(keyIndex)
            ? `${((stats.totalErrors / this.keyStats.get(keyIndex).totalRequests) * 100).toFixed(
                2
              )}%`
            : '0%',
        })),
      },
    };
  }

  /**
   * 新增：重設錯誤統計
   */
  resetErrorStatistics() {
    this.errorStats.totalErrors = 0;
    this.errorStats.recentErrors = [];

    // 重設每種錯誤類型的計數
    Object.keys(this.errorStats.errorsByType).forEach(type => {
      this.errorStats.errorsByType[type] = 0;
    });

    // 重設每個金鑰的錯誤統計
    this.errorStats.errorsByKey.forEach(stats => {
      stats.totalErrors = 0;
      stats.lastError = null;
      stats.lastErrorTime = null;
      Object.keys(stats.errorsByType).forEach(type => {
        stats.errorsByType[type] = 0;
      });
    });

    logger.info('Error statistics reset');
  }

  /**
   * 新增：更新錯誤處理配置
   */
  updateErrorHandlingConfig(newConfig) {
    const allowedKeys = [
      'maxRetryAttempts',
      'baseRetryDelay',
      'maxRetryDelay',
      'retryMultiplier',
      'timeoutMs',
      'enableDetailedErrorLogging',
    ];

    const updatedConfig = {};
    for (const key of allowedKeys) {
      if (newConfig[key] !== undefined) {
        ERROR_HANDLING_CONFIG[key] = newConfig[key];
        updatedConfig[key] = newConfig[key];
      }
    }

    logger.info('Error handling configuration updated', updatedConfig);
    return ERROR_HANDLING_CONFIG;
  }

  /**
   * 新增：獲取錯誤處理配置
   */
  getErrorHandlingConfig() {
    return { ...ERROR_HANDLING_CONFIG };
  }

  /**
   * 新增：獲取錯誤類型定義
   */
  getErrorTypes() {
    return { ...ERROR_TYPES };
  }

  /**
   * 新增：獲取恢復策略定義
   */
  getRecoveryStrategies() {
    return { ...ERROR_RECOVERY_STRATEGIES };
  }

  /**
   * 新增：檢查服務健康狀態
   */
  async getHealthStatus() {
    const stats = this.getKeyStatistics();
    const errorStats = this.getErrorStatistics();
    const rateLimitStatus = await this.getCurrentRateLimitStatus();

    const healthStatus = {
      overall: 'healthy',
      timestamp: new Date().toISOString(),
      keys: {
        total: this.apiKeys.length,
        active: stats.filter(s => s.status === 'active').length,
        rateLimited: stats.filter(s => s.status === 'rate_limited').length,
        quotaExceeded: stats.filter(s => s.status === 'quota_exceeded').length,
        error: stats.filter(s => s.status === 'error').length,
        disabled: stats.filter(s => s.status === 'disabled').length,
      },
      errors: {
        totalErrors: errorStats.totalErrors,
        recentErrorsCount: errorStats.recentErrors.length,
        errorRate:
          stats.reduce((sum, s) => sum + s.totalRequests, 0) > 0
            ? `${(
                (errorStats.totalErrors / stats.reduce((sum, s) => sum + s.totalRequests, 0)) *
                100
              ).toFixed(2)}%`
            : '0%',
      },
      performance: {
        averageSuccessRate:
          stats.length > 0
            ? `${(
                stats.reduce((sum, s) => sum + parseFloat(s.successRate), 0) / stats.length
              ).toFixed(2)}%`
            : '0%',
      },
    };

    // 判斷整體健康狀態
    if (healthStatus.keys.active === 0) {
      healthStatus.overall = 'critical';
    } else if (healthStatus.keys.active < this.apiKeys.length * 0.5) {
      healthStatus.overall = 'degraded';
    } else if (parseFloat(healthStatus.errors.errorRate) > 10) {
      healthStatus.overall = 'warning';
    }

    return healthStatus;
  }

  /**
   * 新增：強制恢復所有錯誤狀態的金鑰
   */
  forceKeyRecovery() {
    let recoveredKeys = 0;

    for (const [keyIndex, stats] of this.keyStats.entries()) {
      if (['error', 'rate_limited'].includes(stats.status)) {
        stats.status = 'active';
        stats.consecutiveErrors = 0;
        stats.lastError = null;
        recoveredKeys++;

        logger.info(`Forced recovery of API key ${keyIndex}`);
      }
    }

    logger.info(`Force recovery completed: ${recoveredKeys} keys recovered`);
    return recoveredKeys;
  }

  /**
   * 添加新的 API 金鑰
   */
  async addApiKey(apiKey) {
    try {
      const client = new GoogleGenerativeAI(apiKey);
      const model = client.getGenerativeModel({ model: 'gemini-pro' });

      // 測試金鑰是否有效
      await model.generateContent('Test');

      const newIndex = this.apiKeys.length;
      this.apiKeys.push(apiKey);
      this.keyClients.set(newIndex, { client, model });
      this.keyStats.set(newIndex, {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        lastUsed: null,
        status: 'active',
        consecutiveErrors: 0,
        lastError: null,
        rateLimit: {
          requestsPerMinute: 0,
          requestsPerHour: 0,
          minuteStart: Date.now(),
          hourStart: Date.now(),
        },
        quota: {
          dailyUsage: 0,
          monthlyUsage: 0,
          lastDailyReset: Date.now(),
          lastMonthlyReset: Date.now(),
        },
      });

      // 新增：為新金鑰初始化錯誤統計
      this.errorStats.errorsByKey.set(newIndex, {
        totalErrors: 0,
        errorsByType: {},
        lastError: null,
        lastErrorTime: null,
      });

      // 初始化錯誤類型計數
      Object.values(ERROR_TYPES).forEach(type => {
        this.errorStats.errorsByKey.get(newIndex).errorsByType[type] = 0;
      });

      logger.info(`Successfully added new API key at index ${newIndex}`);
      return newIndex;
    } catch (error) {
      logger.error(`Failed to add API key: ${error.message}`);
      throw new Error(`Invalid API key: ${error.message}`);
    }
  }

  /**
   * 移除 API 金鑰
   */
  removeApiKey(keyIndex) {
    if (keyIndex < 0 || keyIndex >= this.apiKeys.length) {
      throw new Error('Invalid key index');
    }

    if (this.apiKeys.length <= 1) {
      throw new Error('Cannot remove the last API key');
    }

    this.apiKeys.splice(keyIndex, 1);
    this.keyClients.delete(keyIndex);
    this.keyStats.delete(keyIndex);

    // 新增：清理錯誤統計
    this.errorStats.errorsByKey.delete(keyIndex);

    // 重新索引剩餘的金鑰
    this._reindexKeys();

    logger.info(`Removed API key at index ${keyIndex}`);
  }

  /**
   * 重新索引金鑰
   */
  _reindexKeys() {
    const newKeyClients = new Map();
    const newKeyStats = new Map();
    const newErrorStats = new Map();

    // 根據剩餘的金鑰數量重新建立索引
    for (let i = 0; i < this.apiKeys.length; i++) {
      // 尋找對應的客戶端和統計，可能來自任何舊索引
      for (const [oldIndex, client] of this.keyClients.entries()) {
        if (newKeyClients.size === i && !newKeyClients.has(i)) {
          newKeyClients.set(i, client);
          newKeyStats.set(i, this.keyStats.get(oldIndex));

          // 新增：重新索引錯誤統計
          if (this.errorStats.errorsByKey.has(oldIndex)) {
            newErrorStats.set(i, this.errorStats.errorsByKey.get(oldIndex));
          }
          break;
        }
      }
    }

    this.keyClients = newKeyClients;
    this.keyStats = newKeyStats;
    this.errorStats.errorsByKey = newErrorStats;
    this.currentKeyIndex = 0;
  }

  /**
   * 獲取金鑰統計資訊（包含速率限制和配額資訊）
   */
  getKeyStatistics() {
    const stats = [];
    for (let i = 0; i < this.apiKeys.length; i++) {
      const keyStats = this.keyStats.get(i);
      if (keyStats) {
        stats.push({
          index: i,
          status: keyStats.status,
          totalRequests: keyStats.totalRequests,
          successfulRequests: keyStats.successfulRequests,
          failedRequests: keyStats.failedRequests,
          successRate:
            keyStats.totalRequests > 0
              ? `${((keyStats.successfulRequests / keyStats.totalRequests) * 100).toFixed(2)}%`
              : '0%',
          lastUsed: keyStats.lastUsed,
          consecutiveErrors: keyStats.consecutiveErrors,
          lastError: keyStats.lastError,
          // 速率限制資訊
          rateLimit: {
            requestsPerMinute: keyStats.rateLimit.requestsPerMinute,
            requestsPerHour: keyStats.rateLimit.requestsPerHour,
            minuteStart: keyStats.rateLimit.minuteStart,
            hourStart: keyStats.rateLimit.hourStart,
          },
          // 配額資訊
          quota: {
            dailyUsage: keyStats.quota.dailyUsage,
            monthlyUsage: keyStats.quota.monthlyUsage,
            dailyLimit: RATE_LIMIT_CONFIG.dailyQuota,
            monthlyLimit: RATE_LIMIT_CONFIG.monthlyQuota,
            dailyRemaining: Math.max(0, RATE_LIMIT_CONFIG.dailyQuota - keyStats.quota.dailyUsage),
            monthlyRemaining: Math.max(
              0,
              RATE_LIMIT_CONFIG.monthlyQuota - keyStats.quota.monthlyUsage
            ),
            lastDailyReset: keyStats.quota.lastDailyReset,
            lastMonthlyReset: keyStats.quota.lastMonthlyReset,
          },
        });
      }
    }
    return stats;
  }

  /**
   * 獲取速率限制統計資訊
   */
  getRateLimitStatistics() {
    return {
      ...this.rateLimitStats,
      config: {
        requestsPerMinute: RATE_LIMIT_CONFIG.requestsPerMinute,
        requestsPerHour: RATE_LIMIT_CONFIG.requestsPerHour,
        dailyQuota: RATE_LIMIT_CONFIG.dailyQuota,
        monthlyQuota: RATE_LIMIT_CONFIG.monthlyQuota,
      },
      options: {
        enableRateLimit: this.options.enableRateLimit,
        enableQuotaManagement: this.options.enableQuotaManagement,
        useRedis: this.options.useRedis,
      },
    };
  }

  /**
   * 重設速率限制統計
   */
  async resetRateLimitStatistics() {
    this.rateLimitStats = {
      totalRequests: 0,
      rateLimitedRequests: 0,
      quotaExceededRequests: 0,
      lastResetTime: Date.now(),
    };

    if (this.options.useRedis) {
      try {
        // 清除 Redis 中的速率限制資料
        const keys = await redisConnection.keys('google_ai_*');
        if (keys.length > 0) {
          await redisConnection.del(...keys);
        }
      } catch (error) {
        logger.error('Failed to reset Redis rate limit data', { error: error.message });
      }
    } else {
      // 清除記憶體快取
      memoryCache.clear();
    }

    logger.info('Rate limit statistics reset');
  }

  /**
   * 手動重設特定金鑰的速率限制
   */
  async resetKeyRateLimit(keyIndex) {
    if (keyIndex < 0 || keyIndex >= this.apiKeys.length) {
      throw new Error('Invalid key index');
    }

    const stats = this.keyStats.get(keyIndex);
    if (!stats) {
      throw new Error('Key statistics not found');
    }

    // 重設本地統計
    const now = Date.now();
    stats.rateLimit.requestsPerMinute = 0;
    stats.rateLimit.requestsPerHour = 0;
    stats.rateLimit.minuteStart = now;
    stats.rateLimit.hourStart = now;

    // 重設 Redis 或記憶體快取中的資料
    try {
      const patterns = [
        this._generateRateLimitKey(keyIndex, 'rate_minute', 'minute'),
        this._generateRateLimitKey(keyIndex, 'rate_hour', 'hour'),
      ];

      if (this.options.useRedis) {
        for (const pattern of patterns) {
          await redisConnection.del(pattern);
        }
      } else {
        for (const pattern of patterns) {
          memoryCache.delete(pattern);
        }
      }
    } catch (error) {
      logger.error(`Failed to reset rate limit for key ${keyIndex}`, { error: error.message });
    }

    // 如果金鑰處於速率限制狀態，將其設為活躍
    if (stats.status === 'rate_limited') {
      stats.status = 'active';
    }

    logger.info(`Rate limit reset for API key ${keyIndex}`);
  }

  /**
   * 手動重設特定金鑰的配額
   */
  async resetKeyQuota(keyIndex) {
    if (keyIndex < 0 || keyIndex >= this.apiKeys.length) {
      throw new Error('Invalid key index');
    }

    const stats = this.keyStats.get(keyIndex);
    if (!stats) {
      throw new Error('Key statistics not found');
    }

    // 重設本地統計
    const now = Date.now();
    stats.quota.dailyUsage = 0;
    stats.quota.monthlyUsage = 0;
    stats.quota.lastDailyReset = now;
    stats.quota.lastMonthlyReset = now;

    // 重設 Redis 或記憶體快取中的資料
    try {
      const patterns = [
        this._generateRateLimitKey(keyIndex, 'quota_day', 'day'),
        this._generateRateLimitKey(keyIndex, 'quota_month', 'month'),
      ];

      if (this.options.useRedis) {
        for (const pattern of patterns) {
          await redisConnection.del(pattern);
        }
      } else {
        for (const pattern of patterns) {
          memoryCache.delete(pattern);
        }
      }
    } catch (error) {
      logger.error(`Failed to reset quota for key ${keyIndex}`, { error: error.message });
    }

    // 如果金鑰處於配額超限狀態，將其設為活躍
    if (stats.status === 'quota_exceeded') {
      stats.status = 'active';
    }

    logger.info(`Quota reset for API key ${keyIndex}`);
  }

  /**
   * 獲取當前速率限制狀態
   */
  async getCurrentRateLimitStatus() {
    const status = {
      keys: [],
      overall: {
        totalRequests: this.rateLimitStats.totalRequests,
        rateLimitedRequests: this.rateLimitStats.rateLimitedRequests,
        quotaExceededRequests: this.rateLimitStats.quotaExceededRequests,
        availableKeys: 0,
        rateLimitedKeys: 0,
        quotaExceededKeys: 0,
      },
    };

    for (let i = 0; i < this.apiKeys.length; i++) {
      const keyStats = this.keyStats.get(i);
      if (!keyStats) continue;

      // 檢查當前的速率限制狀態
      const rateLimitCheck = await this._checkRateLimit(i);
      const quotaCheck = await this._checkQuotaLimit(i);

      const keyStatus = {
        index: i,
        status: keyStats.status,
        rateLimit: {
          allowed: rateLimitCheck.allowed,
          reason: rateLimitCheck.reason,
          current: rateLimitCheck.current,
          limit: rateLimitCheck.limit,
        },
        quota: {
          allowed: quotaCheck.allowed,
          reason: quotaCheck.reason,
          current: quotaCheck.current,
          limit: quotaCheck.limit,
        },
      };

      status.keys.push(keyStatus);

      // 更新整體統計
      if (keyStats.status === 'active') {
        status.overall.availableKeys++;
      } else if (keyStats.status === 'rate_limited') {
        status.overall.rateLimitedKeys++;
      } else if (keyStats.status === 'quota_exceeded') {
        status.overall.quotaExceededKeys++;
      }
    }

    return status;
  }

  /**
   * 手動禁用/啟用 API 金鑰
   */
  setKeyStatus(keyIndex, status) {
    if (keyIndex < 0 || keyIndex >= this.apiKeys.length) {
      throw new Error('Invalid key index');
    }

    const validStatuses = ['active', 'disabled'];
    if (!validStatuses.includes(status)) {
      throw new Error('Invalid status. Must be "active" or "disabled"');
    }

    const stats = this.keyStats.get(keyIndex);
    if (stats) {
      stats.status = status;
      logger.info(`API key ${keyIndex} status changed to ${status}`);
    }
  }

  /**
   * 清理統計資料
   */
  resetStatistics() {
    for (const [keyIndex, stats] of this.keyStats.entries()) {
      stats.totalRequests = 0;
      stats.successfulRequests = 0;
      stats.failedRequests = 0;
      stats.consecutiveErrors = 0;
      stats.lastError = null;
      stats.rateLimit.requestsPerMinute = 0;
      stats.rateLimit.requestsPerHour = 0;
      stats.rateLimit.minuteStart = Date.now();
      stats.rateLimit.hourStart = Date.now();
      stats.quota.dailyUsage = 0;
      stats.quota.monthlyUsage = 0;
      stats.quota.lastDailyReset = Date.now();
      stats.quota.lastMonthlyReset = Date.now();
    }
    logger.info('API key statistics reset');
  }

  /**
   * 獲取速率限制配置
   */
  getRateLimitConfig() {
    return {
      ...RATE_LIMIT_CONFIG,
      options: this.options,
    };
  }

  /**
   * 更新速率限制配置（僅限運行時）
   */
  updateRateLimitConfig(newConfig) {
    if (newConfig && typeof newConfig === 'object') {
      Object.assign(RATE_LIMIT_CONFIG, newConfig);
      logger.info('Rate limit configuration updated', newConfig);
    }
  }

  /**
   * 計算請求成本
   */
  _calculateRequestCost(prompt, response) {
    const inputChars = prompt.length;
    const outputChars = response ? response.length : 0;
    const totalChars = inputChars + outputChars;

    const cost = (totalChars / 1000) * COST_CONFIG.costPerThousandChars;

    logger.debug('Request cost calculated', {
      inputChars,
      outputChars,
      totalChars,
      cost,
      costPerThousandChars: COST_CONFIG.costPerThousandChars,
    });

    return {
      cost,
      inputChars,
      outputChars,
      totalChars,
    };
  }

  /**
   * 更新成本追蹤
   */
  _updateCostTracking(costInfo, priority) {
    const now = new Date();
    const currentDateString = now.toDateString();
    const currentMonth = now.getMonth();
    const currentHour = now.getHours();
    const currentDay = now.getDay();

    // 檢查是否需要重設每日統計
    if (this.costTracking.lastDailyReset !== currentDateString) {
      this.costTracking.dailyCost = 0;
      this.costTracking.dailyCharacters = 0;
      this.costTracking.lastDailyReset = currentDateString;
      this.usageStats.dailyRequests = 0;
      logger.info('Daily cost tracking reset');
    }

    // 檢查是否需要重設每月統計
    if (this.costTracking.lastMonthlyReset !== currentMonth) {
      this.costTracking.monthlyCost = 0;
      this.costTracking.monthlyCharacters = 0;
      this.costTracking.lastMonthlyReset = currentMonth;
      this.usageStats.monthlyRequests = 0;
      logger.info('Monthly cost tracking reset');
    }

    // 更新成本追蹤
    this.costTracking.totalCost += costInfo.cost;
    this.costTracking.dailyCost += costInfo.cost;
    this.costTracking.monthlyCost += costInfo.cost;
    this.costTracking.totalCharacters += costInfo.totalChars;
    this.costTracking.dailyCharacters += costInfo.totalChars;
    this.costTracking.monthlyCharacters += costInfo.totalChars;

    // 更新使用量統計
    this.usageStats.totalRequests++;
    this.usageStats.dailyRequests++;
    this.usageStats.monthlyRequests++;
    this.usageStats.requestsByPriority[priority]++;
    this.usageStats.requestsByHour[currentHour]++;
    this.usageStats.requestsByDay[currentDay]++;

    // 計算平均請求大小
    this.usageStats.averageRequestSize =
      this.costTracking.totalCharacters / this.usageStats.totalRequests;

    // 計算成本效率（每美元處理的字符數）
    this.usageStats.costEfficiency =
      this.costTracking.totalCost > 0
        ? this.costTracking.totalCharacters / this.costTracking.totalCost
        : 0;

    // 添加到成本歷史
    this.costTracking.costHistory.push({
      timestamp: now.toISOString(),
      cost: costInfo.cost,
      characters: costInfo.totalChars,
      priority,
      dailyTotal: this.costTracking.dailyCost,
      monthlyTotal: this.costTracking.monthlyCost,
    });

    // 保持歷史記錄在合理範圍內（最多1000條記錄）
    if (this.costTracking.costHistory.length > 1000) {
      this.costTracking.costHistory = this.costTracking.costHistory.slice(-1000);
    }

    // 檢查預算狀況
    this._checkBudgetStatus();

    logger.debug('Cost tracking updated', {
      totalCost: this.costTracking.totalCost,
      dailyCost: this.costTracking.dailyCost,
      monthlyCost: this.costTracking.monthlyCost,
      totalRequests: this.usageStats.totalRequests,
      averageRequestSize: this.usageStats.averageRequestSize,
      costEfficiency: this.usageStats.costEfficiency,
    });
  }

  /**
   * 檢查預算狀況
   */
  _checkBudgetStatus() {
    const dailyBudgetUsage = this.costTracking.dailyCost / COST_CONFIG.dailyBudget;
    const monthlyBudgetUsage = this.costTracking.monthlyCost / COST_CONFIG.monthlyBudget;
    const maxBudgetUsage = Math.max(dailyBudgetUsage, monthlyBudgetUsage);

    // 檢查是否超過預算
    const wasOverBudget = this.costTracking.isOverBudget;
    this.costTracking.isOverBudget = maxBudgetUsage >= 1.0;

    // 檢查是否接近預算警告閾值
    const wasWarning = this.costTracking.isBudgetWarning;
    this.costTracking.isBudgetWarning =
      maxBudgetUsage >= COST_CONFIG.budgetWarningThreshold && !this.costTracking.isOverBudget;

    // 產生警告和通知
    if (this.costTracking.isOverBudget && !wasOverBudget) {
      const alert = {
        type: 'budget_exceeded',
        timestamp: new Date().toISOString(),
        dailyBudgetUsage,
        monthlyBudgetUsage,
        message: `API usage has exceeded budget limits. Daily: ${dailyBudgetUsage.toFixed(2)}%, Monthly: ${monthlyBudgetUsage.toFixed(2)}%`,
      };
      this.costTracking.budgetAlerts.push(alert);
      logger.error('Budget exceeded', alert);
    } else if (this.costTracking.isBudgetWarning && !wasWarning) {
      const alert = {
        type: 'budget_warning',
        timestamp: new Date().toISOString(),
        dailyBudgetUsage,
        monthlyBudgetUsage,
        message: `API usage approaching budget limits. Daily: ${dailyBudgetUsage.toFixed(2)}%, Monthly: ${monthlyBudgetUsage.toFixed(2)}%`,
      };
      this.costTracking.budgetAlerts.push(alert);
      logger.warn('Budget warning', alert);
    }

    // 保持警告記錄在合理範圍內
    if (this.costTracking.budgetAlerts.length > 100) {
      this.costTracking.budgetAlerts = this.costTracking.budgetAlerts.slice(-100);
    }
  }

  /**
   * 檢查是否可以處理請求（預算檢查）
   */
  _canProcessRequest(estimatedCost = 0) {
    if (this.costTracking.isOverBudget) {
      return {
        allowed: false,
        reason: 'Budget exceeded',
        details: {
          dailyBudgetUsage: this.costTracking.dailyCost / COST_CONFIG.dailyBudget,
          monthlyBudgetUsage: this.costTracking.monthlyCost / COST_CONFIG.monthlyBudget,
        },
      };
    }

    // 檢查估算的成本是否會超過預算
    const estimatedDailyCost = this.costTracking.dailyCost + estimatedCost;
    const estimatedMonthlyCost = this.costTracking.monthlyCost + estimatedCost;

    if (estimatedDailyCost > COST_CONFIG.dailyBudget) {
      return {
        allowed: false,
        reason: 'Estimated cost would exceed daily budget',
        details: {
          currentDailyCost: this.costTracking.dailyCost,
          estimatedCost,
          dailyBudget: COST_CONFIG.dailyBudget,
        },
      };
    }

    if (estimatedMonthlyCost > COST_CONFIG.monthlyBudget) {
      return {
        allowed: false,
        reason: 'Estimated cost would exceed monthly budget',
        details: {
          currentMonthlyCost: this.costTracking.monthlyCost,
          estimatedCost,
          monthlyBudget: COST_CONFIG.monthlyBudget,
        },
      };
    }

    return { allowed: true };
  }

  /**
   * 獲取成本統計
   */
  getCostStatistics() {
    return {
      totalCost: this.costTracking.totalCost,
      dailyCost: this.costTracking.dailyCost,
      monthlyCost: this.costTracking.monthlyCost,
      totalCharacters: this.costTracking.totalCharacters,
      dailyCharacters: this.costTracking.dailyCharacters,
      monthlyCharacters: this.costTracking.monthlyCharacters,
      budgetStatus: {
        isOverBudget: this.costTracking.isOverBudget,
        isBudgetWarning: this.costTracking.isBudgetWarning,
        dailyBudgetUsage: this.costTracking.dailyCost / COST_CONFIG.dailyBudget,
        monthlyBudgetUsage: this.costTracking.monthlyCost / COST_CONFIG.monthlyBudget,
      },
      configuration: {
        dailyBudget: COST_CONFIG.dailyBudget,
        monthlyBudget: COST_CONFIG.monthlyBudget,
        costPerThousandChars: COST_CONFIG.costPerThousandChars,
        budgetWarningThreshold: COST_CONFIG.budgetWarningThreshold,
      },
    };
  }

  /**
   * 獲取使用量統計
   */
  getUsageStatistics() {
    return {
      totalRequests: this.usageStats.totalRequests,
      dailyRequests: this.usageStats.dailyRequests,
      monthlyRequests: this.usageStats.monthlyRequests,
      requestsByPriority: { ...this.usageStats.requestsByPriority },
      requestsByHour: [...this.usageStats.requestsByHour],
      requestsByDay: [...this.usageStats.requestsByDay],
      peakUsageTime: this.usageStats.peakUsageTime,
      averageRequestSize: this.usageStats.averageRequestSize,
      costEfficiency: this.usageStats.costEfficiency,
    };
  }

  /**
   * 獲取成本歷史
   */
  getCostHistory(options = {}) {
    const { limit = 100, startTime, endTime } = options;
    let history = [...this.costTracking.costHistory];

    // 時間過濾
    if (startTime) {
      history = history.filter(record => new Date(record.timestamp) >= new Date(startTime));
    }
    if (endTime) {
      history = history.filter(record => new Date(record.timestamp) <= new Date(endTime));
    }

    // 限制返回數量
    if (limit > 0) {
      history = history.slice(-limit);
    }

    return history;
  }

  /**
   * 獲取預算警告
   */
  getBudgetAlerts(options = {}) {
    const { limit = 50, type } = options;
    let alerts = [...this.costTracking.budgetAlerts];

    // 類型過濾
    if (type) {
      alerts = alerts.filter(alert => alert.type === type);
    }

    // 限制返回數量
    if (limit > 0) {
      alerts = alerts.slice(-limit);
    }

    return alerts;
  }

  /**
   * 重設成本統計
   */
  resetCostStatistics() {
    this.costTracking.totalCost = 0;
    this.costTracking.dailyCost = 0;
    this.costTracking.monthlyCost = 0;
    this.costTracking.totalCharacters = 0;
    this.costTracking.dailyCharacters = 0;
    this.costTracking.monthlyCharacters = 0;
    this.costTracking.costHistory = [];
    this.costTracking.budgetAlerts = [];
    this.costTracking.isOverBudget = false;
    this.costTracking.isBudgetWarning = false;

    this.usageStats.totalRequests = 0;
    this.usageStats.dailyRequests = 0;
    this.usageStats.monthlyRequests = 0;
    this.usageStats.requestsByPriority = {
      high: 0,
      medium: 0,
      low: 0,
      background: 0,
    };
    this.usageStats.requestsByHour = new Array(24).fill(0);
    this.usageStats.requestsByDay = new Array(7).fill(0);
    this.usageStats.peakUsageTime = null;
    this.usageStats.averageRequestSize = 0;
    this.usageStats.costEfficiency = 0;

    logger.info('Cost statistics reset');
  }

  /**
   * 更新成本配置
   */
  updateCostConfig(newConfig) {
    if (newConfig && typeof newConfig === 'object') {
      Object.assign(COST_CONFIG, newConfig);
      logger.info('Cost configuration updated', newConfig);
    }
  }

  /**
   * 獲取成本配置
   */
  getCostConfig() {
    return { ...COST_CONFIG };
  }

  /**
   * 獲取佇列統計
   */
  getQueueStatistics() {
    return {
      ...this.queueStats,
      currentQueueSizes: { ...this.queueStats.queueSizes },
      batchProcessingStatus: {
        isProcessing: this.batchProcessing.isProcessing,
        concurrentRequests: this.batchProcessing.concurrentRequests,
        lastProcessTime: this.batchProcessing.lastProcessTime,
      },
    };
  }

  /**
   * 清理資源
   */
  cleanup() {
    if (this.backgroundProcessorInterval) {
      clearInterval(this.backgroundProcessorInterval);
      this.backgroundProcessorInterval = null;
    }
    if (this.batchProcessing.batchTimeout) {
      clearTimeout(this.batchProcessing.batchTimeout);
      this.batchProcessing.batchTimeout = null;
    }
    logger.info('GoogleAIService cleanup completed');
  }

  /**
   * 獲取綜合健康狀態（增強版）
   */
  async getEnhancedHealthStatus() {
    const baseHealth = await this.getHealthStatus();

    return {
      ...baseHealth,
      costStatus: this.getCostStatistics(),
      usageStatus: this.getUsageStatistics(),
      queueStatus: this.getQueueStatistics(),
      budgetAlerts: this.getBudgetAlerts({ limit: 10 }),
      performanceMetrics: {
        averageWaitTime: this.queueStats.averageWaitTime,
        averageProcessingTime: this.queueStats.averageProcessingTime,
        successRate:
          this.queueStats.totalProcessed > 0
            ? this.queueStats.totalCompleted / this.queueStats.totalProcessed
            : 0,
        queueUtilization: Object.values(this.queueStats.queueSizes).reduce(
          (sum, size) => sum + size,
          0
        ),
      },
    };
  }
}

module.exports = GoogleAIService;
module.exports.ERROR_TYPES = ERROR_TYPES;
module.exports.ERROR_RECOVERY_STRATEGIES = ERROR_RECOVERY_STRATEGIES;
