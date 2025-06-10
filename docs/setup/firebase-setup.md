# Firebase 設定指南

## 第一步：建立 Firebase 專案

### 1.1 透過 Firebase Console

1. 前往 [Firebase Console](https://console.firebase.google.com/)
2. 點選「建立專案」
3. 選擇現有的 Google Cloud 專案：
   - 選擇剛才建立的 `localite-ai-guide-[ID]` 專案
   - 點選「繼續」
4. 設定 Google Analytics：
   - 啟用 Google Analytics (建議)
   - 選擇或建立 Analytics 帳戶
   - 點選「建立專案」

## 第二步：設定 Firebase Authentication

### 2.1 啟用 Authentication

1. 在 Firebase Console 左側選單點選「Authentication」
2. 點選「開始使用」
3. 前往「Sign-in method」分頁
4. 啟用以下登入方式：

#### Google 登入

1. 點選「Google」
2. 切換「啟用」開關
3. 設定專案公開名稱：`在地人 AI 導覽系統`
4. 選擇專案支援電子郵件
5. 點選「儲存」

#### Email/Password 登入

1. 點選「電子郵件/密碼」
2. 啟用「電子郵件/密碼」
3. 啟用「電子郵件連結 (無密碼登入)」(可選)
4. 點選「儲存」

### 2.2 設定授權網域

1. 在 Authentication 頁面前往「Settings」
2. 找到「授權網域」區塊
3. 新增以下網域：
   - `localhost` (開發用)
   - `your-domain.com` (生產環境，之後替換)

## 第三步：新增應用程式

### 3.1 新增 Web 應用程式

1. 在專案概覽頁面點選「</>」(Web 圖示)
2. 填寫應用程式資訊：
   - **應用程式暱稱**: `Localite Web`
   - 可選擇是否「設定 Firebase Hosting」(建議勾選)
3. 點選「註冊應用程式」
4. **重要**: 複製 Firebase 配置物件，格式如下：

```javascript
const firebaseConfig = {
  apiKey: 'AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  authDomain: 'your-project.firebaseapp.com',
  projectId: 'your-project-id',
  storageBucket: 'your-project.appspot.com',
  messagingSenderId: '123456789012',
  appId: '1:123456789012:web:abcdef123456789',
  measurementId: 'G-XXXXXXXXXX'
};
```

5. 依照指示將 Firebase SDK 加入你的 Web 應用程式
6. 點選「繼續前往主控台」

### 3.2 新增 iOS 應用程式

1. 在專案概覽頁面點選「新增應用程式」→ iOS 圖示
2. 填寫應用程式資訊：
   - **iOS 套件 ID**: `com.localite.guide.ios`
   - **應用程式暱稱**: `Localite iOS` (可選)
   - **App Store ID**: (可選，之後可在設定中新增)
3. 點選「註冊應用程式」
4. **下載配置檔案**: 下載 `GoogleService-Info.plist` 檔案
5. 將檔案加入你的 Xcode 專案
6. 依照指示加入 Firebase SDK
7. 點選「繼續前往主控台」

### 3.3 新增 Android 應用程式

1. 在專案概覽頁面點選「新增應用程式」→ Android 圖示
2. 填寫應用程式資訊：
   - **Android 套件名稱**: `com.localite.guide.android`
   - **應用程式暱稱**: `Localite Android` (可選)
   - **偵錯簽署憑證 SHA-1**: (可選，開發用)
3. 點選「註冊應用程式」
4. **下載配置檔案**: 下載 `google-services.json` 檔案
5. 將檔案放入你的 Android 專案的 `app/` 目錄
6. 依照指示加入 Firebase SDK 與 Gradle 外掛程式
7. 點選「繼續前往主控台」

## 第四步：設定 Firebase Cloud Messaging (FCM)

### 4.1 存取 Cloud Messaging 設定

1. 在 Firebase Console 左側選單點選「Engage」→「Messaging」
2. 如果是第一次使用，會看到歡迎頁面，點選「開始使用」
3. 或直接前往「專案設定」(齒輪圖示) → 「Cloud Messaging」分頁

### 4.2 設定 Apple Push Notification (僅限 iOS)

**僅在有 iOS 應用程式時需要，且必須先完成步驟 3.2**

#### 方法一：使用 APNs 驗證金鑰 (推薦)

1. **在 Apple Developer 建立 APNs 金鑰**：

   - 前往
     [Apple Developer Console](https://developer.apple.com/account/resources/authkeys/list)
   - 點選「Keys」→「建立新金鑰」
   - 勾選「Apple Push Notifications service (APNs)」
   - 下載 `.p8` 金鑰檔案並記錄金鑰 ID

2. **在 Firebase Console 上傳金鑰**：
   - 前往「專案設定」→「Cloud Messaging」分頁
   - 找到你的 iOS 應用程式區塊
   - 在「APNs 驗證金鑰」區塊點選「上傳」
   - 上傳 `.p8` 檔案
   - 輸入**金鑰 ID** (10 位字元)
   - 輸入**團隊 ID** (可在 Apple Developer 的 Membership 頁面找到)
   - 點選「上傳」

#### 方法二：使用 APNs 憑證 (傳統方式)

1. **在 Apple Developer 建立推播憑證**：

   - 前往「Certificates」→「建立新憑證」
   - 選擇「Apple Push Notification service SSL」
   - 下載 `.cer` 憑證檔案

2. **轉換為 .p12 格式**：

   - 雙擊 `.cer` 檔案匯入 Keychain
   - 在 Keychain 中找到憑證，右鍵「匯出」
   - 儲存為 `.p12` 格式並設定密碼

3. **在 Firebase Console 上傳憑證**：
   - 在「APNs 憑證」區塊點選「上傳」
   - 上傳 `.p12` 檔案並輸入密碼

### 4.3 設定 Web 推播通知 (僅限 Web)

**僅在有 Web 應用程式時需要，且必須先完成步驟 3.1**

#### 產生 VAPID 金鑰組

1. 前往「專案設定」→「Cloud Messaging」分頁
2. 捲動到「Web 設定」區塊
3. 在「Web 推播憑證」區塊：
   - 點選「產生金鑰組」
   - 系統會產生一組 VAPID 金鑰
   - **重要**：複製「金鑰組」(以 `B` 開頭的長字串)
   - 將此金鑰儲存到安全位置，稍後會用到

#### 設定服務工作程式 (Service Worker)

Web 推播還需要在專案中設定 Service Worker：

```javascript
// public/firebase-messaging-sw.js
importScripts(
  'https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js'
);
importScripts(
  'https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js'
);

const firebaseConfig = {
  // 你的 Firebase 配置
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/firebase-logo.png'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
```

### 4.4 設定 Android 推播通知 (僅限 Android)

**僅在有 Android 應用程式時需要，且必須先完成步驟 3.3**

Android FCM 設定相對簡單：

1. **確認 google-services.json 已正確放置**：

   - 檔案應該在 `android/app/` 目錄下
   - 確認檔案包含正確的專案資訊

2. **自動配置**：

   - FCM 會自動使用 Google 服務進行推播
   - 不需要額外的金鑰或憑證設定

3. **測試連線**：
   - 在 Android Studio 中建置專案
   - 確認沒有 Firebase 相關錯誤

### 4.5 驗證 FCM 設定

完成上述設定後，可以進行驗證：

1. **檢查設定狀態**：

   - 前往「專案設定」→「Cloud Messaging」
   - 確認所有平台都顯示「已設定」狀態

2. **測試推播** (可選)：
   - 前往「Messaging」→「建立第一個廣告活動」
   - 選擇「Firebase 通知訊息」
   - 設定標題和內容
   - 選擇目標平台進行測試

### 4.6 取得重要配置資訊

設定完成後，記錄以下資訊：

**Web 應用程式**：

- VAPID 金鑰 (用於前端 Web 推播)
- 服務工作程式已建立

**iOS 應用程式**：

- APNs 金鑰 ID 和團隊 ID (如使用金鑰)
- 或憑證已上傳 (如使用憑證)

**Android 應用程式**：

- google-services.json 已配置
- 專案可正常建置

## 第五步：設定 Firestore Database

### 5.1 建立 Firestore 資料庫

1. 在左側選單點選「Firestore Database」
2. 點選「建立資料庫」
3. 選擇安全性規則：
   - 選擇「以測試模式開始」(開發階段)
   - 點選「下一步」
4. 選擇位置：
   - 選擇 `asia-southeast1` (Singapore)
   - 點選「完成」

### 5.2 設定安全性規則 (開發用)

在 Firestore 的「規則」分頁中，暫時使用以下規則：

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 開發階段：允許已驗證使用者讀寫所有文件
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

## 第六步：取得配置資訊

### 6.1 收集 Web 配置

從步驟 3.1 複製的配置中提取以下資訊：

- `apiKey`: Firebase API 金鑰
- `authDomain`: 驗證網域
- `projectId`: 專案 ID
- `storageBucket`: 儲存桶
- `messagingSenderId`: FCM 傳送者 ID
- `appId`: Web 應用程式 ID
- `measurementId`: Google Analytics 測量 ID (如有啟用 Analytics)

### 6.2 收集推播通知配置

從步驟 4.6 收集的配置資訊：

**Web 推播配置**：

- **VAPID 金鑰**: 從步驟 4.3 取得 (以 `B` 開頭的字串)
- **服務工作程式**: firebase-messaging-sw.js 已建立

**iOS 推播配置** (如有設定)：

- **APNs 金鑰 ID**: 10 位字元的金鑰 ID
- **APNs 團隊 ID**: Apple Developer 團隊 ID
- **金鑰檔案**: .p8 金鑰檔案已上傳

**Android 推播配置** (如有設定)：

- **配置檔案**: google-services.json 已正確放置
- **FCM 整合**: 自動配置完成

### 6.3 收集應用程式 ID

這些資訊可在專案設定中的「一般」分頁找到：

- iOS App ID: `1:123456789012:ios:abcdef123456789`
- Android App ID: `1:123456789012:android:abcdef123456789`

## 第七步：設定 Firebase Admin SDK

### 7.1 建立服務帳戶金鑰 (如果還沒有)

如果你在 Google Cloud 設定中還沒建立服務帳戶：

```bash
# 建立 Firebase Admin 服務帳戶
gcloud iam service-accounts create firebase-admin-localite \
  --description="Firebase Admin SDK 服務帳戶" \
  --display-name="Firebase Admin Localite"

# 授予 Firebase Admin 權限
PROJECT_ID=$(gcloud config get-value project)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:firebase-admin-localite@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/firebase.admin"

# 下載金鑰
gcloud iam service-accounts keys create ./apps/backend/config/firebase-admin.json \
  --iam-account=firebase-admin-localite@$PROJECT_ID.iam.gserviceaccount.com
```

## 第八步：驗證設定

### 8.1 測試 Authentication

1. 前往 Firebase Console 的 Authentication
2. 點選「使用者」分頁
3. 可以手動新增測試使用者

### 8.2 測試 Firestore

1. 前往 Firestore Database
2. 點選「開始收集」
3. 建立測試集合：`test`
4. 新增文件測試寫入功能

### 8.3 測試 Cloud Messaging (可選)

1. 前往 Cloud Messaging
2. 點選「建立您的第一個廣告活動」
3. 選擇「Firebase 通知訊息」
4. 設定測試訊息並傳送給測試應用程式

## 常見問題

### 1. 權限錯誤

確保你的 Google 帳戶具有：

- Firebase 專案的擁有者或編輯者權限
- Google Cloud 專案的適當權限

### 2. 配額限制

免費方案限制：

- Firestore: 50K 讀取/日、20K 寫入/日
- FCM: 無限制
- Authentication: 無限制

### 3. 區域設定

確保所有服務都在相同區域：

- Firestore: `asia-southeast1`
- Cloud Functions: `asia-southeast1`
- Cloud Storage: `asia-southeast1`

## 下一步

完成設定後，你將獲得以下配置資訊：

1. **Web 應用配置**: Firebase 配置物件
2. **行動應用配置**: iOS 和 Android App ID
3. **服務帳戶金鑰**: Firebase Admin SDK 金鑰檔案
4. **FCM 金鑰**: Web 推播憑證

這些資訊將用於更新專案的環境變數檔案。
