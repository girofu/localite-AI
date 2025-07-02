# Localite AI 導覽系統 API 文檔使用指南

## 概覽

本指南將幫助您了解如何使用 Localite
AI 導覽系統的 API 文檔，以及如何進行 API 測試和整合。

## 🚀 快速開始

### 1. 訪問 API 文檔

啟動後端服務器後，您可以通過以下 URL 訪問 API 文檔：

- **開發環境**: `http://localhost:8000/api-docs`
- **生產環境**: `https://api.localite.com/api-docs`

### 2. 文檔界面介紹

API 文檔使用 Swagger UI 構建，提供以下功能：

- 📋 **完整的 API 端點列表**
- 🔒 **認證機制說明**
- 📝 **請求/回應格式**
- 🧪 **在線測試功能**
- 💡 **範例代碼**

## 🔐 認證設置

### 獲取 API Token

1. 登入系統獲取 JWT token
2. 在 Swagger UI 中點擊右上角的 **"Authorize"** 按鈕
3. 在彈出視窗中輸入：`Bearer YOUR_JWT_TOKEN`
4. 點擊 **"Authorize"** 完成認證

```bash
# 範例認證 header
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 認證狀態

- ✅ **已認證**: 綠色鎖頭圖標，可以測試需要認證的 API
- ❌ **未認證**: 灰色鎖頭圖標，只能測試公開 API

## 📖 API 分類說明

### 🔑 Authentication (認證)

- 用戶註冊、登入、密碼重設
- JWT token 管理
- 社交媒體登入整合

### 🗺️ Tours (導覽)

- 導覽內容管理
- AI 生成導覽內容
- 多語言導覽支援

### 🏪 Merchants (商戶)

- 商戶註冊與認證
- 內容管理系統
- 商戶審核流程

### 🛍️ Products (商品)

- 商品資訊管理
- 商品分類與搜尋
- 庫存管理

### 🤖 AI Services (AI 服務)

- 內容生成 API
- 翻譯服務
- 語音合成

### 🔧 Monitoring (監控)

- 系統健康檢查
- 效能指標
- 錯誤追蹤

### 🚩 Feature Flags (功能旗標)

- 功能開關管理
- 金絲雀部署控制
- A/B 測試支援

## 🧪 API 測試指南

### 1. 使用 Swagger UI 測試

1. **選擇 API 端點**: 點擊想要測試的 API
2. **查看參數**: 檢查必需和可選參數
3. **填寫測試數據**: 在表單中輸入測試值
4. **執行請求**: 點擊 "Try it out" 按鈕
5. **查看結果**: 檢查回應狀態碼和數據

### 2. 使用 cURL 測試

每個 API 端點都提供 cURL 範例：

```bash
# 獲取導覽列表
curl -X GET "http://localhost:8000/api/v1/tours" \
  -H "accept: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN"

# 創建新導覽
curl -X POST "http://localhost:8000/api/v1/tours" \
  -H "accept: application/json" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "title": "故宮博物院導覽",
    "description": "深度探索故宮文物",
    "location": {
      "lat": 25.1013,
      "lng": 121.5485,
      "address": "台北市士林區至善路二段221號"
    }
  }'
```

### 3. 使用 Postman 測試

1. 匯入 OpenAPI 規格：
   - 複製 `http://localhost:8000/api-docs/swagger.json`
   - 在 Postman 中選擇 "Import" → "Link"
   - 貼上 URL 並匯入

2. 設置環境變數：
   - `base_url`: `http://localhost:8000`
   - `auth_token`: 您的 JWT token

## 📊 API 回應格式

### 成功回應

```json
{
  "success": true,
  "data": {
    // API 特定數據
  },
  "message": "操作成功完成"
}
```

### 錯誤回應

```json
{
  "success": false,
  "error": {
    "message": "錯誤描述",
    "code": "ERROR_CODE",
    "details": [
      {
        "field": "email",
        "message": "請輸入有效的電子郵件地址"
      }
    ]
  }
}
```

### 分頁回應

```json
{
  "success": true,
  "data": {
    "items": [...],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 150,
      "totalPages": 8,
      "hasNext": true,
      "hasPrev": false
    }
  }
}
```

## ⚡ 最佳實踐

### 1. API 使用限制

- **速率限制**: 每分鐘最多 100 次請求
- **請求大小**: 最大 10MB
- **超時時間**: 30 秒

### 2. 錯誤處理

```javascript
// JavaScript 範例
try {
  const response = await fetch('/api/v1/tours', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error.message);
  }

  const data = await response.json();
  return data.data;
} catch (error) {
  console.error('API 請求失敗:', error.message);
  // 處理錯誤
}
```

### 3. 快取策略

- **GET 請求**: 支援 ETag 快取
- **快取標頭**: 遵循 Cache-Control 指示
- **過期時間**: 導覽內容快取 5 分鐘

### 4. 並行請求

```javascript
// 並行請求範例
const [tours, merchants, products] = await Promise.all(
  [
    fetch('/api/v1/tours'),
    fetch('/api/v1/merchants'),
    fetch('/api/v1/products'),
  ].map(request => request.then(r => r.json()))
);
```

## 🔧 開發者工具

### 1. Schema 驗證

所有 API 端點都包含完整的 JSON Schema 定義，可用於：

- 前端表單驗證
- 自動生成類型定義
- API 客戶端代碼生成

### 2. Mock 數據

開發環境提供 mock 數據端點：

```
GET /api/v1/mock/{resource}
```

### 3. API 版本管理

- 當前版本: `v1`
- 版本策略: URL 路徑版本控制
- 向後兼容: 保證 6 個月向後兼容

## ❓ 常見問題

### Q: 如何處理 401 Unauthorized 錯誤？

A: 檢查 JWT token 是否有效，並確保在 Authorization header 中正確設置。

### Q: API 請求超時怎麼辦？

A: 檢查網路連接，考慮實作重試機制，或聯繫支援團隊。

### Q: 如何獲得更高的速率限制？

A: 聯繫我們升級到專業版 API 金鑰。

### Q: 支援哪些內容類型？

A: 支援 `application/json`、`multipart/form-data`（檔案上傳）和
`application/x-www-form-urlencoded`。

## 📞 支援與聯繫

- 📧 **技術支援**: dev@localite.com
- 📚 **文檔更新**: 每週五更新
- 🐛 **Bug 回報**: [GitHub Issues](https://github.com/localite/api/issues)
- 💬 **討論區**: [開發者社群](https://community.localite.com)

## 🔄 更新日誌

### v1.0.0 (2025-01-02)

- ✨ 初始 API 發布
- 🔐 JWT 認證系統
- 🤖 AI 導覽服務
- 🏪 商戶管理功能
- 📊 監控與功能旗標

---

> 💡
> **提示**: 建議將此文檔加入書籤，以便快速查閱 API 使用方法。如有任何問題，歡迎聯繫我們的技術支援團隊！
