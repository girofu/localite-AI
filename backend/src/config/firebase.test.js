const { firebaseConfig, getAuth, validateConfig } = require("./firebase");

// Mock Firebase Admin
jest.mock("firebase-admin", () => ({
  apps: [],
  initializeApp: jest.fn(),
  credential: {
    cert: jest.fn(),
  },
  auth: jest.fn(() => ({
    listUsers: jest.fn().mockResolvedValue({ users: [] }),
  })),
}));

// Mock logger
jest.mock("../middleware/requestLogger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe("Firebase Configuration", () => {
  beforeEach(() => {
    // 清理環境變數
    delete process.env.FIREBASE_ADMIN_SDK_KEY;
    delete process.env.FIREBASE_PRIVATE_KEY;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PROJECT_ID;

    // 重置 Firebase config
    firebaseConfig.initialized = false;
    firebaseConfig.admin = null;
  });

  describe("getServiceAccountConfig", () => {
    test("應該從 FIREBASE_ADMIN_SDK_KEY 環境變數讀取配置", () => {
      const mockConfig = {
        type: "service_account",
        project_id: "test-project",
        private_key: "test-key",
      };

      process.env.FIREBASE_ADMIN_SDK_KEY = JSON.stringify(mockConfig);

      const config = firebaseConfig.getServiceAccountConfig();
      expect(config).toEqual(mockConfig);
    });

    test("應該從分散的環境變數構建配置", () => {
      process.env.FIREBASE_PROJECT_ID = "test-project";
      process.env.FIREBASE_PRIVATE_KEY = "test-private-key";
      process.env.FIREBASE_CLIENT_EMAIL = "test@test.com";
      process.env.FIREBASE_PRIVATE_KEY_ID = "test-key-id";
      process.env.FIREBASE_CLIENT_ID = "test-client-id";

      const config = firebaseConfig.getServiceAccountConfig();

      expect(config.type).toBe("service_account");
      expect(config.project_id).toBe("test-project");
      expect(config.private_key).toBe("test-private-key");
      expect(config.client_email).toBe("test@test.com");
    });

    test("當沒有配置時應該拋出錯誤", () => {
      expect(() => {
        firebaseConfig.getServiceAccountConfig();
      }).toThrow("無法載入 Firebase 服務帳戶配置");
    });
  });

  describe("initialize", () => {
    test("應該成功初始化 Firebase Admin SDK", () => {
      process.env.FIREBASE_ADMIN_SDK_KEY = JSON.stringify({
        type: "service_account",
        project_id: "test-project",
        private_key: "test-key",
        client_email: "test@test.com",
      });

      const admin = firebaseConfig.initialize();

      expect(admin).toBeDefined();
      expect(firebaseConfig.initialized).toBe(true);
    });

    test("應該返回現有實例如果已經初始化", () => {
      firebaseConfig.initialized = true;
      firebaseConfig.admin = { test: "mock-admin" };

      const admin = firebaseConfig.initialize();

      expect(admin).toEqual({ test: "mock-admin" });
    });
  });

  describe("服務方法", () => {
    beforeEach(() => {
      process.env.FIREBASE_ADMIN_SDK_KEY = JSON.stringify({
        type: "service_account",
        project_id: "test-project",
        private_key: "test-key",
        client_email: "test@test.com",
      });
    });

    test("getAuth 應該返回認證服務", () => {
      const auth = getAuth();
      expect(auth).toBeDefined();
    });

    test("validateConfig 應該驗證配置", async () => {
      const isValid = await validateConfig();
      expect(typeof isValid).toBe("boolean");
    });
  });

  describe("錯誤處理", () => {
    test("當 FIREBASE_ADMIN_SDK_KEY 格式錯誤時應該嘗試其他方法", () => {
      process.env.FIREBASE_ADMIN_SDK_KEY = "invalid-json";
      process.env.FIREBASE_PRIVATE_KEY = "test-key";
      process.env.FIREBASE_CLIENT_EMAIL = "test@test.com";
      process.env.FIREBASE_PROJECT_ID = "test-project";

      const config = firebaseConfig.getServiceAccountConfig();
      expect(config.type).toBe("service_account");
    });
  });
});
