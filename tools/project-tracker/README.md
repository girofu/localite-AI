# 在地人 AI 導覽系統 - 專案追蹤器

一個專為「在地人 AI 導覽系統」設計的專案架構與開發進度追蹤工具，基於規劃文件自動化管理專案狀態，確保開發延續性。

## 🎯 主要功能

### 1. 架構管理

- **技術棧追蹤**: 記錄前端、後端、資料庫、AI服務等技術選型
- **元件狀態**: 追蹤各架構元件的實作進度
- **相依性管理**: 管理元件間的相依關係
- **風險識別**: 自動檢測架構風險項目

### 2. 進度管理

- **週進度追蹤**: 基於12週開發計畫的詳細進度管理
- **任務管理**: 建立、更新、分配開發任務
- **里程碑監控**: 追蹤關鍵里程碑達成狀況
- **趨勢分析**: 分析進度趨勢與預測完成時間

### 3. 報告系統

- **週報告**: 自動生成週進度報告
- **月報告**: 生成階段性月度總結
- **風險報告**: 識別並建議風險處理方案
- **數據導出**: 支援數據備份與匯入

## 🚀 快速開始

### 安裝

```bash
cd tools/project-tracker
npm install
```

### 初始化

```bash
# 初始化專案追蹤器
npm run init

# 或直接執行
node index.js init
```

### 基本使用

```bash
# 查看專案狀態
npm run status

# 更新週進度
npm run update 1

# 生成報告
npm run report

# 查看所有可用命令
node index.js help
```

## 📋 命令說明

### 主要命令

| 命令            | 說明             | 範例                         |
| --------------- | ---------------- | ---------------------------- |
| `init`          | 初始化追蹤器     | `node index.js init`         |
| `status`        | 顯示專案狀態概覽 | `node index.js status`       |
| `update <week>` | 更新指定週進度   | `node index.js update 3`     |
| `add-task`      | 新增開發任務     | `node index.js add-task`     |
| `report`        | 生成詳細報告     | `node index.js report`       |
| `architecture`  | 查看架構狀態     | `node index.js architecture` |

### 進階功能

```bash
# 更新架構元件狀態
node index.js arch-update phase1 projectInit completed

# 更新技術棧狀態
node index.js tech-update backend.framework implemented

# 生成特定週報告
node index.js weekly-report 5

# 生成月度報告
node index.js monthly-report 1

# 數據導出
node index.js export

# 清理舊報告
node index.js cleanup
```

## 📊 專案架構對應

本追蹤器嚴格按照規劃文件結構設計：

### 三個開發階段

1. **第一月**: 基礎架構與核心功能 (週1-4)
2. **第二月**: 核心功能開發 (週5-8)
3. **第三月**: 系統完善與部署 (週9-12)

### 技術棧追蹤

- **前端**: React Native, React.js, Redux Toolkit
- **後端**: Node.js, Express, MongoDB, Redis
- **AI服務**: GPT API, Google Cloud TTS
- **雲端**: Firebase, Google Cloud Platform
- **監控**: Prometheus, Grafana, ELK Stack

### 關鍵里程碑

- **週4**: 基礎架構完成，可進行 API 測試
- **週8**: 核心功能完成，可進行端到端測試
- **週12**: 完整系統上線準備完成

## 📁 資料結構

```
tools/project-tracker/
├── src/
│   ├── ArchitectureManager.js    # 架構管理
│   ├── ProgressManager.js        # 進度管理
│   └── ProjectTracker.js         # 核心追蹤器
├── config/                       # 配置檔案
│   ├── architecture.json         # 架構定義
│   └── tech-stack.json          # 技術棧配置
├── data/                         # 資料檔案
│   ├── progress.json             # 進度資料
│   ├── tasks.json                # 任務資料
│   ├── milestones.json           # 里程碑資料
│   └── reports/                  # 報告檔案
└── index.js                      # 主程式
```

## 🔧 配置說明

### 專案配置 (tracker-config.json)

```json
{
  "projectName": "在地人 AI 導覽系統",
  "version": "3.0.0",
  "team": {
    "projectManager": "專案經理姓名",
    "engineer": "工程師姓名",
    "designer": "設計師姓名",
    "consultant": "顧問姓名"
  },
  "settings": {
    "reportFrequency": "weekly",
    "alertThresholds": {
      "riskCount": 3,
      "delayWeeks": 1,
      "taskOverdue": 5
    }
  }
}
```

### 進度狀態說明

- `pending`: 尚未開始
- `in-progress`: 進行中
- `completed`: 已完成
- `at-risk`: 存在風險
- `blocked`: 被阻塞

## 📈 報告範例

### 週報告內容

- 週目標達成狀況
- 完成的任務清單
- 發現的風險項目
- 下週計畫與建議
- 關鍵指標統計

### 月報告內容

- 階段總體進度
- 月度成就與挑戰
- 趨勢分析與預測
- 資源使用效率
- 調整建議

## 🚨 風險管理

### 自動風險檢測

- **進度風險**: 週進度落後檢測
- **架構風險**: 元件相依性問題
- **任務風險**: 逾期任務累積
- **里程碑風險**: 關鍵節點延遲

### 風險等級

- **High**: 需要立即處理
- **Medium**: 需要關注並規劃處理
- **Low**: 可以後續觀察

## 🛠️ 開發指引

### 擴展功能

1. 在對應的 Manager 類別中新增方法
2. 更新主程式的命令處理
3. 新增相應的測試案例
4. 更新文檔說明

### 自定義配置

可以修改各個 default 配置來符合不同專案需求：

- 調整週數和階段劃分
- 修改技術棧定義
- 自定義里程碑設定
- 調整風險閾值

## 📝 注意事項

1. **資料備份**: 系統會自動備份資料，但建議定期手動備份
2. **版本控制**: 建議將 config 和 data 目錄加入版本控制
3. **權限管理**: 確保團隊成員都有適當的檔案讀寫權限
4. **定期更新**: 建議每週更新進度，每月檢視整體狀況

## 🤝 貢獻

歡迎提交 Issues 和 Pull Requests 來改善這個工具。

## 📄 授權

ISC License - 詳見 LICENSE 檔案
