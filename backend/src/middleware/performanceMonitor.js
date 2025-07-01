const os = require('os');
const process = require('process');
const { createComponentLogger } = require('../config/logger');

const logger = createComponentLogger('performance-monitor');

/**
 * 系統效能監控器
 */
class PerformanceMonitor {
  constructor() {
    this.metrics = {
      requests: {
        total: 0,
        success: 0,
        error: 0,
        averageResponseTime: 0,
      },
      system: {
        cpuUsage: 0,
        memoryUsage: {
          used: 0,
          free: 0,
          percentage: 0,
        },
        uptime: 0,
      },
      endpoints: new Map(),
    };

    this.startTime = Date.now();
    this.responseTimeWindow = [];
    this.windowSize = 100; // 保留最近 100 個請求的響應時間

    // 每 30 秒更新系統指標
    this.systemMetricsInterval = setInterval(() => {
      this.updateSystemMetrics();
    }, 30000);

    // 初始化時更新一次系統指標
    this.updateSystemMetrics();
  }

  /**
   * 更新系統指標
   */
  updateSystemMetrics() {
    try {
      // CPU 使用率計算
      const cpus = os.cpus();
      let totalIdle = 0;
      let totalTick = 0;

      cpus.forEach((cpu) => {
        Object.keys(cpu.times).forEach((type) => {
          totalTick += cpu.times[type];
        });
        totalIdle += cpu.times.idle;
      });

      const idle = totalIdle / cpus.length;
      const total = totalTick / cpus.length;
      this.metrics.system.cpuUsage = Math.round((1 - idle / total) * 100);

      // 記憶體使用率
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      const usedMemory = totalMemory - freeMemory;

      this.metrics.system.memoryUsage = {
        used: Math.round(usedMemory / 1024 / 1024), // MB
        free: Math.round(freeMemory / 1024 / 1024), // MB
        total: Math.round(totalMemory / 1024 / 1024), // MB
        percentage: Math.round((usedMemory / totalMemory) * 100),
      };

      // 系統運行時間
      this.metrics.system.uptime = Math.round(os.uptime());

      // 記錄高使用率警告
      if (this.metrics.system.cpuUsage > 80) {
        logger.warn('高 CPU 使用率檢測', {
          cpuUsage: this.metrics.system.cpuUsage,
          threshold: 80,
        });
      }

      if (this.metrics.system.memoryUsage.percentage > 85) {
        logger.warn('高記憶體使用率檢測', {
          memoryUsage: this.metrics.system.memoryUsage,
          threshold: 85,
        });
      }
    } catch (error) {
      logger.error('更新系統指標失敗', { error: error.message });
    }
  }

  /**
   * 記錄請求指標
   */
  recordRequest(req, res, responseTime) {
    this.metrics.requests.total += 1;

    if (res.statusCode >= 200 && res.statusCode < 400) {
      this.metrics.requests.success += 1;
    } else {
      this.metrics.requests.error += 1;
    }

    // 更新響應時間
    this.responseTimeWindow.push(responseTime);
    if (this.responseTimeWindow.length > this.windowSize) {
      this.responseTimeWindow.shift();
    }

    // 計算平均響應時間
    this.metrics.requests.averageResponseTime = Math.round(
      this.responseTimeWindow.reduce((a, b) => a + b, 0) / this.responseTimeWindow.length,
    );

    // 記錄端點指標
    const endpoint = `${req.method} ${req.route?.path || req.path}`;
    if (!this.metrics.endpoints.has(endpoint)) {
      this.metrics.endpoints.set(endpoint, {
        count: 0,
        averageResponseTime: 0,
        responseTimes: [],
        errors: 0,
      });
    }

    const endpointMetrics = this.metrics.endpoints.get(endpoint);
    endpointMetrics.count += 1;
    endpointMetrics.responseTimes.push(responseTime);

    // 保留最近 50 個請求的響應時間
    if (endpointMetrics.responseTimes.length > 50) {
      endpointMetrics.responseTimes.shift();
    }

    endpointMetrics.averageResponseTime = Math.round(
      endpointMetrics.responseTimes.reduce((a, b) => a + b, 0)
        / endpointMetrics.responseTimes.length,
    );

    if (res.statusCode >= 400) {
      endpointMetrics.errors += 1;
    }

    // 記錄慢請求警告
    if (responseTime > 3000) {
      logger.warn('慢請求檢測', {
        method: req.method,
        url: req.originalUrl,
        responseTime: `${responseTime}ms`,
        statusCode: res.statusCode,
        userAgent: req.get('User-Agent'),
      });
    }
  }

  /**
   * 獲取當前指標
   */
  getMetrics() {
    const endpointsArray = Array.from(this.metrics.endpoints.entries()).map(
      ([endpoint, metrics]) => ({
        endpoint,
        ...metrics,
        responseTimes: undefined, // 不返回詳細的響應時間陣列
      }),
    );

    return {
      ...this.metrics,
      endpoints: endpointsArray,
      timestamp: new Date().toISOString(),
      applicationUptime: Math.round((Date.now() - this.startTime) / 1000),
    };
  }

  /**
   * 重置指標
   */
  resetMetrics() {
    this.metrics.requests = {
      total: 0,
      success: 0,
      error: 0,
      averageResponseTime: 0,
    };
    this.metrics.endpoints.clear();
    this.responseTimeWindow = [];
    this.startTime = Date.now();

    logger.info('效能指標已重置');
  }

  /**
   * 清理資源
   */
  cleanup() {
    if (this.systemMetricsInterval) {
      clearInterval(this.systemMetricsInterval);
    }
  }
}

// 全域 monitor 實例
const monitor = new PerformanceMonitor();

/**
 * 效能監控中間件
 */
const performanceMonitorMiddleware = (req, res, next) => {
  const startTime = Date.now();

  // 監聽響應結束
  res.on('finish', () => {
    const responseTime = Date.now() - startTime;

    // 記錄請求指標
    monitor.recordRequest(req, res, responseTime);

    // 記錄詳細的效能日誌
    logger.http('請求效能記錄', {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      responseTime: `${responseTime}ms`,
      contentLength: res.get('Content-Length') || 0,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
    });
  });

  next();
};

/**
 * 獲取效能指標的 API 端點處理器
 */
const getPerformanceMetrics = (req, res) => {
  try {
    const metrics = monitor.getMetrics();
    res.json({
      success: true,
      data: metrics,
    });
  } catch (error) {
    logger.error('獲取效能指標失敗', { error: error.message });
    res.status(500).json({
      success: false,
      error: '獲取效能指標失敗',
    });
  }
};

/**
 * 重置效能指標的 API 端點處理器
 */
const resetPerformanceMetrics = (req, res) => {
  try {
    monitor.resetMetrics();
    res.json({
      success: true,
      message: '效能指標已重置',
    });
  } catch (error) {
    logger.error('重置效能指標失敗', { error: error.message });
    res.status(500).json({
      success: false,
      error: '重置效能指標失敗',
    });
  }
};

// 優雅關閉時清理資源
process.on('SIGTERM', () => {
  monitor.cleanup();
});

process.on('SIGINT', () => {
  monitor.cleanup();
});

module.exports = {
  performanceMonitorMiddleware,
  getPerformanceMetrics,
  resetPerformanceMetrics,
  monitor,
};
