// 測試環境設置
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret";
process.env.MONGODB_URI = "mongodb://localhost:27017/test";
process.env.REDIS_URL = "redis://localhost:6379";

// 模擬配置管理器
jest.mock("../config", () => {
  const mockConfigManager = {
    initialize: jest.fn().mockResolvedValue(true),
    shutdown: jest.fn().mockResolvedValue(true),
    isInitialized: true,
    healthCheck: jest.fn().mockResolvedValue({
      status: "healthy",
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
jest.mock("../middleware/requestLogger", () => {
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

// 設置測試超時
jest.setTimeout(10000);
