#!/bin/bash

# 程式碼影響分析腳本
# 使用方式: ./scripts/impact-analysis.sh [檔案路徑]

if [ -z "$1" ]; then
    echo "使用方式: $0 <檔案路徑>"
    echo "範例: $0 backend/src/services/featureFlagService.js"
    exit 1
fi

TARGET_FILE="$1"
echo "=== 程式碼影響分析：$TARGET_FILE ==="
echo

# 1. 檢查哪些檔案引用此檔案
echo "📦 依賴此檔案的模組："
echo "----------------------------------------"
grep -r --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx" \
     "import.*$(basename "$TARGET_FILE" .js)" . 2>/dev/null | \
     grep -v "$TARGET_FILE" | \
     head -10
echo

# 2. 檢查此檔案的 exports
echo "📤 此檔案的 exports："
echo "----------------------------------------"
grep -E "(export|module\.exports)" "$TARGET_FILE" 2>/dev/null || echo "無 exports"
echo

# 3. 檢查此檔案的 imports
echo "📥 此檔案的 imports："
echo "----------------------------------------"
grep -E "(import|require)" "$TARGET_FILE" 2>/dev/null || echo "無 imports"
echo

# 4. 檢查相關測試檔案
echo "🧪 相關測試檔案："
echo "----------------------------------------"
TEST_FILE="${TARGET_FILE%.*}.test.js"
if [ -f "$TEST_FILE" ]; then
    echo "✅ $TEST_FILE (存在)"
else
    echo "❌ $TEST_FILE (不存在)"
fi

# 檢查其他可能的測試檔案
find . -name "*test*" -type f | grep "$(basename "$TARGET_FILE" .js)" | head -5
echo

# 5. 建議執行的測試指令
echo "🔧 建議執行的測試："
echo "----------------------------------------"
echo "# 單元測試"
echo "npm test -- $TEST_FILE"
echo
echo "# 相關功能測試 (需手動調整)"
dirname "$TARGET_FILE" | xargs -I {} echo "npm test -- --testPathPattern={}"
echo
echo "# 整合測試"
echo "npm test -- --testPathPattern=routes"
echo
echo "# 完整測試"
echo "npm test" 