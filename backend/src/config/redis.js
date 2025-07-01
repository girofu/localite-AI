const { createClient } = require('redis');
require('dotenv').config();

/**
 * Redis 快取服務配置類
 */
class RedisConnection {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  async connect() {
    try {
      if (this.client && this.isConnected) {
        console.log('Redis already connected');
        return;
      }

      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

      this.client = createClient({
        url: redisUrl,
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > this.maxReconnectAttempts) {
              console.error('❌ Redis max reconnection attempts reached');
              return false;
            }
            const delay = Math.min(retries * 100, 3000);
            console.log(
              `🔄 Redis reconnecting in ${delay}ms (attempt ${retries})`,
            );
            return delay;
          },
          connectTimeout: 10000,
          lazyConnect: true,
        },
        retryDelayOnFailover: 100,
        enableAutoPipelining: true,
      });

      // 設置事件監聽器
      this.client.on('error', (err) => {
        console.error('❌ Redis Client Error:', err);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        console.log('🔄 Redis connecting...');
      });

      this.client.on('ready', () => {
        console.log('✅ Redis connected successfully');
        this.isConnected = true;
        this.reconnectAttempts = 0;
      });

      this.client.on('end', () => {
        console.log('⚠️  Redis connection ended');
        this.isConnected = false;
      });

      this.client.on('reconnecting', () => {
        this.reconnectAttempts++;
        console.log(
          `🔄 Redis reconnecting... (attempt ${this.reconnectAttempts})`,
        );
      });

      await this.client.connect();
    } catch (error) {
      console.error('❌ Redis connection failed:', error);
      this.isConnected = false;
      throw error;
    }
  }

  async disconnect() {
    try {
      if (this.client) {
        await this.client.quit();
        this.client = null;
        this.isConnected = false;
        console.log('✅ Redis disconnected successfully');
      }
    } catch (error) {
      console.error('❌ Redis disconnection failed:', error);
      throw error;
    }
  }

  getClient() {
    if (!this.client || !this.isConnected) {
      throw new Error('Redis client not connected. Call connect() first.');
    }
    return this.client;
  }

  /**
   * 檢查 Redis 連接狀態
   */
  async ping() {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      console.error('❌ Redis ping failed:', error);
      return false;
    }
  }

  /**
   * 設置快取資料
   */
  async set(key, value, options = {}) {
    try {
      const client = this.getClient();
      const serializedValue = JSON.stringify(value);

      if (options.ttl) {
        return await client.setEx(key, options.ttl, serializedValue);
      }

      return await client.set(key, serializedValue);
    } catch (error) {
      console.error('❌ Redis set error:', error);
      throw error;
    }
  }

  /**
   * 獲取快取資料
   */
  async get(key) {
    try {
      const client = this.getClient();
      const value = await client.get(key);

      if (value === null) {
        return null;
      }

      return JSON.parse(value);
    } catch (error) {
      console.error('❌ Redis get error:', error);
      throw error;
    }
  }

  /**
   * 刪除快取資料
   */
  async delete(key) {
    try {
      const client = this.getClient();
      const result = await client.del(key);
      return result > 0;
    } catch (error) {
      console.error('❌ Redis delete error:', error);
      throw error;
    }
  }

  /**
   * 檢查鍵是否存在
   */
  async exists(key) {
    try {
      const client = this.getClient();
      const result = await client.exists(key);
      return result === 1;
    } catch (error) {
      console.error('❌ Redis exists error:', error);
      throw error;
    }
  }

  /**
   * 設置鍵的過期時間
   */
  async expire(key, seconds) {
    try {
      const client = this.getClient();
      const result = await client.expire(key, seconds);
      return result === 1;
    } catch (error) {
      console.error('❌ Redis expire error:', error);
      throw error;
    }
  }

  /**
   * 獲取鍵的剩餘存活時間
   */
  async ttl(key) {
    try {
      const client = this.getClient();
      return await client.ttl(key);
    } catch (error) {
      console.error('❌ Redis ttl error:', error);
      throw error;
    }
  }

  /**
   * 批量獲取
   */
  async mget(keys) {
    try {
      const client = this.getClient();
      const values = await client.mGet(keys);
      return values.map((value) => (value ? JSON.parse(value) : null));
    } catch (error) {
      console.error('❌ Redis mget error:', error);
      throw error;
    }
  }

  /**
   * 清空所有快取
   */
  async flushAll() {
    try {
      const client = this.getClient();
      return await client.flushAll();
    } catch (error) {
      console.error('❌ Redis flushAll error:', error);
      throw error;
    }
  }

  /**
   * 獲取資料庫資訊
   */
  async info() {
    try {
      const client = this.getClient();
      return await client.info();
    } catch (error) {
      console.error('❌ Redis info error:', error);
      throw error;
    }
  }
}

// 創建單例實例
const redisConnection = new RedisConnection();

module.exports = {
  RedisConnection,
  redisConnection,
};
