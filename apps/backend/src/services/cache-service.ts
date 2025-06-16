import { createClient, RedisClientType } from 'redis';
import winston from 'winston';

export class CacheService {
  private client: RedisClientType;
  private logger: winston.Logger;
  private isConnected: boolean = false;

  constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) return new Error('重試次數超過限制');
          return Math.min(retries * 100, 3000);
        }
      }
    });

    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.File({ filename: 'logs/cache-service.log' })
      ]
    });

    this.initializeConnection();
  }

  /**
   * 初始化 Redis 連接
   */
  private async initializeConnection(): Promise<void> {
    try {
      await this.client.connect();
      this.isConnected = true;
      this.logger.info('Redis 連接成功');

      this.client.on('error', (error) => {
        this.logger.error('Redis 連接錯誤', { error: error.message });
        this.isConnected = false;
      });

      this.client.on('reconnecting', () => {
        this.logger.info('Redis 重新連接中...');
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      this.logger.error('Redis 初始化失敗', { error: errorMessage });
      this.isConnected = false;
    }
  }

  /**
   * 設置快取項目
   */
  async set(key: string, value: string, expireInSeconds?: number): Promise<boolean> {
    if (!this.isConnected) {
      this.logger.warn('Redis 未連接，跳過快取設置', { key });
      return false;
    }

    try {
      if (expireInSeconds) {
        await this.client.setEx(key, expireInSeconds, value);
      } else {
        await this.client.set(key, value);
      }
      
      this.logger.debug('快取設置成功', { key, hasExpiry: !!expireInSeconds });
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      this.logger.error('快取設置失敗', { 
        error: errorMessage, 
        key 
      });
      return false;
    }
  }

  /**
   * 獲取快取項目
   */
  async get(key: string): Promise<string | null> {
    if (!this.isConnected) {
      this.logger.warn('Redis 未連接，跳過快取獲取', { key });
      return null;
    }

    try {
      const value = await this.client.get(key);
      
      if (value) {
        this.logger.debug('快取命中', { key });
      } else {
        this.logger.debug('快取未命中', { key });
      }
      
      return value;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      this.logger.error('快取獲取失敗', { 
        error: errorMessage, 
        key 
      });
      return null;
    }
  }

  /**
   * 刪除快取項目
   */
  async delete(key: string): Promise<boolean> {
    if (!this.isConnected) {
      this.logger.warn('Redis 未連接，跳過快取刪除', { key });
      return false;
    }

    try {
      const result = await this.client.del(key);
      this.logger.debug('快取刪除完成', { key, deleted: result > 0 });
      return result > 0;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      this.logger.error('快取刪除失敗', { 
        error: errorMessage, 
        key 
      });
      return false;
    }
  }

  /**
   * 別名方法（向後相容）
   */
  async del(key: string): Promise<boolean> {
    return this.delete(key);
  }

  /**
   * 檢查快取項目是否存在
   */
  async exists(key: string): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }

    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      this.logger.error('快取存在性檢查失敗', { 
        error: errorMessage, 
        key 
      });
      return false;
    }
  }

  /**
   * 設置快取項目的過期時間
   */
  async expire(key: string, expireInSeconds: number): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }

    try {
      const result = await this.client.expire(key, expireInSeconds);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      this.logger.error('設置快取過期時間失敗', { 
        error: errorMessage, 
        key,
        expireInSeconds 
      });
      return false;
    }
  }

  /**
   * 獲取快取項目的剩餘過期時間
   */
  async ttl(key: string): Promise<number> {
    if (!this.isConnected) {
      return -1;
    }

    try {
      return await this.client.ttl(key);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      this.logger.error('獲取快取TTL失敗', { 
        error: errorMessage, 
        key 
      });
      return -1;
    }
  }

  /**
   * 批量刪除符合模式的快取項目
   */
  async deletePattern(pattern: string): Promise<number> {
    if (!this.isConnected) {
      return 0;
    }

    try {
      const keys = await this.client.keys(pattern);
      if (keys.length === 0) {
        return 0;
      }

      const result = await this.client.del(keys);
      this.logger.info('批量刪除快取完成', { 
        pattern, 
        keysCount: keys.length, 
        deletedCount: result 
      });
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      this.logger.error('批量刪除快取失敗', { 
        error: errorMessage, 
        pattern 
      });
      return 0;
    }
  }

  /**
   * 獲取 Redis 資訊
   */
  async getInfo(): Promise<{ connected: boolean; keys?: number; memory?: string }> {
    if (!this.isConnected) {
      return { connected: false };
    }

    try {
      const info = await this.client.info('memory');
      const keyspace = await this.client.info('keyspace');
      
      // 解析資訊（簡化版）
      const memoryMatch = info.match(/used_memory_human:([^\r\n]+)/);
      const keysMatch = keyspace.match(/keys=(\d+)/);
      
      return {
        connected: true,
        memory: memoryMatch ? memoryMatch[1] : 'unknown',
        keys: keysMatch ? parseInt(keysMatch[1]) : 0
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      this.logger.error('獲取 Redis 資訊失敗', { error: errorMessage });
      return { connected: false };
    }
  }

  /**
   * 關閉連接
   */
  async disconnect(): Promise<void> {
    if (this.isConnected) {
      try {
        await this.client.quit();
        this.isConnected = false;
        this.logger.info('Redis 連接已關閉');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '未知錯誤';
        this.logger.error('Redis 關閉連接失敗', { error: errorMessage });
      }
    }
  }

  /**
   * 檢查連接狀態
   */
  isConnectedToRedis(): boolean {
    return this.isConnected;
  }
}

export default CacheService; 