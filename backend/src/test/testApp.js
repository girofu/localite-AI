const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const authRoutes = require('../routes/auth');

// 簡化的錯誤處理中間件
const errorHandler = (err, req, res, _next) => {
  res.status(err.statusCode || 500).json({
    success: false,
    error: {
      message: err.message || '伺服器內部錯誤',
      code: err.code || 'INTERNAL_ERROR',
    },
  });
};

const notFound = (req, res, _next) => {
  res.status(404).json({
    success: false,
    error: {
      message: `路由 ${req.originalUrl} 不存在`,
      code: 'ROUTE_NOT_FOUND',
    },
  });
};

const { securityHeaders, corsOptions, sanitizeInput } = require('../middleware/security');

// 使用我們的 rate limiting 中間件
const { rateLimitMiddleware } = require('../middleware/rateLimitMiddleware');

// 模擬請求記錄中間件
const mockRequestLogger = (req, res, next) => {
  next();
};

// 模擬認證中間件
const mockAuthMiddleware = (req, res, next) => {
  // 檢查測試用戶標頭
  const testUser = req.headers['x-test-user'];
  if (testUser) {
    // 根據測試類型設置不同的用戶
    switch (testUser) {
      case 'security-test':
        req.user = {
          uid: 'security-test-user-123',
          email: 'security-test@localite.com',
          emailVerified: true,
          firebaseUid: 'security-test-user-123',
          role: 'user',
        };
        break;
      case 'jwt-test':
        req.user = {
          uid: 'jwt-test-user-123',
          email: 'jwt-test@localite.com',
          emailVerified: true,
          firebaseUid: 'jwt-test-user-123',
          role: 'user',
        };
        break;
      default:
        req.user = {
          uid: testUser,
          email: `${testUser}@localite.com`,
          emailVerified: true,
          firebaseUid: testUser,
          role: 'user',
        };
    }
  }
  next();
};

function createTestApp() {
  const app = express();

  // 信任代理
  app.set('trust proxy', 1);

  // 安全性中間件
  app.use(securityHeaders);
  app.use(cors(corsOptions));

  // 請求記錄（模擬）
  app.use(mockRequestLogger);

  // 速率限制 - 使用我們的 rate limiting 中間件
  const rateLimiters = rateLimitMiddleware.getDefaultLimiters();
  app.use('/api/', rateLimiters.general);

  // 為認證端點應用更嚴格的限制
  app.use('/api/v1/auth', rateLimiters.auth);

  // 為敏感操作端點應用最嚴格的限制
  app.use('/api/v1/auth/verify-email', rateLimiters.sensitive);
  app.use('/api/v1/auth/reset-password', rateLimiters.sensitive);
  app.use('/api/v1/auth/change-password', rateLimiters.sensitive);

  // 輸入清理
  app.use(sanitizeInput);

  // 請求解析中間件
  app.use(
    express.json({
      limit: '10mb',
      verify: (req, res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(
    express.urlencoded({
      extended: true,
      limit: '10mb',
    }),
  );

  // 模擬認證中間件 - 應用到所有 API 路由
  app.use('/api', mockAuthMiddleware);

  // 模擬健康檢查端點
  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        initialized: true,
        mongodb: true,
        mysql: true,
        redis: true,
      },
      allHealthy: true,
    });
  });

  // 基本資訊端點
  app.get('/', (req, res) => {
    res.json({
      name: 'Localite AI 導覽系統 API',
      version: '1.0.0',
      status: 'running',
      timestamp: new Date().toISOString(),
      endpoints: {
        health: '/health',
        apiDocs: '/api-docs',
        api: '/api/v1',
      },
    });
  });

  // 認證路由
  app.use('/api/v1/auth', authRoutes);

  // API 路由（測試用）
  app.use('/api/v1', (req, res) => {
    res.json({
      message: 'Localite API v1 測試模式',
      availableEndpoints: {
        auth: '/api/v1/auth',
        tours: '/api/v1/tours',
        merchants: '/api/v1/merchants',
        users: '/api/v1/users',
      },
      documentation: '/api-docs',
    });
  });

  app.get('/test', (req, res, _next) => {
    res.json({ message: 'Test endpoint working' });
  });

  app.use('/api/test', (req, res, _next) => {
    res.json({ message: 'API test endpoint working' });
  });

  // 404 處理
  app.use('*', notFound);

  // 全域錯誤處理
  app.use(errorHandler);

  return app;
}

/**
 * 清理所有集合
 */
async function clearCollections() {
  const { collections } = mongoose.connection;
  const collectionNames = Object.keys(collections);

  await Promise.all(
    collectionNames.map(async (name) => {
      const collection = collections[name];
      await collection.deleteMany({});
    }),
  );
}

/**
 * 設置測試應用程序
 */
async function setupTestApp() {
  try {
    // 設置測試環境變數
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/localite_test';

    // 連接到測試資料庫
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
    }

    // 清理測試資料庫
    if (mongoose.connection.readyState === 1) {
      await clearCollections();
    }

    // 創建並返回測試應用
    return createTestApp();
  } catch (error) {
    console.error('測試應用設置失敗:', error);
    throw error;
  }
}

/**
 * 清理測試環境
 */
async function teardownTestApp() {
  try {
    // 清理測試資料
    if (mongoose.connection.readyState === 1) {
      await clearCollections();
    }

    // 關閉資料庫連接
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  } catch (error) {
    console.error('測試環境清理失敗:', error);
    throw error;
  }
}

module.exports = createTestApp();
module.exports.setupTestApp = setupTestApp;
module.exports.teardownTestApp = teardownTestApp;
