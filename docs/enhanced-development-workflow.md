# 增強開發流程指南

## 🎯 核心改進：避免破壞其他功能

基於原有的 `@develop-by-task`
流程，新增了**程式碼影響分析**和**段階式測試策略**，確保每次程式碼修改都不會破壞現有功能。

## 📋 新的工作流程

### 1. 任務開始前：影響分析

```bash
# 分析要修改的檔案影響範圍
./scripts/impact-analysis.sh backend/src/services/featureFlagService.js
```

**檢查清單：**

- [ ] 確認依賴關係（誰引用了這個檔案）
- [ ] 檢查介面契約變更影響
- [ ] 列出需要額外測試的模組
- [ ] 評估是否需要新增整合測試

### 2. 開發過程中：即時驗證

```bash
# 修改任何檔案後立即測試
./scripts/staged-testing.sh unit backend/src/services/featureFlagService.js
```

### 3. 功能完成後：段階式測試

```bash
# 執行完整的段階式測試流程
./scripts/staged-testing.sh
```

**測試順序：**

1. **單元測試** - 確保基本功能正常
2. **相關功能測試** - 驗證依賴模組正常
3. **整合測試** - 確認 API 和資料庫互動
4. **完整測試** - 執行完整測試套件
5. **手動煙霧測試** - 驗證關鍵用戶流程

## 🔧 工具使用方式

### 影響分析腳本

```bash
# 基本使用
./scripts/impact-analysis.sh <檔案路徑>

# 範例
./scripts/impact-analysis.sh backend/src/services/featureFlagService.js
```

**輸出內容：**

- 📦 依賴此檔案的模組清單
- 📤 此檔案的 exports 清單
- 📥 此檔案的 imports 清單
- 🧪 相關測試檔案狀態
- 🔧 建議執行的測試指令

### 段階式測試腳本

```bash
# 執行特定階段測試
./scripts/staged-testing.sh <模式> [檔案路徑]

# 模式選項
unit        # 單元測試
related     # 相關功能測試
integration # 整合測試
full        # 完整測試套件
smoke       # 煙霧測試

# 執行完整流程
./scripts/staged-testing.sh
```

## 📝 更新的記錄格式

錯誤記錄現在包含影響分析結果：

```markdown
## 錯誤修正記錄 (2025-01-05) - 任務 1.6 [功能旗標服務]

### 程式碼影響分析結果

- 受影響檔案：featureFlagMiddleware.js, routes/featureFlags.js
- 額外測試模組：middleware/, routes/

### 錯誤現象

- 快取服務初始化失敗

### 原因

- Redis 連線配置在測試環境未正確設置

### 解決方案

- 添加測試環境的 Redis mock 配置

### 相關影響

- 無其他功能受影響
- 額外執行了中間件和路由測試，結果正常

### 預防措施

- 在修改快取相關功能前，先確認測試環境配置
```

## 🚦 何時使用不同的測試策略

### 小型修改 (bug fixes, 樣式調整)

```bash
./scripts/staged-testing.sh unit <檔案>
./scripts/staged-testing.sh related <檔案>
```

### 中型修改 (新增功能, API 變更)

```bash
./scripts/staged-testing.sh  # 完整流程
```

### 大型修改 (架構變更, 重構)

1. 執行影響分析
2. 執行完整測試流程
3. 額外進行端到端測試
4. 考慮分階段部署

## ⚠️ 重要注意事項

1. **影響分析必須在開發前執行**，不要等到完成後才分析
2. **任何測試失敗都必須修復**，不可跳過測試階段
3. **手動煙霧測試不可省略**，自動化測試無法涵蓋所有場景
4. **記錄影響分析結果**，為未來類似修改提供參考

## 🎯 效果評估

使用此流程後，你應該能夠：

- ✅ 提前識別可能受影響的功能
- ✅ 降低意外破壞現有功能的風險
- ✅ 提高測試覆蓋率和品質
- ✅ 累積更多錯誤修正經驗
- ✅ 加快問題定位和解決速度

## 🔄 持續改進

根據使用經驗，持續優化：

1. **工具改進**：根據實際使用情況調整腳本功能
2. **流程優化**：簡化重複性高的步驟
3. **知識累積**：將常見問題加入自動檢查清單
4. **團隊協作**：分享最佳實踐和經驗
