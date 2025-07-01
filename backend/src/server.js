const express = require('express');
const cors = require('cors');
require('dotenv').config();

// 導入配置和中間件
const { configManager } = require('./config');
const { requestLogger, logger } = require('./middleware/requestLogger');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const {
  securityHeaders,
  corsOptions,
  apiLimiter,
  sanitizeInput,
} = require('./middleware/security');
const swaggerSetup = require('./config/swagger');

const app = express();
const PORT = process.env.PORT || 8000;

/**
 * 初始化應用程式
 */
async function initializeApp() {
  try {
    // 初始化配置管理器
    await configManager.initialize();

    // 信任代理（用於 Nginx 等反向代理）
    app.set('trust proxy', 1);

    // 安全性中間件
    app.use(securityHeaders);
    app.use(cors(corsOptions));

    // 請求記錄
    app.use(requestLogger);

    // 速率限制
    app.use('/api/', apiLimiter);

    // 輸入清理
    app.use(sanitizeInput);

    // 請求解析中間件
    app.use(
      express.json({
        limit: '10mb',
        verify: (req, res, buf) => {
          req.rawBody = buf;
        },
      })
    );
    app.use(
      express.urlencoded({
        extended: true,
        limit: '10mb',
      })
    );

    // API 文檔
    app.use(
      '/api-docs',
      swaggerSetup.swaggerUi.serve,
      swaggerSetup.swaggerUi.setup(swaggerSetup.specs, swaggerSetup.customOptions)
    );

    // 健康檢查端點
    app.get('/health', async (req, res) => {
      try {
        const healthStatus = await configManager.healthCheck();
        res.status(healthStatus.allHealthy ? 200 : 503).json(healthStatus);
      } catch (error) {
        logger.error('Health check failed:', error);
        res.status(503).json({
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: error.message,
        });
      }
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

    // API 路由
    const featureFlagRoutes = require('./routes/featureFlags');
    app.use('/api/v1/feature-flags', featureFlagRoutes);

    // API 基本資訊端點
    app.get('/api/v1', (req, res) => {
      res.json({
        message: 'Localite API v1',
        version: '1.0.0',
        availableEndpoints: {
          'feature-flags': '/api/v1/feature-flags',
          health: '/health',
          docs: '/api-docs',
        },
        documentation: '/api-docs',
      });
    });

    // 404 處理
    app.use('*', notFound);

    // 全域錯誤處理
    app.use(errorHandler);

    logger.info('Express 應用程式初始化完成');
  } catch (error) {
    logger.error('應用程式初始化失敗:', error);
    throw error;
  }
}

/**
 * 啟動伺服器
 */
async function startServer() {
  try {
    await initializeApp();

    const server = app.listen(PORT, () => {
      logger.info(`🚀 Localite Backend Server 已啟動在端口 ${PORT}`);
      logger.info(`📱 健康檢查: http://localhost:${PORT}/health`);
      logger.info(`📖 API 文檔: http://localhost:${PORT}/api-docs`);
      logger.info(`🔗 API 端點: http://localhost:${PORT}/api/v1`);
    });

    // 優雅關閉處理
    const gracefulShutdown = async signal => {
      logger.info(`收到 ${signal} 信號，開始優雅關閉...`);

      server.close(async () => {
        logger.info('HTTP 伺服器已關閉');

        try {
          await configManager.shutdown();
          logger.info('所有服務已關閉');
          process.exit(0);
        } catch (error) {
          logger.error('關閉服務時發生錯誤:', error);
          process.exit(1);
        }
      });

      // 如果 30 秒內沒有正常關閉，強制退出
      setTimeout(() => {
        logger.error('強制關閉伺服器');
        process.exit(1);
      }, 30000);
    };

    // 註冊信號處理器
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // 處理未捕獲的異常
    process.on('uncaughtException', error => {
      logger.error('未捕獲的異常:', error);
      gracefulShutdown('UNCAUGHT_EXCEPTION');
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('未處理的 Promise 拒絕:', reason);
      gracefulShutdown('UNHANDLED_REJECTION');
    });

    return server;
  } catch (error) {
    logger.error('伺服器啟動失敗:', error);
    process.exit(1);
  }
}

// 如果直接執行此檔案，啟動伺服器
if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
