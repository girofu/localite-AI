# AI 導覽服務測試指南

針對第2.1階段的AI導覽服務整合功能，我們提供了多種測試方式：

## 🧪 測試方式總覽

### 1. 單元測試 (Unit Tests)

- **檔案**: `src/__tests__/ai-service.test.ts`
- **目的**: 測試AI服務的核心邏輯
- **執行方式**: `npm test ai-service.test.ts`

### 2. API整合測試 (Integration Tests)

- **檔案**: `src/__tests__/tour-api.test.ts`
- **目的**: 測試API端點的完整流程
- **執行方式**: `npm test tour-api.test.ts`

### 3. 手動測試工具 (Manual Testing Tool)

- **檔案**: `src/scripts/test-ai-service.ts`
- **目的**: 直接測試AI服務功能，無需API呼叫
- **執行方式**: `npm run test:ai`

### 4. HTTP API測試 (REST API Testing)

- **檔案**: `test-requests.http`
- **目的**: 測試實際的HTTP API端點
- **工具**: VS Code REST Client 或 Postman

## ⚡ 快速開始

### 準備工作

1. **設定環境變數** (.env 檔案):

```bash
GOOGLE_CLOUD_PROJECT_ID=your-project-id
GOOGLE_CLOUD_LOCATION=us-central1
FIREBASE_ADMIN_SDK_KEY=path/to/service-account.json
REDIS_URL=redis://localhost:6379
MONGODB_URI=mongodb://localhost:27017/localite-v3
```

2. **啟動相關服務**:

```bash
# 啟動 Redis (可選，快取功能需要)
redis-server

# 啟動 MongoDB
mongod

# 啟動後端服務
npm run dev
```

### 執行測試

#### 方式1: 手動測試工具 (推薦)

```bash
# 執行完整測試套件
npm run test:ai

# 只測試導覽內容生成
npm run test:ai:generate

# 只測試翻譯功能
npm run test:ai:translate

# 只測試語音合成
npm run test:ai:speech

# 只測試快取功能
npm run test:ai:cache
```

#### 方式2: Jest 單元測試

```bash
# 執行所有測試
npm test

# 只執行AI服務測試
npm test ai-service.test.ts

# 只執行API測試
npm test tour-api.test.ts

# 監控模式
npm run test:watch
```

#### 方式3: HTTP API測試

1. 在VS Code中安裝 `REST Client` 擴展
2. 打開 `test-requests.http` 檔案
3. 更新 `@authToken` 變數為你的Firebase Auth Token
4. 點擊請求上方的 "Send Request" 按鈕

## 📋 測試項目說明

### AI導覽內容生成測試

- ✅ 基本內容生成 (台北101、故宮等地點)
- ✅ 多語言支援 (中文、英文、日文)
- ✅ 不同偏好設定 (時間、興趣、難度)
- ✅ 快取機制驗證
- ✅ 錯誤處理測試

### 翻譯服務測試

- ✅ 中文 → 英文翻譯
- ✅ 中文 → 日文翻譯
- ✅ 中文 → 韓文翻譯
- ✅ 翻譯失敗處理
- ✅ 無效語言代碼處理

### 語音合成測試

- ✅ 中文語音生成
- ✅ 英文語音生成
- ✅ 日文語音生成
- ✅ 長文本處理
- ✅ 語音檔案產生

### 快取系統測試

- ✅ Redis 連線測試
- ✅ 資料存取測試
- ✅ 過期時間設定
- ✅ 快取清理功能

## 🐛 常見問題排除

### Google Cloud 認證問題

```bash
# 檢查服務帳戶金鑰
export GOOGLE_APPLICATION_CREDENTIALS="path/to/service-account.json"

# 或在程式中設定
FIREBASE_ADMIN_SDK_KEY=path/to/service-account.json
```

### Redis 連線問題

```bash
# 如果沒有 Redis，快取功能會自動降級
# 但不會影響其他功能

# 安裝 Redis (macOS)
brew install redis
brew services start redis

# 安裝 Redis (Ubuntu)
sudo apt install redis-server
sudo systemctl start redis
```

### Firebase Auth Token 獲取

```javascript
// 在前端應用中
import { getAuth } from 'firebase/auth';
const user = getAuth().currentUser;
const token = await user.getIdToken();
console.log('Auth Token:', token);
```

### API 響應時間過長

- AI 服務初次呼叫較慢 (30-60秒)
- 後續呼叫有快取，響應更快 (1-3秒)
- 可以先用手動測試工具預熱服務

## 📊 測試結果解讀

### 成功指標

- ✅ 導覽內容包含標題、描述、段落
- ✅ AI 信心度 > 0.7
- ✅ 翻譯內容不為空且不同於原文
- ✅ 語音檔案成功生成
- ✅ 快取讀寫正常

### 警告指標

- ⚠️ AI 信心度 0.5-0.7 (內容品質可能不穩定)
- ⚠️ Redis 連線失敗 (功能降級但可正常運作)
- ⚠️ 翻譯服務偶發錯誤 (會返回原文)

### 錯誤指標

- ❌ Google Cloud 服務無法連線
- ❌ 環境變數配置錯誤
- ❌ Firebase 認證失敗
- ❌ API 路由未正確設定

## 🚀 效能基準

### 預期回應時間

- **導覽內容生成**: 15-45秒 (首次), 1-3秒 (快取)
- **翻譯服務**: 2-8秒
- **語音合成**: 3-10秒
- **快取操作**: < 100ms

### 並發能力

- 同時處理 5-10 個AI請求
- Redis 快取支援高並發讀取
- 建議實作 rate limiting 避免過載

## 💡 最佳實踐

1. **測試順序**: 先執行手動測試確認服務正常，再執行自動化測試
2. **環境隔離**: 測試時使用獨立的 Google Cloud 專案避免影響正式服務
3. **成本控制**: AI 服務按調用計費，測試時注意用量
4. **日誌監控**: 觀察日誌檔案了解服務運作狀況
5. **錯誤處理**: 確保所有錯誤情況都有適當的fallback機制
