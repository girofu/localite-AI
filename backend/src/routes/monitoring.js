const express = require('express');
const {
  getPerformanceMetrics,
  resetPerformanceMetrics,
} = require('../middleware/performanceMonitor');
const { authMiddleware } = require('../middleware/authMiddleware');
const { createComponentLogger } = require('../config/logger');
const ErrorTrackingService = require('../services/errorTrackingService');

const router = express.Router();
const logger = createComponentLogger('monitoring-routes');

// 創建錯誤追蹤服務實例
const errorTrackingService = new ErrorTrackingService({
  enabled: process.env.NODE_ENV !== 'test',
  maxHistorySize: 1000,
  notificationThresholds: {
    critical: 1,
    high: 5,
    medium: 10,
    low: 50,
  },
});

/**
 * @route GET /api/v1/monitoring/performance
 * @desc 獲取系統效能指標
 * @access Private (需要認證)
 */
router.get('/performance', authMiddleware, (req, res) => {
  logger.info('效能指標查詢請求', {
    userId: req.user?.uid,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
  });

  getPerformanceMetrics(req, res);
});

/**
 * @route POST /api/v1/monitoring/performance/reset
 * @desc 重置效能指標
 * @access Private (需要認證，僅管理員)
 */
router.post('/performance/reset', authMiddleware, (req, res) => {
  // 檢查是否為管理員
  if (req.user?.role !== 'admin') {
    logger.warn('非管理員嘗試重置效能指標', {
      userId: req.user?.uid,
      role: req.user?.role,
      ip: req.ip,
    });

    return res.status(403).json({
      success: false,
      error: '權限不足，僅管理員可以重置效能指標',
    });
  }

  logger.info('管理員重置效能指標', {
    userId: req.user?.uid,
    ip: req.ip,
  });

  resetPerformanceMetrics(req, res);
});

/**
 * @route GET /api/v1/monitoring/health
 * @desc 系統健康檢查端點
 * @access Public
 */
router.get('/health', (req, res) => {
  const startTime = Date.now();

  try {
    // 基本健康檢查
    const healthCheck = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      },
      version: process.env.APP_VERSION || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      responseTime: Date.now() - startTime,
    };

    logger.debug('健康檢查完成', {
      responseTime: healthCheck.responseTime,
      memoryUsed: healthCheck.memory.used,
    });

    res.status(200).json({
      success: true,
      data: healthCheck,
    });
  } catch (error) {
    logger.error('健康檢查失敗', {
      error: error.message,
      stack: error.stack,
    });

    res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: '系統健康檢查失敗',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @route GET /api/v1/monitoring/health/detailed
 * @desc 詳細系統健康檢查
 * @access Private (需要認證)
 */
router.get('/health/detailed', authMiddleware, async (req, res) => {
  const startTime = Date.now();

  try {
    const os = require('os');

    // 詳細健康檢查
    const detailedHealthCheck = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      application: {
        uptime: process.uptime(),
        version: process.env.APP_VERSION || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        nodeVersion: process.version,
        pid: process.pid,
      },
      system: {
        platform: os.platform(),
        architecture: os.arch(),
        cpus: os.cpus().length,
        totalMemory: Math.round(os.totalmem() / 1024 / 1024 / 1024), // GB
        freeMemory: Math.round(os.freemem() / 1024 / 1024 / 1024), // GB
        uptime: Math.round(os.uptime()),
        loadAverage: os.loadavg(),
      },
      process: {
        memoryUsage: {
          rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
          heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          external: Math.round(process.memoryUsage().external / 1024 / 1024),
        },
        cpuUsage: process.cpuUsage(),
      },
      services: {
        // TODO: 添加外部服務健康檢查
        database: 'pending',
        redis: 'pending',
        firebase: 'pending',
      },
      responseTime: Date.now() - startTime,
    };

    logger.info('詳細健康檢查完成', {
      userId: req.user?.uid,
      responseTime: detailedHealthCheck.responseTime,
      memoryUsage: detailedHealthCheck.process.memoryUsage.heapUsed,
    });

    res.status(200).json({
      success: true,
      data: detailedHealthCheck,
    });
  } catch (error) {
    logger.error('詳細健康檢查失敗', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.uid,
    });

    res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: '詳細健康檢查失敗',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @route GET /api/v1/monitoring/logs
 * @desc 獲取系統日誌摘要
 * @access Private (需要認證，僅管理員)
 */
router.get('/logs', authMiddleware, (req, res) => {
  // 檢查是否為管理員
  if (req.user?.role !== 'admin') {
    logger.warn('非管理員嘗試訪問日誌', {
      userId: req.user?.uid,
      role: req.user?.role,
      ip: req.ip,
    });

    return res.status(403).json({
      success: false,
      error: '權限不足，僅管理員可以查看系統日誌',
    });
  }

  try {
    const fs = require('fs');
    const path = require('path');
    const logDir = path.join(__dirname, '../../logs');

    if (!fs.existsSync(logDir)) {
      return res.json({
        success: true,
        data: {
          message: '日誌目錄不存在',
          files: [],
        },
      });
    }

    const logFiles = fs.readdirSync(logDir).map(file => {
      const filePath = path.join(logDir, file);
      const stats = fs.statSync(filePath);

      return {
        name: file,
        size: Math.round(stats.size / 1024), // KB
        modified: stats.mtime.toISOString(),
      };
    });

    logger.info('日誌檔案查詢', {
      userId: req.user?.uid,
      fileCount: logFiles.length,
    });

    res.json({
      success: true,
      data: {
        logDirectory: logDir,
        files: logFiles,
        totalFiles: logFiles.length,
        totalSize: logFiles.reduce((sum, file) => sum + file.size, 0),
      },
    });
  } catch (error) {
    logger.error('獲取日誌檔案失敗', {
      error: error.message,
      userId: req.user?.uid,
    });

    res.status(500).json({
      success: false,
      error: '獲取日誌檔案失敗',
    });
  }
});

/**
 * @route GET /api/v1/monitoring/errors/stats
 * @desc 獲取錯誤統計資訊
 * @access Private (需要認證，僅管理員)
 */
router.get('/errors/stats', authMiddleware, (req, res) => {
  // 檢查是否為管理員
  if (req.user?.role !== 'admin') {
    logger.warn('非管理員嘗試訪問錯誤統計', {
      userId: req.user?.uid,
      role: req.user?.role,
      ip: req.ip,
    });

    return res.status(403).json({
      success: false,
      error: '權限不足，僅管理員可以查看錯誤統計',
    });
  }

  try {
    const timeframe = parseInt(req.query.timeframe) || 3600000; // 預設1小時
    const stats = errorTrackingService.getErrorStats({ timeframe });

    logger.info('錯誤統計查詢', {
      userId: req.user?.uid,
      timeframe,
      totalErrors: stats.summary.total,
    });

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error('獲取錯誤統計失敗', {
      error: error.message,
      userId: req.user?.uid,
    });

    res.status(500).json({
      success: false,
      error: '獲取錯誤統計失敗',
    });
  }
});

/**
 * @route GET /api/v1/monitoring/errors/:trackingId
 * @desc 獲取特定錯誤的詳細資訊
 * @access Private (需要認證，僅管理員)
 */
router.get('/errors/:trackingId', authMiddleware, (req, res) => {
  // 檢查是否為管理員
  if (req.user?.role !== 'admin') {
    logger.warn('非管理員嘗試訪問錯誤詳情', {
      userId: req.user?.uid,
      role: req.user?.role,
      trackingId: req.params.trackingId,
      ip: req.ip,
    });

    return res.status(403).json({
      success: false,
      error: '權限不足，僅管理員可以查看錯誤詳情',
    });
  }

  try {
    const { trackingId } = req.params;
    const errorDetails = errorTrackingService.getErrorDetails(trackingId);

    if (!errorDetails) {
      return res.status(404).json({
        success: false,
        error: '找不到指定的錯誤記錄',
      });
    }

    logger.info('錯誤詳情查詢', {
      userId: req.user?.uid,
      trackingId,
    });

    res.json({
      success: true,
      data: errorDetails,
    });
  } catch (error) {
    logger.error('獲取錯誤詳情失敗', {
      error: error.message,
      userId: req.user?.uid,
      trackingId: req.params.trackingId,
    });

    res.status(500).json({
      success: false,
      error: '獲取錯誤詳情失敗',
    });
  }
});

/**
 * @route POST /api/v1/monitoring/errors/track
 * @desc 手動記錄錯誤（用於測試）
 * @access Private (需要認證，僅管理員)
 */
router.post('/errors/track', authMiddleware, async (req, res) => {
  // 檢查是否為管理員
  if (req.user?.role !== 'admin') {
    logger.warn('非管理員嘗試記錄錯誤', {
      userId: req.user?.uid,
      role: req.user?.role,
      ip: req.ip,
    });

    return res.status(403).json({
      success: false,
      error: '權限不足，僅管理員可以記錄錯誤',
    });
  }

  try {
    const { message, severity = 'medium', context = {} } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        error: '錯誤訊息不能為空',
      });
    }

    const trackingId = await errorTrackingService.trackError(
      message,
      {
        ...context,
        userId: req.user?.uid,
        manualEntry: true,
        route: req.originalUrl,
        method: req.method,
      },
      severity
    );

    logger.info('手動錯誤記錄', {
      userId: req.user?.uid,
      trackingId,
      severity,
      message,
    });

    res.json({
      success: true,
      data: {
        trackingId,
        message: '錯誤已記錄',
      },
    });
  } catch (error) {
    logger.error('記錄錯誤失敗', {
      error: error.message,
      userId: req.user?.uid,
    });

    res.status(500).json({
      success: false,
      error: '記錄錯誤失敗',
    });
  }
});

/**
 * @route GET /api/v1/monitoring/errors/status
 * @desc 獲取錯誤追蹤服務狀態
 * @access Private (需要認證)
 */
router.get('/errors/status', authMiddleware, (req, res) => {
  try {
    const status = errorTrackingService.getStatus();

    logger.debug('錯誤追蹤服務狀態查詢', {
      userId: req.user?.uid,
    });

    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    logger.error('獲取錯誤追蹤狀態失敗', {
      error: error.message,
      userId: req.user?.uid,
    });

    res.status(500).json({
      success: false,
      error: '獲取錯誤追蹤狀態失敗',
    });
  }
});

/**
 * @route POST /api/v1/monitoring/errors/cleanup
 * @desc 清理舊的錯誤記錄
 * @access Private (需要認證，僅管理員)
 */
router.post('/errors/cleanup', authMiddleware, (req, res) => {
  // 檢查是否為管理員
  if (req.user?.role !== 'admin') {
    logger.warn('非管理員嘗試清理錯誤記錄', {
      userId: req.user?.uid,
      role: req.user?.role,
      ip: req.ip,
    });

    return res.status(403).json({
      success: false,
      error: '權限不足，僅管理員可以清理錯誤記錄',
    });
  }

  try {
    const maxAge = parseInt(req.body.maxAge) || 86400000; // 預設24小時

    errorTrackingService.cleanup(maxAge);

    logger.info('錯誤記錄清理', {
      userId: req.user?.uid,
      maxAge,
    });

    res.json({
      success: true,
      data: {
        message: '錯誤記錄清理完成',
        maxAge,
      },
    });
  } catch (error) {
    logger.error('清理錯誤記錄失敗', {
      error: error.message,
      userId: req.user?.uid,
    });

    res.status(500).json({
      success: false,
      error: '清理錯誤記錄失敗',
    });
  }
});

// 匯出錯誤追蹤服務供其他模組使用
module.exports = { router, errorTrackingService };
