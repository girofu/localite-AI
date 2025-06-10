# 在地人 AI 導覽系統 (Localite v3)

## 專案概述

在地人 AI 導覽系統是一個智能旅遊導覽平台，結合 AI 技術為用戶提供個性化的在地導覽體驗，並為商戶提供內容管理和行銷工具。

## 系統架構

```
┌─────────────────────────────────────────────────────────────┐
│                     前端層 (Frontend)                        │
├─────────────────────────────────────────────────────────────┤
│  React Native App  │          React Web App                │
└─────────────────────────────────────────────────────────────┘
                                │
┌─────────────────────────────────────────────────────────────┐
│                    API 閘道層 (Gateway)                      │
├─────────────────────────────────────────────────────────────┤
│        Express.js API Server + Authentication              │
└─────────────────────────────────────────────────────────────┘
                                │
┌─────────────────────────────────────────────────────────────┐
│                   後端服務層 (Services)                      │
├─────────────────────────────────────────────────────────────┤
│ AI Service │ Tour Service │ Merchant Service │ User Service │
└─────────────────────────────────────────────────────────────┘
                                │
┌─────────────────────────────────────────────────────────────┐
│                   資料層 (Data Layer)                       │
├─────────────────────────────────────────────────────────────┤
│    MongoDB     │     Redis     │  File Storage │   MySQL    │
│   (主要資料)    │    (快取)      │   (媒體檔案)   │  (交易記錄)  │
└─────────────────────────────────────────────────────────────┘
```

## 技術棧

### 前端

- **Mobile**: React Native + TypeScript
- **Web**: React.js + TypeScript
- **狀態管理**: Redux Toolkit
- **UI 框架**: Material-UI / Ant Design
- **測試**: Jest + React Testing Library

### 後端

- **主框架**: Node.js + Express + TypeScript
- **API 設計**: RESTful API + OpenAPI 3.0
- **認證**: Firebase Authentication
- **快取**: Redis
- **消息隊列**: RabbitMQ (選用)

### 資料庫

- **主資料庫**: MongoDB (導覽內容、用戶資料)
- **交易資料庫**: MySQL (訂單、付款記錄)
- **檔案存儲**: Google Cloud Storage / AWS S3

### AI 服務

- **文字生成**: Google Vertex AI / OpenAI GPT
- **語音合成**: Google Cloud Text-to-Speech
- **翻譯服務**: Google Translate API

### 雲端服務

- **認證**: Firebase Authentication
- **推播通知**: Firebase Cloud Messaging
- **監控**: Google Cloud Monitoring
- **CI/CD**: GitHub Actions

## 專案結構

```
localite-v3/
├── apps/
│   ├── backend/              # Node.js 後端 API
│   ├── web/                 # React Web 應用
│   └── mobile/              # React Native 應用
├── packages/
│   ├── shared/              # 共用類型定義和工具
│   ├── ui-components/       # 共用 UI 元件庫
│   └── api-client/          # API 客戶端庫
├── tools/
│   ├── docker/              # Docker 配置
│   ├── scripts/             # 建置和部署腳本
│   └── monitoring/          # 監控配置
├── docs/                    # 文檔
└── config/                  # 環境配置
```

## 快速開始

### 前置需求

- **Node.js** 18+ 
- **npm** 或 **yarn**
- **Docker** 和 **Docker Compose**
- **Google Cloud** 帳戶和專案
- **Firebase** 專案
- **macOS** 開發環境

### 快速安裝

1. **複製專案**

   ```bash
   git clone [repository-url]
   cd localite-v3
   ```

2. **安裝依賴**

   ```bash
   npm install
   ```

3. **自動環境設定**

   ```bash
   npm run setup:env
   ```

4. **啟動資料庫服務**

   ```bash
   npm run docker:up
   ```

5. **啟動開發環境**
   ```bash
   npm run dev
   ```

**詳細設定指南**: 請參考 [SETUP.md](./SETUP.md) 了解完整的 Google Cloud 和 Firebase 配置。

### 開發指令

```bash
# 啟動所有服務
npm run dev

# 啟動後端 API
npm run dev:backend

# 啟動 Web 應用
npm run dev:web

# 啟動移動應用
npm run dev:mobile

# 執行測試
npm run test

# 建置生產版本
npm run build

# 程式碼檢查
npm run lint

# 格式化程式碼
npm run format
```

## API 文檔

開發中的 API 文檔將在 `http://localhost:3000/api-docs` 提供 (Swagger UI)。

## 開發規範

請參考：

- [Google 開發者風格指南](https://developers.google.com/style)
- [專案程式碼風格](./docs/coding-standards.md)
- [API 設計規範](./docs/api-guidelines.md)

## 授權

[授權資訊]
