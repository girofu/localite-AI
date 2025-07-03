const request = require('supertest');
const express = require('express');
const { rateLimitMiddleware, RateLimitMiddleware } = require('./rateLimitMiddleware');

// 建立測試應用
const createTestApp = limiter => {
  const app = express();
  app.use(express.json());
  app.use(limiter);
  app.get('/test', (req, res) => {
    res.json({ success: true, message: 'Test endpoint' });
  });
  return app;
};

describe('RateLimitMiddleware', () => {
  let rateLimitInstance;

  beforeEach(() => {
    rateLimitInstance = new RateLimitMiddleware();
    jest.clearAllMocks();
  });

  afterEach(() => {
    rateLimitInstance.resetStats();
    // 清理定時器
    if (rateLimitInstance.stopStatsTimer) {
      rateLimitInstance.stopStatsTimer();
    }
  });

  describe('初始化', () => {
    it('應該正確初始化 rate limiting 中間件', () => {
      expect(rateLimitInstance).toBeInstanceOf(RateLimitMiddleware);
      expect(rateLimitInstance.stats).toBeDefined();
      expect(rateLimitInstance.stats.totalRequests).toBe(0);
      expect(rateLimitInstance.stats.blockedRequests).toBe(0);
    });

    it('應該有預設的統計資料', () => {
      const stats = rateLimitInstance.getStats();
      expect(stats).toHaveProperty('totalRequests');
      expect(stats).toHaveProperty('blockedRequests');
      expect(stats).toHaveProperty('errorCount');
      expect(stats).toHaveProperty('redisAvailable');
      expect(stats).toHaveProperty('timestamp');
    });
  });

  describe('鍵生成器', () => {
    it('應該生成唯一的限制鍵', () => {
      const mockReq = {
        ip: '127.0.0.1',
        user: { uid: 'test-user-123' },
        get: jest.fn(header => {
          if (header === 'User-Agent') return 'Mozilla/5.0 Test Browser';
          return null;
        }),
      };

      const key = RateLimitMiddleware.generateKey(mockReq, 'test_prefix');
      expect(key).toMatch(/^test_prefix:127\.0\.0\.1:test-user-123:/);
      expect(key).toContain('test_prefix');
    });

    it('應該處理匿名用戶', () => {
      const mockReq = {
        ip: '192.168.1.1',
        get: jest.fn(() => 'Test-Agent'),
      };

      const key = RateLimitMiddleware.generateKey(mockReq);
      expect(key).toMatch(/^rate_limit:192\.168\.1\.1:anonymous:/);
    });
  });

  describe('createLimiter', () => {
    it('應該建立有效的 rate limiter', () => {
      const limiter = rateLimitInstance.createLimiter({
        windowMs: 60000, // 1分鐘
        maxRequests: 5,
        message: '測試限制',
      });

      expect(limiter).toBeDefined();
      expect(typeof limiter).toBe('function');
    });

    it('應該使用預設選項', () => {
      const limiter = rateLimitInstance.createLimiter();
      expect(limiter).toBeDefined();
    });
  });

  describe('預設限制器', () => {
    it('應該提供預設的限制器配置', () => {
      const defaultLimiters = rateLimitInstance.getDefaultLimiters();

      expect(defaultLimiters).toHaveProperty('general');
      expect(defaultLimiters).toHaveProperty('auth');
      expect(defaultLimiters).toHaveProperty('sensitive');
      expect(defaultLimiters).toHaveProperty('strict');

      // 確保每個限制器都是函數
      Object.values(defaultLimiters).forEach(limiter => {
        expect(typeof limiter).toBe('function');
      });
    });
  });

  describe('統計功能', () => {
    it('應該能重置統計資料', () => {
      rateLimitInstance.stats.totalRequests = 10;
      rateLimitInstance.stats.blockedRequests = 2;

      rateLimitInstance.resetStats();

      expect(rateLimitInstance.stats.totalRequests).toBe(0);
      expect(rateLimitInstance.stats.blockedRequests).toBe(0);
    });

    it('應該提供完整的統計資料', () => {
      const stats = rateLimitInstance.getStats();

      expect(stats).toHaveProperty('totalRequests');
      expect(stats).toHaveProperty('blockedRequests');
      expect(stats).toHaveProperty('errorCount');
      expect(stats).toHaveProperty('redisAvailable');
      expect(stats).toHaveProperty('timestamp');
      expect(typeof stats.timestamp).toBe('string');
    });
  });

  describe('跳過條件', () => {
    it('應該在測試環境中跳過限制', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';

      const skipFunction = RateLimitMiddleware.createSkipFunction();
      const mockReq = { ip: '127.0.0.1' };

      const shouldSkip = skipFunction(mockReq);
      expect(shouldSkip).toBe(true);

      process.env.NODE_ENV = originalEnv;
    });

    it('應該在開發環境中根據環境變數跳過', () => {
      const originalEnv = process.env.NODE_ENV;
      const originalSkip = process.env.SKIP_RATE_LIMIT;

      process.env.NODE_ENV = 'development';
      process.env.SKIP_RATE_LIMIT = 'true';

      const skipFunction = RateLimitMiddleware.createSkipFunction();
      const mockReq = { ip: '127.0.0.1' };

      const shouldSkip = skipFunction(mockReq);
      expect(shouldSkip).toBe(true);

      process.env.NODE_ENV = originalEnv;
      process.env.SKIP_RATE_LIMIT = originalSkip;
    });

    it('應該支援自訂跳過條件', () => {
      // 暫時設定為非測試環境以測試自訂條件
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const customSkipCondition = req => req.ip === '192.168.1.100';
      const skipFunction = RateLimitMiddleware.createSkipFunction([customSkipCondition]);

      const mockReq1 = { ip: '192.168.1.100' };
      const mockReq2 = { ip: '192.168.1.101' };

      expect(skipFunction(mockReq1)).toBe(true);
      expect(skipFunction(mockReq2)).toBe(false);

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('整合測試', () => {
    it('應該正確處理正常請求', async () => {
      const limiter = rateLimitInstance.createLimiter({
        windowMs: 60000,
        maxRequests: 10,
        message: '測試限制',
      });

      const app = createTestApp(limiter);

      const response = await request(app).get('/test').expect(200);

      expect(response.body.success).toBe(true);
    });

    it('應該在超過限制時返回 429', async () => {
      // 暫時設定為非測試環境以啟用限制功能
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const limiter = rateLimitInstance.createLimiter({
        windowMs: 60000,
        maxRequests: 1, // 只允許 1 次請求
        message: '測試限制超過',
      });

      const app = createTestApp(limiter);

      // 第一次請求應該成功
      await request(app).get('/test').expect(200);

      // 第二次請求應該被限制
      const response = await request(app).get('/test').expect(429);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(response.body.error.message).toBe('測試限制超過');

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('錯誤處理', () => {
    it('應該正確處理 Redis 連接失敗', async () => {
      // 模擬 Redis 不可用的情況
      rateLimitInstance.isRedisAvailable = false;

      const limiter = rateLimitInstance.createLimiter({
        windowMs: 60000,
        maxRequests: 5,
      });

      const app = createTestApp(limiter);

      // 應該回退到記憶體存儲，仍然能正常工作
      const response = await request(app).get('/test').expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('單例實例', () => {
    it('應該匯出單例實例', () => {
      expect(rateLimitMiddleware).toBeDefined();
      expect(rateLimitMiddleware).toBeInstanceOf(RateLimitMiddleware);
    });

    it('應該具有 createLimiter 方法', () => {
      expect(typeof rateLimitMiddleware.createLimiter).toBe('function');
    });

    it('應該具有統計方法', () => {
      expect(typeof rateLimitMiddleware.getStats).toBe('function');
      expect(typeof rateLimitMiddleware.resetStats).toBe('function');
    });
  });
});

// 回應處理器測試
describe('Response Handler', () => {
  let rateLimitInstance;

  beforeEach(() => {
    rateLimitInstance = new RateLimitMiddleware();
  });

  it('應該建立正確的回應處理器', () => {
    const handler = rateLimitInstance.createResponseHandler('測試訊息', 60000);
    expect(typeof handler).toBe('function');
  });

  it('應該正確格式化錯誤回應', () => {
    const handler = rateLimitInstance.createResponseHandler('測試訊息', 60000);

    const mockReq = {
      ip: '127.0.0.1',
      originalUrl: '/test',
      method: 'GET',
      get: jest.fn(() => 'Test-Agent'),
    };

    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    handler(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(429);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          message: '測試訊息',
          code: 'RATE_LIMIT_EXCEEDED',
        }),
        rateLimitInfo: expect.objectContaining({
          windowMs: 60000,
        }),
      })
    );
  });
});
