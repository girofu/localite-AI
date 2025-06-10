# Google Cloud Platform 設定指南

## 第一步：建立 Google Cloud Project

### 1.1 透過 Google Cloud Console

1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 點選上方專案選擇器，然後點選「新增專案」
3. 填寫專案資訊：
   - **專案名稱**: `localite-ai-guide` (或你偏好的名稱)
   - **專案 ID**: 系統會自動生成，記住這個 ID
   - **位置**: 選擇組織 (如果有的話)
4. 點選「建立」

### 1.2 透過 gcloud CLI (可選)

```bash
# 安裝 gcloud CLI (如果還沒安裝)
# macOS: brew install google-cloud-sdk
# 其他系統請參考官方文檔

# 登入 Google Cloud
gcloud auth login

# 建立專案
gcloud projects create localite-ai-guide-[RANDOM_ID] \
  --name="在地人 AI 導覽系統"

# 設定為預設專案
gcloud config set project localite-ai-guide-[RANDOM_ID]
```

## 第二步：啟用必要的 API

### 2.1 透過 Console 啟用

前往 [API 程式庫](https://console.cloud.google.com/apis/library) 並搜尋以下 API 逐一啟用：

1. **Vertex AI API**
   - 搜尋: "Vertex AI API"
   - 點選「啟用」

2. **Cloud Translation API**
   - 搜尋: "Cloud Translation API"
   - 點選「啟用」

3. **Cloud Text-to-Speech API**
   - 搜尋: "Cloud Text-to-Speech API"
   - 點選「啟用」

4. **Cloud Storage API**
   - 搜尋: "Cloud Storage JSON API"
   - 點選「啟用」

5. **Firebase Admin SDK API**
   - 搜尋: "Firebase Admin SDK API"
   - 點選「啟用」

6. **Cloud Run Admin API**
   - 搜尋: "Cloud Run Admin API"
   - 點選「啟用」

### 2.2 透過 gcloud CLI 啟用

```bash
# 啟用所有必要的 API
gcloud services enable \
  aiplatform.googleapis.com \
  translate.googleapis.com \
  texttospeech.googleapis.com \
  storage.googleapis.com \
  firebase.googleapis.com \
  run.googleapis.com \
  cloudfunctions.googleapis.com \
  cloudresourcemanager.googleapis.com
```

## 第三步：建立和設定服務帳戶

### 3.1 建立服務帳戶

```bash
# 建立服務帳戶
gcloud iam service-accounts create localite-service-account \
  --description="在地人 AI 導覽系統服務帳戶" \
  --display-name="Localite Service Account"
```

### 3.2 設定 IAM 權限

```bash
# 取得專案 ID
PROJECT_ID=$(gcloud config get-value project)

# 授予必要權限
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:localite-service-account@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:localite-service-account@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/translate.editor"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:localite-service-account@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/texttospeech.synthesizer"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:localite-service-account@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/storage.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:localite-service-account@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/firebase.admin"
```

### 3.3 下載服務帳戶金鑰

```bash
# 建立金鑰並下載
gcloud iam service-accounts keys create ./apps/backend/config/service-account.json \
  --iam-account=localite-service-account@$PROJECT_ID.iam.gserviceaccount.com
```

## 第四步：建立 Cloud Storage Bucket

```bash
# 建立儲存桶
gsutil mb -p $PROJECT_ID -l asia-southeast1 gs://localite-storage-$PROJECT_ID

# 設定 CORS 政策
cat > cors.json << EOF
[
  {
    "origin": ["http://localhost:3000", "http://localhost:3001"],
    "method": ["GET", "POST", "PUT", "DELETE"],
    "responseHeader": ["Content-Type"],
    "maxAgeSeconds": 3600
  }
]
EOF

gsutil cors set cors.json gs://localite-storage-$PROJECT_ID
rm cors.json
```

## 第五步：取得專案資訊

執行以下指令取得重要資訊：

```bash
# 顯示專案 ID
echo "專案 ID: $(gcloud config get-value project)"

# 顯示服務帳戶 email
echo "服務帳戶 Email: localite-service-account@$(gcloud config get-value project).iam.gserviceaccount.com"

# 顯示儲存桶名稱
echo "儲存桶名稱: localite-storage-$(gcloud config get-value project)"
```

## 驗證設定

```bash
# 驗證 API 已啟用
gcloud services list --enabled --filter="name:(aiplatform OR translate OR texttospeech)"

# 驗證服務帳戶
gcloud iam service-accounts list --filter="email:localite-service-account*"

# 驗證儲存桶
gsutil ls -p $(gcloud config get-value project)
```

## 疑難排解

### 常見問題

1. **API 配額限制**
   - 檢查 [配額頁面](https://console.cloud.google.com/iam-admin/quotas)
   - 申請增加配額 (如果需要)

2. **權限問題**
   - 確保你的 Google 帳戶有專案擁有者或編輯者權限
   - 檢查服務帳戶是否有正確的 IAM 角色

3. **區域問題**
   - 確保所有服務都在相同或鄰近區域 (建議使用 asia-southeast1)

### 成本控制

1. 設定預算警示：
   ```bash
   # 建立預算 (需要透過 Console 設定)
   # 前往 https://console.cloud.google.com/billing/budgets
   ```

2. 監控使用量：
   - 定期檢查 [計費報告](https://console.cloud.google.com/billing)
   - 設定用量監控警示 