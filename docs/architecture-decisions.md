# 在地人 AI 導覽系統 - 架構決策記錄 (ADR)

## 技術選型確認 (2024-01-XX)

基於專案需求和團隊決策，以下是確認的技術架構選擇：

## 🎯 目標平台決策

### 決策: 優先開發 React Native，同時支援 Web 應用

**確認項目：**
- ✅ 同時開發 Web 應用和 React Native 移動應用
- ✅ **React Native 為優先開發平台**
- ✅ 特定瀏覽器支援：**Chrome 90+**

**理由：**
- React Native 提供原生應用體驗，適合移動端導覽功能
- Web 應用提供管理後台和電腦端訪問
- Chrome 優化確保最佳效能和相容性

## 🤖 AI 服務決策

### 決策: 使用 Google Vertex AI 生態系統

**確認項目：**
- ✅ AI 服務：**Google Vertex AI (Gemini)**
- ✅ 語音合成：**Google Cloud Text-to-Speech**
- ✅ 翻譯服務：**Google Cloud Translation API**

**理由：**
- 統一的 Google Cloud 生態系統
- Vertex AI 提供最新的 Gemini 模型
- 優秀的多語言支援 (繁體中文優化)
- 成本效益和可擴展性

## ☁️ 雲端服務決策

### 決策: 全面採用 Google Cloud Platform

**確認項目：**
- ✅ 雲端平台：**Google Cloud Platform**
- ✅ 已有現有 Google Cloud 帳戶
- ✅ 所有服務整合 GCP 生態系統

**理由：**
- 已有 GCP 帳戶，減少設定複雜度
- AI 服務與雲端服務無縫整合
- 統一的監控和計費管理

## 💾 資料庫決策

### 決策: 混合資料庫架構

**確認項目：**
- ✅ 主要資料庫：**MongoDB** (導覽內容、用戶資料)
- ✅ 交易資料庫：**MySQL** (訂單、支付記錄)
- ✅ 本地開發資料庫設定：**需要**

**理由：**
- MongoDB 適合靈活的內容管理
- MySQL 確保交易資料一致性
- 本地開發環境使用 Docker 容器化

## 🛠️ 開發環境決策

### 決策: macOS 優化的開發環境

**確認項目：**
- ✅ 開發作業系統：**macOS**
- ✅ 容器化開發環境：**需要 Docker**
- ✅ 支援 React Native iOS/Android 開發

**理由：**
- 團隊使用 macOS 開發環境
- Docker 確保環境一致性
- 原生支援 iOS 開發

## 🏗️ 架構實作

### 技術棧總結

```
前端層:
├── React Native App (優先)    # iOS/Android 原生應用
├── React Web App              # Chrome 90+ 優化
└── 共用組件庫                 # @localite/ui-components

API層:
├── Express.js + TypeScript    # RESTful API
├── Firebase Authentication    # 用戶認證
└── API Gateway               # 路由和中間件

AI服務層:
├── Google Vertex AI          # Gemini 模型
├── Google Cloud TTS          # 語音合成
└── Google Cloud Translation  # 多語言翻譯

資料層:
├── MongoDB                   # 主要資料 (Atlas)
├── MySQL                     # 交易資料
├── Redis                     # 快取層
└── Google Cloud Storage      # 媒體檔案

開發環境:
├── Docker Compose            # 本地服務
├── macOS                     # 開發環境
└── Google Cloud              # 生產環境
```

### 專案結構

```
localite-v3/
├── apps/
│   ├── mobile/              # React Native (優先開發)
│   ├── web/                 # React Web App
│   └── backend/             # Node.js API
├── packages/
│   ├── shared/              # 共用類型和工具
│   └── ui-components/       # 共用 UI 元件
├── tools/
│   ├── docker/              # Docker 配置
│   └── scripts/             # 開發腳本
└── docs/                    # 文檔
```

## 🚀 實施階段

### 第一階段 (MVP) - 優先 React Native
1. 移動端核心功能開發
2. Google Cloud 服務整合
3. 基礎 Web 管理界面

### 第二階段
1. Web 應用功能完善
2. 進階 AI 功能
3. 效能優化

### 第三階段
1. 生產環境部署
2. 監控和分析
3. 擴展功能

## 📋 開發優先級

1. **React Native 移動應用** (主要開發重點)
2. 後端 API 服務
3. Google Cloud 整合
4. React Web 應用
5. 管理功能和分析

## 🔄 技術債務管理

- 定期評估 Google Cloud 服務成本
- 監控 AI API 使用量和效能
- React Native 版本升級策略
- 資料庫效能優化

---

**最後更新**: 2024-01-XX  
**決策者**: 開發團隊  
**狀態**: 已確認實施 