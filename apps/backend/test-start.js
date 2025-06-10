const { spawn } = require('child_process');
const path = require('path');

// 設定環境變數
process.env.NODE_ENV = 'development';
process.env.PORT = '8000';
process.env.FIREBASE_PROJECT_ID = 'localite-dev';

console.log('🚀 啟動測試伺服器...');

const child = spawn('npx', ['tsx', 'src/index.ts'], {
  cwd: __dirname,
  stdio: 'inherit',
  env: process.env
});

child.on('error', error => {
  console.error('❌ 啟動失敗:', error);
  process.exit(1);
});

child.on('exit', code => {
  console.log(`🛑 伺服器停止，退出碼: ${code}`);
  process.exit(code);
});

// 優雅關閉
process.on('SIGINT', () => {
  console.log('\n📴 正在關閉伺服器...');
  child.kill('SIGINT');
});

process.on('SIGTERM', () => {
  console.log('\n📴 正在關閉伺服器...');
  child.kill('SIGTERM');
});
