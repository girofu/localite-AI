const FeatureFlagService = require('../services/featureFlagService');

/**
 * 功能旗標中間件
 * 用於在 API 路由中檢查功能是否啟用
 */
class FeatureFlagMiddleware {
  constructor(cacheService = null, logger = console) {
    this.featureFlagService = new FeatureFlagService(cacheService, logger);
    this.logger = logger;
    this.initialized = false;
  }

  /**
   * 初始化中間件
   */
  async initialize() {
    if (!this.initialized) {
      await this.featureFlagService.initialize();
      this.initialized = true;
    }
  }

  /**
   * 檢查功能旗標的中間件工廠函數
   * @param {string} flagName - 功能旗標名稱
   * @param {Object} options - 選項
   * @param {boolean} options.required - 是否必須啟用（預設 true）
   * @param {string} options.errorMessage - 自定義錯誤訊息
   * @param {number} options.errorCode - 自定義錯誤代碼（預設 403）
   * @returns {Function} Express 中間件函數
   */
  requireFeature(flagName, options = {}) {
    const {
      required = true,
      errorMessage = `功能 ${flagName} 目前未開放`,
      errorCode = 403,
    } = options;

    return async (req, res, next) => {
      try {
        // 確保中間件已初始化
        await this.initialize();

        // 從請求中提取用戶上下文
        const context = this.extractUserContext(req);

        // 檢查功能旗標
        const isEnabled = await this.featureFlagService.isEnabled(flagName, context);

        if (required && !isEnabled) {
          return res.status(errorCode).json({
            error: errorMessage,
            feature: flagName,
            enabled: false,
          });
        }

        // 將功能旗標狀態添加到請求對象
        req.featureFlags = req.featureFlags || {};
        req.featureFlags[flagName] = isEnabled;

        next();
      } catch (error) {
        this.logger.error(`功能旗標中間件錯誤 ${flagName}:`, error.message);

        if (required) {
          return res.status(500).json({
            error: '功能檢查失敗',
            feature: flagName,
          });
        }

        // 如果不是必須的，繼續執行但標記為未啟用
        req.featureFlags = req.featureFlags || {};
        req.featureFlags[flagName] = false;
        next();
      }
    };
  }

  /**
   * 批量檢查多個功能旗標
   * @param {Array<string>} flagNames - 功能旗標名稱陣列
   * @param {Object} options - 選項
   * @param {boolean} options.requireAll - 是否要求全部啟用（預設 false）
   * @param {boolean} options.requireAny - 是否要求任一啟用（預設 false）
   * @returns {Function} Express 中間件函數
   */
  requireFeatures(flagNames, options = {}) {
    const {
      requireAll = false,
      requireAny = false,
      errorMessage = '所需功能未開放',
      errorCode = 403,
    } = options;

    return async (req, res, next) => {
      try {
        await this.initialize();

        const context = this.extractUserContext(req);
        const results = {};

        // 檢查所有功能旗標
        for (const flagName of flagNames) {
          results[flagName] = await this.featureFlagService.isEnabled(flagName, context);
        }

        // 評估條件
        const enabledFlags = Object.values(results).filter(Boolean);
        let shouldAllow = true;

        if (requireAll && enabledFlags.length !== flagNames.length) {
          shouldAllow = false;
        } else if (requireAny && enabledFlags.length === 0) {
          shouldAllow = false;
        }

        if (!shouldAllow) {
          return res.status(errorCode).json({
            error: errorMessage,
            features: results,
            requireAll,
            requireAny,
          });
        }

        // 將所有功能旗標狀態添加到請求對象
        req.featureFlags = { ...req.featureFlags, ...results };

        next();
      } catch (error) {
        this.logger.error('批量功能旗標檢查錯誤:', error.message);
        return res.status(500).json({
          error: '功能檢查失敗',
          features: flagNames,
        });
      }
    };
  }

  /**
   * 檢查功能旗標但不阻擋請求的中間件
   * 用於記錄功能使用情況或提供條件式功能
   * @param {Array<string>} flagNames - 功能旗標名稱陣列
   * @returns {Function} Express 中間件函數
   */
  checkFeatures(flagNames) {
    return async (req, res, next) => {
      try {
        await this.initialize();

        const context = this.extractUserContext(req);
        const results = {};

        for (const flagName of flagNames) {
          results[flagName] = await this.featureFlagService.isEnabled(flagName, context);
        }

        req.featureFlags = { ...req.featureFlags, ...results };
        next();
      } catch (error) {
        this.logger.error('功能旗標檢查錯誤:', error.message);
        // 不阻擋請求，但記錄錯誤
        req.featureFlags = req.featureFlags || {};
        next();
      }
    };
  }

  /**
   * 從請求中提取用戶上下文
   * @param {Object} req - Express 請求對象
   * @returns {Object} 用戶上下文
   */
  extractUserContext(req) {
    const context = {
      userId: null,
      userGroups: [],
      environment: process.env.NODE_ENV || 'development',
      userAgent: req.get('User-Agent'),
      ip: req.ip || req.connection.remoteAddress,
    };

    // 從 Firebase 認證中獲取用戶資訊
    if (req.user) {
      context.userId = req.user.uid;
      context.email = req.user.email;

      // 如果有自定義聲明，提取用戶群體
      if (req.user.custom_claims) {
        context.userGroups = req.user.custom_claims.groups || [];
        context.role = req.user.custom_claims.role;
      }
    }

    // 從請求標頭中獲取額外上下文
    if (req.headers['x-user-groups']) {
      context.userGroups = req.headers['x-user-groups'].split(',');
    }

    if (req.headers['x-user-region']) {
      context.region = req.headers['x-user-region'];
    }

    return context;
  }

  /**
   * 獲取功能旗標服務實例（用於直接訪問）
   * @returns {FeatureFlagService} 功能旗標服務
   */
  getService() {
    return this.featureFlagService;
  }
}

// 創建單例實例
let middlewareInstance = null;

/**
 * 獲取功能旗標中間件實例
 * @param {Object} cacheService - 快取服務
 * @param {Object} logger - 日誌記錄器
 * @returns {FeatureFlagMiddleware} 中間件實例
 */
function getFeatureFlagMiddleware(cacheService = null, logger = console) {
  if (!middlewareInstance) {
    middlewareInstance = new FeatureFlagMiddleware(cacheService, logger);
  }
  return middlewareInstance;
}

/**
 * 便捷方法：檢查單個功能旗標
 * @param {string} flagName - 功能旗標名稱
 * @param {Object} options - 選項
 * @returns {Function} Express 中間件函數
 */
function requireFeature(flagName, options = {}) {
  const middleware = getFeatureFlagMiddleware();
  return middleware.requireFeature(flagName, options);
}

/**
 * 便捷方法：檢查多個功能旗標
 * @param {Array<string>} flagNames - 功能旗標名稱陣列
 * @param {Object} options - 選項
 * @returns {Function} Express 中間件函數
 */
function requireFeatures(flagNames, options = {}) {
  const middleware = getFeatureFlagMiddleware();
  return middleware.requireFeatures(flagNames, options);
}

/**
 * 便捷方法：檢查功能旗標但不阻擋
 * @param {Array<string>} flagNames - 功能旗標名稱陣列
 * @returns {Function} Express 中間件函數
 */
function checkFeatures(flagNames) {
  const middleware = getFeatureFlagMiddleware();
  return middleware.checkFeatures(flagNames);
}

module.exports = {
  FeatureFlagMiddleware,
  getFeatureFlagMiddleware,
  requireFeature,
  requireFeatures,
  checkFeatures,
};
