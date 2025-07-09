require('dotenv').config({ path: '.env.test' });

// Redis 模擬
jest.mock('../config/redis', () => {
  const mockRedisData = new Map();
  // 用於存儲 rate limit 相關數據
  const rateLimitData = new Map();

  const mockRedisClient = {
    isConnected: true,
    set: jest.fn((key, value, options = {}) => {
      mockRedisData.set(key, { value, ...options });
      return Promise.resolve('OK');
    }),
    get: jest.fn(key => {
      const data = mockRedisData.get(key);
      return Promise.resolve(data ? data.value : null);
    }),
    del: jest.fn(key => {
      const existed = mockRedisData.has(key);
      mockRedisData.delete(key);
      return Promise.resolve(existed ? 1 : 0);
    }),
    exists: jest.fn(key => {
      return Promise.resolve(mockRedisData.has(key) ? 1 : 0);
    }),
    expire: jest.fn(() => Promise.resolve(1)),
    ttl: jest.fn(() => Promise.resolve(-1)),
    keys: jest.fn(pattern => {
      const keys = Array.from(mockRedisData.keys());
      if (pattern === '*test*') {
        return Promise.resolve(keys.filter(key => key.includes('test')));
      }
      return Promise.resolve(keys);
    }),
    flushdb: jest.fn(() => {
      mockRedisData.clear();
      rateLimitData.clear();
      return Promise.resolve('OK');
    }),
    flushAll: jest.fn(() => {
      mockRedisData.clear();
      rateLimitData.clear();
      return Promise.resolve('OK');
    }),
    setEx: jest.fn((key, ttl, value) => {
      mockRedisData.set(key, { value, ttl });
      return Promise.resolve('OK');
    }),
    mGet: jest.fn(keys => {
      return Promise.resolve(
        keys.map(key => {
          const data = mockRedisData.get(key);
          return data ? data.value : null;
        })
      );
    }),
    ping: jest.fn(() => Promise.resolve('PONG')),
    info: jest.fn(() => Promise.resolve('redis_version:6.0.0')),
    connect: jest.fn(() => Promise.resolve()),
    quit: jest.fn(() => Promise.resolve()),
    // 添加事務支援
    multi: jest.fn(() => ({
      incr: jest.fn(() => mockTransaction),
      expire: jest.fn(() => mockTransaction),
      exec: jest.fn(() => Promise.resolve([1, 1])), // 返回假結果
    })),
    incr: jest.fn(key => {
      const data = mockRedisData.get(key);
      const currentValue = data ? parseInt(data.value) || 0 : 0;
      const newValue = currentValue + 1;
      mockRedisData.set(key, { value: newValue.toString() });
      return Promise.resolve(newValue);
    }),
    decr: jest.fn(key => {
      const data = mockRedisData.get(key);
      const currentValue = data ? parseInt(data.value) || 0 : 0;
      const newValue = currentValue - 1;
      mockRedisData.set(key, { value: newValue.toString() });
      return Promise.resolve(newValue);
    }),
    hset: jest.fn((key, field, value) => {
      const hash = mockRedisData.get(key) || { value: {} };
      hash.value[field] = value;
      mockRedisData.set(key, hash);
      return Promise.resolve(1);
    }),
    hget: jest.fn((key, field) => {
      const hash = mockRedisData.get(key);
      return Promise.resolve(hash && hash.value ? hash.value[field] : null);
    }),
    hgetall: jest.fn(key => {
      const hash = mockRedisData.get(key);
      return Promise.resolve(hash && hash.value ? hash.value : {});
    }),
    hdel: jest.fn((key, field) => {
      const hash = mockRedisData.get(key);
      if (hash && hash.value && hash.value[field]) {
        delete hash.value[field];
        return Promise.resolve(1);
      }
      return Promise.resolve(0);
    }),
    scan: jest.fn(() => Promise.resolve(['0', []])),
    eval: jest.fn((script, keys, args) => {
      // 模擬 express-rate-limit 的 Lua 腳本
      if (script.includes('local current = redis.call("incr", KEYS[1])')) {
        const key = keys[0];
        const limit = parseInt(args[0]) || 100;
        const window = parseInt(args[1]) || 60;

        let current = 1;
        const existing = rateLimitData.get(key);
        if (existing && existing.expires > Date.now()) {
          current = existing.hits + 1;
          rateLimitData.set(key, { hits: current, expires: existing.expires });
        } else {
          rateLimitData.set(key, { hits: 1, expires: Date.now() + window * 1000 });
        }

        const remaining = Math.max(0, limit - current);
        const resetTime = Math.ceil((rateLimitData.get(key).expires - Date.now()) / 1000);

        return Promise.resolve({
          totalHits: current,
          resetTime: resetTime,
          remaining: remaining,
        });
      }
      return Promise.resolve(null);
    }),
    // 添加 express-rate-limit 支援的方法
    pexpire: jest.fn((key, ms) => {
      const data = mockRedisData.get(key);
      if (data) {
        data.expires = Date.now() + ms;
        mockRedisData.set(key, data);
        return Promise.resolve(1);
      }
      return Promise.resolve(0);
    }),
    pttl: jest.fn(key => {
      const data = mockRedisData.get(key);
      if (data && data.expires) {
        return Promise.resolve(Math.max(0, data.expires - Date.now()));
      }
      return Promise.resolve(-1);
    }),
  };

  // 模擬事務物件
  const mockTransaction = {
    incr: jest.fn(() => mockTransaction),
    expire: jest.fn(() => mockTransaction),
    set: jest.fn(() => mockTransaction),
    get: jest.fn(() => mockTransaction),
    del: jest.fn(() => mockTransaction),
    pexpire: jest.fn(() => mockTransaction),
    exec: jest.fn(() => Promise.resolve([1, 1])),
  };

  const mockRedisConnection = {
    client: mockRedisClient,
    isConnected: true,
    connect: jest.fn(() => Promise.resolve()),
    disconnect: jest.fn(() => Promise.resolve()),
    getClient: jest.fn(() => mockRedisClient),
    ping: jest.fn(() => Promise.resolve(true)),
    set: jest.fn((key, value, options) => mockRedisClient.set(key, JSON.stringify(value), options)),
    get: jest.fn(async key => {
      const value = await mockRedisClient.get(key);
      return value ? JSON.parse(value) : null;
    }),
    delete: jest.fn(key => mockRedisClient.del(key)),
    exists: jest.fn(key => mockRedisClient.exists(key)),
    expire: jest.fn((key, seconds) => mockRedisClient.expire(key, seconds)),
    ttl: jest.fn(key => mockRedisClient.ttl(key)),
    mget: jest.fn(async keys => {
      const values = await mockRedisClient.mGet(keys);
      return values.map(value => (value ? JSON.parse(value) : null));
    }),
    flushAll: jest.fn(() => mockRedisClient.flushAll()),
    flushdb: jest.fn(() => mockRedisClient.flushdb()),
    info: jest.fn(() => mockRedisClient.info()),
    keys: jest.fn(pattern => mockRedisClient.keys(pattern)),
    del: jest.fn((...keys) => {
      let deletedCount = 0;
      keys.forEach(key => {
        if (mockRedisData.has(key)) {
          mockRedisData.delete(key);
          deletedCount++;
        }
      });
      return Promise.resolve(deletedCount);
    }),
    // 添加 setex 方法
    setex: jest.fn((key, ttl, value) => mockRedisClient.setEx(key, ttl, JSON.stringify(value))),
    // 添加 incr 方法
    incr: jest.fn(key => mockRedisClient.incr(key)),
  };

  return {
    RedisConnection: jest.fn(() => mockRedisConnection),
    redisConnection: mockRedisConnection,
  };
});

// Firebase Admin 模擬
jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  credential: {
    cert: jest.fn(),
  },
  auth: jest.fn(() => ({
    verifyIdToken: jest.fn(() =>
      Promise.resolve({
        uid: 'security-test-user-123',
        email: 'security-test@localite.com',
        email_verified: true,
      })
    ),
    createUser: jest.fn(),
    updateUser: jest.fn(),
    deleteUser: jest.fn(),
  })),
  storage: jest.fn(() => ({
    bucket: jest.fn(),
  })),
  messaging: jest.fn(() => ({
    send: jest.fn(),
    sendMulticast: jest.fn(),
  })),
}));

// 自定義 Jest 匹配器
expect.extend({
  toBeOneOf(received, expected) {
    const pass = expected.includes(received);
    if (pass) {
      return {
        message: () => `expected ${received} not to be one of ${expected.join(', ')}`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be one of ${expected.join(', ')}`,
        pass: false,
      };
    }
  },
  toBeWithinRange(received, min, max) {
    const pass = received >= min && received <= max;
    if (pass) {
      return {
        message: () => `expected ${received} not to be within range ${min} - ${max}`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be within range ${min} - ${max}`,
        pass: false,
      };
    }
  },
  toHaveBeenCalledWithObjectContaining(received, expected) {
    const pass = received.mock.calls.some(call =>
      call.some(
        arg =>
          typeof arg === 'object' && Object.keys(expected).every(key => arg[key] === expected[key])
      )
    );
    if (pass) {
      return {
        message: () =>
          `expected function not to have been called with object containing ${JSON.stringify(expected)}`,
        pass: true,
      };
    } else {
      return {
        message: () =>
          `expected function to have been called with object containing ${JSON.stringify(expected)}`,
        pass: false,
      };
    }
  },
});

// 設置測試環境變數
process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'localite-test';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-localite-testing';
process.env.MONGODB_URI = 'mongodb://localhost:27017/localite_test';
process.env.REDIS_URL = 'redis://localhost:6379';

// 設置測試超時
jest.setTimeout(30000);

// 全域測試清理
afterEach(() => {
  jest.clearAllMocks();
});

// 靜默控制台輸出（可選）
if (process.env.SILENT_TESTS === 'true') {
  global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

// 添加 MongoDB 連接設置
const mongoose = require('mongoose');

// 在測試開始前確保資料庫連接
beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI);
  }
});

// 測試結束後清理連接
afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
});
