/* eslint-disable max-classes-per-file */
const mongoose = require('mongoose');
const mysql = require('mysql2/promise');
require('dotenv').config();

/**
 * MongoDB 連接配置
 */
class MongoDBConnection {
  constructor() {
    this.isConnected = false;
  }

  async connect() {
    try {
      if (this.isConnected) {
        console.log('MongoDB already connected');
        return;
      }

      const options = {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        family: 4, // Use IPv4, skip trying IPv6
        bufferCommands: false,
      };

      await mongoose.connect(process.env.MONGODB_URI, options);
      this.isConnected = true;
      console.log('✅ MongoDB connected successfully');

      // 監聽連接事件
      mongoose.connection.on('error', (err) => {
        console.error('❌ MongoDB connection error:', err);
        this.isConnected = false;
      });

      mongoose.connection.on('disconnected', () => {
        console.log('⚠️  MongoDB disconnected');
        this.isConnected = false;
      });
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error);
      throw error;
    }
  }

  async disconnect() {
    try {
      await mongoose.disconnect();
      this.isConnected = false;
      console.log('✅ MongoDB disconnected successfully');
    } catch (error) {
      console.error('❌ MongoDB disconnection failed:', error);
      throw error;
    }
  }

  getConnection() {
    if (!this.isConnected) {
      throw new Error('MongoDB not connected. Call connect() first.');
    }
    return mongoose.connection;
  }
}

/**
 * MySQL 連接池配置
 */
class MySQLConnection {
  constructor() {
    this.pool = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      if (this.pool && this.isConnected) {
        console.log('MySQL pool already connected');
        return;
      }

      const config = {
        host: process.env.MYSQL_HOST || 'localhost',
        port: process.env.MYSQL_PORT || 3306,
        user: process.env.MYSQL_USER || 'root',
        password: process.env.MYSQL_PASSWORD || '',
        database: process.env.MYSQL_DATABASE || 'localite',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        acquireTimeout: 60000,
        timeout: 60000,
        reconnect: true,
        charset: 'utf8mb4',
        timezone: '+08:00',
      };

      this.pool = mysql.createPool(config);

      // 測試連接
      const connection = await this.pool.getConnection();
      await connection.ping();
      connection.release();

      this.isConnected = true;
      console.log('✅ MySQL connected successfully');
    } catch (error) {
      console.error('❌ MySQL connection failed:', error);
      throw error;
    }
  }

  async disconnect() {
    try {
      if (this.pool) {
        await this.pool.end();
        this.pool = null;
        this.isConnected = false;
        console.log('✅ MySQL disconnected successfully');
      }
    } catch (error) {
      console.error('❌ MySQL disconnection failed:', error);
      throw error;
    }
  }

  getPool() {
    if (!this.pool) {
      throw new Error('MySQL pool not initialized. Call connect() first.');
    }
    return this.pool;
  }

  async query(sql, params = []) {
    try {
      const [rows] = await this.pool.execute(sql, params);
      return rows;
    } catch (error) {
      console.error('❌ MySQL query error:', error);
      throw error;
    }
  }

  async transaction(callback) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

// 創建單例實例
const mongoConnection = new MongoDBConnection();
const mysqlConnection = new MySQLConnection();

/**
 * 初始化所有資料庫連接
 */
async function initializeDatabases() {
  try {
    console.log('🔄 Initializing databases...');

    await mongoConnection.connect();
    await mysqlConnection.connect();

    console.log('✅ All databases initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}

/**
 * 關閉所有資料庫連接
 */
async function closeDatabases() {
  try {
    console.log('🔄 Closing databases...');

    await mongoConnection.disconnect();
    await mysqlConnection.disconnect();

    console.log('✅ All databases closed successfully');
  } catch (error) {
    console.error('❌ Database closure failed:', error);
    throw error;
  }
}

module.exports = {
  MongoDBConnection,
  MySQLConnection,
  mongoConnection,
  mysqlConnection,
  initializeDatabases,
  closeDatabases,
  mongoose,
};
