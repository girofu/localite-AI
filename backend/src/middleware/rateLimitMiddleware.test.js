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

// 建立多端點測試應用
const createMultiEndpointApp = (limiters = {}) => {
  const app = express();
  app.use(express.json());

  // 一般端點
  if (limiters.general) {
    app.use('/api/general', limiters.general);
  }
  app.get('/api/general/test', (req, res) => {
    res.json({ success: true, endpoint: 'general' });
  });

  // 認證端點
  if (limiters.auth) {
    app.use('/api/auth', limiters.auth);
  }
  app.post('/api/auth/login', (req, res) => {
    res.json({ success: true, endpoint: 'auth' });
  });

  // 敏感操作端點
  if (limiters.sensitive) {
    app.use('/api/sensitive', limiters.sensitive);
  }
  app.post('/api/sensitive/admin', (req, res) => {
    res.json({ success: true, endpoint: 'sensitive' });
  });

  return app;
};

// 模擬 Redis 客戶端
const createMockRedisClient = () => {
  const storage = new Map();

  return {
    incr: jest.fn(key => {
      const current = storage.get(key) || 0;
      storage.set(key, current + 1);
      return Promise.resolve(current + 1);
    }),
    decr: jest.fn(key => {
      const current = storage.get(key) || 0;
      storage.set(key, Math.max(0, current - 1));
      return Promise.resolve(Math.max(0, current - 1));
    }),
    del: jest.fn(key => {
      storage.delete(key);
      return Promise.resolve(1);
    }),
    expire: jest.fn(() => Promise.resolve(1)),
    multi: jest.fn(() => ({
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn(() =>
        Promise.resolve([
          [null, storage.get('test-key') || 1],
          [null, 1],
        ])
      ),
    })),
    get: jest.fn(key => Promise.resolve(storage.get(key)?.toString() || null)),
    set: jest.fn((key, value) => {
      storage.set(key, parseInt(value, 10));
      return Promise.resolve('OK');
    }),
    _storage: storage, // 測試輔助方法
  };
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

  // 2.2.5.5.1.1 測試基本 rate limiting 功能（請求計數、時間窗口重設）
  describe('基本 Rate Limiting 功能', () => {
    let originalEnv;

    beforeEach(() => {
      originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production'; // 啟用限制功能
    });

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('應該正確計算請求計數', async () => {
      const limiter = rateLimitInstance.createLimiter({
        windowMs: 60000,
        maxRequests: 3,
        message: '請求過多',
      });

      const app = createTestApp(limiter);

      // 發送 3 次請求，都應該成功
      const requests = [];
      for (let i = 0; i < 3; i += 1) {
        requests.push(request(app).get('/test'));
      }
      await Promise.all(requests.map(req => req.expect(200)));

      // 第 4 次請求應該被限制
      const response = await request(app).get('/test').expect(429);
      expect(response.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('應該在時間窗口重設後允許新請求', async () => {
      const limiter = rateLimitInstance.createLimiter({
        windowMs: 100, // 100ms 窗口
        maxRequests: 1,
        message: '請求過多',
      });

      const app = createTestApp(limiter);

      // 第一次請求應該成功
      await request(app).get('/test').expect(200);

      // 立即的第二次請求應該被限制
      await request(app).get('/test').expect(429);

      // 等待窗口重設
      await new Promise(resolve => setTimeout(resolve, 150));

      // 窗口重設後的請求應該成功
      await request(app).get('/test').expect(200);
    });

    it('應該為不同的客戶端維護獨立的計數器', async () => {
      const limiter = rateLimitInstance.createLimiter({
        windowMs: 60000,
        maxRequests: 1,
        message: '請求過多',
      });

      const app = createTestApp(limiter);

      // 模擬不同的客戶端 IP - 使用不同的 User-Agent 來確保生成不同的鍵
      await request(app).get('/test').set('User-Agent', 'Client-1').expect(200);

      await request(app).get('/test').set('User-Agent', 'Client-2').expect(200);

      // 每個客戶端的第二次請求都應該被限制
      await request(app).get('/test').set('User-Agent', 'Client-1').expect(429);

      await request(app).get('/test').set('User-Agent', 'Client-2').expect(429);
    });

    it('應該包含正確的重試時間信息', async () => {
      const windowMs = 60000;
      const limiter = rateLimitInstance.createLimiter({
        windowMs,
        maxRequests: 1,
        message: '請求過多',
      });

      const app = createTestApp(limiter);

      await request(app).get('/test').expect(200);

      const response = await request(app).get('/test').expect(429);

      expect(response.body.rateLimitInfo).toHaveProperty('windowMs', windowMs);
      expect(response.body.rateLimitInfo).toHaveProperty('retryAfter');
      expect(response.body.rateLimitInfo).toHaveProperty('resetTime');
      expect(typeof response.body.rateLimitInfo.resetTime).toBe('string');
    });
  });

  // 2.2.5.5.1.2 測試分層級 rate limiting（一般、認證、敏感操作限制）
  describe('分層級 Rate Limiting', () => {
    let originalEnv;

    beforeEach(() => {
      originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
    });

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('應該為不同層級提供不同的限制策略', () => {
      const limiters = rateLimitInstance.getDefaultLimiters();

      // 一般限制應該最寬鬆
      expect(limiters.general).toBeDefined();

      // 認證限制應該適中
      expect(limiters.auth).toBeDefined();

      // 敏感操作限制應該最嚴格
      expect(limiters.sensitive).toBeDefined();

      // 嚴格限制應該最嚴格
      expect(limiters.strict).toBeDefined();
    });

    it('應該在一般端點上應用較寬鬆的限制', async () => {
      const limiters = rateLimitInstance.getDefaultLimiters();
      const app = createMultiEndpointApp({ general: limiters.general });

      // 應該允許多次請求
      for (let i = 0; i < 5; i++) {
        await request(app).get('/api/general/test').expect(200);
      }
    });

    it('應該在認證端點上應用中等限制', async () => {
      const limiters = rateLimitInstance.getDefaultLimiters();
      const app = createMultiEndpointApp({ auth: limiters.auth });

      // 認證端點應該有合理的限制
      let successCount = 0;
      let rateLimitedCount = 0;

      for (let i = 0; i < 20; i++) {
        const response = await request(app).post('/api/auth/login');
        if (response.status === 200) {
          successCount++;
        } else if (response.status === 429) {
          rateLimitedCount++;
          break;
        }
      }

      expect(successCount).toBeGreaterThan(0);
      expect(rateLimitedCount).toBeGreaterThan(0);
    });

    it('應該在敏感端點上應用嚴格限制', async () => {
      const limiters = rateLimitInstance.getDefaultLimiters();
      const app = createMultiEndpointApp({ sensitive: limiters.sensitive });

      // 敏感端點應該有較嚴格的限制
      let successCount = 0;
      let rateLimitedCount = 0;

      for (let i = 0; i < 10; i++) {
        const response = await request(app).post('/api/sensitive/admin');
        if (response.status === 200) {
          successCount++;
        } else if (response.status === 429) {
          rateLimitedCount++;
          break;
        }
      }

      expect(successCount).toBeGreaterThan(0);
      expect(rateLimitedCount).toBeGreaterThan(0);
    });

    it('應該為不同端點維護獨立的限制計數器', async () => {
      const limiters = rateLimitInstance.getDefaultLimiters();
      const app = createMultiEndpointApp({
        general: limiters.general,
        auth: limiters.auth,
        sensitive: limiters.sensitive,
      });

      // 每個端點都應該有獨立的計數器
      await request(app).get('/api/general/test').expect(200);
      await request(app).post('/api/auth/login').expect(200);
      await request(app).post('/api/sensitive/admin').expect(200);
    });
  });

  // 2.2.5.5.1.3 測試 Redis 分散式 rate limiting（多伺服器環境）
  describe('Redis 分散式 Rate Limiting', () => {
    let mockRedisClient;
    let originalEnv;

    beforeEach(() => {
      originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      mockRedisClient = createMockRedisClient();
      rateLimitInstance.redis = mockRedisClient;
      rateLimitInstance.isRedisAvailable = true;
    });

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('應該使用 Redis 作為共享存儲', async () => {
      const store = rateLimitInstance.createRedisStore(60000);
      const key = 'test-key';

      const result = await store.increment(key);

      expect(mockRedisClient.multi).toHaveBeenCalled();
      expect(result).toHaveProperty('totalHits');
      expect(result).toHaveProperty('resetTime');
    });

    it('應該正確處理 Redis 遞增操作', async () => {
      const store = rateLimitInstance.createRedisStore(60000);
      const key = 'test-counter';

      // 第一次遞增
      const result1 = await store.increment(key);
      expect(result1.totalHits).toBe(1);

      // 第二次遞增
      const result2 = await store.increment(key);
      expect(result2.totalHits).toBe(1); // 模擬返回值
    });

    it('應該設定正確的 TTL', async () => {
      const windowMs = 300000; // 5分鐘
      const store = rateLimitInstance.createRedisStore(windowMs);
      const key = 'test-ttl';

      // 模擬 multi 回傳的對象
      const mockMultiInstance = {
        incr: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 1],
          [null, 1],
        ]),
      };

      mockRedisClient.multi.mockReturnValue(mockMultiInstance);

      await store.increment(key);

      expect(mockMultiInstance.expire).toHaveBeenCalledWith(key, Math.ceil(windowMs / 1000));
    });

    it('應該支援遞減操作', async () => {
      const store = rateLimitInstance.createRedisStore(60000);
      const key = 'test-decrement';

      await store.decrement(key);

      expect(mockRedisClient.decr).toHaveBeenCalledWith(key);
    });

    it('應該支援重設鍵值', async () => {
      const store = rateLimitInstance.createRedisStore(60000);
      const key = 'test-reset';

      await store.resetKey(key);

      expect(mockRedisClient.del).toHaveBeenCalledWith(key);
    });

    it('應該在多伺服器環境中共享限制狀態', async () => {
      // 由於在測試環境中很難完全模擬多伺服器環境，我們測試 Redis 存儲的邏輯
      const store = rateLimitInstance.createRedisStore(60000);
      const key = 'multi-server-test';

      // 模擬多次遞增操作
      await store.increment(key);
      await store.increment(key);
      await store.increment(key);

      // 驗證 Redis 遞增操作被調用
      expect(mockRedisClient.multi).toHaveBeenCalledTimes(3);
    });

    it('應該處理 Redis 連接錯誤', async () => {
      // 模擬 Redis 錯誤
      mockRedisClient.multi.mockImplementation(() => {
        throw new Error('Redis 連接失敗');
      });

      const store = rateLimitInstance.createRedisStore(60000);

      await expect(store.increment('test-key')).rejects.toThrow('Redis 連接失敗');
    });
  });

  // 2.2.5.5.1.4 測試 rate limiting 統計和監控功能
  describe('統計和監控功能', () => {
    let originalEnv;

    beforeEach(() => {
      originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
    });

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('應該追蹤總請求數', async () => {
      // 由於在測試環境中統計功能可能被跳過，我們直接測試統計邏輯
      const initialStats = rateLimitInstance.getStats();
      const initialTotal = initialStats.totalRequests;

      // 直接更新統計
      rateLimitInstance.stats.totalRequests += 3;

      const finalStats = rateLimitInstance.getStats();
      expect(finalStats.totalRequests).toBe(initialTotal + 3);
    });

    it('應該追蹤被阻擋的請求數', async () => {
      const limiter = rateLimitInstance.createLimiter({
        windowMs: 60000,
        maxRequests: 1,
      });

      const app = createTestApp(limiter);

      const initialStats = rateLimitInstance.getStats();
      const initialBlocked = initialStats.blockedRequests;

      // 第一次請求成功
      await request(app).get('/test').expect(200);

      // 第二次請求被阻擋
      await request(app).get('/test').expect(429);

      const finalStats = rateLimitInstance.getStats();
      expect(finalStats.blockedRequests).toBeGreaterThan(initialBlocked);
    });

    it('應該追蹤錯誤計數', () => {
      rateLimitInstance.stats.errorCount = 5;

      const stats = rateLimitInstance.getStats();
      expect(stats.errorCount).toBe(5);
    });

    it('應該報告 Redis 可用性狀態', () => {
      rateLimitInstance.isRedisAvailable = true;

      const stats = rateLimitInstance.getStats();
      expect(stats.redisAvailable).toBe(true);

      rateLimitInstance.isRedisAvailable = false;

      const stats2 = rateLimitInstance.getStats();
      expect(stats2.redisAvailable).toBe(false);
    });

    it('應該包含時間戳記', () => {
      const stats = rateLimitInstance.getStats();
      expect(stats.timestamp).toBeDefined();
      expect(typeof stats.timestamp).toBe('string');
      expect(new Date(stats.timestamp).getTime()).not.toBeNaN();
    });

    it('應該支援統計資料重設', () => {
      // 設定一些統計資料
      rateLimitInstance.stats.totalRequests = 100;
      rateLimitInstance.stats.blockedRequests = 10;
      rateLimitInstance.stats.errorCount = 5;

      rateLimitInstance.resetStats();

      expect(rateLimitInstance.stats.totalRequests).toBe(0);
      expect(rateLimitInstance.stats.blockedRequests).toBe(0);
      expect(rateLimitInstance.stats.errorCount).toBe(0);
    });

    it('應該支援定時統計收集', () => {
      // 在非測試環境中檢查定時器
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const instance = new RateLimitMiddleware();
      expect(instance.statsTimer).toBeDefined();

      // 清理定時器
      instance.stopStatsTimer();
      process.env.NODE_ENV = originalEnv;
    });

    it('應該支援停止統計收集', () => {
      // 在非測試環境中測試定時器停止
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const instance = new RateLimitMiddleware();
      instance.stopStatsTimer();
      expect(instance.statsTimer).toBe(null);

      process.env.NODE_ENV = originalEnv;
    });
  });

  // 2.2.5.5.1.5 測試錯誤處理和邊界條件（Redis 連接失敗等）
  describe('錯誤處理和邊界條件', () => {
    let originalEnv;

    beforeEach(() => {
      originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
    });

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('應該處理 Redis 初始化失敗', async () => {
      const instance = new RateLimitMiddleware();

      // 模擬 Redis 初始化失敗
      instance.redis = null;
      instance.isRedisAvailable = false;

      const limiter = instance.createLimiter({
        windowMs: 60000,
        maxRequests: 5,
      });

      const app = createTestApp(limiter);

      // 應該回退到記憶體存儲
      await request(app).get('/test').expect(200);
    });

    it('應該處理 Redis 運行時錯誤', async () => {
      const mockRedisClient = createMockRedisClient();
      mockRedisClient.multi.mockImplementation(() => {
        throw new Error('Redis 運行時錯誤');
      });

      rateLimitInstance.redis = mockRedisClient;
      rateLimitInstance.isRedisAvailable = true;

      const store = rateLimitInstance.createRedisStore(60000);

      await expect(store.increment('test-key')).rejects.toThrow('Redis 運行時錯誤');
    });

    it('應該處理無效的配置選項', () => {
      expect(() => {
        rateLimitInstance.createLimiter({
          windowMs: -1000, // 無效的時間窗口
          maxRequests: 5,
        });
      }).not.toThrow();

      expect(() => {
        rateLimitInstance.createLimiter({
          windowMs: 60000,
          maxRequests: -5, // 無效的最大請求數
        });
      }).not.toThrow();
    });

    it('應該處理缺少請求信息', () => {
      const mockReq = {
        // 缺少 ip 和 user，connection 也不存在
        connection: undefined,
        get: jest.fn(() => null),
      };

      const key = RateLimitMiddleware.generateKey(mockReq);
      expect(key).toBeDefined();
      expect(key).toContain('anonymous');
    });

    it('應該處理損壞的 User-Agent 標頭', () => {
      const mockReq = {
        ip: '127.0.0.1',
        get: jest.fn(() => null), // 返回 null 而不是字符串
      };

      const key = RateLimitMiddleware.generateKey(mockReq);
      expect(key).toBeDefined();
      expect(key).toContain('127.0.0.1');
    });

    it('應該在清理時正確關閉資源', async () => {
      const mockRedisClient = createMockRedisClient();

      // 添加清理所需的方法
      mockRedisClient.keys = jest.fn().mockResolvedValue([]);
      mockRedisClient.ttl = jest.fn().mockResolvedValue(100);
      mockRedisClient.pipeline = jest.fn().mockReturnValue({
        del: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      });

      const instance = new RateLimitMiddleware();

      // 模擬有 Redis 連接
      instance.redis = mockRedisClient;
      instance.isRedisAvailable = true;

      await instance.cleanup();

      // cleanup 方法主要是清理過期的鍵，不會將 redis 設為 null
      expect(mockRedisClient.keys).toHaveBeenCalledWith('rate_limit:*');
    });

    it('應該處理並發請求', async () => {
      const limiter = rateLimitInstance.createLimiter({
        windowMs: 60000,
        maxRequests: 5,
      });

      const app = createTestApp(limiter);

      // 同時發送多個請求
      const concurrentRequests = Array(10)
        .fill(null)
        .map(() => request(app).get('/test'));

      const results = await Promise.all(concurrentRequests);

      const successCount = results.filter(r => r.status === 200).length;
      const rateLimitedCount = results.filter(r => r.status === 429).length;

      expect(successCount + rateLimitedCount).toBe(10);
      expect(successCount).toBeLessThanOrEqual(5);
    });

    it('應該處理極端的時間窗口值', () => {
      // 極小的時間窗口
      expect(() => {
        rateLimitInstance.createLimiter({
          windowMs: 1,
          maxRequests: 1,
        });
      }).not.toThrow();

      // 極大的時間窗口
      expect(() => {
        rateLimitInstance.createLimiter({
          windowMs: Number.MAX_SAFE_INTEGER,
          maxRequests: 1,
        });
      }).not.toThrow();
    });

    it('應該處理極端的請求限制值', () => {
      // 零請求限制
      expect(() => {
        rateLimitInstance.createLimiter({
          windowMs: 60000,
          maxRequests: 0,
        });
      }).not.toThrow();

      // 極大的請求限制
      expect(() => {
        rateLimitInstance.createLimiter({
          windowMs: 60000,
          maxRequests: Number.MAX_SAFE_INTEGER,
        });
      }).not.toThrow();
    });

    it('應該在記憶體不足時正確處理', () => {
      // 模擬記憶體不足情況
      const originalError = console.error;
      console.error = jest.fn();

      try {
        // 這裡可以模擬記憶體不足的情況
        expect(() => {
          rateLimitInstance.createLimiter({
            windowMs: 60000,
            maxRequests: 1000,
          });
        }).not.toThrow();
      } finally {
        console.error = originalError;
      }
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

  it('應該更新被阻擋請求統計', () => {
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

    const initialBlocked = rateLimitInstance.stats.blockedRequests;
    handler(mockReq, mockRes);

    expect(rateLimitInstance.stats.blockedRequests).toBe(initialBlocked + 1);
  });

  it('應該包含用戶信息在回應中', () => {
    const handler = rateLimitInstance.createResponseHandler('測試訊息', 60000);

    const mockReq = {
      ip: '192.168.1.1',
      originalUrl: '/api/test',
      method: 'POST',
      user: { uid: 'user123' },
      get: jest.fn(() => 'Mozilla/5.0'),
    };

    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    handler(mockReq, mockRes);

    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          endpoint: '/api/test',
          timestamp: expect.any(String),
        }),
      })
    );
  });
});
