// 測試環境設置
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.MONGODB_URI = 'mongodb://localhost:27017/localite_test';
process.env.REDIS_URL = 'redis://localhost:6379';

// 模擬 Firebase Admin SDK
jest.mock('firebase-admin', () => {
  const mockAuth = {
    verifyIdToken: jest.fn(),
    generateEmailVerificationLink: jest.fn().mockResolvedValue('http://test-verification-link.com'),
    listUsers: jest.fn().mockResolvedValue({ users: [] }),
  };

  const mockApp = {
    delete: jest.fn().mockResolvedValue(),
  };

  return {
    apps: [],
    initializeApp: jest.fn().mockReturnValue(mockApp),
    credential: {
      cert: jest.fn(),
    },
    auth: jest.fn().mockReturnValue(mockAuth),
    firestore: jest.fn(),
    storage: jest.fn(),
    messaging: jest.fn(),
  };
});

// 模擬 Firebase 配置
jest.mock('../config/firebase', () => {
  const mockAuth = {
    verifyIdToken: jest.fn(),
    generateEmailVerificationLink: jest.fn().mockResolvedValue('http://test-verification-link.com'),
    listUsers: jest.fn().mockResolvedValue({ users: [] }),
  };

  return {
    getAuth: jest.fn().mockReturnValue(mockAuth),
    getFirestore: jest.fn(),
    getStorage: jest.fn(),
    getMessaging: jest.fn(),
    firebaseConfig: {
      initialized: true,
      admin: null,
      getServiceAccountConfig: jest.fn(),
    },
  };
});

// 模擬配置管理器
jest.mock('../config', () => {
  const mockConfigManager = {
    initialize: jest.fn().mockResolvedValue(true),
    shutdown: jest.fn().mockResolvedValue(true),
    isInitialized: true,
    healthCheck: jest.fn().mockResolvedValue({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        initialized: true,
        mongodb: true,
        mysql: true,
        redis: true,
      },
      allHealthy: true,
    }),
    getConnectionStatus: jest.fn().mockReturnValue({
      initialized: true,
      mongodb: true,
      mysql: true,
      redis: true,
    }),
  };

  return {
    configManager: mockConfigManager,
    mongoConnection: {
      isConnected: true,
      getConnection: jest.fn().mockReturnValue({
        readyState: 1,
      }),
    },
    mysqlConnection: {
      isConnected: true,
      query: jest.fn().mockResolvedValue([]),
    },
    redisConnection: {
      isConnected: true,
      ping: jest.fn().mockResolvedValue(true),
    },
    initializeDatabases: jest.fn().mockResolvedValue(true),
    closeDatabases: jest.fn().mockResolvedValue(true),
  };
});

// 模擬 winston logger
jest.mock('../middleware/requestLogger', () => {
  const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    log: jest.fn(),
  };

  const mockRequestLogger = (req, res, next) => {
    next();
  };

  return {
    logger: mockLogger,
    requestLogger: mockRequestLogger,
  };
});

// 設置測試超時 - 增加到 30 秒以處理資料庫操作
jest.setTimeout(30000);

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
