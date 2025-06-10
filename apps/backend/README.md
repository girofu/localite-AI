# 在地人 AI 導覽系統 - 後端 API

這是在地人 AI 導覽系統的後端 API 服務，提供用戶認證、導覽管理、AI 內容生成等核心功能。

## 🏗️ 架構概覽

- **框架**: Node.js + Express + TypeScript
- **資料庫**: MongoDB (主要) + Redis (快取)
- **認證**: Firebase Authentication
- **AI 服務**: Google Vertex AI / OpenAI
- **API 文檔**: Swagger/OpenAPI 3.0
- **測試**: Jest + Supertest

## 🚀 快速開始

### 1. 環境要求

- Node.js >= 18.0.0
- MongoDB >= 5.0
- Redis >= 6.0
- Firebase 專案設定

### 2. 安裝依賴

```bash
npm install
```

### 3. 環境配置

複製環境變數範例文件：

```bash
cp env.example .env
```

編輯 `.env` 文件並設定以下必要變數：

```env
# 基本配置
NODE_ENV=development
PORT=8000

# 資料庫
MONGODB_URI=mongodb://localhost:27017/localite
REDIS_URL=redis://localhost:6379

# Firebase
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY_PATH=./config/service-account.json
```

### 4. Firebase 服務帳戶設定

1. 在 Firebase Console 中建立服務帳戶
2. 下載 JSON 金鑰文件
3. 將文件放置在 `config/service-account.json`
4. 或設定環境變數 `FIREBASE_PRIVATE_KEY` 和 `FIREBASE_CLIENT_EMAIL`

### 5. 啟動開發伺服器

```bash
npm run dev
```

伺服器將在 http://localhost:8000 啟動

## 📚 API 文檔

啟動伺服器後，可以在以下地址查看 API 文檔：

- **Swagger UI**: http://localhost:8000/api-docs
- **API 根路由**: http://localhost:8000/api

## 🛠️ 開發命令

```bash
# 開發模式（熱重載）
npm run dev

# 建置
npm run build

# 生產模式啟動
npm start

# 測試
npm test
npm run test:watch
npm run test:coverage

# 程式碼檢查
npm run lint
npm run lint:fix
npm run type-check

# 格式化程式碼
npm run format
npm run format:check
```

## 🗄️ 資料庫

### MongoDB 集合

- **users**: 用戶資料
- **tours**: 導覽內容
- **bookings**: 預訂記錄
- **reviews**: 評價記錄

### Redis 快取策略

- **用戶資料**: `user:{firebaseUid}` (30分鐘)
- **導覽內容**: `tour:{tourId}` (1小時)
- **搜尋結果**: `search:{hash}` (15分鐘)

## 🔐 認證流程

系統使用 Firebase Authentication 進行用戶認證：

1. 前端使用 Firebase SDK 進行用戶登入
2. 前端取得 ID Token
3. 後端驗證 ID Token 並建立用戶會話
4. 後續請求攜帶 Bearer Token

### API 請求格式

```http
Authorization: Bearer <firebase-id-token>
Content-Type: application/json
```

## 📡 API 端點

### 認證相關

```
POST   /api/v1/auth/register       # 用戶註冊
GET    /api/v1/auth/profile        # 獲取用戶資料
PUT    /api/v1/auth/profile        # 更新用戶資料
POST   /api/v1/auth/verify-token   # 驗證 Token
```

### 導覽相關（即將實作）

```
GET    /api/v1/tours               # 獲取導覽列表
POST   /api/v1/tours               # 創建導覽
GET    /api/v1/tours/:id           # 獲取導覽詳情
PUT    /api/v1/tours/:id           # 更新導覽
DELETE /api/v1/tours/:id           # 刪除導覽
```

## 🧪 測試

測試使用 Jest 框架，包含單元測試和整合測試：

```bash
# 執行所有測試
npm test

# 監視模式
npm run test:watch

# 測試覆蓋率
npm run test:coverage
```

測試文件位於 `src/__tests__/` 目錄。

## 🏗️ 專案結構

```
src/
├── __tests__/          # 測試文件
├── config/             # 配置文件
│   ├── database.ts     # 資料庫連線
│   └── firebase.ts     # Firebase 設定
├── controllers/        # 控制器
├── middleware/         # 中間件
│   ├── auth.ts         # 認證中間件
│   └── validation.ts   # 驗證中間件
├── models/             # 資料模型
│   ├── User.ts         # 用戶模型
│   └── Tour.ts         # 導覽模型
├── routes/             # 路由定義
└── index.ts            # 應用程式入口
```

## 🔧 開發指南

### 新增 API 端點

1. 在 `models/` 建立資料模型
2. 在 `controllers/` 建立控制器
3. 在 `middleware/validation.ts` 添加驗證規則
4. 在 `routes/` 建立路由
5. 在 `index.ts` 註冊路由
6. 撰寫測試

### 錯誤處理

所有錯誤都有統一的格式：

```json
{
  "error": "ERROR_CODE",
  "message": "錯誤描述",
  "details": {} // 詳細錯誤資訊（開發環境）
}
```

### 程式碼風格

- 使用 TypeScript 嚴格模式
- 遵循 Google 程式碼風格指南
- 使用 ESLint + Prettier 進行程式碼格式化
- 函數和變數使用駝峰式命名

## 🚀 部署

### 開發環境

```bash
npm run dev
```

### 生產環境

```bash
npm run build
npm start
```

### Docker 部署

```bash
docker build -t localite-backend .
docker run -p 8000:8000 localite-backend
```

## 📈 監控

- **健康檢查**: `GET /health`
- **API 狀態**: `GET /api`
- **錯誤日誌**: Console + 文件
- **效能監控**: 內建中間件

## 🤝 貢獻指南

1. Fork 專案
2. 建立功能分支
3. 撰寫測試
4. 確保所有測試通過
5. 提交 Pull Request

## 📄 授權

MIT License
