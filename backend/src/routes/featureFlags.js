const express = require('express');
const { getFeatureFlagMiddleware } = require('../middleware/featureFlagMiddleware');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

/**
 * 初始化功能旗標中間件
 */
let featureFlagMiddleware;

const initializeMiddleware = async (req, res, next) => {
  if (!featureFlagMiddleware) {
    featureFlagMiddleware = getFeatureFlagMiddleware();
    await featureFlagMiddleware.initialize();
  }
  next();
};

/**
 * 檢查管理員權限的中間件
 */
const requireAdminRole = (req, res, next) => {
  if (!req.user || !req.user.custom_claims || req.user.custom_claims.role !== 'admin') {
    return res.status(403).json({
      error: '需要管理員權限才能管理功能旗標',
    });
  }
  next();
};

/**
 * GET /api/v1/feature-flags
 * 獲取所有功能旗標
 */
router.get('/', initializeMiddleware, authMiddleware, async (req, res) => {
  try {
    const service = featureFlagMiddleware.getService();
    const flags = service.getAllFlags();
    const stats = service.getStats();

    res.json({
      flags,
      stats,
      total: Object.keys(flags).length,
    });
  } catch (error) {
    console.error('獲取功能旗標失敗:', error);
    res.status(500).json({
      error: '獲取功能旗標失敗',
      message: error.message,
    });
  }
});

/**
 * GET /api/v1/feature-flags/check
 * 檢查當前用戶的功能旗標狀態
 */
router.get('/check', initializeMiddleware, authMiddleware, async (req, res) => {
  try {
    const service = featureFlagMiddleware.getService();
    const { flags } = req.query;

    if (!flags) {
      return res.status(400).json({
        error: '請提供要檢查的功能旗標名稱',
        example: '/api/v1/feature-flags/check?flags=ai_tour_generation,user_registration',
      });
    }

    const flagNames = flags.split(',').map((f) => f.trim());
    const context = featureFlagMiddleware.extractUserContext(req);
    const results = {};

    for (const flagName of flagNames) {
      results[flagName] = await service.isEnabled(flagName, context);
    }

    res.json({
      user: {
        id: context.userId,
        groups: context.userGroups,
        environment: context.environment,
      },
      flags: results,
    });
  } catch (error) {
    console.error('檢查功能旗標失敗:', error);
    res.status(500).json({
      error: '檢查功能旗標失敗',
      message: error.message,
    });
  }
});

/**
 * GET /api/v1/feature-flags/stats
 * 獲取功能旗標統計資訊
 */
router.get('/stats', initializeMiddleware, authMiddleware, async (req, res) => {
  try {
    const service = featureFlagMiddleware.getService();
    const stats = service.getStats();

    res.json(stats);
  } catch (error) {
    console.error('獲取統計資訊失敗:', error);
    res.status(500).json({
      error: '獲取統計資訊失敗',
      message: error.message,
    });
  }
});

/**
 * POST /api/v1/feature-flags
 * 創建新的功能旗標（需要管理員權限）
 */
router.post('/', initializeMiddleware, authMiddleware, requireAdminRole, async (req, res) => {
  try {
    const { name, config } = req.body;

    if (!name || !config) {
      return res.status(400).json({
        error: '請提供功能旗標名稱和配置',
        required: ['name', 'config'],
      });
    }

    // 驗證配置格式
    const validConfig = {
      enabled: config.enabled || false,
      rolloutPercentage: Math.max(0, Math.min(100, config.rolloutPercentage || 0)),
      environments: Array.isArray(config.environments) ? config.environments : ['development'],
      userGroups: Array.isArray(config.userGroups) ? config.userGroups : [],
      description: config.description || '',
    };

    const service = featureFlagMiddleware.getService();
    await service.createFlag(name, validConfig);

    res.status(201).json({
      message: '功能旗標創建成功',
      name,
      config: validConfig,
    });
  } catch (error) {
    console.error('創建功能旗標失敗:', error);
    res.status(500).json({
      error: '創建功能旗標失敗',
      message: error.message,
    });
  }
});

/**
 * PUT /api/v1/feature-flags/:name
 * 更新現有的功能旗標（需要管理員權限）
 */
router.put('/:name', initializeMiddleware, authMiddleware, requireAdminRole, async (req, res) => {
  try {
    const { name } = req.params;
    const updates = req.body;

    if (!updates || Object.keys(updates).length === 0) {
      return res.status(400).json({
        error: '請提供要更新的配置',
      });
    }

    // 驗證更新內容
    const validUpdates = {};
    if (typeof updates.enabled === 'boolean') {
      validUpdates.enabled = updates.enabled;
    }
    if (typeof updates.rolloutPercentage === 'number') {
      validUpdates.rolloutPercentage = Math.max(0, Math.min(100, updates.rolloutPercentage));
    }
    if (Array.isArray(updates.environments)) {
      validUpdates.environments = updates.environments;
    }
    if (Array.isArray(updates.userGroups)) {
      validUpdates.userGroups = updates.userGroups;
    }
    if (typeof updates.description === 'string') {
      validUpdates.description = updates.description;
    }

    const service = featureFlagMiddleware.getService();
    await service.updateFlag(name, validUpdates);

    res.json({
      message: '功能旗標更新成功',
      name,
      updates: validUpdates,
    });
  } catch (error) {
    console.error('更新功能旗標失敗:', error);
    if (error.message.includes('不存在')) {
      return res.status(404).json({
        error: error.message,
      });
    }
    res.status(500).json({
      error: '更新功能旗標失敗',
      message: error.message,
    });
  }
});

/**
 * DELETE /api/v1/feature-flags/:name
 * 刪除功能旗標（需要管理員權限）
 */
router.delete(
  '/:name',
  initializeMiddleware,
  authMiddleware,
  requireAdminRole,
  async (req, res) => {
    try {
      const { name } = req.params;

      const service = featureFlagMiddleware.getService();
      await service.deleteFlag(name);

      res.json({
        message: '功能旗標刪除成功',
        name,
      });
    } catch (error) {
      console.error('刪除功能旗標失敗:', error);
      if (error.message.includes('不存在')) {
        return res.status(404).json({
          error: error.message,
        });
      }
      res.status(500).json({
        error: '刪除功能旗標失敗',
        message: error.message,
      });
    }
  },
);

/**
 * POST /api/v1/feature-flags/:name/toggle
 * 快速切換功能旗標開關（需要管理員權限）
 */
router.post(
  '/:name/toggle',
  initializeMiddleware,
  authMiddleware,
  requireAdminRole,
  async (req, res) => {
    try {
      const { name } = req.params;

      const service = featureFlagMiddleware.getService();
      const flags = service.getAllFlags();
      const currentFlag = flags[name];

      if (!currentFlag) {
        return res.status(404).json({
          error: `功能旗標不存在: ${name}`,
        });
      }

      await service.updateFlag(name, { enabled: !currentFlag.enabled });

      res.json({
        message: '功能旗標狀態切換成功',
        name,
        enabled: !currentFlag.enabled,
      });
    } catch (error) {
      console.error('切換功能旗標失敗:', error);
      res.status(500).json({
        error: '切換功能旗標失敗',
        message: error.message,
      });
    }
  },
);

/**
 * POST /api/v1/feature-flags/:name/rollout
 * 調整功能旗標推出百分比（需要管理員權限）
 */
router.post(
  '/:name/rollout',
  initializeMiddleware,
  authMiddleware,
  requireAdminRole,
  async (req, res) => {
    try {
      const { name } = req.params;
      const { percentage } = req.body;

      if (typeof percentage !== 'number' || percentage < 0 || percentage > 100) {
        return res.status(400).json({
          error: '百分比必須是 0-100 之間的數字',
        });
      }

      const service = featureFlagMiddleware.getService();
      await service.updateFlag(name, { rolloutPercentage: percentage });

      res.json({
        message: '推出百分比更新成功',
        name,
        percentage,
      });
    } catch (error) {
      console.error('更新推出百分比失敗:', error);
      if (error.message.includes('不存在')) {
        return res.status(404).json({
          error: error.message,
        });
      }
      res.status(500).json({
        error: '更新推出百分比失敗',
        message: error.message,
      });
    }
  },
);

module.exports = router;
