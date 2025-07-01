# Localite V4 - AI 導覽系統

Localite 是一個基於 AI 的智能導覽系統，提供個性化的在地旅遊體驗。

## 🚀 專案架構

```
localite-v4/
├── backend/                 # Node.js + Express 後端 API
│   ├── src/
│   │   ├── controllers/     # 控制器
│   │   ├── services/        # 業務邏輯服務
│   │   ├── models/          # 資料模型
│   │   ├── middleware/      # 中間件
│   │   ├── routes/          # 路由定義
│   │   ├── config/          # 配置文件
│   │   └── utils/           # 工具函數
│   └── test/               # 測試文件
├── frontend/
│   ├── web/                # React 網頁應用
│   ├── mobile/             # React Native 移動應用
│   └── shared/             # 共享組件和工具
├── docs/                   # 文檔
└── docker-compose.yml      # 開發環境配置
```

## 🛠️ 技術棧

### 後端

- **框架**: Node.js + Express.js
- **資料庫**: MongoDB (主要) + MySQL (交易)
- **快取**: Redis
- **認證**: Firebase Auth + JWT
- **AI 服務**: Google Vertex AI (Gemini)
- **語音合成**: Google Cloud Text-to-Speech
- **檔案存儲**: Google Cloud Storage
- **支付**: 綠界金流

### 前端

- **網頁**: React.js + Material-UI
- **移動端**: React Native + Expo
- **狀態管理**: Redux Toolkit
- **路由**: React Router (Web) + React Navigation (Mobile)
- **國際化**: i18next

## 📋 環境要求

- Node.js 18.0+
- npm 9.0+
- Docker & Docker Compose (可選，用於本地開發環境)

## 🚀 快速開始

### 1. 安裝依賴

```bash
# 安裝所有專案依賴
npm run install:all

# 或者分別安裝
npm install              # 根目錄依賴
npm run install:backend  # 後端依賴
npm run install:web      # 網頁前端依賴
npm run install:mobile   # 移動端依賴
```

### 2. 設置環境變數

```bash
# 後端環境變數
cp backend/.env.example backend/.env
# 編輯 backend/.env 設置你的配置
```

### 3. 啟動開發環境

#### 使用 Docker (推薦)

```bash
# 啟動資料庫服務
npm run docker:up

# 檢查服務狀態
npm run docker:logs
```

#### 手動啟動

```bash
# 同時啟動後端和網頁前端
npm run dev

# 或者分別啟動
npm run dev:backend      # 後端 API (port 8000)
npm run dev:web         # 網頁前端 (port 3000)
npm run dev:mobile      # 移動端 (Expo)
```

## 🔧 開發工具

### 資料庫管理界面

- **MongoDB**: http://localhost:8082 (Mongo Express)
- **MySQL**: http://localhost:8080 (phpMyAdmin)
- **Redis**: http://localhost:8081 (Redis Commander)

### API 端點

- **後端 API**: http://localhost:8000
- **健康檢查**: http://localhost:8000/health
- **API 文檔**: http://localhost:8000/api/v1 (開發中)

## 📝 開發指令

```bash
# 開發
npm run dev              # 啟動全部開發服務
npm run dev:backend      # 僅後端
npm run dev:web         # 僅網頁前端
npm run dev:mobile      # 僅移動端

# 建置
npm run build           # 建置全部
npm run build:backend   # 建置後端
npm run build:web       # 建置網頁前端

# 測試
npm test               # 執行全部測試
npm run test:backend   # 後端測試
npm run test:web       # 網頁前端測試
npm run test:mobile    # 移動端測試

# 程式碼檢查
npm run lint           # 檢查全部程式碼
npm run lint:backend   # 檢查後端
npm run lint:web       # 檢查網頁前端
npm run lint:mobile    # 檢查移動端
```

## 🗂️ API 設計

### 認證 API

```
POST /api/v1/auth/login     # 用戶登入
POST /api/v1/auth/register  # 用戶註冊
POST /api/v1/auth/logout    # 用戶登出
GET  /api/v1/auth/profile   # 獲取用戶資料
```

### 導覽 API

```
GET    /api/v1/tours        # 獲取導覽列表
POST   /api/v1/tours        # 創建導覽
GET    /api/v1/tours/:id    # 獲取特定導覽
POST   /api/v1/tours/generate # AI 生成導覽內容
```

### 商戶 API

```
POST /api/v1/merchants/register # 商戶註冊
GET  /api/v1/merchants/profile  # 商戶資料
POST /api/v1/merchants/content  # 上傳內容
```

## 🏗️ 部署

### Docker 部署

```bash
# 建置 Docker 映像
docker build -t localite-backend ./backend
docker build -t localite-web ./frontend/web

# 使用 docker-compose 部署
docker-compose -f docker-compose.prod.yml up -d
```

## 🧪 測試

專案使用 Jest 進行測試：

```bash
# 執行所有測試
npm test

# 執行特定測試
npm run test:backend -- --testPathPattern=auth
npm run test:web -- --testNamePattern="API"

# 測試覆蓋率
npm run test:backend -- --coverage
```

## 📚 文檔

- [架構決策](docs/architecture-decisions.md)
- [API 文檔](docs/api-documentation.md)
- [部署指南](docs/deployment-guide.md)
- [貢獻指南](docs/contributing.md)

## 🤝 貢獻

1. Fork 專案
2. 創建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交變更 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 開啟 Pull Request

## 📄 授權

本專案採用 MIT 授權條款 - 詳見 [LICENSE](LICENSE) 文件

## 👥 團隊

- **專案經理**: [姓名]
- **後端開發**: [姓名]
- **前端開發**: [姓名]
- **UI/UX 設計**: [姓名]

## 🆘 支援

如有問題或需要支援，請：

1. 查看 [FAQ](docs/FAQ.md)
2. 搜尋 [Issues](https://github.com/your-org/localite-v4/issues)
3. 創建新的 Issue
4. 聯繫開發團隊
