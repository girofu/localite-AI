const crypto = require('crypto');

/**
 * 功能旗標服務
 * 支援金絲雀部署、A/B 測試、功能開關等
 */
class FeatureFlagService {
  constructor(cacheService = null, logger = console) {
    this.cacheService = cacheService;
    this.logger = logger;
    this.flags = new Map();
    this.defaultTTL = 300; // 5 分鐘快取
    this.initialized = false;
  }

  /**
   * 初始化功能旗標服務
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // 載入預設功能旗標
      await this.loadDefaultFlags();
      this.initialized = true;
      this.logger.info('FeatureFlagService 初始化成功');
    } catch (error) {
      this.logger.error('FeatureFlagService 初始化失敗:', error.message);
      throw error;
    }
  }

  /**
   * 載入預設功能旗標配置
   */
  async loadDefaultFlags() {
    const defaultFlags = {
      // AI 相關功能
      ai_tour_generation: {
        enabled: true,
        rolloutPercentage: 100,
        environments: ['development', 'test', 'production'],
        description: 'AI 導覽內容生成功能',
      },
      ai_voice_synthesis: {
        enabled: true,
        rolloutPercentage: 80,
        environments: ['development', 'test', 'production'],
        description: 'AI 語音合成功能',
      },

      // 用戶功能
      user_registration: {
        enabled: true,
        rolloutPercentage: 100,
        environments: ['development', 'test', 'staging', 'production'],
        description: '用戶註冊功能',
      },
      social_login: {
        enabled: false,
        rolloutPercentage: 0,
        environments: ['development', 'test'],
        description: '社交媒體登入功能',
      },

      // 商戶功能
      merchant_dashboard: {
        enabled: true,
        rolloutPercentage: 100,
        environments: ['development', 'test', 'production'],
        description: '商戶後台管理',
      },
      bulk_content_upload: {
        enabled: false,
        rolloutPercentage: 20,
        environments: ['development', 'test'],
        description: '批量內容上傳功能',
      },

      // 支付功能
      payment_integration: {
        enabled: false,
        rolloutPercentage: 0,
        environments: ['development', 'test'],
        description: '支付系統整合',
      },

      // 實驗性功能
      new_ui_design: {
        enabled: false,
        rolloutPercentage: 10,
        environments: ['development', 'test'],
        userGroups: ['beta_testers'],
        description: '新版 UI 設計',
      },
    };

    Object.entries(defaultFlags).forEach(([key, flag]) => {
      this.flags.set(key, {
        ...flag,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
  }

  /**
   * 檢查功能旗標是否啟用
   * @param {string} flagName - 功能旗標名稱
   * @param {Object} context - 使用者上下文 { userId, userGroups, environment, region }
   * @returns {boolean} 是否啟用
   */
  async isEnabled(flagName, context = {}) {
    try {
      // 先從快取獲取（帶獨立錯誤處理）
      const cacheKey = `feature_flag:${flagName}`;
      if (this.cacheService) {
        try {
          const cachedResult = await this.cacheService.get(cacheKey);
          if (cachedResult !== null) {
            return this.evaluateFlag(JSON.parse(cachedResult), context);
          }
        } catch (cacheError) {
          this.logger.warn(`快取獲取失敗 ${flagName}:`, cacheError.message);
          // 繼續從記憶體獲取
        }
      }

      // 從記憶體獲取旗標配置
      const flag = this.flags.get(flagName);
      if (!flag) {
        this.logger.warn(`功能旗標不存在: ${flagName}`);
        return false;
      }

      // 快取旗標配置（帶獨立錯誤處理）
      if (this.cacheService) {
        try {
          await this.cacheService.set(cacheKey, JSON.stringify(flag), this.defaultTTL);
        } catch (cacheError) {
          this.logger.warn(`快取設置失敗 ${flagName}:`, cacheError.message);
          // 繼續評估功能旗標
        }
      }

      return this.evaluateFlag(flag, context);
    } catch (error) {
      this.logger.error(`評估功能旗標失敗 ${flagName}:`, error.message);
      return false;
    }
  }

  /**
   * 評估功能旗標
   * @param {Object} flag - 功能旗標配置
   * @param {Object} context - 使用者上下文
   * @returns {boolean} 是否啟用
   */
  evaluateFlag(flag, context) {
    // 基本啟用檢查
    if (!flag.enabled) {
      return false;
    }

    // 環境檢查
    const currentEnv = process.env.NODE_ENV || 'development';
    if (flag.environments && !flag.environments.includes(currentEnv)) {
      return false;
    }

    // 用戶群體檢查
    if (flag.userGroups && context.userGroups) {
      const hasGroup = flag.userGroups.some((group) => context.userGroups.includes(group));
      if (!hasGroup) {
        return false;
      }
    }

    // 百分比檢查（金絲雀部署核心邏輯）
    if (flag.rolloutPercentage < 100) {
      const hash = this.getUserHash(context.userId || 'anonymous');
      const percentage = (hash % 100) + 1;
      if (percentage > flag.rolloutPercentage) {
        return false;
      }
    }

    return true;
  }

  /**
   * 獲取用戶哈希值（用於一致性百分比分配）
   * @param {string} userId - 用戶ID
   * @returns {number} 哈希值
   */
  getUserHash(userId) {
    const hash = crypto.createHash('md5').update(userId).digest('hex');
    return parseInt(hash.substring(0, 8), 16);
  }

  /**
   * 創建新的功能旗標
   * @param {string} name - 旗標名稱
   * @param {Object} config - 旗標配置
   */
  async createFlag(name, config) {
    const flag = {
      enabled: config.enabled || false,
      rolloutPercentage: config.rolloutPercentage || 0,
      environments: config.environments || ['development'],
      userGroups: config.userGroups || [],
      description: config.description || '',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.flags.set(name, flag);

    // 清除相關快取
    if (this.cacheService) {
      await this.cacheService.delete(`feature_flag:${name}`);
    }

    this.logger.info(`創建功能旗標: ${name}`);
  }

  /**
   * 更新功能旗標
   * @param {string} name - 旗標名稱
   * @param {Object} updates - 更新內容
   */
  async updateFlag(name, updates) {
    const flag = this.flags.get(name);
    if (!flag) {
      throw new Error(`功能旗標不存在: ${name}`);
    }

    const updatedFlag = {
      ...flag,
      ...updates,
      updatedAt: new Date(),
    };

    this.flags.set(name, updatedFlag);

    // 清除相關快取
    if (this.cacheService) {
      await this.cacheService.delete(`feature_flag:${name}`);
    }

    this.logger.info(`更新功能旗標: ${name}`);
  }

  /**
   * 刪除功能旗標
   * @param {string} name - 旗標名稱
   */
  async deleteFlag(name) {
    if (!this.flags.has(name)) {
      throw new Error(`功能旗標不存在: ${name}`);
    }

    this.flags.delete(name);

    // 清除相關快取
    if (this.cacheService) {
      await this.cacheService.delete(`feature_flag:${name}`);
    }

    this.logger.info(`刪除功能旗標: ${name}`);
  }

  /**
   * 獲取所有功能旗標
   * @returns {Object} 所有功能旗標
   */
  getAllFlags() {
    const flags = {};
    Array.from(this.flags.entries()).forEach(([name, flag]) => {
      flags[name] = flag;
    });
    return flags;
  }

  /**
   * 獲取功能旗標統計
   * @returns {Object} 統計資訊
   */
  getStats() {
    const flags = Array.from(this.flags.values());
    return {
      total: flags.length,
      enabled: flags.filter((f) => f.enabled).length,
      disabled: flags.filter((f) => !f.enabled).length,
      canaryDeployment: flags.filter((f) => f.rolloutPercentage < 100 && f.rolloutPercentage > 0)
        .length,
    };
  }
}

module.exports = FeatureFlagService;
