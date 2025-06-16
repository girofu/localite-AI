---
description: 
globs: 
alwaysApply: true
---
# 在地人 AI 導覽系統 - 改進版開發架構與時程規劃-v2

# to-do

1. 程式碼庫風格指南 (style guide)\
   <https://developers.google.com/style>

2. 靜態檢查工具 (例如 linter)



## 一、技術架構設計

### 1\.1 系統架構建議

# 在地人 AI 導覽系統 - 技術架構圖

## 系統架構概覽

```
flowchart TD
    subgraph Frontend["前端層"]
        Mobile[Mobile App - React Native] 
        Web[Web App - React]
    end
    
    subgraph Gateway["API層"]
        API[API Gateway]
        Auth[Authentication Service]
    end
    
    subgraph Backend["後端層"]
        App[應用伺服器 - Node.js]
        Queue[消息隊列 - RabbitMQ]
        Cache[快取層 - Redis]
        FeatureFlags[功能旗標服務]
    end
    
    subgraph AI["AI服務層"]
        GPT[GPT API Service]
        TTS[語音合成服務]
    end
    
    subgraph Database["資料層"]
        MongoDB[(MongoDB 主庫)]
        MySQL[(MySQL 交易庫)]
        Storage[對象存儲 S3]
    end
    
    subgraph Payment["付款層"]
        PayGate[綠界金流]
        Apple[Apple Pay]
        Line[Line Pay]
    end
    
    subgraph Monitoring["監控層"]
        Metrics[指標收集]
        Alerts[告警系統]
        Logging[日誌系統]
    end
    
    Mobile --> API
    Web --> API
    API --> Auth
    Auth --> App
    API --> App
    App --> Queue
    App --> Cache
    App --> GPT
    App --> TTS
    App --> MongoDB
    App --> MySQL
    App --> Storage
    App --> PayGate
    App --> Apple
    App --> Line
    App --> FeatureFlags
    App --> Metrics
    Queue --> Metrics
    Cache --> Metrics
    API --> Metrics
    Metrics --> Alerts

```

## 核心模塊架構

### 1\. 導覽服務模塊

```
flowchart LR
    User[用戶請求] --> Tour[導覽引擎]
    Tour --> Content[內容管理]
    Tour --> AI[AI處理器]
    AI --> GPT[GPT API]
    AI --> Voice[語音生成]
    Content --> Cache[快取]
    Content --> DB[(資料庫)]
    Tour --> FeatureFlags[功能旗標]

```

### 2\. 商戶管理模塊

```
flowchart LR
    Merchant[商戶後台] --> CMS[內容管理系統]
    CMS --> Content[導覽內容]
    CMS --> Product[商品管理]
    CMS --> Settings[設定管理]
    CMS --> DB[(資料庫)]
    CMS --> FeatureFlags[功能旗標]

```

### 3\. 資料處理流程

```
sequenceDiagram
    participant User as 用戶
    participant App as 移動端
    participant API as API Gateway
    participant AI as AI服務
    participant DB as 資料庫
    participant Cache as 快取層
    
    User->>App: 請求導覽
    App->>API: 發送請求
    API->>Cache: 檢查快取
    
    alt 快取命中
        Cache-->>API: 返回快取內容
        API-->>App: 返回導覽內容
    else 快取未命中
        API->>AI: 調用GPT
        AI->>DB: 獲取內容
        AI-->>API: 生成導覽內容
        API->>Cache: 存入快取
        API-->>App: 返回導覽內容
    end
    
    App-->>User: 播放導覽

```

### 1\.2 技術棧選擇

基於您的團隊熟悉度，並結合現代軟體工程最佳實踐，我建議使用以下技術棧：

**前端部分：**

- 手機 App：React Native

- 網頁 App：React.js

- 狀態管理：Redux Toolkit (提供更簡潔的Redux體驗)

- UI 框架：Material-UI 或 Ant Design

- 單元測試：Jest + React Testing Library

**後端部分：**

- 主框架：Node.js + Express

- API 設計：RESTful API + OpenAPI 規範

- API 文檔：Swagger

- 消息隊列：RabbitMQ（處理非同步任務）

- 快取：Redis（提升響應速度）

- 功能旗標：自建或使用LaunchDarkly/PostHog

**資料庫：**

- 主資料庫：MongoDB（導覽內容、用戶資料）

- 交易資料庫：MySQL（訂單、付款紀錄）

- 對象存儲：AWS S3 或 GCP Storage（照片、影片）

**AI 服務：**

- GPT API：用於導覽內容生成

- 語音合成：Azure Speech Service 或 Google Cloud TTS

**付款服務：**

- 綠界金流（統一處理信用卡、Apple Pay、Line Pay）

**雲端服務：**

- Firebase（MVP階段快速開發方案）：

   - Firebase Authentication（用戶認證）

   - Firebase Cloud Messaging（推播通知）

   - Firebase Storage（檔案存儲）

**監控與日誌：**

- 指標收集：Prometheus

- 告警系統：Grafana Alert

- 日誌系統：ELK Stack (Elasticsearch, Logstash, Kibana)

### 1\.3 API設計原則

根據現代API設計最佳實踐，我們將遵循以下原則：

1. **簡單直觀**：API命名清晰表達意圖，例如`GET /guides/{guide_id}`而非`GET /g/{guide_id}`

2. **一致性高**：所有API遵循相同風格，例如統一使用駝峰式命名法

3. **版本控制**：使用URL前綴進行版本控制，如`/api/v1/guides`

4. **可向後兼容**：新增欄位不破壞原有客戶端

5. **冪等性設計**：特別針對支付API，確保不會重複處理

6. **錯誤處理標準化**：統一的錯誤響應格式

API路徑示例：

```
GET /api/v1/tours                   # 獲取所有導覽
GET /api/v1/tours/{id}              # 獲取特定導覽
POST /api/v1/tours                  # 創建導覽
PUT /api/v1/tours/{id}              # 更新導覽
GET /api/v1/merchants/{id}/tours    # 獲取特定商戶的導覽
POST /api/v1/payments               # 創建支付

```

### 1\.4 SOLID原則應用

為確保程式碼的可維護性和擴展性，我們將遵循SOLID原則：

1. **單一職責原則(S)**：每個服務模塊只負責一項功能，例如分離導覽服務和支付服務

2. **開放封閉原則(O)**：系統設計允許添加新功能而無需修改現有代碼，例如添加新的導覽內容提供者

3. **里氏替換原則(L)**：確保API接口的實現可以替換，例如未來可以替換不同的AI語言模型

4. **接口隔離原則(I)**：服務接口精簡，只包含必要的方法，例如商戶接口和用戶接口分離

5. **依賴反轉原則(D)**：高層模塊不依賴低層模塊，例如導覽服務不直接依賴具體的AI服務實現，而是依賴抽象的接口

## 二、MVP 功能優先級與部署策略

### 2\.1 第一階段（MVP）

**必要功能：**

1. 用戶系統（註冊/登入）

2. AI 導覽服務（文字+語音）

3. 廠商後台（內容上傳管理）

4. 多語言支援（中文+英文）

5. 基本商品展示（無購買功能）

**技術實作重點：**

- 使用 Firebase Auth 簡化認證開發

- GPT API 整合 + 語音合成

- 簡化的內容管理系統

- 基礎 UI/UX 實現

- 功能旗標實現金絲雀部署

### 2\.2 第二階段（上線後）

**擴展功能：**

1. 定位導航功能

2. 完整購物系統

3. 客製化紀念品服務

4. 更多語言支援

5. 數據分析後台

### 2\.3 金絲雀部署策略

為了安全上線並降低風險，我們將使用功能旗標實施金絲雀部署：

1. **內部測試階段**：僅團隊成員可見新功能

2. **Alpha測試階段**：選定5%用戶可見新功能

3. **Beta測試階段**：擴大至20%用戶

4. **逐步推廣階段**：按地區或用戶特性逐步開放至50%、80%

5. **全量發布階段**：100%用戶可見

每個階段都進行監控評估，如發現異常可立即回滾。

## 三、詳細開發時程規劃

### 第一月：核心架構與設計（4週）

#### 週1：系統設計與架構確認

- **專案經理**：

   - 確認需求規格書

   - 制定詳細工作分解結構（WBS）

   - 建立專案管理流程（Scrum/Kanban）

- **工程師**：

   - 系統架構設計確認

   - 技術選型最終決定

   - 開發環境建置

   - 設計API規範和接口文檔

- **設計師**：

   - 使用者研究（可選）

   - 競品分析

   - 設計風格確定

#### 週2：UI/UX設計

- **設計師**：
   - 繪製用戶流程圖

   - 製作線框圖（Wireframe）

   - 設計視覺稿（主要頁面）

- **工程師**：

   - 資料庫結構設計

   - API 規格設計

   - 開始後端基礎建置

   - 設置功能旗標服務

#### 週3：核心架構開發

- **工程師**：

   - 搭建 Node.js 後端框架

   - 建立 MongoDB 資料模型

   - 實作 Firebase 認證整合

   - 設置 Redis 快取環境

   - 建立監控系統基礎架構

- **設計師**：

   - 完成剩餘 UI 設計

   - 準備設計系統文件

   - 標註圖完成

#### 週4：前端初始化與API整合

- **工程師**：

   - React Native 專案建置

   - React Web 專案建置

   - 實現基礎路由系統

   - 建立 API 客戶端

   - 設置 CI/CD 管道

- **設計師**：

   - 協助前端套版

   - 準備設計資源（圖標、圖片）

### 第二月：核心功能開發（4週）

#### 週5：用戶系統與認證

- **工程師**：

   - 用戶註冊/登入功能

   - 角色權限系統

   - Session 管理

   - 基礎 API 安全措施

   - 單元測試實現

- **設計師**：

   - 協助用戶介面調整

   - 準備多語言介面文案

#### 週6：廠商系統基礎

- **工程師**：

   - 廠商註冊/認證

   - 內容上傳介面後端

   - 文件存儲系統（S3）

   - 內容管理 API

   - API冪等性實現

- **設計師**：

   - 廠商後台 UI 調整

   - 上傳流程 UX 優化

#### 週7：AI 導覽核心功能

- **工程師**：

   - GPT API 整合

   - 導覽內容生成邏輯

   - 語音合成整合

   - 多語言切換功能

   - 快取系統優化

- **設計師**：

   - 導覽頁面完整設計

   - 互動動畫設計

#### 週8：導覽功能完善

- **工程師**：

   - 導覽流程實現

   - 內容快取機制

   - 離線功能（選用）

   - 效能優化

   - 功能旗標整合

- **設計師**：

   - 使用者測試設計

   - 準備demo素材

### 第三月：系統整合與測試（4週）

#### 週9：系統整合

- **工程師**：

   - 前後端功能整合

   - 解決整合問題

   - API 測試與調優

   - 錯誤處理機制

   - 設置監控告警系統

- **設計師**：

   - 視覺調整與微調

   - 說明文檔設計

#### 週10：內部測試

- **全團隊**：

   - 功能測試

   - 壓力測試（模擬多用戶）

   - 安全性檢查

   - UI/UX 體驗測試

   - 性能監控評估

- **特別注意**：

   - 記錄 bug 並分優先級處理

   - 性能瓶頸識別

#### 週11：修復與優化

- **工程師**：

   - 修復測試發現的問題

   - 性能優化

   - 程式碼重構

   - 文檔完善

   - 優化監控指標

- **設計師**：

   - 基於測試回饋微調設計

   - 協助製作用戶指南

#### 週12：上線準備

- **工程師**：

   - 生產環境準備

   - CI/CD 流程建立

   - 監控系統設置

   - 備份方案確認

   - 功能旗標發布計劃

- **專案經理**：

   - 上線計劃制定

   - 客戶溝通準備

   - 內部培訓安排

- **設計師**：

   - 宣傳素材準備

   - 用戶引導設計

## 四、專案管理建議

### 4\.1 工作流程建議

- 採用 **2週Sprint** 的敏捷開發流程

- 使用 Trello 或 Jira 進行任務管理

- 每日早上15分鐘 Stand-up Meeting

- 每週 Sprint Review 檢視進度

- 自動化測試與持續整合

### 4\.2 外部顧問安排

建議聘請架構顧問：

- 時間：每週 4-6 小時

- 重點時段：第1-4週（架構設計期）

- 服務內容：架構審查、技術難題解決、程式碼審查、SOLID原則實踐輔導

### 4\.3 品質保證

在沒有專門QA的情況下：

- 單元測試由工程師負責（目標代碼覆蓋率至少70%）

- 整合測試由專案經理協助

- UI測試利用自動化工具（Cypress）

- 內部User Testing由設計師規劃

- 實施功能旗標驅動的開發與測試

### 4\.4 系統穩定性保障措施

1. **避免單點故障**：

   - 關鍵服務冗餘部署

   - 均衡負載設計

   - 備份系統自動化

2. **監控機制**：

   - 關鍵指標：API響應時間、錯誤率、系統資源使用率

   - 設置合理閾值和告警機制

   - 日誌集中管理與分析

3. **自動擴展**：

   - 根據負載自動調整服務規模

   - 高峰期預警機制

## 五、預算分配建議（30萬元）

1. **開發人力**：20萬元（67%）

   - 全職工程師：16萬（3個月）

   - 架構顧問：4萬（外包）

2. **設計成本**：4萬元（13%）

   - UI/UX設計師：4萬（已有內部人員）

3. **技術服務**：4萬元（13%）

   - 雲端服務（Firebase、AWS等）

   - GPT API使用費

   - 第三方服務（綠界金流等）

   - 監控系統服務

4. **測試/其他**：2萬元（7%）

   - 測試服務器

   - 文檔工具訂閱

   - 自動化測試工具

   - 功能旗標服務

## 六、接下來的行動項目

1. **本週內完成**：

   - 確認架構設計方案

   - 開始招募/聯繫外部架構顧問

   - 設置開發環境

   - 建立API設計文檔

2. **下週開始**：

   - 設計師開始 UI/UX 設計

   - 工程師開始後端架構搭建

   - 建立專案管理系統

   - 設置功能旗標服務的初始架構
