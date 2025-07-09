const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const logger = require('../config/logger');

// 新增 Redis 連接
let redisConnection;
try {
  const redisConfig = require('../config/redis');
  redisConnection = redisConfig.redisConnection;
} catch (error) {
  logger.warn('Redis connection not available, using in-memory rate limiting');
}

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

// 記憶體快取用於備援
const memoryCache = new Map();

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
      ...options,
    };

    // 初始化金鑰管理狀態
    this.currentKeyIndex = 0;
    this.keyStats = new Map();
    this.keyClients = new Map();

    // 為每個金鑰初始化統計和客戶端
    this._initializeKeys();

    // 初始化速率限制管理器
    this._initializeRateLimiter();

    logger.info(`GoogleAIService initialized with ${this.apiKeys.length} API keys`, {
      rateLimit: this.options.enableRateLimit,
      quotaManagement: this.options.enableQuotaManagement,
      useRedis: this.options.useRedis,
    });
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

    let candidateKeys = unrestricted.length > 0 ? unrestricted : availableKeys;

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
   * 生成內容的主要方法，帶有速率限制、配額檢查和自動重試
   */
  async generateContent(prompt, options = {}) {
    const maxRetries = options.maxRetries || this.apiKeys.length;
    let lastError = null;
    let attemptCount = 0;
    let rateLimitedKeys = [];
    let quotaExceededKeys = [];

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const keyIndex = this._getNextAvailableKey();

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
          lastError = error;
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
          lastError = error;
          continue;
        }

        const { model } = this.keyClients.get(keyIndex);
        attemptCount++;

        logger.debug(`Using API key ${keyIndex} for content generation (attempt ${attempt + 1})`);

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // 增加速率限制和配額計數
        await this._incrementRateLimitAndQuota(keyIndex);

        // 成功時更新統計
        this._updateKeyStats(keyIndex, true);

        return text;
      } catch (error) {
        lastError = error;
        const errorMessage = error.message || error.toString();

        // 更新失敗統計
        this._updateKeyStats(this.currentKeyIndex, false, errorMessage);

        logger.warn(
          `API key ${this.currentKeyIndex} failed (attempt ${attempt + 1}): ${errorMessage}`
        );

        // 如果是速率限制或配額相關錯誤，不再重試
        if (error.code === 'RATE_LIMIT_EXCEEDED' || error.code === 'QUOTA_EXCEEDED') {
          break;
        }

        // 如果還有重試次數，繼續嘗試
        if (attempt < maxRetries - 1) {
          continue;
        }
      }
    }

    // 檢查是否所有金鑰都被限制
    const allKeysRateLimited = rateLimitedKeys.length === this.apiKeys.length;
    const allKeysQuotaExceeded = quotaExceededKeys.length === this.apiKeys.length;

    if (allKeysRateLimited) {
      throw new Error('Rate limit exceeded: All API keys are rate limited');
    }

    if (allKeysQuotaExceeded) {
      throw new Error('Quota exceeded: All API keys have exceeded their quota');
    }

    // 所有重試都失敗
    logger.error('All API keys failed to generate content:', lastError);
    throw new Error(
      `Failed to generate content from Google AI after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`
    );
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

    // 根據剩餘的金鑰數量重新建立索引
    for (let i = 0; i < this.apiKeys.length; i++) {
      // 尋找對應的客戶端和統計，可能來自任何舊索引
      for (const [oldIndex, client] of this.keyClients.entries()) {
        if (newKeyClients.size === i && !newKeyClients.has(i)) {
          newKeyClients.set(i, client);
          newKeyStats.set(i, this.keyStats.get(oldIndex));
          break;
        }
      }
    }

    this.keyClients = newKeyClients;
    this.keyStats = newKeyStats;
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
              ? ((keyStats.successfulRequests / keyStats.totalRequests) * 100).toFixed(2) + '%'
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
    const allowedKeys = [
      'requestsPerMinute',
      'requestsPerHour',
      'dailyQuota',
      'monthlyQuota',
      'rateLimitCooldown',
      'quotaResetHours',
    ];

    for (const key of allowedKeys) {
      if (newConfig[key] !== undefined) {
        RATE_LIMIT_CONFIG[key] = parseInt(newConfig[key], 10);
      }
    }

    logger.info('Rate limit configuration updated', newConfig);
  }
}

module.exports = GoogleAIService;
