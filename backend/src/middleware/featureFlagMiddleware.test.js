const {
  FeatureFlagMiddleware,
  getFeatureFlagMiddleware,
  requireFeature,
  requireFeatures,
  checkFeatures,
} = require('./featureFlagMiddleware');

// Mock FeatureFlagService
jest.mock('../services/featureFlagService');
const FeatureFlagService = require('../services/featureFlagService');

// Mock cache service
const mockCacheService = {
  get: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
};

// Mock logger
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Mock request and response objects
const createMockRequest = (overrides = {}) => ({
  user: null,
  headers: {},
  ip: '127.0.0.1',
  connection: { remoteAddress: '127.0.0.1' },
  get: jest.fn(header => {
    if (header === 'User-Agent') return 'test-agent';
    return null;
  }),
  featureFlags: {},
  ...overrides,
});

const createMockResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('FeatureFlagMiddleware', () => {
  let middleware;
  let mockService;

  beforeEach(() => {
    jest.clearAllMocks();

    // 創建 mock service 實例
    mockService = {
      initialize: jest.fn().mockResolvedValue(),
      isEnabled: jest.fn(),
      getAllFlags: jest.fn(),
      getStats: jest.fn(),
      createFlag: jest.fn(),
      updateFlag: jest.fn(),
      deleteFlag: jest.fn(),
    };

    // Mock FeatureFlagService constructor
    FeatureFlagService.mockImplementation(() => mockService);

    middleware = new FeatureFlagMiddleware(mockCacheService, mockLogger);
  });

  describe('初始化', () => {
    test('應該正確初始化中間件', async () => {
      await middleware.initialize();

      expect(middleware.initialized).toBe(true);
      expect(mockService.initialize).toHaveBeenCalled();
    });

    test('避免重複初始化', async () => {
      await middleware.initialize();
      await middleware.initialize();

      expect(mockService.initialize).toHaveBeenCalledTimes(1);
    });
  });

  describe('用戶上下文提取', () => {
    test('應該從請求中提取基本上下文', () => {
      const req = createMockRequest();
      const context = middleware.extractUserContext(req);

      expect(context).toMatchObject({
        userId: null,
        userGroups: [],
        environment: 'test', // Jest 設定的 NODE_ENV
        userAgent: 'test-agent',
        ip: '127.0.0.1',
      });
    });

    test('應該從 Firebase 用戶中提取資訊', () => {
      const req = createMockRequest({
        user: {
          uid: 'test-user-123',
          email: 'test@example.com',
          custom_claims: {
            role: 'user',
            groups: ['beta_testers'],
          },
        },
      });

      const context = middleware.extractUserContext(req);

      expect(context.userId).toBe('test-user-123');
      expect(context.email).toBe('test@example.com');
      expect(context.role).toBe('user');
      expect(context.userGroups).toEqual(['beta_testers']);
    });

    test('應該從請求標頭中提取額外資訊', () => {
      const req = createMockRequest({
        headers: {
          'x-user-groups': 'admin,power_user',
          'x-user-region': 'asia-pacific',
        },
      });

      const context = middleware.extractUserContext(req);

      expect(context.userGroups).toEqual(['admin', 'power_user']);
      expect(context.region).toBe('asia-pacific');
    });
  });

  describe('requireFeature 中間件', () => {
    test('功能啟用時應該允許請求繼續', async () => {
      mockService.isEnabled.mockResolvedValue(true);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      const middlewareFunc = middleware.requireFeature('test_feature');
      await middlewareFunc(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.featureFlags.test_feature).toBe(true);
      expect(res.status).not.toHaveBeenCalled();
    });

    test('功能停用時應該返回 403 錯誤', async () => {
      mockService.isEnabled.mockResolvedValue(false);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      const middlewareFunc = middleware.requireFeature('test_feature');
      await middlewareFunc(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: '功能 test_feature 目前未開放',
        feature: 'test_feature',
        enabled: false,
      });
    });

    test('應該支援自定義錯誤訊息和代碼', async () => {
      mockService.isEnabled.mockResolvedValue(false);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      const middlewareFunc = middleware.requireFeature('test_feature', {
        errorMessage: '自定義錯誤訊息',
        errorCode: 404,
      });
      await middlewareFunc(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: '自定義錯誤訊息',
        feature: 'test_feature',
        enabled: false,
      });
    });

    test('錯誤時應該返回 500 狀態', async () => {
      mockService.isEnabled.mockRejectedValue(new Error('Service error'));

      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      const middlewareFunc = middleware.requireFeature('test_feature');
      await middlewareFunc(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('requireFeatures 中間件', () => {
    test('requireAll 模式：所有功能都啟用時應該允許', async () => {
      mockService.isEnabled.mockResolvedValueOnce(true).mockResolvedValueOnce(true);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      const middlewareFunc = middleware.requireFeatures(['feature1', 'feature2'], {
        requireAll: true,
      });
      await middlewareFunc(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.featureFlags).toEqual({
        feature1: true,
        feature2: true,
      });
    });

    test('requireAll 模式：部分功能停用時應該拒絕', async () => {
      mockService.isEnabled.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      const middlewareFunc = middleware.requireFeatures(['feature1', 'feature2'], {
        requireAll: true,
      });
      await middlewareFunc(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('requireAny 模式：至少一個功能啟用時應該允許', async () => {
      mockService.isEnabled.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      const middlewareFunc = middleware.requireFeatures(['feature1', 'feature2'], {
        requireAny: true,
      });
      await middlewareFunc(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    test('requireAny 模式：所有功能都停用時應該拒絕', async () => {
      mockService.isEnabled.mockResolvedValueOnce(false).mockResolvedValueOnce(false);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      const middlewareFunc = middleware.requireFeatures(['feature1', 'feature2'], {
        requireAny: true,
      });
      await middlewareFunc(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('checkFeatures 中間件', () => {
    test('應該檢查功能但不阻擋請求', async () => {
      mockService.isEnabled.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      const middlewareFunc = middleware.checkFeatures(['feature1', 'feature2']);
      await middlewareFunc(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.featureFlags).toEqual({
        feature1: true,
        feature2: false,
      });
      expect(res.status).not.toHaveBeenCalled();
    });

    test('錯誤時應該繼續執行但記錄錯誤', async () => {
      mockService.isEnabled.mockRejectedValue(new Error('Service error'));

      const req = createMockRequest();
      const res = createMockResponse();
      const next = jest.fn();

      const middlewareFunc = middleware.checkFeatures(['feature1']);
      await middlewareFunc(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('便捷函數', () => {
    test('getFeatureFlagMiddleware 應該返回單例實例', () => {
      const instance1 = getFeatureFlagMiddleware(mockCacheService, mockLogger);
      const instance2 = getFeatureFlagMiddleware(mockCacheService, mockLogger);

      expect(instance1).toBe(instance2);
    });

    test('requireFeature 便捷函數應該正常工作', () => {
      const middlewareFunc = requireFeature('test_feature');
      expect(typeof middlewareFunc).toBe('function');
    });

    test('requireFeatures 便捷函數應該正常工作', () => {
      const middlewareFunc = requireFeatures(['feature1', 'feature2']);
      expect(typeof middlewareFunc).toBe('function');
    });

    test('checkFeatures 便捷函數應該正常工作', () => {
      const middlewareFunc = checkFeatures(['feature1', 'feature2']);
      expect(typeof middlewareFunc).toBe('function');
    });
  });

  describe('getService 方法', () => {
    test('應該返回功能旗標服務實例', () => {
      const service = middleware.getService();
      expect(service).toBe(mockService);
    });
  });
});
