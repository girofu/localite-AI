const admin = require("firebase-admin");
const { logger } = require("../middleware/requestLogger");

/**
 * Firebase Admin 配置初始化
 * 支援多種環境配置方式：
 * 1. 生產環境：從環境變數讀取 JSON 字串
 * 2. 開發環境：從 JSON 檔案讀取或環境變數
 */
class FirebaseConfig {
  constructor() {
    this.admin = null;
    this.initialized = false;
  }

  /**
   * 初始化 Firebase Admin SDK
   */
  initialize() {
    if (this.initialized) {
      return this.admin;
    }

    try {
      // 檢查是否已經有 Firebase 應用實例
      if (admin.apps.length > 0) {
        this.admin = admin;
        this.initialized = true;
        logger.info("Firebase Admin SDK 已經初始化，使用現有實例");
        return this.admin;
      }

      const serviceAccount = this.getServiceAccountConfig();

      // 初始化 Firebase Admin
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId:
          process.env.FIREBASE_PROJECT_ID ||
          process.env.GOOGLE_CLOUD_PROJECT_ID,
        storageBucket: process.env.GOOGLE_CLOUD_STORAGE_BUCKET,
      });

      this.admin = admin;
      this.initialized = true;

      logger.info("Firebase Admin SDK 初始化成功", {
        projectId:
          process.env.FIREBASE_PROJECT_ID ||
          process.env.GOOGLE_CLOUD_PROJECT_ID,
        hasStorageBucket: !!process.env.GOOGLE_CLOUD_STORAGE_BUCKET,
      });

      return this.admin;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "未知錯誤";
      logger.error("Firebase Admin SDK 初始化失敗", {
        error: errorMessage,
        projectId: process.env.FIREBASE_PROJECT_ID,
        hasPrivateKey: !!process.env.FIREBASE_PRIVATE_KEY,
      });
      throw new Error(`Firebase 初始化失敗: ${errorMessage}`);
    }
  }

  /**
   * 獲取服務帳戶配置
   * 優先級：環境變數 > JSON 檔案
   */
  getServiceAccountConfig() {
    // 方法 1: 從環境變數讀取完整的 JSON 字串（生產環境推薦）
    if (process.env.FIREBASE_ADMIN_SDK_KEY) {
      try {
        return JSON.parse(process.env.FIREBASE_ADMIN_SDK_KEY);
      } catch (error) {
        logger.warn("FIREBASE_ADMIN_SDK_KEY 格式錯誤，嘗試其他配置方式");
      }
    }

    // 方法 2: 從分散的環境變數構建配置物件
    if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
      return {
        type: "service_account",
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri:
          process.env.FIREBASE_AUTH_URI ||
          "https://accounts.google.com/oauth2/auth",
        token_uri:
          process.env.FIREBASE_TOKEN_URI ||
          "https://oauth2.googleapis.com/token",
        auth_provider_x509_cert_url:
          "https://www.googleapis.com/oauth2/v1/certs",
        client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(
          process.env.FIREBASE_CLIENT_EMAIL
        )}`,
      };
    }

    // 方法 3: 從 JSON 檔案讀取（開發環境）
    if (process.env.GOOGLE_CLOUD_KEY_FILE) {
      try {
        return require(process.env.GOOGLE_CLOUD_KEY_FILE);
      } catch (error) {
        logger.warn("無法從檔案載入 Firebase 配置", {
          file: process.env.GOOGLE_CLOUD_KEY_FILE,
        });
      }
    }

    // 開發環境預設路徑
    const defaultPaths = [
      "../../config/firebase-service-account.json",
      "../../../config/firebase-service-account.json",
    ];

    for (const path of defaultPaths) {
      try {
        return require(path);
      } catch (error) {
        // 繼續嘗試下一個路徑
      }
    }

    throw new Error("無法載入 Firebase 服務帳戶配置，請檢查環境變數或配置檔案");
  }

  /**
   * 獲取 Firebase Admin 實例
   */
  getAdmin() {
    if (!this.initialized) {
      return this.initialize();
    }
    return this.admin;
  }

  /**
   * 獲取 Authentication 服務
   */
  getAuth() {
    const admin = this.getAdmin();
    return admin.auth();
  }

  /**
   * 獲取 Firestore 服務
   */
  getFirestore() {
    const admin = this.getAdmin();
    return admin.firestore();
  }

  /**
   * 獲取 Storage 服務
   */
  getStorage() {
    const admin = this.getAdmin();
    return admin.storage();
  }

  /**
   * 獲取 Cloud Messaging 服務
   */
  getMessaging() {
    const admin = this.getAdmin();
    return admin.messaging();
  }

  /**
   * 驗證 Firebase 配置是否正確
   */
  async validateConfig() {
    try {
      const admin = this.getAdmin();
      const auth = admin.auth();

      // 嘗試獲取用戶列表來驗證配置
      await auth.listUsers(1);

      logger.info("Firebase 配置驗證成功");
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "未知錯誤";
      logger.error("Firebase 配置驗證失敗", { error: errorMessage });
      return false;
    }
  }

  /**
   * 清理資源
   */
  async cleanup() {
    try {
      if (this.initialized && this.admin) {
        await Promise.all(this.admin.apps.map((app) => app.delete()));
        this.initialized = false;
        this.admin = null;
        logger.info("Firebase Admin SDK 資源清理完成");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "未知錯誤";
      logger.error("Firebase 資源清理失敗", { error: errorMessage });
    }
  }
}

// 建立單例實例
const firebaseConfig = new FirebaseConfig();

// 導出常用的服務實例
module.exports = {
  firebaseConfig,
  getAuth: () => firebaseConfig.getAuth(),
  getFirestore: () => firebaseConfig.getFirestore(),
  getStorage: () => firebaseConfig.getStorage(),
  getMessaging: () => firebaseConfig.getMessaging(),
  validateConfig: () => firebaseConfig.validateConfig(),
  cleanup: () => firebaseConfig.cleanup(),
};
