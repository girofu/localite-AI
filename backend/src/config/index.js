const {
  initializeDatabases,
  closeDatabases,
  mongoConnection,
  mysqlConnection,
} = require('./database');
const { redisConnection } = require('./redis');

/**
 * 統一配置管理類
 */
class ConfigManager {
  constructor() {
    this.isInitialized = false;
  }

  /**
   * 初始化所有服務連接
   */
  async initialize() {
    try {
      if (this.isInitialized) {
        console.log('🔄 Services already initialized');
        return;
      }

      console.log('🚀 Starting service initialization...');

      // 初始化資料庫連接
      await initializeDatabases();

      // 初始化 Redis 連接
      await redisConnection.connect();

      this.isInitialized = true;
      console.log('✅ All services initialized successfully');
    } catch (error) {
      console.error('❌ Service initialization failed:', error);
      throw error;
    }
  }

  /**
   * 關閉所有服務連接
   */
  async shutdown() {
    try {
      if (!this.isInitialized) {
        console.log('🔄 Services not initialized');
        return;
      }

      console.log('🛑 Starting graceful shutdown...');

      // 關閉資料庫連接
      await closeDatabases();

      // 關閉 Redis 連接
      await redisConnection.disconnect();

      this.isInitialized = false;
      console.log('✅ All services shut down successfully');
    } catch (error) {
      console.error('❌ Service shutdown failed:', error);
      throw error;
    }
  }

  /**
   * 獲取各個服務的連接狀態
   */
  getConnectionStatus() {
    return {
      initialized: this.isInitialized,
      mongodb: mongoConnection.isConnected,
      mysql: mysqlConnection.isConnected,
      redis: redisConnection.isConnected,
    };
  }

  /**
   * 健康檢查
   */
  async healthCheck() {
    const status = this.getConnectionStatus();

    try {
      // 檢查 Redis 連接
      if (status.redis) {
        status.redis = await redisConnection.ping();
      }

      // 檢查 MongoDB 連接
      if (status.mongodb) {
        const mongoStatus = mongoConnection.getConnection().readyState;
        status.mongodb = mongoStatus === 1; // 1 表示連接正常
      }

      // 檢查 MySQL 連接
      if (status.mysql) {
        try {
          await mysqlConnection.query('SELECT 1');
        } catch (error) {
          status.mysql = false;
        }
      }

      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: status,
        allHealthy: Object.values(status).every(Boolean),
      };
    } catch (error) {
      console.error('❌ Health check failed:', error);
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        services: status,
        allHealthy: false,
        error: error.message,
      };
    }
  }
}

// 創建配置管理器實例
const configManager = new ConfigManager();

// 導出所有配置和連接
module.exports = {
  configManager,
  mongoConnection,
  mysqlConnection,
  redisConnection,
  initializeDatabases,
  closeDatabases,
};
