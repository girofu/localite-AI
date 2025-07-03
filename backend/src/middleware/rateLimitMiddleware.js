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

    // 初始化 Redis 連接
    this.initializeRedis();

    // 啟動統計定時器
    this.startStatsTimer();
  }

  /**
   * 初始化 Redis 連接
   */
  async initializeRedis() {
    try {
      if (redisConnection && redisConnection.isConnected) {
        this.redis = redisConnection.getClient();
        this.isRedisAvailable = true;
        logger.info('Rate limiting Redis 連接已建立');
      } else {
        logger.warn('Redis 不可用，使用記憶體快取進行 rate limiting');
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
    const ip = req.ip || req.connection.remoteAddress;
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
    const { redis } = this;

    return {
      async increment(key) {
        try {
          const results = await redis
            .multi()
            .incr(key)
            .expire(key, Math.ceil(windowMs / 1000))
            .exec();

          return {
            totalHits: results[0][1],
            resetTime: new Date(Date.now() + windowMs),
          };
        } catch (error) {
          logger.error('Redis rate limit increment failed', {
            error: error.message,
            key,
          });
          throw error;
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
    if (!this.isRedisAvailable) return;

    try {
      // 清理過期的 rate limit 鍵
      const keys = await this.redis.keys('rate_limit:*');
      if (keys.length > 0) {
        // 檢查 TTL 並清理過期的鍵
        const pipeline = this.redis.pipeline();
        // 並行檢查所有鍵的 TTL
        const ttlChecks = keys.map(key => this.redis.ttl(key));
        const ttlResults = await Promise.all(ttlChecks);

        keys.forEach((key, index) => {
          if (ttlResults[index] <= 0) {
            pipeline.del(key);
          }
        });
        await pipeline.exec();
        logger.info(`Rate limit cleanup completed, processed ${keys.length} keys`);
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
