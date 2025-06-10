import mongoose from 'mongoose';
import { createClient } from 'redis';

// MongoDB 連線
export const connectMongoDB = async (): Promise<void> => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/localite';
    
    await mongoose.connect(mongoUri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    console.log('✅ MongoDB 連線成功');
    
    // 監聽連線事件
    mongoose.connection.on('error', (error) => {
      console.error('❌ MongoDB 連線錯誤:', error);
    });

    mongoose.connection.on('disconnected', () => {
      console.log('⚠️ MongoDB 連線中斷');
    });

    // 優雅關閉
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      console.log('📴 MongoDB 連線已關閉');
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ MongoDB 連線失敗:', error);
    process.exit(1);
  }
};

// Redis 連線
export let redisClient: ReturnType<typeof createClient>;

export const connectRedis = async (): Promise<void> => {
  try {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    
    redisClient = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 50000,
      }
    });

    redisClient.on('error', (error) => {
      console.error('❌ Redis 連線錯誤:', error);
    });

    redisClient.on('connect', () => {
      console.log('✅ Redis 連線成功');
    });

    redisClient.on('disconnect', () => {
      console.log('⚠️ Redis 連線中斷');
    });

    await redisClient.connect();

    // 優雅關閉
    process.on('SIGINT', async () => {
      await redisClient.quit();
      console.log('📴 Redis 連線已關閉');
    });

  } catch (error) {
    console.error('❌ Redis 連線失敗:', error);
    // Redis 失敗不影響主服務啟動
  }
};

// 資料庫初始化
export const initializeDatabase = async (): Promise<void> => {
  await Promise.all([
    connectMongoDB(),
    connectRedis()
  ]);
};

// 快取工具函數
export const cache = {
  async get(key: string): Promise<string | null> {
    try {
      if (!redisClient?.isOpen) return null;
      return await redisClient.get(key);
    } catch (error) {
      console.error('Redis GET 錯誤:', error);
      return null;
    }
  },

  async set(key: string, value: string, ttl?: number): Promise<boolean> {
    try {
      if (!redisClient?.isOpen) return false;
      
      if (ttl) {
        await redisClient.setEx(key, ttl, value);
      } else {
        await redisClient.set(key, value);
      }
      return true;
    } catch (error) {
      console.error('Redis SET 錯誤:', error);
      return false;
    }
  },

  async del(key: string): Promise<boolean> {
    try {
      if (!redisClient?.isOpen) return false;
      await redisClient.del(key);
      return true;
    } catch (error) {
      console.error('Redis DEL 錯誤:', error);
      return false;
    }
  },

  async exists(key: string): Promise<boolean> {
    try {
      if (!redisClient?.isOpen) return false;
      const result = await redisClient.exists(key);
      return result === 1;
    } catch (error) {
      console.error('Redis EXISTS 錯誤:', error);
      return false;
    }
  }
}; 