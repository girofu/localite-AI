#!/bin/bash

# 在地人 AI 導覽系統 - Google Cloud & Firebase 自動化設定腳本
set -e

echo "🚀 Google Cloud & Firebase 自動化設定"
echo "===================================="

# 顏色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 檢查必要工具
check_prerequisites() {
  echo -e "${BLUE}🔍 檢查必要工具...${NC}"
  
  # 檢查 gcloud CLI
  if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}❌ gcloud CLI 未安裝${NC}"
    echo "請先安裝 Google Cloud SDK:"
    echo "macOS: brew install google-cloud-sdk"
    echo "其他系統: https://cloud.google.com/sdk/docs/install"
    exit 1
  fi
  echo -e "${GREEN}✅ gcloud CLI $(gcloud version --format='value(Google Cloud SDK)' 2>/dev/null)${NC}"
  
  # 檢查 Firebase CLI
  if ! command -v firebase &> /dev/null; then
    echo -e "${YELLOW}⚠️ Firebase CLI 未安裝，正在安裝...${NC}"
    npm install -g firebase-tools
  fi
  echo -e "${GREEN}✅ Firebase CLI $(firebase --version | head -n1 | cut -d' ' -f1)${NC}"
}

# 登入檢查
check_authentication() {
  echo -e "\n${BLUE}🔐 檢查登入狀態...${NC}"
  
  # 檢查 gcloud 登入
  if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | head -n1 &> /dev/null; then
    echo -e "${YELLOW}⚠️ 需要登入 Google Cloud${NC}"
    gcloud auth login
  fi
  
  GCLOUD_ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" | head -n1)
  echo -e "${GREEN}✅ Google Cloud 已登入: ${GCLOUD_ACCOUNT}${NC}"
  
  # 檢查 Firebase 登入
  if ! firebase projects:list &> /dev/null; then
    echo -e "${YELLOW}⚠️ 需要登入 Firebase${NC}"
    firebase login
  fi
  echo -e "${GREEN}✅ Firebase 已登入${NC}"
}

# 專案設定
setup_project() {
  echo -e "\n${BLUE}📝 專案設定${NC}"
  
  # 讀取專案 ID 或建立新專案
  read -p "輸入現有的 Google Cloud 專案 ID (留空則建立新專案): " PROJECT_ID
  
  if [ -z "$PROJECT_ID" ]; then
    # 建立新專案
    RANDOM_SUFFIX=$(date +%s | tail -c 6)
    PROJECT_ID="localite-ai-guide-${RANDOM_SUFFIX}"
    PROJECT_NAME="在地人 AI 導覽系統"
    
    echo -e "${YELLOW}📦 建立新專案: ${PROJECT_ID}${NC}"
    gcloud projects create $PROJECT_ID --name="$PROJECT_NAME"
    
    echo -e "${YELLOW}💳 請設定帳單帳戶...${NC}"
    echo "前往: https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT_ID"
    read -p "設定完成後按 Enter 繼續..."
  fi
  
  # 設定預設專案
  gcloud config set project $PROJECT_ID
  echo -e "${GREEN}✅ 專案設定完成: ${PROJECT_ID}${NC}"
}

# 啟用 API
enable_apis() {
  echo -e "\n${BLUE}🔌 啟用必要的 API...${NC}"
  
  APIS=(
    "aiplatform.googleapis.com"
    "translate.googleapis.com"
    "texttospeech.googleapis.com"
    "storage.googleapis.com"
    "firebase.googleapis.com"
    "run.googleapis.com"
    "cloudfunctions.googleapis.com"
    "cloudresourcemanager.googleapis.com"
    "iam.googleapis.com"
  )
  
  for api in "${APIS[@]}"; do
    echo -e "  啟用 ${api}..."
    gcloud services enable $api
  done
  
  echo -e "${GREEN}✅ 所有 API 已啟用${NC}"
}

# 建立服務帳戶
create_service_account() {
  echo -e "\n${BLUE}👤 建立服務帳戶...${NC}"
  
  SERVICE_ACCOUNT_NAME="localite-service-account"
  SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
  
  # 檢查服務帳戶是否已存在
  if gcloud iam service-accounts describe $SERVICE_ACCOUNT_EMAIL &> /dev/null; then
    echo -e "${YELLOW}⚠️ 服務帳戶已存在${NC}"
  else
    gcloud iam service-accounts create $SERVICE_ACCOUNT_NAME \
      --description="在地人 AI 導覽系統服務帳戶" \
      --display-name="Localite Service Account"
  fi
  
  # 授予權限
  echo -e "  設定 IAM 角色..."
  ROLES=(
    "roles/aiplatform.user"
    "roles/cloudtranslate.user"
    "roles/ml.admin"
    "roles/storage.admin"
    "roles/firebase.admin"
    "roles/run.admin"
  )
  
  for role in "${ROLES[@]}"; do
    gcloud projects add-iam-policy-binding $PROJECT_ID \
      --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
      --role="$role" --quiet
  done
  
  # 建立配置目錄
  mkdir -p ./apps/backend/config
  
  # 下載服務帳戶金鑰
  echo -e "  下載服務帳戶金鑰..."
  gcloud iam service-accounts keys create ./apps/backend/config/service-account.json \
    --iam-account=$SERVICE_ACCOUNT_EMAIL
  
  echo -e "${GREEN}✅ 服務帳戶建立完成${NC}"
}

# 建立 Cloud Storage
create_storage() {
  echo -e "\n${BLUE}🗄️ 建立 Cloud Storage...${NC}"
  
  BUCKET_NAME="localite-storage-${PROJECT_ID}"
  LOCATION="asia-southeast1"
  
  # 檢查 bucket 是否已存在
  if gsutil ls -b gs://$BUCKET_NAME &> /dev/null; then
    echo -e "${YELLOW}⚠️ Storage bucket 已存在${NC}"
  else
    gsutil mb -p $PROJECT_ID -l $LOCATION gs://$BUCKET_NAME
  fi
  
  # 設定 CORS
  cat > /tmp/cors.json << EOF
[
  {
    "origin": ["http://localhost:3000", "http://localhost:3001", "https://*.firebaseapp.com"],
    "method": ["GET", "POST", "PUT", "DELETE"],
    "responseHeader": ["Content-Type", "Authorization"],
    "maxAgeSeconds": 3600
  }
]
EOF
  
  gsutil cors set /tmp/cors.json gs://$BUCKET_NAME
  rm /tmp/cors.json
  
  echo -e "${GREEN}✅ Cloud Storage 設定完成: gs://${BUCKET_NAME}${NC}"
}

# 設定 Firebase
setup_firebase() {
  echo -e "\n${BLUE}🔥 設定 Firebase...${NC}"
  
  # 初始化 Firebase 專案
  echo -e "  連接到 Firebase 專案..."
  firebase use $PROJECT_ID --add
  
  # 初始化 Firebase 功能
  echo -e "  初始化 Firebase 功能..."
  
  # 建立 firebase.json 配置
  cat > firebase.json << EOF
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "hosting": {
    "public": "apps/web/dist",
    "ignore": [
      "firebase.json",
      "**/.*",
      "**/node_modules/**"
    ],
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  },
  "storage": {
    "rules": "storage.rules"
  }
}
EOF

  # 建立 Firestore 規則
  cat > firestore.rules << EOF
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 開發階段：允許已驗證使用者讀寫
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
EOF

  # 建立 Storage 規則
  cat > storage.rules << EOF
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if request.auth != null;
    }
  }
}
EOF

  # 建立 Firestore 索引
  echo '{"indexes": [], "fieldOverrides": []}' > firestore.indexes.json
  
  echo -e "${GREEN}✅ Firebase 設定完成${NC}"
}

# 更新環境變數
update_env_files() {
  echo -e "\n${BLUE}📝 更新環境變數檔案...${NC}"
  
  # 取得配置資訊
  BUCKET_NAME="localite-storage-${PROJECT_ID}"
  SERVICE_ACCOUNT_EMAIL="localite-service-account@${PROJECT_ID}.iam.gserviceaccount.com"
  
  echo -e "  更新 backend .env 檔案..."
  
  # 更新 backend 環境變數
  sed -i.bak \
    -e "s/your-gcp-project-id/${PROJECT_ID}/g" \
    -e "s/your-project-id/${PROJECT_ID}/g" \
    -e "s/localite-storage/localite-storage-${PROJECT_ID}/g" \
    apps/backend/.env
  
  echo -e "  更新 web .env 檔案..."
  
  # 更新 web 環境變數
  sed -i.bak \
    -e "s/your-project-id/${PROJECT_ID}/g" \
    -e "s/your-project\.firebaseapp\.com/${PROJECT_ID}.firebaseapp.com/g" \
    -e "s/your-project\.appspot\.com/${PROJECT_ID}.appspot.com/g" \
    apps/web/.env
  
  echo -e "  更新 mobile .env 檔案..."
  
  # 更新 mobile 環境變數
  sed -i.bak \
    -e "s/your-project-id/${PROJECT_ID}/g" \
    -e "s/your-project\.firebaseapp\.com/${PROJECT_ID}.firebaseapp.com/g" \
    -e "s/your-project\.appspot\.com/${PROJECT_ID}.appspot.com/g" \
    apps/mobile/.env
  
  # 清理備份檔案
  rm -f apps/backend/.env.bak apps/web/.env.bak apps/mobile/.env.bak
  
  echo -e "${GREEN}✅ 環境變數檔案已更新${NC}"
}

# 顯示設定摘要
show_summary() {
  echo -e "\n${GREEN}🎉 設定完成！${NC}"
  echo -e "${GREEN}==============${NC}"
  
  echo -e "\n📋 專案資訊:"
  echo -e "  專案 ID: ${BLUE}${PROJECT_ID}${NC}"
  echo -e "  服務帳戶: ${BLUE}localite-service-account@${PROJECT_ID}.iam.gserviceaccount.com${NC}"
  echo -e "  Storage Bucket: ${BLUE}localite-storage-${PROJECT_ID}${NC}"
  
  echo -e "\n🔗 重要連結:"
  echo -e "  Google Cloud Console: ${BLUE}https://console.cloud.google.com/home/dashboard?project=${PROJECT_ID}${NC}"
  echo -e "  Firebase Console: ${BLUE}https://console.firebase.google.com/project/${PROJECT_ID}${NC}"
  echo -e "  Cloud Storage: ${BLUE}https://console.cloud.google.com/storage/browser?project=${PROJECT_ID}${NC}"
  
  echo -e "\n📝 接下來的步驟:"
  echo -e "  1. 前往 Firebase Console 設定 Authentication 和應用程式"
  echo -e "  2. 複製 Firebase 配置到環境變數檔案"
  echo -e "  3. 執行 ${BLUE}npm run dev${NC} 啟動開發環境"
  
  echo -e "\n💡 有用的指令:"
  echo -e "  ${BLUE}gcloud projects describe ${PROJECT_ID}${NC} - 查看專案資訊"
  echo -e "  ${BLUE}firebase projects:list${NC} - 查看 Firebase 專案"
  echo -e "  ${BLUE}gsutil ls gs://localite-storage-${PROJECT_ID}${NC} - 查看 Storage 內容"
}

# 主執行流程
main() {
  check_prerequisites
  check_authentication
  setup_project
  enable_apis
  create_service_account
  create_storage
  setup_firebase
  update_env_files
  show_summary
}

# 錯誤處理
trap 'echo -e "${RED}❌ 設定過程發生錯誤！${NC}"' ERR

# 執行主流程
main "$@" 