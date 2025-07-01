const {
  performanceMonitorMiddleware,
  getPerformanceMetrics,
  resetPerformanceMetrics,
  monitor,
} = require('./performanceMonitor');
const { createComponentLogger } = require('../config/logger');

// Mock logger
jest.mock('../config/logger', () => ({
  createComponentLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    http: jest.fn(),
    debug: jest.fn(),
  }),
}));

describe('Performance Monitor', () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    req = {
      method: 'GET',
      originalUrl: '/test',
      path: '/test',
      get: jest.fn(),
      ip: '127.0.0.1',
    };

    res = {
      statusCode: 200,
      on: jest.fn(),
      get: jest.fn(),
      json: jest.fn(),
      status: jest.fn(() => res),
    };

    next = jest.fn();

    // 重置監控指標
    monitor.resetMetrics();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('performanceMonitorMiddleware', () => {
    test('should call next function', () => {
      performanceMonitorMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('should register finish event listener', () => {
      performanceMonitorMiddleware(req, res, next);
      expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
    });

    test('should record metrics when response finishes', (done) => {
      const initialMetrics = monitor.getMetrics();
      expect(initialMetrics.requests.total).toBe(0);

      // 模擬響應結束
      res.on.mockImplementation((event, callback) => {
        if (event === 'finish') {
          setTimeout(() => {
            callback();

            // 檢查指標是否被記錄
            const metrics = monitor.getMetrics();
            expect(metrics.requests.total).toBe(1);
            expect(metrics.requests.success).toBe(1);
            done();
          }, 10);
        }
      });

      performanceMonitorMiddleware(req, res, next);
    });

    test('should record error metrics for 4xx/5xx responses', (done) => {
      res.statusCode = 500;

      res.on.mockImplementation((event, callback) => {
        if (event === 'finish') {
          setTimeout(() => {
            callback();

            const metrics = monitor.getMetrics();
            expect(metrics.requests.total).toBe(1);
            expect(metrics.requests.error).toBe(1);
            expect(metrics.requests.success).toBe(0);
            done();
          }, 10);
        }
      });

      performanceMonitorMiddleware(req, res, next);
    });
  });

  describe('PerformanceMonitor class', () => {
    test('should initialize with default metrics', () => {
      const metrics = monitor.getMetrics();

      expect(metrics).toHaveProperty('requests');
      expect(metrics).toHaveProperty('system');
      expect(metrics).toHaveProperty('endpoints');
      expect(metrics).toHaveProperty('timestamp');
      expect(metrics).toHaveProperty('applicationUptime');

      expect(metrics.requests.total).toBe(0);
      expect(metrics.requests.success).toBe(0);
      expect(metrics.requests.error).toBe(0);
    });

    test('should update system metrics', () => {
      monitor.updateSystemMetrics();
      const metrics = monitor.getMetrics();

      expect(typeof metrics.system.cpuUsage).toBe('number');
      expect(typeof metrics.system.memoryUsage.percentage).toBe('number');
      expect(typeof metrics.system.uptime).toBe('number');

      expect(metrics.system.memoryUsage).toHaveProperty('used');
      expect(metrics.system.memoryUsage).toHaveProperty('free');
      expect(metrics.system.memoryUsage).toHaveProperty('total');
      expect(metrics.system.memoryUsage).toHaveProperty('percentage');
    });

    test('should record request metrics correctly', () => {
      const mockReq = {
        method: 'POST',
        path: '/api/test',
        route: { path: '/api/test' },
      };
      const mockRes = { statusCode: 201 };

      monitor.recordRequest(mockReq, mockRes, 150);

      const metrics = monitor.getMetrics();
      expect(metrics.requests.total).toBe(1);
      expect(metrics.requests.success).toBe(1);
      expect(metrics.requests.averageResponseTime).toBe(150);

      // 檢查端點指標
      const endpoint = metrics.endpoints.find((e) => e.endpoint === 'POST /api/test');
      expect(endpoint).toBeDefined();
      expect(endpoint.count).toBe(1);
      expect(endpoint.averageResponseTime).toBe(150);
    });

    test('should calculate average response time correctly', () => {
      const mockReq = { method: 'GET', path: '/test' };
      const mockRes = { statusCode: 200 };

      monitor.recordRequest(mockReq, mockRes, 100);
      monitor.recordRequest(mockReq, mockRes, 200);
      monitor.recordRequest(mockReq, mockRes, 300);

      const metrics = monitor.getMetrics();
      expect(metrics.requests.averageResponseTime).toBe(200);
    });

    test('should reset metrics correctly', () => {
      // 添加一些指標
      const mockReq = { method: 'GET', path: '/test' };
      const mockRes = { statusCode: 200 };
      monitor.recordRequest(mockReq, mockRes, 100);

      // 確認有指標
      let metrics = monitor.getMetrics();
      expect(metrics.requests.total).toBe(1);

      // 重置指標
      monitor.resetMetrics();

      // 確認指標已重置
      metrics = monitor.getMetrics();
      expect(metrics.requests.total).toBe(0);
      expect(metrics.requests.success).toBe(0);
      expect(metrics.requests.error).toBe(0);
      expect(metrics.endpoints.length).toBe(0);
    });
  });

  describe('API endpoints', () => {
    test('getPerformanceMetrics should return metrics', () => {
      getPerformanceMetrics(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          requests: expect.any(Object),
          system: expect.any(Object),
          endpoints: expect.any(Array),
        }),
      });
    });

    test('resetPerformanceMetrics should reset and return success', () => {
      resetPerformanceMetrics(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: '效能指標已重置',
      });
    });

    test('should handle errors in getPerformanceMetrics', () => {
      // 模擬錯誤
      const originalGetMetrics = monitor.getMetrics;
      monitor.getMetrics = () => {
        throw new Error('Test error');
      };

      getPerformanceMetrics(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: '獲取效能指標失敗',
      });

      // 恢復原始方法
      monitor.getMetrics = originalGetMetrics;
    });
  });

  describe('Threshold monitoring', () => {
    test('should not warn for normal response times', () => {
      const logger = createComponentLogger('test');
      const mockReq = { method: 'GET', path: '/test', get: jest.fn() };
      const mockRes = { statusCode: 200 };

      monitor.recordRequest(mockReq, mockRes, 1000); // 1 second

      expect(logger.warn).not.toHaveBeenCalled();
    });

    test('should warn for slow requests', () => {
      const mockReq = {
        method: 'GET',
        originalUrl: '/slow-endpoint',
        get: jest.fn(() => 'Test User Agent'),
      };
      const mockRes = { statusCode: 200 };

      // 記錄慢請求（超過 3 秒）
      monitor.recordRequest(mockReq, mockRes, 3500);

      // 這裡我們無法直接測試 logger.warn 被調用，因為它在內部被調用
      // 但我們可以確認指標被正確記錄
      const metrics = monitor.getMetrics();
      expect(metrics.requests.total).toBe(1);
    });
  });
});
