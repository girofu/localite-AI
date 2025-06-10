#!/bin/bash

# 在地人 AI 導覽系統 - 開發環境快速設定腳本
set -e

echo "🚀 在地人 AI 導覽系統 - 開發環境設定"
echo "======================================"

# 檢查必要工具
check_prerequisites() {
  echo "🔍 檢查必要工具..."
  
  # 檢查 Node.js
  if ! command -v node &> /dev/null; then
    echo "❌ Node.js 未安裝。請先安裝 Node.js 18 或更新版本"
    exit 1
  fi
  
  NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
  if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 版本太舊 (當前: $(node -v))。需要 v18 或更新版本"
    exit 1
  fi
  echo "✅ Node.js $(node -v)"
  
  # 檢查 Docker
  if ! command -v docker &> /dev/null; then
    echo "❌ Docker 未安裝。請先安裝 Docker"
    exit 1
  fi
  echo "✅ Docker $(docker --version | cut -d' ' -f3 | cut -d',' -f1)"
  
  # 檢查 Docker Compose
  if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose 未安裝"
    exit 1
  fi
  echo "✅ Docker Compose $(docker-compose --version | cut -d' ' -f3 | cut -d',' -f1)"
}

# 安裝依賴
install_dependencies() {
  echo ""
  echo "📦 安裝專案依賴..."
  npm install
  echo "✅ 依賴安裝完成"
}

# 設定環境變數
setup_environment() {
  echo ""
  echo "🔧 設定環境變數..."
  node tools/scripts/setup-env.js
  echo "✅ 環境變數設定完成"
}

# 啟動資料庫服務
start_databases() {
  echo ""
  echo "🗄️ 啟動資料庫服務..."
  
  # 停止可能存在的容器
  docker-compose down 2>/dev/null || true
  
  # 啟動資料庫服務
  docker-compose up -d mongodb redis
  
  echo "⏳ 等待資料庫服務啟動..."
  sleep 10
  
  # 檢查 MongoDB
  if docker-compose exec -T mongodb mongosh --eval "db.runCommand({ping: 1})" > /dev/null 2>&1; then
    echo "✅ MongoDB 已就緒"
  else
    echo "❌ MongoDB 啟動失敗"
    exit 1
  fi
  
  # 檢查 Redis
  if docker-compose exec -T redis redis-cli ping > /dev/null 2>&1; then
    echo "✅ Redis 已就緒"
  else
    echo "❌ Redis 啟動失敗"
    exit 1
  fi
}

# 初始化資料庫
init_database() {
  echo ""
  echo "🗃️ 初始化資料庫..."
  
  # 這裡之後會加入資料庫遷移腳本
  echo "✅ 資料庫初始化完成 (目前為空)"
}

# 設定 Git Hooks
setup_git_hooks() {
  echo ""
  echo "🪝 設定 Git Hooks..."
  
  if [ -d ".git" ]; then
    npx husky install
    echo "✅ Git Hooks 設定完成"
  else
    echo "⚠️ 非 Git 專案，跳過 Git Hooks 設定"
  fi
}

# 顯示下一步指示
show_next_steps() {
  echo ""
  echo "🎉 開發環境設定完成！"
  echo "====================="
  echo ""
  echo "📋 下一步："
  echo "1. 編輯環境變數檔案："
  echo "   - apps/backend/.env"
  echo "   - apps/web/.env"
  echo "   - apps/mobile/.env"
  echo ""
  echo "2. 設定 Google Cloud 服務帳戶："
  echo "   - 下載服務帳戶金鑰 JSON 檔案"
  echo "   - 存放到 apps/backend/config/service-account.json"
  echo ""
  echo "3. 啟動開發伺服器："
  echo "   npm run dev"
  echo ""
  echo "4. 存取應用："
  echo "   - 後端 API: http://localhost:8000"
  echo "   - Web 前端: http://localhost:3000"
  echo "   - 行動應用: 使用 Expo 掃描 QR Code"
  echo ""
  echo "🛠️ 有用的指令："
  echo "   npm run dev          # 啟動所有服務"
  echo "   npm run docker:up    # 啟動資料庫"
  echo "   npm run docker:down  # 停止資料庫"
  echo "   npm run lint         # 程式碼檢查"
  echo "   npm run test         # 執行測試"
}

# 主執行流程
main() {
  check_prerequisites
  install_dependencies
  setup_environment
  start_databases
  init_database
  setup_git_hooks
  show_next_steps
}

# 捕捉錯誤
trap 'echo "❌ 設定過程發生錯誤！"' ERR

# 執行主流程
main "$@" 