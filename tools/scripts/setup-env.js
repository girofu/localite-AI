#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { prompts } = require('prompts');

/**
 * 在地人 AI 導覽系統 - 環境設定腳本
 * 此腳本幫助開發者快速設定開發環境變數
 */

const ENV_TEMPLATE = {
  backend: {
    // 應用基本配置
    NODE_ENV: 'development',
    PORT: '8000',
    API_BASE_URL: 'http://localhost:8000',

    // 資料庫配置
    MONGODB_URI: 'mongodb://localhost:27017/localite-v3',
    REDIS_URL: 'redis://localhost:6379',

    // MySQL 交易資料庫
    MYSQL_HOST: 'localhost',
    MYSQL_PORT: '3306',
    MYSQL_DATABASE: 'localite_transactions',
    MYSQL_USERNAME: 'localite',
    MYSQL_PASSWORD: 'localite123',

    // Firebase 配置
    FIREBASE_PROJECT_ID: 'your-project-id',
    FIREBASE_PRIVATE_KEY_ID: 'your-private-key-id',
    FIREBASE_PRIVATE_KEY:
      '"-----BEGIN PRIVATE KEY-----\\nyour-private-key\\n-----END PRIVATE KEY-----\\n"',
    FIREBASE_CLIENT_EMAIL: 'your-client-email',
    FIREBASE_CLIENT_ID: 'your-client-id',
    FIREBASE_AUTH_URI: 'https://accounts.google.com/o/oauth2/auth',
    FIREBASE_TOKEN_URI: 'https://oauth2.googleapis.com/token',
    FIREBASE_AUTH_PROVIDER_X509_CERT_URL: 'https://www.googleapis.com/oauth2/v1/certs',
    FIREBASE_CLIENT_X509_CERT_URL:
      'https://www.googleapis.com/robot/v1/metadata/x509/your-service-account%40your-project.iam.gserviceaccount.com',

    // Google Cloud 配置
    GOOGLE_CLOUD_PROJECT_ID: 'your-gcp-project-id',
    GOOGLE_CLOUD_LOCATION: 'asia-southeast1',
    GOOGLE_APPLICATION_CREDENTIALS: './config/service-account.json',

    // Google Vertex AI 配置
    VERTEX_AI_PROJECT_ID: 'your-project-id',
    VERTEX_AI_LOCATION: 'asia-southeast1',
    VERTEX_AI_MODEL: 'gemini-1.5-pro',

    // Google Cloud Text-to-Speech 配置
    TTS_LANGUAGE_CODE: 'zh-TW',
    TTS_VOICE_NAME: 'zh-TW-Wavenet-A',
    TTS_VOICE_GENDER: 'FEMALE',

    // Google Cloud Translation 配置
    TRANSLATE_PROJECT_ID: 'your-project-id',

    // Google Cloud Storage 配置
    GCS_BUCKET_NAME: 'localite-storage',
    GCS_PROJECT_ID: 'your-gcp-project-id',

    // 本地開發用 MinIO (替代 GCS)
    MINIO_ENDPOINT: 'localhost',
    MINIO_PORT: '9000',
    MINIO_ACCESS_KEY: 'localite',
    MINIO_SECRET_KEY: 'localite123',
    MINIO_BUCKET_NAME: 'localite-dev',

    // JWT 密鑰
    JWT_SECRET: 'your-super-secret-jwt-key-change-this-in-production',
    JWT_EXPIRES_IN: '7d',

    // API 金鑰和限制
    API_RATE_LIMIT_WINDOW_MS: '900000',
    API_RATE_LIMIT_MAX_REQUESTS: '100',

    // 綠界金流配置
    ECPAY_MERCHANT_ID: 'your-merchant-id',
    ECPAY_HASH_KEY: 'your-hash-key',
    ECPAY_HASH_IV: 'your-hash-iv',
    ECPAY_RETURN_URL: 'http://localhost:8000/api/v1/payments/ecpay/return',
    ECPAY_ORDER_RESULT_URL: 'http://localhost:8000/api/v1/payments/ecpay/notify',
    ECPAY_MODE: 'test',

    // RabbitMQ 配置 (選用)
    RABBITMQ_URL: 'amqp://localite:localite123@localhost:5672',

    // 日誌配置
    LOG_LEVEL: 'debug',
    LOG_FORMAT: 'combined',

    // CORS 配置
    CORS_ORIGINS: 'http://localhost:3000,http://localhost:3001',

    // 功能旗標服務配置
    FEATURE_FLAGS_ENDPOINT: 'http://localhost:8000/api/v1/feature-flags',
    FEATURE_FLAGS_API_KEY: 'your-feature-flags-api-key',

    // 監控配置
    SENTRY_DSN: 'your-sentry-dsn',
    PROMETHEUS_PORT: '9090'
  },

  web: {
    // React 應用配置
    VITE_API_BASE_URL: 'http://localhost:8000',
    VITE_APP_NAME: '在地人 AI 導覽系統',
    VITE_APP_VERSION: '1.0.0',

    // Firebase 配置 (前端)
    VITE_FIREBASE_API_KEY: 'your-firebase-api-key',
    VITE_FIREBASE_AUTH_DOMAIN: 'your-project.firebaseapp.com',
    VITE_FIREBASE_PROJECT_ID: 'your-project-id',
    VITE_FIREBASE_STORAGE_BUCKET: 'your-project.appspot.com',
    VITE_FIREBASE_MESSAGING_SENDER_ID: '123456789',
    VITE_FIREBASE_APP_ID: '1:123456789:web:abcdef123456',
    VITE_FIREBASE_MEASUREMENT_ID: 'G-XXXXXXXXXX',

    // 功能旗標
    VITE_FEATURE_FLAGS_ENDPOINT: 'http://localhost:8000/api/v1/feature-flags',

    // 環境
    VITE_NODE_ENV: 'development'
  },

  mobile: {
    // React Native 環境變數
    API_URL: 'http://localhost:8000/api/v1',
    FIREBASE_API_KEY: 'your-firebase-api-key',
    FIREBASE_AUTH_DOMAIN: 'your-project.firebaseapp.com',
    FIREBASE_PROJECT_ID: 'your-project-id',
    FIREBASE_STORAGE_BUCKET: 'your-project.appspot.com',
    FIREBASE_MESSAGING_SENDER_ID: '123456789',
    FIREBASE_APP_ID_IOS: '1:123456789:ios:abcdef123456',
    FIREBASE_APP_ID_ANDROID: '1:123456789:android:abcdef123456',
    FIREBASE_MEASUREMENT_ID: 'G-XXXXXXXXXX'
  }
};

/**
 * 生成環境變數文件內容
 */
function generateEnvContent(config) {
  let content = '';
  for (const [key, value] of Object.entries(config)) {
    content += `${key}=${value}\n`;
  }
  return content;
}

/**
 * 建立環境變數文件
 */
function createEnvFile(appName, config) {
  const envPath = path.join(process.cwd(), 'apps', appName, '.env');
  const content = generateEnvContent(config);

  try {
    // 建立目錄（如果不存在）
    const dir = path.dirname(envPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 寫入文件
    fs.writeFileSync(envPath, content);
    console.log(`✅ 已建立 ${appName} 環境變數文件: ${envPath}`);

    return true;
  } catch (error) {
    console.error(`❌ 建立 ${appName} 環境變數文件失敗:`, error.message);
    return false;
  }
}

/**
 * 主要設定流程
 */
async function setupEnvironment() {
  console.log('🚀 在地人 AI 導覽系統 - 環境設定\n');

  // 建立後端環境變數
  console.log('設定後端環境變數...');
  createEnvFile('backend', ENV_TEMPLATE.backend);

  // 建立前端環境變數
  console.log('設定前端環境變數...');
  createEnvFile('web', ENV_TEMPLATE.web);

  // 建立 React Native 環境變數
  console.log('設定 React Native 環境變數...');
  createEnvFile('mobile', ENV_TEMPLATE.mobile);

  console.log('\n📋 下一步設定說明:');
  console.log('1. 編輯 apps/backend/.env 文件，填入您的 Google Cloud 專案資訊');
  console.log('2. 編輯 apps/web/.env 文件，填入您的 Firebase 配置');
  console.log(
    '3. 將您的 Google Cloud 服務帳戶金鑰文件放置到 apps/backend/config/service-account.json'
  );
  console.log('4. 運行 `npm run docker:up` 啟動本地資料庫服務');
  console.log('5. 運行 `npm run dev` 開始開發');

  console.log('\n🔧 Google Cloud 設定指南:');
  console.log('- 訪問 https://console.cloud.google.com/');
  console.log('- 啟用 Vertex AI API、Cloud Translation API、Text-to-Speech API');
  console.log('- 建立服務帳戶並下載金鑰文件');
  console.log('- 設定 IAM 權限');

  console.log('\n🔥 Firebase 設定指南:');
  console.log('- 訪問 https://console.firebase.google.com/');
  console.log('- 建立新專案或使用現有專案');
  console.log('- 啟用 Authentication 和 Cloud Messaging');
  console.log('- 複製配置資訊到環境變數');
}

/**
 * 檢查 Docker 設定文件
 */
function createDockerInitFiles() {
  const files = [
    {
      path: 'tools/docker/mongodb/init-mongo.js',
      content: `// MongoDB 初始化腳本
db = db.getSiblingDB('localite');

// 建立用戶
db.createUser({
  user: 'localite',
  pwd: 'localite123',
  roles: [
    {
      role: 'readWrite',
      db: 'localite'
    }
  ]
});

// 建立基礎集合
db.createCollection('users');
db.createCollection('tours');
db.createCollection('merchants');
db.createCollection('contents');

console.log('MongoDB 初始化完成');`
    },
    {
      path: 'tools/docker/mysql/init.sql',
      content: `-- MySQL 初始化腳本
CREATE DATABASE IF NOT EXISTS localite_transactions;
USE localite_transactions;

-- 建立用戶表
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(255) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 建立訂單表
CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    total_amount DECIMAL(10, 2) NOT NULL,
    status ENUM('pending', 'paid', 'cancelled', 'refunded') DEFAULT 'pending',
    payment_method VARCHAR(50),
    payment_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 建立支付記錄表
CREATE TABLE IF NOT EXISTS payments (
    id VARCHAR(255) PRIMARY KEY,
    order_id VARCHAR(255) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    status ENUM('pending', 'success', 'failed', 'refunded') DEFAULT 'pending',
    gateway VARCHAR(50) NOT NULL,
    gateway_transaction_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id)
);

SELECT 'MySQL 初始化完成' AS message;`
    }
  ];

  files.forEach(file => {
    const filePath = path.join(process.cwd(), file.path);
    const dir = path.dirname(filePath);

    // 建立目錄
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 寫入文件
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, file.content);
      console.log(`✅ 已建立 Docker 初始化文件: ${file.path}`);
    }
  });
}

// 執行主要流程
if (require.main === module) {
  setupEnvironment()
    .then(() => {
      console.log('\n✨ 環境設定完成！');
      createDockerInitFiles();
    })
    .catch(error => {
      console.error('❌ 環境設定失敗:', error);
      process.exit(1);
    });
}

module.exports = {
  setupEnvironment,
  createEnvFile,
  ENV_TEMPLATE
};
