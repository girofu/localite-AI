import dotenv from 'dotenv';

// 載入測試環境變數
dotenv.config({ path: '.env.test' });

// 設定測試環境變數
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/localite-test';
process.env.REDIS_URL = process.env.REDIS_TEST_URL || 'redis://localhost:6379/1';

// 全域測試設定
global.console = {
  ...console,
  // 在測試中減少 log 輸出
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};
