const request = require('supertest');
const express = require('express');

// Mock dependencies before importing monitoring routes
jest.mock('../middleware/authMiddleware', () => ({
  authMiddleware: (req, res, next) => {
    // 模擬認證成功的用戶
    req.user = {
      uid: 'test-user-123',
      role: req.headers['x-test-role'] || 'user',
    };
    next();
  },
}));

jest.mock('../config/logger', () => ({
  createComponentLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('../services/errorTrackingService', () => {
  return jest.fn().mockImplementation(() => ({
    trackError: jest.fn().mockResolvedValue('mock-tracking-id'),
    getErrorStats: jest.fn().mockReturnValue({
      summary: { total: 0 },
      bySeverity: {},
      byType: {},
      topErrors: [],
    }),
    getErrorDetails: jest.fn().mockReturnValue(null),
    cleanup: jest.fn(),
    getStatus: jest.fn().mockReturnValue({
      enabled: false,
      environment: 'test',
      errorHistorySize: 0,
      activeCounters: 0,
    }),
  }));
});

const { router: monitoringRoutes } = require('./monitoring');

jest.mock('../middleware/performanceMonitor', () => ({
  getPerformanceMetrics: (req, res) => {
    res.json({
      success: true,
      data: {
        requests: { total: 100, success: 95, error: 5 },
        system: { cpuUsage: 45, memoryUsage: { percentage: 60 } },
        endpoints: [],
      },
    });
  },
  resetPerformanceMetrics: (req, res) => {
    res.json({
      success: true,
      message: '效能指標已重置',
    });
  },
}));

describe('Monitoring Routes', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/monitoring', monitoringRoutes);
  });

  describe('GET /performance', () => {
    test('should return performance metrics for authenticated user', async () => {
      const response = await request(app).get('/api/v1/monitoring/performance').expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('requests');
      expect(response.body.data).toHaveProperty('system');
    });
  });

  describe('GET /health', () => {
    test('should return basic health check', async () => {
      const response = await request(app).get('/api/v1/monitoring/health').expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('status', 'healthy');
      expect(response.body.data).toHaveProperty('uptime');
      expect(response.body.data).toHaveProperty('memory');
      expect(response.body.data).toHaveProperty('responseTime');
    });
  });
});
