const ErrorTrackingService = require('./errorTrackingService');

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-123'),
}));

// Mock logger
jest.mock('../config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const logger = require('../config/logger');

describe('ErrorTrackingService', () => {
  let errorTrackingService;
  let mockNotificationService;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock 通知服務
    mockNotificationService = {
      send: jest.fn().mockResolvedValue(true),
    };

    errorTrackingService = new ErrorTrackingService({
      enabled: true,
      maxHistorySize: 100,
      notificationThresholds: {
        critical: 1,
        high: 2,
        medium: 3,
        low: 5,
      },
    });
  });

  describe('constructor', () => {
    test('should initialize with default options', () => {
      const service = new ErrorTrackingService();

      expect(service.enabled).toBe(true);
      expect(service.environment).toBe('test');
      expect(service.errorHistory).toHaveLength(0);
      expect(service.errorCounts.size).toBe(0);
    });

    test('should initialize with custom options', () => {
      const customOptions = {
        enabled: false,
        maxHistorySize: 500,
        notificationThresholds: { critical: 2 },
      };

      const service = new ErrorTrackingService(customOptions);

      expect(service.enabled).toBe(false);
      expect(service.maxHistorySize).toBe(500);
      expect(service.notificationThresholds.critical).toBe(2);
    });

    test('should log initialization', () => {
      expect(logger.info).toHaveBeenCalledWith(
        'ErrorTrackingService initialized',
        expect.objectContaining({
          enabled: true,
          environment: 'test',
        })
      );
    });
  });

  describe('trackError', () => {
    test('should track Error object successfully', async () => {
      const error = new Error('Test error message');
      const context = {
        userId: 'user123',
        route: '/api/test',
        method: 'GET',
      };

      const trackingId = await errorTrackingService.trackError(error, context, 'high');

      expect(trackingId).toBe('mock-uuid-123');
      expect(errorTrackingService.errorHistory).toHaveLength(1);

      const errorRecord = errorTrackingService.errorHistory[0];
      expect(errorRecord.trackingId).toBe('mock-uuid-123');
      expect(errorRecord.severity).toBe('high');
      expect(errorRecord.message).toBe('Test error message');
      expect(errorRecord.type).toBe('Error');
      expect(errorRecord.context.userId).toBe('user123');
      expect(errorRecord.context.route).toBe('/api/test');
    });

    test('should track string error successfully', async () => {
      const error = 'Custom error message';
      const trackingId = await errorTrackingService.trackError(error, {}, 'medium');

      expect(trackingId).toBe('mock-uuid-123');
      expect(errorTrackingService.errorHistory).toHaveLength(1);

      const errorRecord = errorTrackingService.errorHistory[0];
      expect(errorRecord.message).toBe('Custom error message');
      expect(errorRecord.type).toBe('CustomError');
      expect(errorRecord.stack).toBe(null);
    });

    test('should return null when service is disabled', async () => {
      errorTrackingService.enabled = false;

      const trackingId = await errorTrackingService.trackError(new Error('Test'), {});

      expect(trackingId).toBe(null);
      expect(errorTrackingService.errorHistory).toHaveLength(0);
    });

    test('should log error to logger', async () => {
      const error = new Error('Test error');

      await errorTrackingService.trackError(error, {}, 'critical');

      expect(logger.error).toHaveBeenCalledWith(
        'Error tracked',
        expect.objectContaining({
          trackingId: 'mock-uuid-123',
          severity: 'critical',
          message: 'Test error',
        })
      );
    });
  });

  describe('normalizeError', () => {
    test('should normalize Error object', () => {
      const error = new TypeError('Type error message');
      const result = errorTrackingService.normalizeError(error);

      expect(result.message).toBe('Type error message');
      expect(result.type).toBe('TypeError');
      expect(result.stack).toBe(error.stack);
      expect(result.signature).toBeDefined();
    });

    test('should normalize string error', () => {
      const error = 'String error message';
      const result = errorTrackingService.normalizeError(error);

      expect(result.message).toBe('String error message');
      expect(result.type).toBe('CustomError');
      expect(result.stack).toBe(null);
      expect(result.signature).toBeDefined();
    });

    test('should handle unknown error types', () => {
      const error = { unknown: 'object' };
      const result = errorTrackingService.normalizeError(error);

      expect(result.message).toBe('Unknown error');
      expect(result.type).toBe('UnknownError');
      expect(result.stack).toBe(null);
      expect(result.signature).toBe('unknown_error');
    });
  });

  describe('generateErrorSignature', () => {
    test('should generate consistent signature for same error', () => {
      const message = 'Database connection failed at port 5432';
      const stack = 'Error: Database connection failed\n    at connect (/app/db.js:10:5)';

      const signature1 = errorTrackingService.generateErrorSignature(message, stack);
      const signature2 = errorTrackingService.generateErrorSignature(message, stack);

      expect(signature1).toBe(signature2);
      expect(signature1).toBeDefined();
      expect(signature1.length).toBeLessThanOrEqual(200);
    });

    test('should normalize numbers in message', () => {
      const message1 = 'Connection failed at port 5432';
      const message2 = 'Connection failed at port 3306';

      const signature1 = errorTrackingService.generateErrorSignature(message1);
      const signature2 = errorTrackingService.generateErrorSignature(message2);

      expect(signature1).toBe(signature2); // Numbers should be normalized to 'N'
    });
  });

  describe('updateErrorCount', () => {
    test('should update error count correctly', () => {
      const signature = 'test_error_signature';
      const severity = 'high';

      errorTrackingService.updateErrorCount(signature, severity);
      errorTrackingService.updateErrorCount(signature, severity);

      const key = `${signature}:${severity}`;
      const count = errorTrackingService.errorCounts.get(key);

      expect(count.count).toBe(2);
      expect(count.lastSeen).toBeInstanceOf(Date);
    });
  });

  describe('checkNotificationThreshold', () => {
    beforeEach(() => {
      errorTrackingService.setNotificationService(mockNotificationService);
    });

    test('should trigger notification when threshold is reached', async () => {
      const signature = 'critical_error';
      const severity = 'critical';
      const errorRecord = {
        trackingId: 'test-123',
        message: 'Critical error occurred',
      };

      // Update error count to reach the threshold (1 for critical)
      errorTrackingService.updateErrorCount(signature, severity);

      // Critical threshold is 1, so this should trigger notification
      await errorTrackingService.checkNotificationThreshold(signature, severity, errorRecord);

      expect(mockNotificationService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'CRITICAL Error Alert',
          message: expect.stringContaining('Critical error occurred'),
        })
      );
    });

    test('should not trigger notification before threshold', async () => {
      const signature = 'medium_error';
      const severity = 'medium';
      const errorRecord = { trackingId: 'test-123', message: 'Medium error' };

      // Medium threshold is 3, so first occurrence shouldn't trigger
      errorTrackingService.errorCounts.set(`${signature}:${severity}`, {
        count: 1,
        lastSeen: new Date(),
      });

      await errorTrackingService.checkNotificationThreshold(signature, severity, errorRecord);

      expect(mockNotificationService.send).not.toHaveBeenCalled();
    });

    test('should reset counter after notification', async () => {
      const signature = 'high_error';
      const severity = 'high';
      const errorRecord = { trackingId: 'test-123', message: 'High error' };

      // Set count to threshold (2)
      errorTrackingService.errorCounts.set(`${signature}:${severity}`, {
        count: 2,
        lastSeen: new Date(),
      });

      await errorTrackingService.checkNotificationThreshold(signature, severity, errorRecord);

      // Counter should be reset
      const key = `${signature}:${severity}`;
      const count = errorTrackingService.errorCounts.get(key);
      expect(count.count).toBe(0);
    });
  });

  describe('sendNotification', () => {
    beforeEach(() => {
      errorTrackingService.setNotificationService(mockNotificationService);
    });

    test('should send notification successfully', async () => {
      const severity = 'high';
      const errorRecord = {
        trackingId: 'test-123',
        message: 'Test error for notification',
      };
      const count = 5;

      await errorTrackingService.sendNotification(severity, errorRecord, count);

      expect(mockNotificationService.send).toHaveBeenCalledWith({
        title: 'HIGH Error Alert',
        message: 'Error occurred 5 times: Test error for notification',
        data: {
          trackingId: 'test-123',
          severity: 'high',
          count: '5',
          environment: 'test',
        },
      });

      expect(logger.warn).toHaveBeenCalledWith(
        'Error notification triggered',
        expect.objectContaining({
          severity: 'high',
          count: 5,
          trackingId: 'test-123',
        })
      );
    });

    test('should handle notification service errors', async () => {
      mockNotificationService.send.mockRejectedValue(new Error('Notification failed'));

      const errorRecord = {
        trackingId: 'test-123',
        message: 'Test error',
      };

      await errorTrackingService.sendNotification('critical', errorRecord, 1);

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to send error notification',
        expect.objectContaining({
          error: 'Notification failed',
          originalError: 'Test error',
        })
      );
    });

    test('should work without notification service', async () => {
      errorTrackingService.setNotificationService(null);

      const errorRecord = {
        trackingId: 'test-123',
        message: 'Test error',
      };

      // Should not throw error
      await expect(
        errorTrackingService.sendNotification('medium', errorRecord, 3)
      ).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        'Error notification triggered',
        expect.objectContaining({
          severity: 'medium',
          count: 3,
        })
      );
    });
  });

  describe('getErrorStats', () => {
    beforeEach(async () => {
      // Add some test errors
      await errorTrackingService.trackError(new Error('Critical error'), {}, 'critical');
      await errorTrackingService.trackError(new TypeError('Type error'), {}, 'high');
      await errorTrackingService.trackError('Medium error', {}, 'medium');
      await errorTrackingService.trackError(new Error('Critical error'), {}, 'critical'); // Duplicate
    });

    test('should return error statistics', () => {
      const stats = errorTrackingService.getErrorStats();

      expect(stats.summary.total).toBe(4);
      expect(stats.summary.environment).toBe('test');
      expect(stats.bySeverity.critical).toBe(2);
      expect(stats.bySeverity.high).toBe(1);
      expect(stats.bySeverity.medium).toBe(1);
      expect(stats.byType.Error).toBe(2);
      expect(stats.byType.TypeError).toBe(1);
      expect(stats.byType.CustomError).toBe(1);
    });

    test('should filter by timeframe', async () => {
      // 等待一小段時間讓錯誤變舊
      await new Promise(resolve => setTimeout(resolve, 50));

      const stats = errorTrackingService.getErrorStats({ timeframe: 10 }); // 10ms ago

      expect(stats.summary.total).toBe(0); // All errors should be older than 10ms
    });

    test('should return top errors', () => {
      const stats = errorTrackingService.getErrorStats();

      expect(stats.topErrors).toBeDefined();
      expect(Array.isArray(stats.topErrors)).toBe(true);
      expect(stats.topErrors.length).toBeGreaterThan(0);
    });
  });

  describe('getErrorDetails', () => {
    test('should return error details by tracking ID', async () => {
      const error = new Error('Detailed error');
      const context = { userId: 'user123' };

      const trackingId = await errorTrackingService.trackError(error, context, 'high');
      const details = errorTrackingService.getErrorDetails(trackingId);

      expect(details).toBeDefined();
      expect(details.trackingId).toBe(trackingId);
      expect(details.message).toBe('Detailed error');
      expect(details.context.userId).toBe('user123');
    });

    test('should return null for non-existent tracking ID', () => {
      const details = errorTrackingService.getErrorDetails('non-existent-id');
      expect(details).toBe(null);
    });
  });

  describe('cleanup', () => {
    beforeEach(async () => {
      // Add some errors
      await errorTrackingService.trackError(new Error('Error 1'), {}, 'high');
      await errorTrackingService.trackError(new Error('Error 2'), {}, 'medium');
    });

    test('should clean up old errors', async () => {
      // 等待一小段時間讓錯誤變舊
      await new Promise(resolve => setTimeout(resolve, 50));

      // Set a very short max age to force cleanup
      errorTrackingService.cleanup(10); // 10ms

      expect(errorTrackingService.errorHistory).toHaveLength(0);
      expect(errorTrackingService.errorCounts.size).toBe(0);

      expect(logger.info).toHaveBeenCalledWith(
        'Error tracking cleanup completed',
        expect.objectContaining({
          remainingErrors: 0,
          remainingCounters: 0,
        })
      );
    });

    test('should keep recent errors', () => {
      // Set a large max age
      errorTrackingService.cleanup(86400000); // 24 hours

      expect(errorTrackingService.errorHistory.length).toBeGreaterThan(0);
    });
  });

  describe('addToHistory', () => {
    test('should maintain history size limit', () => {
      errorTrackingService.maxHistorySize = 2;

      const errorRecord1 = { trackingId: '1', message: 'Error 1' };
      const errorRecord2 = { trackingId: '2', message: 'Error 2' };
      const errorRecord3 = { trackingId: '3', message: 'Error 3' };

      errorTrackingService.addToHistory(errorRecord1);
      errorTrackingService.addToHistory(errorRecord2);
      errorTrackingService.addToHistory(errorRecord3);

      expect(errorTrackingService.errorHistory).toHaveLength(2);
      expect(errorTrackingService.errorHistory[0]).toBe(errorRecord2);
      expect(errorTrackingService.errorHistory[1]).toBe(errorRecord3);
    });
  });

  describe('setNotificationService', () => {
    test('should set notification service', () => {
      const service = { send: jest.fn() };

      errorTrackingService.setNotificationService(service);

      expect(errorTrackingService.notificationService).toBe(service);
      expect(logger.info).toHaveBeenCalledWith(
        'Notification service configured for error tracking'
      );
    });
  });

  describe('getStatus', () => {
    test('should return service status', async () => {
      await errorTrackingService.trackError(new Error('Test error'), {}, 'medium');
      errorTrackingService.setNotificationService(mockNotificationService);

      const status = errorTrackingService.getStatus();

      expect(status).toEqual({
        enabled: true,
        environment: 'test',
        errorHistorySize: 1,
        activeCounters: 1,
        thresholds: errorTrackingService.notificationThresholds,
        hasNotificationService: true,
      });
    });

    test('should return status without notification service', () => {
      const status = errorTrackingService.getStatus();

      expect(status.hasNotificationService).toBe(false);
    });
  });
});
