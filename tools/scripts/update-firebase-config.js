#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

/**
 * Firebase 配置更新工具
 * 協助用戶將 Firebase Console 的配置資訊更新到環境變數檔案
 */

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// 顏色定義
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

// 更新環境變數檔案的函數
function updateEnvFile(filePath, updates) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');

    for (const [key, value] of Object.entries(updates)) {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      const newLine = `${key}=${value}`;

      if (content.match(regex)) {
        content = content.replace(regex, newLine);
      } else {
        content += `\n${newLine}`;
      }
    }

    fs.writeFileSync(filePath, content);
    return true;
  } catch (error) {
    log(`❌ 更新檔案失敗: ${error.message}`, 'red');
    return false;
  }
}

// 收集 Firebase Web 配置
async function collectWebConfig() {
  log('\n🌐 Firebase Web 應用程式配置', 'blue');
  log('請從 Firebase Console > 專案設定 > 一般 > 您的應用程式 中複製以下資訊：', 'cyan');

  const webConfig = {};

  webConfig.apiKey = await question('Firebase API Key: ');
  webConfig.authDomain = await question('Auth Domain (例如: your-project.firebaseapp.com): ');
  webConfig.projectId = await question('Project ID: ');
  webConfig.storageBucket = await question('Storage Bucket (例如: your-project.appspot.com): ');
  webConfig.messagingSenderId = await question('Messaging Sender ID: ');
  webConfig.appId = await question('App ID (例如: 1:123456789:web:abc123): ');

  return webConfig;
}

// 收集 Firebase Mobile 配置
async function collectMobileConfig() {
  log('\n📱 Firebase Mobile 應用程式配置', 'blue');
  log('請從 Firebase Console > 專案設定 > 一般 > 您的應用程式 中複製以下資訊：', 'cyan');

  const mobileConfig = {};

  mobileConfig.iosAppId = await question('iOS App ID (例如: 1:123456789:ios:abc123): ');
  mobileConfig.androidAppId = await question('Android App ID (例如: 1:123456789:android:abc123): ');

  return mobileConfig;
}

// 收集 FCM 配置
async function collectFCMConfig() {
  log('\n🔔 Firebase Cloud Messaging 配置', 'blue');
  log('請從 Firebase Console > 專案設定 > Cloud Messaging 中複製以下資訊：', 'cyan');

  const fcmConfig = {};

  fcmConfig.vapidKey = await question('Web 推播憑證 (VAPID key) [可選]: ');

  return fcmConfig;
}

// 主要更新流程
async function updateFirebaseConfig() {
  log('🔥 Firebase 配置更新工具', 'bright');
  log('===============================', 'bright');

  try {
    // 收集配置資訊
    const webConfig = await collectWebConfig();
    const mobileConfig = await collectMobileConfig();
    const fcmConfig = await collectFCMConfig();

    log('\n📝 更新環境變數檔案...', 'yellow');

    // 更新 Web 環境變數
    const webEnvPath = path.join(process.cwd(), 'apps', 'web', '.env');
    const webUpdates = {
      VITE_FIREBASE_API_KEY: webConfig.apiKey,
      VITE_FIREBASE_AUTH_DOMAIN: webConfig.authDomain,
      VITE_FIREBASE_PROJECT_ID: webConfig.projectId,
      VITE_FIREBASE_STORAGE_BUCKET: webConfig.storageBucket,
      VITE_FIREBASE_MESSAGING_SENDER_ID: webConfig.messagingSenderId,
      VITE_FIREBASE_APP_ID: webConfig.appId
    };

    if (fcmConfig.vapidKey) {
      webUpdates['VITE_FIREBASE_VAPID_KEY'] = fcmConfig.vapidKey;
    }

    if (updateEnvFile(webEnvPath, webUpdates)) {
      log('✅ Web 環境變數已更新', 'green');
    }

    // 更新 Mobile 環境變數
    const mobileEnvPath = path.join(process.cwd(), 'apps', 'mobile', '.env');
    const mobileUpdates = {
      FIREBASE_API_KEY: webConfig.apiKey,
      FIREBASE_AUTH_DOMAIN: webConfig.authDomain,
      FIREBASE_PROJECT_ID: webConfig.projectId,
      FIREBASE_STORAGE_BUCKET: webConfig.storageBucket,
      FIREBASE_MESSAGING_SENDER_ID: webConfig.messagingSenderId,
      FIREBASE_APP_ID_IOS: mobileConfig.iosAppId,
      FIREBASE_APP_ID_ANDROID: mobileConfig.androidAppId
    };

    if (updateEnvFile(mobileEnvPath, mobileUpdates)) {
      log('✅ Mobile 環境變數已更新', 'green');
    }

    // 更新 Backend 環境變數
    const backendEnvPath = path.join(process.cwd(), 'apps', 'backend', '.env');
    const backendUpdates = {
      FIREBASE_PROJECT_ID: webConfig.projectId
    };

    if (updateEnvFile(backendEnvPath, backendUpdates)) {
      log('✅ Backend 環境變數已更新', 'green');
    }

    log('\n🎉 Firebase 配置更新完成！', 'green');
    log('接下來的步驟：', 'cyan');
    log('1. 檢查各個 .env 檔案確認配置正確', 'cyan');
    log('2. 執行 npm run dev 測試應用程式', 'cyan');
    log('3. 如有問題，請參考 docs/setup/firebase-setup.md', 'cyan');
  } catch (error) {
    log(`❌ 更新過程發生錯誤: ${error.message}`, 'red');
  } finally {
    rl.close();
  }
}

// 顯示使用說明
function showHelp() {
  log('🔥 Firebase 配置更新工具', 'bright');
  log('===============================', 'bright');
  log('此工具協助您將 Firebase Console 的配置資訊更新到專案的環境變數檔案中。', 'cyan');
  log('');
  log('使用方法:', 'yellow');
  log('  node tools/scripts/update-firebase-config.js', 'cyan');
  log('');
  log('需要準備的資訊:', 'yellow');
  log('  1. Firebase Web 應用程式配置 (從 Firebase Console 取得)', 'cyan');
  log('  2. Firebase iOS/Android 應用程式 ID', 'cyan');
  log('  3. FCM Web 推播憑證 (可選)', 'cyan');
  log('');
  log('詳細設定指南請參考: docs/setup/firebase-setup.md', 'cyan');
}

// 檢查是否顯示幫助
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  showHelp();
  process.exit(0);
}

// 檢查環境變數檔案是否存在
function checkEnvFiles() {
  const requiredFiles = ['apps/web/.env', 'apps/mobile/.env', 'apps/backend/.env'];

  const missingFiles = requiredFiles.filter(file => !fs.existsSync(path.join(process.cwd(), file)));

  if (missingFiles.length > 0) {
    log('❌ 缺少以下環境變數檔案:', 'red');
    missingFiles.forEach(file => log(`  ${file}`, 'red'));
    log('請先執行 npm run setup:env 建立環境變數檔案', 'yellow');
    process.exit(1);
  }
}

// 主程序
if (require.main === module) {
  checkEnvFiles();
  updateFirebaseConfig();
}

module.exports = {
  updateFirebaseConfig,
  updateEnvFile
};
