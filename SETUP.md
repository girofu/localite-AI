# 在地人 AI 導覽系統 - 環境設定指南

## 🚀 快速開始

本指南將協助您設定完整的開發環境，包含 Google Cloud 服務整合。

## 📋 前置需求

- **Node.js** 18+ 
- **npm** 或 **yarn**
- **Docker** 和 **Docker Compose**
- **Google Cloud** 帳戶和專案
- **Firebase** 專案
- **macOS** 開發環境

## 🔧 環境設定步驟

### 步驟 1: 克隆專案並安裝依賴

```bash
git clone [repository-url]
cd localite-v3
npm install
```

### 步驟 2: 設定環境變數

運行環境設定腳本：

```bash
npm run setup:env
```

這會自動建立以下檔案：
- `apps/backend/.env`
- `apps/web/.env`

### 步驟 3: Google Cloud 設定

#### 3.1 建立 Google Cloud 專案

1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 建立新專案或選擇現有專案
3. 記錄專案 ID

#### 3.2 啟用必要的 API

```bash
gcloud services enable \
  aiplatform.googleapis.com \
  texttospeech.googleapis.com \
  translate.googleapis.com \
  storage.googleapis.com \
  firestore.googleapis.com
```

#### 3.3 建立服務帳戶

```bash
# 建立服務帳戶
gcloud iam service-accounts create localite-service-account \
  --description="在地人 AI 導覽系統服務帳戶" \
  --display-name="Localite Service Account"

# 授權必要權限
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:localite-service-account@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:localite-service-account@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/storage.admin"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:localite-service-account@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/cloudtranslate.user"

# 下載金鑰文件
gcloud iam service-accounts keys create apps/backend/config/google-cloud-key.json \
  --iam-account=localite-service-account@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

### 步驟 4: Firebase 設定

#### 4.1 建立 Firebase 專案

1. 前往 [Firebase Console](https://console.firebase.google.com/)
2. 建立新專案或匯入現有的 Google Cloud 專案
3. 啟用 Authentication 和 Cloud Messaging

#### 4.2 設定 Web 應用

1. 在 Firebase 專案中新增 Web 應用
2. 複製配置資訊到 `apps/web/.env`：

```env
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abcdef
```

#### 4.3 下載 Firebase 管理員金鑰

1. 前往 Firebase Console → 專案設定 → 服務帳戶
2. 產生新的私密金鑰
3. 將下載的 JSON 檔案重新命名並放置到適當位置

### 步驟 5: 更新環境變數

編輯 `apps/backend/.env` 和 `apps/web/.env`，填入真實的配置值：

#### Backend Environment Variables

```env
# Google Cloud 配置
GOOGLE_CLOUD_PROJECT_ID=your-actual-project-id
VERTEX_AI_PROJECT_ID=your-actual-project-id
TRANSLATE_PROJECT_ID=your-actual-project-id
GCS_PROJECT_ID=your-actual-project-id

# Firebase 配置
FIREBASE_PROJECT_ID=your-actual-project-id
FIREBASE_CLIENT_EMAIL=localite-service-account@your-project.iam.gserviceaccount.com
```

### 步驟 6: 啟動開發環境

#### 6.1 啟動資料庫服務

```bash
npm run docker:up
```

這會啟動：
- MongoDB (localhost:27017)
- Redis (localhost:6379)
- MySQL (localhost:3306)
- RabbitMQ (localhost:5672, 管理界面: localhost:15672)
- MinIO (localhost:9000, 管理界面: localhost:9001)

#### 6.2 啟動應用服務

```bash
# 啟動所有服務
npm run dev

# 或分別啟動
npm run dev:backend    # 後端 API (localhost:3000)
npm run dev:web       # Web 應用 (localhost:5173)
npm run dev:mobile    # React Native (Metro bundler)
```

## 📱 React Native 設定

### iOS 設定

```bash
cd apps/mobile
npx pod-install ios
npm run ios
```

### Android 設定

```bash
cd apps/mobile
npm run android
```

## 🧪 測試和驗證

### 測試 API 連接

```bash
curl http://localhost:3000/api/v1/health
```

### 測試資料庫連接

```bash
# 測試 MongoDB
mongosh mongodb://localite:localite123@localhost:27017/localite

# 測試 Redis
redis-cli -a localite123 ping

# 測試 MySQL
mysql -h localhost -u localite -p localite_transactions
```

### 測試 Google Cloud 服務

```bash
# 在後端目錄測試
cd apps/backend
npm run test:cloud-services
```

## 🔍 開發工具

### API 文檔

開發伺服器啟動後，可以在以下位置查看 API 文檔：
- Swagger UI: http://localhost:3000/api-docs

### 資料庫管理

- **MongoDB**: MongoDB Compass
- **Redis**: RedisInsight
- **MySQL**: MySQL Workbench
- **MinIO**: Web 介面 http://localhost:9001

### 監控工具

- **RabbitMQ 管理**: http://localhost:15672 (guest/guest)
- **應用日誌**: 查看終端輸出或日誌檔案

## 🚨 常見問題排解

### Google Cloud 認證問題

如果遇到認證錯誤：

```bash
# 確認服務帳戶金鑰路徑
export GOOGLE_APPLICATION_CREDENTIALS="./apps/backend/config/google-cloud-key.json"

# 測試認證
gcloud auth activate-service-account --key-file=apps/backend/config/google-cloud-key.json
```

### Docker 容器問題

```bash
# 重新建置容器
npm run docker:down
npm run docker:build
npm run docker:up

# 查看容器日誌
docker-compose logs [service-name]
```

### 端口衝突問題

如果遇到端口被佔用：

```bash
# 查看佔用的端口
lsof -i :3000
lsof -i :5173

# 終止進程
kill -9 [PID]
```

## 📚 下一步

1. 閱讀 [API 文檔](./docs/api-guidelines.md)
2. 查看 [開發規範](./docs/coding-standards.md)
3. 了解 [專案架構](./docs/architecture.md)
4. 開始開發功能模組

## 💡 開發提示

- 使用 `npm run lint` 檢查程式碼風格
- 使用 `npm run format` 格式化程式碼
- 定期執行 `npm run test` 確保測試通過
- 提交前執行 `npm run build` 確保建置成功

## 🆘 尋求協助

如果遇到設定問題，請：

1. 檢查錯誤日誌
2. 確認環境變數設定
3. 驗證 Google Cloud 和 Firebase 配置
4. 聯繫技術團隊

---

**技術堆疊版本資訊：**
- Node.js: 18+
- React: 18+
- React Native: 0.72+
- TypeScript: 5+
- Google Cloud: 最新版
- Firebase: v10+ 