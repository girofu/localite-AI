# 在地人 AI 導覽系統 - 快速設定指南

## 🚀 快速開始

本指南將協助您在 15 分鐘內完成開發環境的設定。

### 前置需求

確保您已安裝以下工具：

```bash
# 檢查 Node.js (需要 v18+)
node --version

# 檢查 Docker
docker --version

# 檢查 Docker Compose
docker-compose --version
```

## 🛠️ 設定步驟

### 第一步：基礎環境設定

```bash
# 1. 安裝專案依賴並建立環境變數檔案
npm run setup:quick

# 2. 啟動本地資料庫 (MongoDB, Redis)
npm run docker:up
```

### 第二步：Google Cloud & Firebase 設定

#### 選項 A：自動化設定 (推薦)

```bash
# 執行自動化設定腳本
npm run setup:gcp
```

此腳本將：

- 檢查並安裝必要工具 (gcloud CLI, Firebase CLI)
- 引導您登入 Google Cloud 和 Firebase
- 建立或選擇 Google Cloud 專案
- 啟用所有必要的 API
- 建立服務帳戶並下載金鑰
- 設定 Cloud Storage 和 Firebase
- 自動更新環境變數檔案

#### 選項 B：手動設定

如果您偏好手動設定，請參考詳細指南：

- [Google Cloud 設定指南](./setup/gcp-setup.md)
- [Firebase 設定指南](./setup/firebase-setup.md)

### 第三步：Firebase 應用程式配置

完成第二步後，需要設定 Firebase 應用程式：

1. **前往 Firebase
   Console**：`https://console.firebase.google.com/project/YOUR_PROJECT_ID`

2. **設定 Authentication**：

   - 啟用 Google 和 Email/Password 登入方式
   - 設定授權網域

3. **新增應用程式**：

   - 新增 Web 應用程式 (Localite Web)
   - 新增 iOS 應用程式 (bundle ID: `com.localite.guide.ios`)
   - 新增 Android 應用程式 (package: `com.localite.guide.android`)

4. **更新環境變數**：

```bash
# 執行互動式配置更新工具
npm run setup:firebase
```

### 第四步：初始化應用程式文件結構

如果這是首次設定，某些必要的應用程式文件可能不存在。系統已自動創建基本文件結構：

**Backend 應用程式文件**：

- `apps/backend/src/index.ts` - 後端 API 伺服器主入口
- `apps/backend/.env` - 後端環境變數檔案

**Mobile 應用程式文件**：

- `apps/mobile/metro.config.js` - React Native Metro 配置
- `apps/mobile/index.js` - React Native 應用程式入口
- `apps/mobile/app.json` - 應用程式基本配置
- `apps/mobile/src/App.tsx` - 主應用程式組件

這些文件包含最基本的設定，您可以根據需求進行客製化。

### 第五步：驗證設定

```bash
# 檢查環境變數檔案
cat apps/backend/.env | grep PROJECT_ID
cat apps/web/.env | grep FIREBASE
cat apps/mobile/.env | grep FIREBASE

# 檢查服務帳戶金鑰
ls -la apps/backend/config/service-account.json

# 測試資料庫連線
npm run docker:logs

# 檢查應用程式文件結構
ls -la apps/backend/src/
ls -la apps/mobile/
```

### 第六步：啟動開發環境

```bash
# 啟動所有服務 (後端 API、Web 前端、行動應用)
npm run dev
```

開啟以下網址檢查：

- 後端 API: http://localhost:8000
- Web 前端: http://localhost:3000
- 行動應用: 掃描終端顯示的 QR Code

**注意**: 首次啟動時，React Native 可能需要一些時間來編譯。

## 🔧 有用的指令

### 專案管理

```bash
npm run dev          # 啟動所有服務
npm run build        # 建置所有應用
npm run test         # 執行測試
npm run lint         # 程式碼檢查
npm run format       # 格式化程式碼
```

### 資料庫管理

```bash
npm run docker:up    # 啟動資料庫
npm run docker:down  # 停止資料庫
npm run docker:logs  # 查看資料庫日誌
```

### 設定工具

```bash
npm run setup:env      # 重新建立環境變數檔案
npm run setup:gcp      # Google Cloud 自動化設定
npm run setup:firebase # 更新 Firebase 配置
npm run setup:dev      # 完整開發環境設定
```

## 🐛 疑難排解

### 常見問題

#### 1. 應用程式檔案結構錯誤

**錯誤訊息**：

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../apps/backend/src/index.ts'
```

**解決方案**：

```bash
# 檢查是否存在必要文件
ls -la apps/backend/src/index.ts
ls -la apps/mobile/metro.config.js
ls -la apps/mobile/index.js

# 如果文件不存在，執行初始化
npm run setup:dev
```

**手動創建缺失文件**：

```bash
# 創建 backend 目錄結構
mkdir -p apps/backend/src

# 創建 mobile 基本文件 (如果不存在)
touch apps/mobile/metro.config.js
touch apps/mobile/index.js
touch apps/mobile/app.json
mkdir -p apps/mobile/src
```

#### 2. React Native Metro 設定錯誤

**錯誤訊息**：

```
error No metro config found in /path/to/apps/mobile
```

**解決方案**：

```bash
# 檢查 Metro 配置文件
cat apps/mobile/metro.config.js

# 重新安裝 React Native 依賴
cd apps/mobile
npm install
cd ../..
```

#### 3. Node.js 模組解析錯誤

**錯誤訊息**：

```
Node.js v20.7.0
Error [ERR_MODULE_NOT_FOUND]
```

**解決方案**：

```bash
# 清理並重新安裝依賴
npm run clean
npm install

# 檢查 Node.js 版本相容性
node --version  # 應該是 v18 以上

# 重新建置 TypeScript
npm run build:backend
```

#### 4. Google Cloud API 權限錯誤

```bash
# 檢查是否已啟用所需 API
gcloud services list --enabled

# 重新授權
gcloud auth login
gcloud auth application-default login
```

#### 5. Firebase 配置錯誤

```bash
# 檢查 Firebase 專案
firebase projects:list

# 重新設定 Firebase 配置
npm run setup:firebase
```

#### 6. Docker 資料庫連線問題

```bash
# 重新啟動資料庫
npm run docker:down
npm run docker:up

# 檢查資料庫狀態
docker-compose ps
```

#### 7. 環境變數問題

```bash
# 重新生成環境變數檔案
npm run setup:env

# 檢查環境變數是否正確
grep -E "(PROJECT_ID|FIREBASE)" apps/*/.env
```

### 取得協助

如果遇到問題，請檢查：

1. **詳細文檔**：

   - [Google Cloud 設定指南](./setup/gcp-setup.md)
   - [Firebase 設定指南](./setup/firebase-setup.md)

2. **日誌檔案**：

   ```bash
   # 檢查應用程式日誌
   npm run dev 2>&1 | tee dev.log

   # 檢查資料庫日誌
   docker-compose logs
   ```

3. **驗證設定**：
   ```bash
   # 執行設定檢查
   node tools/scripts/verify-setup.js
   ```

## 🎯 下一步

設定完成後，您可以：

1. **開始開發**：查看 [開發指南](../README.md#development)
2. **瞭解架構**：閱讀 [系統架構文檔](./architecture.md)
3. **API 文檔**：查看 [API 參考指南](./api-reference.md)

## 📊 效能監控

設定完成後，可以存取以下監控面板：

- **Google Cloud Console**:
  https://console.cloud.google.com/home/dashboard?project=YOUR_PROJECT_ID
- **Firebase Console**:
  https://console.firebase.google.com/project/YOUR_PROJECT_ID
- **Cloud Storage**:
  https://console.cloud.google.com/storage/browser?project=YOUR_PROJECT_ID

---

**💡 提示**: 如果您是第一次使用 Google
Cloud，請確保已設定帳單帳戶。大部分開發階段的使用都在免費額度內。
