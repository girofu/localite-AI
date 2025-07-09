const GoogleAIService = require('./googleAIService');

// Mock the logger
jest.mock('../config/logger', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock the @google/generative-ai library
jest.mock('@google/generative-ai', () => {
  const mockGenerateContent = jest.fn();
  const mockGetGenerativeModel = jest.fn(() => ({
    generateContent: mockGenerateContent,
  }));
  const mockGoogleGenerativeAI = jest.fn(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  }));

  return {
    GoogleGenerativeAI: mockGoogleGenerativeAI,
    HarmCategory: {
      HARM_CATEGORY_HARASSMENT: 'HARASSMENT',
      HARM_CATEGORY_HATE_SPEECH: 'HATE_SPEECH',
    },
    HarmBlockThreshold: {
      BLOCK_MEDIUM_AND_ABOVE: 'BLOCK_MEDIUM_AND_ABOVE',
    },
    mockGetGenerativeModel,
    mockGenerateContent,
  };
});

const {
  GoogleGenerativeAI,
  mockGetGenerativeModel,
  mockGenerateContent,
} = require('@google/generative-ai');

describe('GoogleAIService', () => {
  const singleApiKey = 'test-api-key';
  const multipleApiKeys = ['key1', 'key2', 'key3'];

  beforeEach(() => {
    // Clear all instances and calls to constructor and all methods:
    GoogleGenerativeAI.mockClear();
    mockGetGenerativeModel.mockClear();
    mockGenerateContent.mockClear();

    // Clear environment variables
    delete process.env.GOOGLE_AI_API_KEY;
    delete process.env.GOOGLE_AI_API_KEY_1;
    delete process.env.GOOGLE_AI_API_KEY_2;
    delete process.env.GOOGLE_AI_API_KEYS;
  });

  describe('constructor', () => {
    it('should throw an error if no API keys are provided', () => {
      expect(() => new GoogleAIService()).toThrow('At least one Google AI API key is required.');
    });

    it('should initialize with a single API key', () => {
      const service = new GoogleAIService(singleApiKey, { enableAutoRotation: false });
      expect(service.apiKeys).toEqual([singleApiKey]);
      expect(GoogleGenerativeAI).toHaveBeenCalledWith(singleApiKey);
    });

    it('should initialize with multiple API keys from array', () => {
      const service = new GoogleAIService(multipleApiKeys, { enableAutoRotation: false });
      expect(service.apiKeys).toEqual(multipleApiKeys);
      expect(GoogleGenerativeAI).toHaveBeenCalledTimes(multipleApiKeys.length);
    });

    it('should load API keys from environment variables', () => {
      process.env.GOOGLE_AI_API_KEY = 'env-key-1';
      process.env.GOOGLE_AI_API_KEY_1 = 'env-key-2';
      process.env.GOOGLE_AI_API_KEY_2 = 'env-key-3';

      const service = new GoogleAIService(null, { enableAutoRotation: false });
      expect(service.apiKeys).toEqual(['env-key-1', 'env-key-2', 'env-key-3']);
    });

    it('should load API keys from comma-separated environment variable', () => {
      process.env.GOOGLE_AI_API_KEYS = 'key1,key2,key3';

      const service = new GoogleAIService(null, { enableAutoRotation: false });
      expect(service.apiKeys).toEqual(['key1', 'key2', 'key3']);
    });

    it('should remove duplicate API keys', () => {
      const keysWithDuplicates = ['key1', 'key2', 'key1', 'key3'];
      const service = new GoogleAIService(keysWithDuplicates, { enableAutoRotation: false });
      expect(service.apiKeys).toEqual(['key1', 'key2', 'key3']);
    });

    it('should initialize key statistics for all keys', () => {
      const service = new GoogleAIService(multipleApiKeys, { enableAutoRotation: false });
      expect(service.keyStats.size).toBe(multipleApiKeys.length);

      for (let i = 0; i < multipleApiKeys.length; i++) {
        const stats = service.keyStats.get(i);
        expect(stats).toEqual(
          expect.objectContaining({
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            status: 'active',
            consecutiveErrors: 0,
          })
        );
      }
    });
  });

  describe('API key rotation and failover', () => {
    let service;

    beforeEach(() => {
      service = new GoogleAIService(multipleApiKeys, { enableAutoRotation: false });
      mockGenerateContent.mockClear();
    });

    it('should rotate keys based on usage count (load balancing)', () => {
      // Mock successful responses
      const mockResponse = {
        response: {
          text: () => 'Mocked response',
        },
      };
      mockGenerateContent.mockResolvedValue(mockResponse);

      const usageCountBefore = service.keyStats.get(0).totalRequests;

      // Call generateContent - should use the key with least usage
      return service.generateContent('test prompt').then(() => {
        expect(service.keyStats.get(0).totalRequests).toBe(usageCountBefore + 1);
      });
    });

    it('should failover to next key when one fails', async () => {
      // Mock first key to fail, second to succeed
      mockGenerateContent
        .mockRejectedValueOnce(new Error('API quota exceeded'))
        .mockResolvedValueOnce({
          response: { text: () => 'Success from second key' },
        });

      const result = await service.generateContent('test prompt');
      expect(result).toBe('Success from second key');
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });

    it('should try all keys before giving up', async () => {
      // Mock all keys to fail
      mockGenerateContent.mockRejectedValue(new Error('All keys failed'));

      await expect(service.generateContent('test prompt')).rejects.toThrow(
        'Failed to generate content from Google AI after 3 attempts'
      );

      expect(mockGenerateContent).toHaveBeenCalledTimes(3);
    });

    it('should disable key after consecutive failures', async () => {
      // Mock key to fail 3 times consecutively
      mockGenerateContent.mockRejectedValue(new Error('Persistent error'));

      // Try 3 times to trigger the error threshold
      for (let i = 0; i < 3; i++) {
        try {
          await service.generateContent('test prompt');
        } catch (error) {
          // Expected to fail
        }
      }

      const stats = service.keyStats.get(0);
      expect(stats.status).toBe('error');
      expect(stats.consecutiveErrors).toBeGreaterThanOrEqual(3);
    });

    it('should recover disabled keys after recovery interval', () => {
      // Manually set a key to error state with past timestamp
      const stats = service.keyStats.get(0);
      stats.status = 'error';
      stats.lastUsed = Date.now() - 6 * 60 * 1000; // 6 minutes ago

      // Call the private method to test recovery
      service._attemptKeyRecovery();

      expect(stats.status).toBe('active');
      expect(stats.consecutiveErrors).toBe(0);
    });
  });

  describe('key management methods', () => {
    let service;

    beforeEach(() => {
      service = new GoogleAIService(['initial-key']);
    });

    describe('addApiKey', () => {
      it('should successfully add a valid API key', async () => {
        // Mock successful validation
        mockGenerateContent.mockResolvedValueOnce({
          response: { text: () => 'Validation success' },
        });

        const newIndex = await service.addApiKey('new-valid-key');

        expect(newIndex).toBe(1);
        expect(service.apiKeys).toContain('new-valid-key');
        expect(service.keyStats.has(1)).toBe(true);
        expect(service.keyClients.has(1)).toBe(true);
      });

      it('should reject invalid API key', async () => {
        // Mock validation failure
        mockGenerateContent.mockRejectedValueOnce(new Error('Invalid API key'));

        await expect(service.addApiKey('invalid-key')).rejects.toThrow('Invalid API key');
      });
    });

    describe('removeApiKey', () => {
      beforeEach(() => {
        service = new GoogleAIService(['key1', 'key2', 'key3']);
      });

      it('should successfully remove a key by index', () => {
        const initialLength = service.apiKeys.length;
        service.removeApiKey(1);

        expect(service.apiKeys.length).toBe(initialLength - 1);
        expect(service.apiKeys).not.toContain('key2');
      });

      it('should throw error when removing invalid index', () => {
        expect(() => service.removeApiKey(-1)).toThrow('Invalid key index');
        expect(() => service.removeApiKey(99)).toThrow('Invalid key index');
      });

      it('should throw error when trying to remove the last key', () => {
        const singleKeyService = new GoogleAIService(['only-key']);
        expect(() => singleKeyService.removeApiKey(0)).toThrow('Cannot remove the last API key');
      });

      it('should reindex remaining keys after removal', () => {
        service.removeApiKey(1); // Remove middle key

        // Verify that all remaining keys have sequential indices
        expect(service.keyClients.size).toBe(2);
        expect(service.keyStats.size).toBe(2);
        expect(service.keyClients.has(0)).toBe(true);
        expect(service.keyClients.has(1)).toBe(true);
        expect(service.keyClients.has(2)).toBe(false);
      });
    });

    describe('setKeyStatus', () => {
      beforeEach(() => {
        service = new GoogleAIService(['key1', 'key2']);
      });

      it('should successfully change key status', () => {
        service.setKeyStatus(0, 'disabled');
        expect(service.keyStats.get(0).status).toBe('disabled');
      });

      it('should throw error for invalid key index', () => {
        expect(() => service.setKeyStatus(-1, 'disabled')).toThrow('Invalid key index');
      });

      it('should throw error for invalid status', () => {
        expect(() => service.setKeyStatus(0, 'invalid-status')).toThrow(
          'Invalid status. Must be "active" or "disabled"'
        );
      });
    });
  });

  describe('statistics and monitoring', () => {
    let service;

    beforeEach(() => {
      service = new GoogleAIService(['key1', 'key2']);
    });

    it('should track request statistics correctly', async () => {
      // Mock successful response
      mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => 'Success' },
      });

      await service.generateContent('test prompt');

      const stats = service.keyStats.get(0);
      expect(stats.totalRequests).toBe(1);
      expect(stats.successfulRequests).toBe(1);
      expect(stats.failedRequests).toBe(0);
      expect(stats.lastUsed).toBeTruthy();
    });

    it('should track failure statistics correctly', async () => {
      // Mock failed response
      mockGenerateContent.mockRejectedValue(new Error('API Error'));

      try {
        await service.generateContent('test prompt');
      } catch (error) {
        // Expected to fail
      }

      const stats = service.keyStats.get(0);
      expect(stats.totalRequests).toBeGreaterThan(0);
      expect(stats.failedRequests).toBeGreaterThan(0);
      expect(stats.consecutiveErrors).toBeGreaterThan(0);
    });

    it('should provide comprehensive key statistics', () => {
      // Manually update some stats for testing
      const stats = service.keyStats.get(0);
      stats.totalRequests = 10;
      stats.successfulRequests = 8;
      stats.failedRequests = 2;

      const statistics = service.getKeyStatistics();

      expect(statistics).toHaveLength(2);
      expect(statistics[0]).toEqual(
        expect.objectContaining({
          index: 0,
          totalRequests: 10,
          successfulRequests: 8,
          failedRequests: 2,
          successRate: '80.00%',
        })
      );
    });

    it('should reset all statistics', () => {
      // Set some initial stats
      service.keyStats.get(0).totalRequests = 5;
      service.keyStats.get(0).failedRequests = 2;
      service.keyStats.get(1).totalRequests = 3;

      service.resetStatistics();

      // Verify all stats are reset
      for (const stats of service.keyStats.values()) {
        expect(stats.totalRequests).toBe(0);
        expect(stats.successfulRequests).toBe(0);
        expect(stats.failedRequests).toBe(0);
        expect(stats.consecutiveErrors).toBe(0);
      }
    });
  });

  describe('error handling and recovery', () => {
    let service;

    beforeEach(() => {
      service = new GoogleAIService(['key1', 'key2']);
    });

    it('should handle quota exceeded errors correctly', async () => {
      mockGenerateContent.mockRejectedValueOnce(new Error('quota exceeded'));

      try {
        await service.generateContent('test prompt');
      } catch (error) {
        // Expected to fail after trying all keys
      }

      const stats = service.keyStats.get(0);
      expect(stats.status).toBe('quota_exceeded');
    });

    it('should handle generic API errors', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Network error'));

      try {
        await service.generateContent('test prompt');
      } catch (error) {
        // Expected to fail
      }

      const stats = service.keyStats.get(0);
      expect(stats.lastError).toBe('Network error');
    });

    it('should recover from error state on successful request', async () => {
      // Create a service with single key for this test
      const singleKeyService = new GoogleAIService(['test-key']);

      // First, set key to error state
      const stats = singleKeyService.keyStats.get(0);
      stats.status = 'error';
      stats.consecutiveErrors = 2;

      // Mock successful response
      mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => 'Recovery success' },
      });

      await singleKeyService.generateContent('test prompt');

      expect(stats.status).toBe('active');
      expect(stats.consecutiveErrors).toBe(0);
    });
  });

  describe('generateContent with enhanced features', () => {
    let service;

    beforeEach(() => {
      service = new GoogleAIService(multipleApiKeys, { enableAutoRotation: false });
    });

    it('should respect maxRetries option', async () => {
      // Mock all keys to fail
      mockGenerateContent.mockRejectedValue(new Error('All keys failed'));

      const customRetries = 2;
      await expect(
        service.generateContent('test', { maxRetries: customRetries })
      ).rejects.toThrow();

      expect(mockGenerateContent).toHaveBeenCalledTimes(customRetries);
    });

    it('should use default maxRetries based on number of keys', async () => {
      // Mock all keys to fail
      mockGenerateContent.mockRejectedValue(new Error('All keys failed'));

      await expect(service.generateContent('test')).rejects.toThrow();

      expect(mockGenerateContent).toHaveBeenCalledTimes(multipleApiKeys.length);
    });

    it('should update rate limiting statistics', async () => {
      const mockResponse = {
        response: {
          text: () => 'Mocked response',
        },
      };
      mockGenerateContent.mockResolvedValue(mockResponse);

      await service.generateContent('test prompt');

      const stats = service.keyStats.get(0);
      expect(stats.rateLimit.requestsPerMinute).toBe(1);
    });
  });

  describe('Rate Limiting and Quota Management', () => {
    let service;

    beforeEach(() => {
      // 模擬 Redis 不可用，使用記憶體快取
      service = new GoogleAIService(multipleApiKeys, {
        useRedis: false,
        enableRateLimit: true,
        enableQuotaManagement: true,
      });
    });

    describe('Rate Limiting', () => {
      it('should enforce per-minute rate limits', async () => {
        // 模擬成功回應
        const mockResponse = {
          response: {
            text: () => 'Mocked response',
          },
        };
        mockGenerateContent.mockResolvedValue(mockResponse);

        // 建立服務時設定極低的速率限制
        const testService = new GoogleAIService(multipleApiKeys, {
          useRedis: false,
          enableRateLimit: true,
        });

        // 模擬速率限制檢查 - 第一次成功，之後所有金鑰都被限制
        const checkRateLimit = jest.spyOn(testService, '_checkRateLimit');
        checkRateLimit.mockResolvedValueOnce({ allowed: true, reason: null }).mockResolvedValue({
          allowed: false,
          reason: 'minute_rate_limit_exceeded',
          retryAfter: 60,
          current: 60,
          limit: 60,
        });

        // 第一次請求應該成功
        await testService.generateContent('test prompt 1');
        expect(mockGenerateContent).toHaveBeenCalledTimes(1);

        // 第二次請求應該被速率限制
        await expect(testService.generateContent('test prompt 2')).rejects.toThrow(
          'Rate limit exceeded'
        );

        const stats = testService.getRateLimitStatistics();
        expect(stats.rateLimitedRequests).toBeGreaterThan(0);
      });

      it('should enforce per-hour rate limits', async () => {
        const mockResponse = {
          response: {
            text: () => 'Mocked response',
          },
        };
        mockGenerateContent.mockResolvedValue(mockResponse);

        const testService = new GoogleAIService(multipleApiKeys, {
          useRedis: false,
          enableRateLimit: true,
        });

        const checkRateLimit = jest.spyOn(testService, '_checkRateLimit');
        checkRateLimit.mockResolvedValue({
          allowed: false,
          reason: 'hour_rate_limit_exceeded',
          retryAfter: 3600,
          current: 1000,
          limit: 1000,
        });

        await expect(testService.generateContent('test prompt')).rejects.toThrow(
          'Rate limit exceeded'
        );

        const stats = testService.getRateLimitStatistics();
        expect(stats.rateLimitedRequests).toBeGreaterThan(0);
      });

      it('should track rate limit statistics correctly', async () => {
        const stats = service.getRateLimitStatistics();

        expect(stats).toHaveProperty('totalRequests');
        expect(stats).toHaveProperty('rateLimitedRequests');
        expect(stats).toHaveProperty('quotaExceededRequests');
        expect(stats).toHaveProperty('config');
        expect(stats.config).toHaveProperty('requestsPerMinute');
        expect(stats.config).toHaveProperty('requestsPerHour');
      });

      it('should reset rate limit statistics', async () => {
        service.rateLimitStats.totalRequests = 10;
        service.rateLimitStats.rateLimitedRequests = 5;

        await service.resetRateLimitStatistics();

        const stats = service.getRateLimitStatistics();
        expect(stats.totalRequests).toBe(0);
        expect(stats.rateLimitedRequests).toBe(0);
      });

      it('should reset individual key rate limits', async () => {
        const keyIndex = 0;
        const stats = service.keyStats.get(keyIndex);

        // 模擬速率限制狀態
        stats.status = 'rate_limited';
        stats.rateLimit.requestsPerMinute = 60;

        await service.resetKeyRateLimit(keyIndex);

        expect(stats.status).toBe('active');
        expect(stats.rateLimit.requestsPerMinute).toBe(0);
      });
    });

    describe('Quota Management', () => {
      it('should enforce daily quota limits', async () => {
        const testService = new GoogleAIService(multipleApiKeys, {
          useRedis: false,
          enableQuotaManagement: true,
        });

        const checkQuotaLimit = jest.spyOn(testService, '_checkQuotaLimit');
        checkQuotaLimit.mockResolvedValue({
          allowed: false,
          reason: 'daily_quota_exceeded',
          current: 10000,
          limit: 10000,
        });

        await expect(testService.generateContent('test prompt')).rejects.toThrow('Quota exceeded');

        const stats = testService.getRateLimitStatistics();
        expect(stats.quotaExceededRequests).toBeGreaterThan(0);
      });

      it('should enforce monthly quota limits', async () => {
        const testService = new GoogleAIService(multipleApiKeys, {
          useRedis: false,
          enableQuotaManagement: true,
        });

        const checkQuotaLimit = jest.spyOn(testService, '_checkQuotaLimit');
        checkQuotaLimit.mockResolvedValue({
          allowed: false,
          reason: 'monthly_quota_exceeded',
          current: 100000,
          limit: 100000,
        });

        await expect(testService.generateContent('test prompt')).rejects.toThrow('Quota exceeded');

        const stats = testService.getRateLimitStatistics();
        expect(stats.quotaExceededRequests).toBeGreaterThan(0);
      });

      it('should track quota usage correctly', async () => {
        const mockResponse = {
          response: {
            text: () => 'Mocked response',
          },
        };
        mockGenerateContent.mockResolvedValue(mockResponse);

        // 模擬配額檢查通過
        const checkQuotaLimit = jest.spyOn(service, '_checkQuotaLimit');
        checkQuotaLimit.mockResolvedValue({ allowed: true, reason: null });

        await service.generateContent('test prompt');

        const stats = service.keyStats.get(0);
        expect(stats.quota.dailyUsage).toBe(1);
        expect(stats.quota.monthlyUsage).toBe(1);
      });

      it('should reset individual key quotas', async () => {
        const keyIndex = 0;
        const stats = service.keyStats.get(keyIndex);

        // 模擬配額超限狀態
        stats.status = 'quota_exceeded';
        stats.quota.dailyUsage = 10000;
        stats.quota.monthlyUsage = 50000;

        await service.resetKeyQuota(keyIndex);

        expect(stats.status).toBe('active');
        expect(stats.quota.dailyUsage).toBe(0);
        expect(stats.quota.monthlyUsage).toBe(0);
      });
    });

    describe('Enhanced Key Statistics', () => {
      it('should provide comprehensive key statistics with rate limit and quota info', () => {
        const stats = service.getKeyStatistics();

        expect(stats).toHaveLength(multipleApiKeys.length);

        for (const keyStat of stats) {
          expect(keyStat).toHaveProperty('rateLimit');
          expect(keyStat.rateLimit).toHaveProperty('requestsPerMinute');
          expect(keyStat.rateLimit).toHaveProperty('requestsPerHour');

          expect(keyStat).toHaveProperty('quota');
          expect(keyStat.quota).toHaveProperty('dailyUsage');
          expect(keyStat.quota).toHaveProperty('monthlyUsage');
          expect(keyStat.quota).toHaveProperty('dailyLimit');
          expect(keyStat.quota).toHaveProperty('monthlyLimit');
          expect(keyStat.quota).toHaveProperty('dailyRemaining');
          expect(keyStat.quota).toHaveProperty('monthlyRemaining');
        }
      });

      it('should get current rate limit status', async () => {
        const status = await service.getCurrentRateLimitStatus();

        expect(status).toHaveProperty('keys');
        expect(status).toHaveProperty('overall');
        expect(status.overall).toHaveProperty('totalRequests');
        expect(status.overall).toHaveProperty('availableKeys');
        expect(status.overall).toHaveProperty('rateLimitedKeys');
        expect(status.overall).toHaveProperty('quotaExceededKeys');

        expect(status.keys).toHaveLength(multipleApiKeys.length);

        for (const keyStatus of status.keys) {
          expect(keyStatus).toHaveProperty('rateLimit');
          expect(keyStatus).toHaveProperty('quota');
          expect(keyStatus.rateLimit).toHaveProperty('allowed');
          expect(keyStatus.quota).toHaveProperty('allowed');
        }
      });
    });

    describe('Configuration Management', () => {
      it('should get rate limit configuration', () => {
        const config = service.getRateLimitConfig();

        expect(config).toHaveProperty('requestsPerMinute');
        expect(config).toHaveProperty('requestsPerHour');
        expect(config).toHaveProperty('dailyQuota');
        expect(config).toHaveProperty('monthlyQuota');
        expect(config).toHaveProperty('options');
      });

      it('should update rate limit configuration', () => {
        const newConfig = {
          requestsPerMinute: 100,
          requestsPerHour: 2000,
          dailyQuota: 20000,
        };

        service.updateRateLimitConfig(newConfig);

        const config = service.getRateLimitConfig();
        expect(config.requestsPerMinute).toBe(100);
        expect(config.requestsPerHour).toBe(2000);
        expect(config.dailyQuota).toBe(20000);
      });
    });

    describe('Error Handling', () => {
      it('should handle Redis connection errors gracefully', async () => {
        const testService = new GoogleAIService(multipleApiKeys, {
          useRedis: true, // 啟用 Redis 但會失敗
          enableRateLimit: true,
        });

        // 模擬 Redis 錯誤
        const checkRateLimit = jest.spyOn(testService, '_checkRateLimit');
        checkRateLimit.mockRejectedValueOnce(new Error('Redis connection failed'));

        const mockResponse = {
          response: {
            text: () => 'Mocked response',
          },
        };
        mockGenerateContent.mockResolvedValue(mockResponse);

        // 即使 Redis 失敗，請求仍應該成功（graceful degradation）
        const result = await testService.generateContent('test prompt');
        expect(result).toBe('Mocked response');
      });

      it('should handle invalid key indices in rate limit operations', async () => {
        await expect(service.resetKeyRateLimit(-1)).rejects.toThrow('Invalid key index');
        await expect(service.resetKeyRateLimit(999)).rejects.toThrow('Invalid key index');

        await expect(service.resetKeyQuota(-1)).rejects.toThrow('Invalid key index');
        await expect(service.resetKeyQuota(999)).rejects.toThrow('Invalid key index');
      });
    });

    describe('Key Selection Strategy', () => {
      it('should prioritize active keys over rate limited keys', () => {
        const keyStats0 = service.keyStats.get(0);
        const keyStats1 = service.keyStats.get(1);

        // 將第一個金鑰設為速率限制狀態
        keyStats0.status = 'rate_limited';
        keyStats1.status = 'active';

        // 第二個金鑰使用次數更多，但狀態是活躍的
        keyStats1.totalRequests = 100;
        keyStats0.totalRequests = 10;

        const availableKeys = [0, 1];
        const selectedKey = service._selectKeyByStrategy(availableKeys);

        // 應該選擇活躍的金鑰而不是使用次數少的限制金鑰
        expect(selectedKey).toBe(1);
      });

      it('should select key with minimum requests when all keys have same status', () => {
        const keyStats0 = service.keyStats.get(0);
        const keyStats1 = service.keyStats.get(1);

        keyStats0.status = 'active';
        keyStats1.status = 'active';
        keyStats0.totalRequests = 10;
        keyStats1.totalRequests = 5;

        const availableKeys = [0, 1];
        const selectedKey = service._selectKeyByStrategy(availableKeys);

        expect(selectedKey).toBe(1); // 選擇使用次數較少的金鑰
      });
    });
  });

  describe('private methods', () => {
    let service;

    beforeEach(() => {
      service = new GoogleAIService(['key1', 'key2', 'key3']);
    });

    describe('_selectKeyByStrategy', () => {
      it('should select key with minimum requests', () => {
        // Set different usage counts
        service.keyStats.get(0).totalRequests = 5;
        service.keyStats.get(1).totalRequests = 2;
        service.keyStats.get(2).totalRequests = 8;

        const selectedKey = service._selectKeyByStrategy([0, 1, 2]);
        expect(selectedKey).toBe(1); // Key with minimum requests (2)
      });
    });

    describe('_getNextAvailableKey', () => {
      it('should return active keys only', () => {
        service.keyStats.get(0).status = 'disabled';
        service.keyStats.get(1).status = 'active';
        service.keyStats.get(2).status = 'error';

        const keyIndex = service._getNextAvailableKey();
        expect(keyIndex).toBe(1);
      });

      it('should throw error when no keys are available', () => {
        // Disable all keys - only 'disabled' status should be completely unusable
        service.keyStats.get(0).status = 'disabled';
        service.keyStats.get(1).status = 'disabled';
        service.keyStats.get(2).status = 'disabled';

        expect(() => service._getNextAvailableKey()).toThrow(
          'No available API keys. All keys are disabled or have errors.'
        );
      });
    });
  });
});
