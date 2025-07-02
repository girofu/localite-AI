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

/**
 * @swagger
 * components:
 *   schemas:
 *     PerformanceMetrics:
 *       type: object
 *       properties:
 *         timestamp:
 *           type: string
 *           format: date-time
 *           description: 指標收集時間
 *         memory:
 *           type: object
 *           properties:
 *             used:
 *               type: number
 *               description: 已使用記憶體 (MB)
 *             total:
 *               type: number
 *               description: 總記憶體 (MB)
 *         cpu:
 *           type: object
 *           properties:
 *             usage:
 *               type: number
 *               description: CPU 使用率百分比
 *         responseTime:
 *           type: object
 *           properties:
 *             average:
 *               type: number
 *               description: 平均響應時間 (ms)
 *             max:
 *               type: number
 *               description: 最大響應時間 (ms)
 *
 *     HealthCheck:
 *       type: object
 *       properties:
 *         status:
 *           type: string
 *           enum: [healthy, unhealthy]
 *           description: 健康狀態
 *         timestamp:
 *           type: string
 *           format: date-time
 *           description: 檢查時間
 *         uptime:
 *           type: number
 *           description: 系統運行時間 (秒)
 *         memory:
 *           type: object
 *           properties:
 *             used:
 *               type: number
 *               description: 已使用記憶體 (MB)
 *             total:
 *               type: number
 *               description: 總記憶體 (MB)
 *         version:
 *           type: string
 *           description: 應用程式版本
 *         environment:
 *           type: string
 *           description: 運行環境
 *         responseTime:
 *           type: number
 *           description: 檢查響應時間 (ms)
 *
 *     DetailedHealthCheck:
 *       allOf:
 *         - $ref: '#/components/schemas/HealthCheck'
 *         - type: object
 *           properties:
 *             application:
 *               type: object
 *               properties:
 *                 nodeVersion:
 *                   type: string
 *                   description: Node.js 版本
 *                 pid:
 *                   type: number
 *                   description: 進程 ID
 *             system:
 *               type: object
 *               properties:
 *                 platform:
 *                   type: string
 *                   description: 作業系統平台
 *                 architecture:
 *                   type: string
 *                   description: 系統架構
 *                 cpus:
 *                   type: number
 *                   description: CPU 核心數
 *                 totalMemory:
 *                   type: number
 *                   description: 系統總記憶體 (GB)
 *                 freeMemory:
 *                   type: number
 *                   description: 系統可用記憶體 (GB)
 *
 *     ErrorStats:
 *       type: object
 *       properties:
 *         summary:
 *           type: object
 *           properties:
 *             total:
 *               type: number
 *               description: 錯誤總數
 *         byLevel:
 *           type: object
 *           properties:
 *             critical:
 *               type: number
 *             high:
 *               type: number
 *             medium:
 *               type: number
 *             low:
 *               type: number
 *         timeframe:
 *           type: number
 *           description: 統計時間範圍 (毫秒)
 *
 *     ErrorDetails:
 *       type: object
 *       properties:
 *         trackingId:
 *           type: string
 *           description: 錯誤追蹤 ID
 *         message:
 *           type: string
 *           description: 錯誤訊息
 *         severity:
 *           type: string
 *           enum: [critical, high, medium, low]
 *           description: 錯誤嚴重程度
 *         timestamp:
 *           type: string
 *           format: date-time
 *           description: 錯誤發生時間
 *         context:
 *           type: object
 *           description: 錯誤上下文資訊
 *         count:
 *           type: number
 *           description: 相同錯誤出現次數
 *
 *     LogFile:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *           description: 日誌檔案名稱
 *         size:
 *           type: number
 *           description: 檔案大小 (KB)
 *         modified:
 *           type: string
 *           format: date-time
 *           description: 最後修改時間
 *
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *       description: Firebase ID Token
 *
 *   responses:
 *     UnauthorizedError:
 *       description: 需要身份驗證
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               success:
 *                 type: boolean
 *                 example: false
 *               error:
 *                 type: string
 *                 example: "需要身份驗證"
 *
 *     ForbiddenError:
 *       description: 權限不足
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               success:
 *                 type: boolean
 *                 example: false
 *               error:
 *                 type: string
 *                 example: "權限不足，僅管理員可以執行此操作"
 *
 *     ServerError:
 *       description: 伺服器內部錯誤
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               success:
 *                 type: boolean
 *                 example: false
 *               error:
 *                 type: string
 *                 example: "內部伺服器錯誤"
 */

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
 * @swagger
 * /api/v1/monitoring/performance:
 *   get:
 *     summary: 獲取系統效能指標
 *     description: 獲取當前系統的效能監控指標，包括記憶體使用率、CPU 使用率、響應時間等
 *     tags:
 *       - Monitoring
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 成功獲取效能指標
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/PerformanceMetrics'
 *             example:
 *               success: true
 *               data:
 *                 timestamp: "2025-01-24T10:00:00.000Z"
 *                 memory:
 *                   used: 128
 *                   total: 512
 *                 cpu:
 *                   usage: 25.5
 *                 responseTime:
 *                   average: 150
 *                   max: 500
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
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
 * @swagger
 * /api/v1/monitoring/performance/reset:
 *   post:
 *     summary: 重置效能指標
 *     description: 重置系統效能監控指標，清空歷史數據（僅管理員可執行）
 *     tags:
 *       - Monitoring
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 成功重置效能指標
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "效能指標已重置"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
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
 * @swagger
 * /api/v1/monitoring/health:
 *   get:
 *     summary: 系統健康檢查
 *     description: 基本的系統健康檢查端點，返回系統運行狀態和基本指標
 *     tags:
 *       - Monitoring
 *     responses:
 *       200:
 *         description: 系統健康狀態正常
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/HealthCheck'
 *             example:
 *               success: true
 *               data:
 *                 status: "healthy"
 *                 timestamp: "2025-01-24T10:00:00.000Z"
 *                 uptime: 3600
 *                 memory:
 *                   used: 128
 *                   total: 512
 *                 version: "1.0.0"
 *                 environment: "production"
 *                 responseTime: 5
 *       503:
 *         description: 系統健康狀態異常
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 status:
 *                   type: string
 *                   example: "unhealthy"
 *                 error:
 *                   type: string
 *                   example: "系統健康檢查失敗"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
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
 * @swagger
 * /api/v1/monitoring/health/detailed:
 *   get:
 *     summary: 詳細系統健康檢查
 *     description: 獲取詳細的系統健康狀態，包括應用程式、系統、進程等完整資訊
 *     tags:
 *       - Monitoring
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 成功獲取詳細健康狀態
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/DetailedHealthCheck'
 *             example:
 *               success: true
 *               data:
 *                 status: "healthy"
 *                 timestamp: "2025-01-24T10:00:00.000Z"
 *                 application:
 *                   uptime: 3600
 *                   version: "1.0.0"
 *                   environment: "production"
 *                   nodeVersion: "v18.17.0"
 *                   pid: 12345
 *                 system:
 *                   platform: "linux"
 *                   architecture: "x64"
 *                   cpus: 4
 *                   totalMemory: 8
 *                   freeMemory: 4
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       503:
 *         description: 詳細健康檢查失敗
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 status:
 *                   type: string
 *                   example: "unhealthy"
 *                 error:
 *                   type: string
 *                   example: "詳細健康檢查失敗"
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

    const logFiles = fs.readdirSync(logDir).map((file) => {
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
 * @swagger
 * /api/v1/monitoring/errors/stats:
 *   get:
 *     summary: 獲取錯誤統計資訊
 *     description: 獲取系統錯誤的統計資訊，包括錯誤總數、分級統計等（僅管理員可訪問）
 *     tags:
 *       - Monitoring
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: timeframe
 *         schema:
 *           type: integer
 *           default: 3600000
 *         description: 統計時間範圍（毫秒），預設為1小時
 *         example: 3600000
 *     responses:
 *       200:
 *         description: 成功獲取錯誤統計
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/ErrorStats'
 *             example:
 *               success: true
 *               data:
 *                 summary:
 *                   total: 42
 *                 byLevel:
 *                   critical: 2
 *                   high: 8
 *                   medium: 15
 *                   low: 17
 *                 timeframe: 3600000
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
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
 * @swagger
 * /api/v1/monitoring/errors/{trackingId}:
 *   get:
 *     summary: 獲取特定錯誤詳情
 *     description: 根據追蹤 ID 獲取特定錯誤的詳細資訊（僅管理員可訪問）
 *     tags:
 *       - Monitoring
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: trackingId
 *         required: true
 *         schema:
 *           type: string
 *         description: 錯誤追蹤 ID
 *         example: "error_20250124_001"
 *     responses:
 *       200:
 *         description: 成功獲取錯誤詳情
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/ErrorDetails'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: 找不到指定的錯誤記錄
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "找不到指定的錯誤記錄"
 *       500:
 *         $ref: '#/components/responses/ServerError'
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
 * @swagger
 * /api/v1/monitoring/errors/track:
 *   post:
 *     summary: 手動記錄錯誤
 *     description: 手動記錄一個錯誤到錯誤追蹤系統（用於測試，僅管理員可執行）
 *     tags:
 *       - Monitoring
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *                 description: 錯誤訊息
 *                 example: "測試錯誤訊息"
 *               severity:
 *                 type: string
 *                 enum: [critical, high, medium, low]
 *                 default: medium
 *                 description: 錯誤嚴重程度
 *               context:
 *                 type: object
 *                 description: 額外的上下文資訊
 *                 example:
 *                   component: "test-component"
 *                   action: "manual-test"
 *     responses:
 *       200:
 *         description: 成功記錄錯誤
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     trackingId:
 *                       type: string
 *                       description: 錯誤追蹤 ID
 *                       example: "error_20250124_001"
 *                     message:
 *                       type: string
 *                       example: "錯誤已記錄"
 *       400:
 *         description: 請求參數錯誤
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "錯誤訊息不能為空"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
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
      severity,
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
