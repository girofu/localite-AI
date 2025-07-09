// Simplified rate limit middleware stub for testing environment.
// In production, replace with real implementation (e.g., express-rate-limit).

const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { redisConnection } = require('../config/redis');
const { logger } = require('./requestLogger');

/**
 * 專業級 Rate Limiting 中間件
 * 支援分散式快取、多層級限制策略、監控統計
 */
class RateLimitMiddleware {
  constructor() {
    this.redis = null;
    this.isRedisAvailable = false;
    this.stats = {
      totalRequests: 0,
      blockedRequests: 0,
      errorCount: 0,
    };

    // 初始化 Redis 連接（異步）
    this.initializeRedis().catch(error => {
      logger.error('Rate limiting Redis 初始化失敗', { error: error.message });
    });

    // 啟動統計定時器
    this.startStatsTimer();
  }

  /**
   * 初始化 Redis 連接
   */
  async initializeRedis() {
    try {
      // 先嘗試連接 Redis
      await redisConnection.connect();

      if (redisConnection && redisConnection.isConnected) {
        this.redis = redisConnection;
        this.isRedisAvailable = true;
        logger.info('Rate limiting Redis 連接已建立');
      } else {
        logger.warn('Redis 不可用，使用記憶體快取進行 rate limiting');
        this.isRedisAvailable = false;
      }
    } catch (error) {
      logger.error('Rate limiting Redis 初始化失敗', { error: error.message });
      this.isRedisAvailable = false;
    }
  }

  /**
   * 自訂鍵生成器
   */
  static generateKey(req, prefix = 'rate_limit') {
    // 基於 IP 地址和用戶 ID（如果有）生成唯一鍵
    // 優先使用 X-Forwarded-For 標頭中的 IP（用於測試和代理環境）
    const ip =
      req.get('X-Forwarded-For') ||
      req.ip ||
      (req.connection && req.connection.remoteAddress) ||
      'unknown';
    const userId = req.user?.uid || req.user?.id || 'anonymous';
    const userAgent = req.get('User-Agent') || 'unknown';

    // 生成設備指紋的簡化版本
    const deviceFingerprint = crypto
      .createHash('md5')
      .update(userAgent)
      .digest('hex')
      .substring(0, 8);

    return `${prefix}:${ip}:${userId}:${deviceFingerprint}`;
  }

  /**
   * 自訂回應處理器
   */
  createResponseHandler(message, windowMs) {
    return (req, res) => {
      this.stats.blockedRequests += 1;

      const retryAfter = Math.ceil(windowMs / 1000);
      const clientInfo = {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        userId: req.user?.uid,
        timestamp: new Date().toISOString(),
      };

      // 記錄被阻擋的請求
      logger.warn('Rate limit exceeded', {
        ...clientInfo,
        message,
        retryAfter,
        endpoint: req.originalUrl,
        method: req.method,
      });

      // 返回標準化的錯誤回應
      res.status(429).json({
        success: false,
        error: {
          message: message || '請求過於頻繁，請稍後再試',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter,
          endpoint: req.originalUrl,
          timestamp: new Date().toISOString(),
        },
        rateLimitInfo: {
          windowMs,
          retryAfter,
          resetTime: new Date(Date.now() + windowMs).toISOString(),
        },
      });
    };
  }

  /**
   * 跳過條件檢查
   */
  static createSkipFunction(customSkipConditions = []) {
    return req => {
      // 開發環境跳過（可選）
      if (process.env.NODE_ENV === 'development' && process.env.SKIP_RATE_LIMIT === 'true') {
        return true;
      }

      // 測試環境跳過
      if (process.env.NODE_ENV === 'test') {
        return true;
      }

      // 白名單 IP
      const whitelistedIPs = (process.env.RATE_LIMIT_WHITELIST || '').split(',').filter(Boolean);
      if (whitelistedIPs.includes(req.ip)) {
        return true;
      }

      // 自訂跳過條件
      return customSkipConditions.some(condition => condition(req));
    };
  }

  /**
   * 建立 Redis 存儲類別
   */
  createRedisStore(windowMs) {
    const redis = this.redis;

    return {
      async increment(key) {
        try {
          // 檢查 Redis 是否真的可用
          if (!redis || !redis.isConnected) {
            throw new Error('Redis not available');
          }

          // 使用 Redis 的 incr 和 expire 命令
          const multi = redis.multi();
          multi.incr(key);
          multi.expire(key, Math.ceil(windowMs / 1000));
          const results = await multi.exec();

          // 檢查結果格式
          if (results && results.length >= 2 && results[0][0] === null) {
            const totalHits = results[0][1]; // incr 的結果
            return {
              totalHits,
              resetTime: new Date(Date.now() + windowMs),
            };
          } else {
            // 如果 multi 失敗，嘗試單獨的命令
            const totalHits = await redis.incr(key);
            await redis.expire(key, Math.ceil(windowMs / 1000));
            return {
              totalHits,
              resetTime: new Date(Date.now() + windowMs),
            };
          }
        } catch (error) {
          logger.error('Redis rate limit increment failed', {
            error: error.message,
            key,
          });

          // 如果 Redis 操作失敗，回退到記憶體存儲
          if (!this.memoryStore) {
            this.memoryStore = new Map();
          }

          const now = Date.now();
          const record = this.memoryStore.get(key) || { count: 0, resetTime: now + windowMs };

          if (now > record.resetTime) {
            record.count = 1;
            record.resetTime = now + windowMs;
          } else {
            record.count++;
          }

          this.memoryStore.set(key, record);

          return {
            totalHits: record.count,
            resetTime: new Date(record.resetTime),
          };
        }
      },

      async decrement(key) {
        try {
          await redis.decr(key);
        } catch (error) {
          logger.error('Redis rate limit decrement failed', {
            error: error.message,
            key,
          });
        }
      },

      async resetKey(key) {
        try {
          await redis.del(key);
        } catch (error) {
          logger.error('Redis rate limit reset failed', {
            error: error.message,
            key,
          });
        }
      },
    };
  }

  /**
   * 建立 Rate Limiter
   */
  createLimiter(options = {}) {
    const {
      windowMs = 15 * 60 * 1000, // 15分鐘
      maxRequests = 100,
      message = '請求過於頻繁，請稍後再試',
      keyPrefix = 'rate_limit',
      skipConditions = [],
      enableStats = true,
    } = options;

    const limiterConfig = {
      windowMs,
      max: maxRequests,
      message: {
        success: false,
        error: {
          message,
          code: 'RATE_LIMIT_EXCEEDED',
        },
      },
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: req => RateLimitMiddleware.generateKey(req, keyPrefix),
      handler: this.createResponseHandler(message, windowMs),
      skip: RateLimitMiddleware.createSkipFunction(skipConditions),
    };

    // 如果 Redis 可用，使用 Redis 存儲
    if (this.isRedisAvailable) {
      limiterConfig.store = this.createRedisStore(windowMs);
    }

    // 統計計數
    const originalHandler = limiterConfig.handler;
    limiterConfig.handler = (req, res, next) => {
      if (enableStats) {
        this.stats.totalRequests += 1;
      }
      return originalHandler(req, res, next);
    };

    return rateLimit(limiterConfig);
  }

  /**
   * 預設的限制器配置
   */
  getDefaultLimiters() {
    return {
      // 一般 API 限制
      general: this.createLimiter({
        windowMs: 15 * 60 * 1000, // 15分鐘
        maxRequests: 100,
        message: '一般 API 請求過於頻繁，請稍後再試',
        keyPrefix: 'general_rate_limit',
        enableStats: true,
      }),

      // 認證相關限制
      auth: this.createLimiter({
        windowMs: 15 * 60 * 1000, // 15分鐘
        maxRequests: 10,
        message: '認證請求過於頻繁，請稍後再試',
        keyPrefix: 'auth_rate_limit',
        enableStats: true,
      }),

      // 敏感操作限制
      sensitive: this.createLimiter({
        windowMs: 15 * 60 * 1000, // 15分鐘
        maxRequests: 5,
        message: '敏感操作請求過於頻繁，請稍後再試',
        keyPrefix: 'sensitive_rate_limit',
        enableStats: true,
      }),

      // 嚴格限制（用於高風險操作）
      strict: this.createLimiter({
        windowMs: 60 * 60 * 1000, // 1小時
        maxRequests: 3,
        message: '高風險操作請求過於頻繁，請稍後再試',
        keyPrefix: 'strict_rate_limit',
        enableStats: true,
      }),
    };
  }

  /**
   * 獲取統計資料
   */
  getStats() {
    return {
      ...this.stats,
      redisAvailable: this.isRedisAvailable,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 重置統計資料
   */
  resetStats() {
    this.stats = {
      totalRequests: 0,
      blockedRequests: 0,
      errorCount: 0,
    };
    logger.info('Rate limiting statistics reset');
  }

  /**
   * 啟動統計定時器
   */
  startStatsTimer() {
    // 測試環境不啟動定時器，避免 Jest 異步操作問題
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    // 每小時記錄統計資料
    this.statsTimer = setInterval(
      () => {
        if (this.stats.totalRequests > 0) {
          logger.info('Rate limiting statistics', this.getStats());
        }
      },
      60 * 60 * 1000
    ); // 1小時
  }

  /**
   * 停止統計定時器
   */
  stopStatsTimer() {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
  }

  /**
   * 清理過期的 rate limit 記錄
   */
  async cleanup() {
    if (!this.isRedisAvailable) {
      // 清理記憶體存儲
      if (this.memoryStore) {
        const now = Date.now();
        for (const [key, record] of this.memoryStore.entries()) {
          if (now > record.resetTime) {
            this.memoryStore.delete(key);
          }
        }
      }
      return;
    }

    try {
      // 清理過期的 rate limit 鍵
      const keys = await this.redis.keys('rate_limit:*');
      if (keys.length > 0) {
        // 檢查 TTL 並清理過期的鍵
        const expiredKeys = [];
        for (const key of keys) {
          const ttl = await this.redis.ttl(key);
          if (ttl <= 0) {
            expiredKeys.push(key);
          }
        }

        if (expiredKeys.length > 0) {
          await this.redis.del(...expiredKeys);
          logger.info(`Rate limit cleanup completed, removed ${expiredKeys.length} expired keys`);
        }
      }
    } catch (error) {
      logger.error('Rate limit cleanup failed', { error: error.message });
    }
  }
}

// 建立單例實例
const rateLimitMiddleware = new RateLimitMiddleware();

module.exports = {
  rateLimitMiddleware,
  RateLimitMiddleware,
};
