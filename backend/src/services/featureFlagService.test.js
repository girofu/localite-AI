const FeatureFlagService = require('./featureFlagService');

// Mock cache service
class MockCacheService {
  constructor() {
    this.cache = new Map();
  }

  async get(key) {
    return this.cache.get(key) || null;
  }

  async set(key, value, ttl) {
    this.cache.set(key, value);
  }

  async delete(key) {
    return this.cache.delete(key);
  }
}

// Mock logger
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

describe('FeatureFlagService', () => {
  let featureFlagService;
  let mockCacheService;

  beforeEach(async () => {
    mockCacheService = new MockCacheService();
    featureFlagService = new FeatureFlagService(mockCacheService, mockLogger);
    await featureFlagService.initialize();

    // 清除 mock 呼叫記錄
    jest.clearAllMocks();
  });

  describe('初始化', () => {
    test('應該成功初始化服務', async () => {
      const newService = new FeatureFlagService(mockCacheService, mockLogger);
      await newService.initialize();

      expect(newService.initialized).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith('FeatureFlagService 初始化成功');
    });

    test('應該載入預設功能旗標', () => {
      const flags = featureFlagService.getAllFlags();

      expect(flags).toHaveProperty('ai_tour_generation');
      expect(flags).toHaveProperty('user_registration');
      expect(flags).toHaveProperty('merchant_dashboard');
      expect(flags).toHaveProperty('payment_integration');
    });

    test('避免重複初始化', async () => {
      // 再次初始化
      await featureFlagService.initialize();

      // 應該只有一次初始化日誌
      expect(mockLogger.info).not.toHaveBeenCalled();
    });
  });

  describe('功能旗標評估', () => {
    test('應該正確評估啟用的功能', async () => {
      const isEnabled = await featureFlagService.isEnabled('ai_tour_generation');
      expect(isEnabled).toBe(true);
    });

    test('應該正確評估停用的功能', async () => {
      const isEnabled = await featureFlagService.isEnabled('social_login');
      expect(isEnabled).toBe(false);
    });

    test('不存在的功能旗標應該返回 false', async () => {
      const isEnabled = await featureFlagService.isEnabled('non_existent_flag');
      expect(isEnabled).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith('功能旗標不存在: non_existent_flag');
    });

    test('應該根據環境判斷功能是否啟用', async () => {
      // 設定測試環境
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const isEnabled = await featureFlagService.isEnabled('social_login');
      expect(isEnabled).toBe(false); // social_login 只在 development 環境啟用

      // 恢復原始環境
      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('金絲雀部署邏輯', () => {
    test('應該根據百分比控制用戶訪問', async () => {
      // 測試語音合成功能（80% 開放）
      const testResults = [];

      // 測試多個用戶ID
      for (let i = 0; i < 100; i++) {
        const context = { userId: `user${i}` };
        const isEnabled = await featureFlagService.isEnabled('ai_voice_synthesis', context);
        testResults.push(isEnabled);
      }

      const enabledCount = testResults.filter(Boolean).length;
      // 80% 開放，應該大約有 80 個用戶能夠使用
      expect(enabledCount).toBeGreaterThan(70);
      expect(enabledCount).toBeLessThan(90);
    });

    test('相同用戶應該得到一致的結果', async () => {
      const context = { userId: 'test-user' };

      const result1 = await featureFlagService.isEnabled('ai_voice_synthesis', context);
      const result2 = await featureFlagService.isEnabled('ai_voice_synthesis', context);
      const result3 = await featureFlagService.isEnabled('ai_voice_synthesis', context);

      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
    });

    test('應該正確處理用戶群體限制', async () => {
      const betaContext = {
        userId: 'user1',
        userGroups: ['beta_testers'],
      };
      const normalContext = {
        userId: 'user2',
        userGroups: ['normal_users'],
      };

      // new_ui_design 只對 beta_testers 開放
      const betaResult = await featureFlagService.isEnabled('new_ui_design', betaContext);
      const normalResult = await featureFlagService.isEnabled('new_ui_design', normalContext);

      // beta_testers 可能有機會看到（基於百分比）
      // normal_users 絕對看不到
      expect(normalResult).toBe(false);
    });
  });

  describe('快取功能', () => {
    test('應該使用快取提升效能', async () => {
      // 第一次呼叫
      await featureFlagService.isEnabled('ai_tour_generation');

      // 模擬快取中有資料
      const cacheKey = 'feature_flag:ai_tour_generation';
      const cachedValue = mockCacheService.cache.get(cacheKey);
      expect(cachedValue).toBeDefined();

      // 第二次呼叫應該使用快取
      await featureFlagService.isEnabled('ai_tour_generation');

      // 驗證快取被使用
      expect(mockCacheService.cache.has(cacheKey)).toBe(true);
    });

    test('應該在更新旗標時清除快取', async () => {
      // 先觸發快取
      await featureFlagService.isEnabled('ai_tour_generation');

      // 更新旗標
      await featureFlagService.updateFlag('ai_tour_generation', { enabled: false });

      // 快取應該被清除（模擬清除效果）
      const cacheKey = 'feature_flag:ai_tour_generation';
      expect(mockCacheService.cache.has(cacheKey)).toBe(false);
    });
  });

  describe('CRUD 操作', () => {
    test('應該能夠創建新的功能旗標', async () => {
      const config = {
        enabled: true,
        rolloutPercentage: 50,
        environments: ['development', 'staging'],
        description: '測試功能',
      };

      await featureFlagService.createFlag('test_feature', config);

      const flags = featureFlagService.getAllFlags();
      expect(flags).toHaveProperty('test_feature');
      expect(flags.test_feature.enabled).toBe(true);
      expect(flags.test_feature.rolloutPercentage).toBe(50);
    });

    test('應該能夠更新現有的功能旗標', async () => {
      await featureFlagService.updateFlag('ai_tour_generation', {
        rolloutPercentage: 90,
      });

      const flags = featureFlagService.getAllFlags();
      expect(flags.ai_tour_generation.rolloutPercentage).toBe(90);
    });

    test('更新不存在的旗標應該拋出錯誤', async () => {
      await expect(
        featureFlagService.updateFlag('non_existent', { enabled: true }),
      ).rejects.toThrow('功能旗標不存在: non_existent');
    });

    test('應該能夠刪除功能旗標', async () => {
      await featureFlagService.createFlag('temp_feature', { enabled: true });
      await featureFlagService.deleteFlag('temp_feature');

      const flags = featureFlagService.getAllFlags();
      expect(flags).not.toHaveProperty('temp_feature');
    });

    test('刪除不存在的旗標應該拋出錯誤', async () => {
      await expect(featureFlagService.deleteFlag('non_existent')).rejects.toThrow(
        '功能旗標不存在: non_existent',
      );
    });
  });

  describe('統計功能', () => {
    test('應該返回正確的統計資訊', () => {
      const stats = featureFlagService.getStats();

      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('enabled');
      expect(stats).toHaveProperty('disabled');
      expect(stats).toHaveProperty('canaryDeployment');

      expect(stats.total).toBeGreaterThan(0);
      expect(stats.enabled + stats.disabled).toBe(stats.total);
    });
  });

  describe('錯誤處理', () => {
    test('快取錯誤不應該影響功能旗標評估', async () => {
      // 模擬快取錯誤
      const errorCacheService = {
        get: jest.fn().mockRejectedValue(new Error('Cache error')),
        set: jest.fn().mockRejectedValue(new Error('Cache error')),
        delete: jest.fn().mockRejectedValue(new Error('Cache error')),
      };

      const serviceWithErrorCache = new FeatureFlagService(errorCacheService, mockLogger);
      await serviceWithErrorCache.initialize();

      // 應該仍然能夠評估功能旗標
      const isEnabled = await serviceWithErrorCache.isEnabled('ai_tour_generation');
      expect(isEnabled).toBe(true);
    });

    test('評估錯誤應該記錄日誌並返回 false', async () => {
      // 模擬評估過程中的錯誤
      const originalEvaluateFlag = featureFlagService.evaluateFlag;
      featureFlagService.evaluateFlag = jest.fn().mockImplementation(() => {
        throw new Error('Evaluation error');
      });

      const isEnabled = await featureFlagService.isEnabled('ai_tour_generation');

      expect(isEnabled).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        '評估功能旗標失敗 ai_tour_generation:',
        'Evaluation error',
      );

      // 恢復原始方法
      featureFlagService.evaluateFlag = originalEvaluateFlag;
    });
  });

  describe('用戶哈希值計算', () => {
    test('相同用戶ID應該產生相同哈希值', () => {
      const hash1 = featureFlagService.getUserHash('user123');
      const hash2 = featureFlagService.getUserHash('user123');

      expect(hash1).toBe(hash2);
    });

    test('不同用戶ID應該產生不同哈希值', () => {
      const hash1 = featureFlagService.getUserHash('user123');
      const hash2 = featureFlagService.getUserHash('user456');

      expect(hash1).not.toBe(hash2);
    });

    test('哈希值應該在有效範圍內', () => {
      const hash = featureFlagService.getUserHash('testuser');

      expect(hash).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(hash)).toBe(true);
    });
  });
});
