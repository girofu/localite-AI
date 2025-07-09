#!/bin/bash

# 段階式測試腳本
# 使用方式: ./scripts/staged-testing.sh [測試模式] [檔案路徑]
# 測試模式: unit|related|integration|full|smoke

set -e  # 任何錯誤都停止執行

MODE="$1"
TARGET_FILE="$2"

echo "🚀 段階式測試執行器"
echo "===================="

# 顏色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 執行測試並檢查結果
run_test() {
    local test_name="$1"
    local test_command="$2"
    
    echo -e "${BLUE}🧪 執行 $test_name${NC}"
    echo "指令: $test_command"
    echo "----------------------------------------"
    
    if eval "$test_command"; then
        echo -e "${GREEN}✅ $test_name 通過${NC}"
        echo
        return 0
    else
        echo -e "${RED}❌ $test_name 失敗${NC}"
        echo
        return 1
    fi
}

# 單元測試
unit_test() {
    echo -e "${YELLOW}🎯 階段 1: 單元測試${NC}"
    if [ -n "$TARGET_FILE" ]; then
        TEST_FILE="${TARGET_FILE%.*}.test.js"
        if [ -f "$TEST_FILE" ]; then
            run_test "目標檔案單元測試" "npm test -- '$TEST_FILE'"
        else
            echo -e "${YELLOW}⚠️ 測試檔案 $TEST_FILE 不存在${NC}"
        fi
    else
        run_test "所有單元測試" "npm test -- --testPathPattern='\.test\.js$' --testNamePattern='^(?!.*integration).*'"
    fi
}

# 相關功能測試
related_test() {
    echo -e "${YELLOW}🔗 階段 2: 相關功能測試${NC}"
    if [ -n "$TARGET_FILE" ]; then
        # 根據檔案路徑推測相關模組
        MODULE_DIR=$(dirname "$TARGET_FILE")
        run_test "相關模組測試" "npm test -- --testPathPattern='$MODULE_DIR'"
    else
        echo -e "${YELLOW}⚠️ 需要指定目標檔案才能執行相關功能測試${NC}"
    fi
}

# 整合測試
integration_test() {
    echo -e "${YELLOW}🔄 階段 3: 整合測試${NC}"
    run_test "API 路由測試" "npm test -- --testPathPattern='routes.*test'"
    run_test "服務整合測試" "npm test -- --testPathPattern='services.*test'"
    run_test "中間件整合測試" "npm test -- --testPathPattern='middleware.*test'"
}

# 完整測試套件
full_test() {
    echo -e "${YELLOW}🌍 階段 4: 完整測試套件${NC}"
    run_test "完整測試套件" "npm test"
}

# 煙霧測試（手動提示）
smoke_test() {
    echo -e "${YELLOW}🔥 階段 5: 手動煙霧測試${NC}"
    echo "請手動執行以下關鍵功能驗證："
    echo "----------------------------------------"
    echo "1. 🔐 用戶認證流程 (登入/登出)"
    echo "2. 📱 API 基本功能 (GET /api/health)"
    echo "3. 🏃‍♂️ 核心業務流程"
    echo "4. 🔧 管理功能 (如果修改了管理相關功能)"
    echo
    echo -e "${BLUE}是否完成手動測試？ (y/n)${NC}"
    read -r answer
    if [[ $answer == "y" || $answer == "Y" ]]; then
        echo -e "${GREEN}✅ 手動煙霧測試完成${NC}"
        return 0
    else
        echo -e "${RED}❌ 手動煙霧測試未完成${NC}"
        return 1
    fi
}

# 主要執行邏輯
case "$MODE" in
    "unit")
        unit_test
        ;;
    "related")
        related_test
        ;;
    "integration")
        integration_test
        ;;
    "full")
        full_test
        ;;
    "smoke")
        smoke_test
        ;;
    "")
        # 執行完整流程
        echo "執行完整段階式測試流程..."
        echo
        unit_test && \
        related_test && \
        integration_test && \
        full_test && \
        smoke_test
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}🎉 所有測試階段完成！可以安全提交程式碼${NC}"
        else
            echo -e "${RED}💥 測試失敗！請修復問題後重新測試${NC}"
            exit 1
        fi
        ;;
    *)
        echo "使用方式: $0 [模式] [檔案路徑]"
        echo "模式選項:"
        echo "  unit        - 執行單元測試"
        echo "  related     - 執行相關功能測試"
        echo "  integration - 執行整合測試"
        echo "  full        - 執行完整測試套件"
        echo "  smoke       - 執行煙霧測試"
        echo "  (空白)      - 執行完整流程"
        echo
        echo "範例:"
        echo "  $0 unit backend/src/services/featureFlagService.js"
        echo "  $0 full"
        echo "  $0"
        exit 1
        ;;
esac 