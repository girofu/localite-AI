const express = require('express');
const { getFeatureFlagMiddleware } = require('../middleware/featureFlagMiddleware');
const { authenticate: authMiddleware } = require('../middleware/authMiddleware');

const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     FeatureFlag:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *           description: 功能旗標名稱
 *         enabled:
 *           type: boolean
 *           description: 是否啟用
 *         rolloutPercentage:
 *           type: number
 *           minimum: 0
 *           maximum: 100
 *           description: 推出百分比（金絲雀部署）
 *         environments:
 *           type: array
 *           items:
 *             type: string
 *           description: 支援的環境
 *         userGroups:
 *           type: array
 *           items:
 *             type: string
 *           description: 支援的用戶群組
 *         description:
 *           type: string
 *           description: 功能描述
 *     FeatureFlagList:
 *       type: object
 *       properties:
 *         flags:
 *           type: object
 *           additionalProperties:
 *             $ref: '#/components/schemas/FeatureFlag'
 *         stats:
 *           type: object
 *           properties:
 *             totalFlags:
 *               type: number
 *             enabledFlags:
 *               type: number
 *             flagsInProduction:
 *               type: number
 *         total:
 *           type: number
 *     FeatureFlagCheck:
 *       type: object
 *       properties:
 *         user:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *             groups:
 *               type: array
 *               items:
 *                 type: string
 *             environment:
 *               type: string
 *         flags:
 *           type: object
 *           additionalProperties:
 *             type: boolean
 */

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
  return next();
};

/**
 * @swagger
 * /api/v1/feature-flags:
 *   get:
 *     summary: 獲取所有功能旗標
 *     description: 獲取系統中所有功能旗標的配置和統計信息
 *     tags:
 *       - Feature Flags
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 成功獲取功能旗標列表
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/FeatureFlagList'
 *             example:
 *               flags:
 *                 ai_tour_generation:
 *                   enabled: true
 *                   rolloutPercentage: 100
 *                   environments: ["development", "test", "production"]
 *                   userGroups: []
 *                   description: "AI 導覽內容生成功能"
 *               stats:
 *                 totalFlags: 5
 *                 enabledFlags: 3
 *                 flagsInProduction: 2
 *               total: 5
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         description: 內部伺服器錯誤
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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
 * @swagger
 * /api/v1/feature-flags/check:
 *   get:
 *     summary: 檢查用戶功能旗標狀態
 *     description: 檢查當前用戶對指定功能旗標的訪問權限
 *     tags:
 *       - Feature Flags
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: flags
 *         required: true
 *         schema:
 *           type: string
 *         description: 要檢查的功能旗標名稱，多個以逗號分隔
 *         example: "ai_tour_generation,user_registration"
 *     responses:
 *       200:
 *         description: 成功檢查功能旗標狀態
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/FeatureFlagCheck'
 *             example:
 *               user:
 *                 id: "user123"
 *                 groups: ["beta_testers"]
 *                 environment: "production"
 *               flags:
 *                 ai_tour_generation: true
 *                 user_registration: false
 *       400:
 *         description: 請求參數錯誤
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 example:
 *                   type: string
 *             example:
 *               error: "請提供要檢查的功能旗標名稱"
 *               example: "/api/v1/feature-flags/check?flags=ai_tour_generation,user_registration"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         description: 內部伺服器錯誤
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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

    const flagNames = flags.split(',').map(f => f.trim());
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
 * @swagger
 * /api/v1/feature-flags/stats:
 *   get:
 *     summary: 獲取功能旗標統計
 *     description: 獲取功能旗標的統計信息，包括總數、啟用數量等
 *     tags:
 *       - Feature Flags
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 成功獲取統計信息
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalFlags:
 *                   type: number
 *                   description: 總功能旗標數量
 *                 enabledFlags:
 *                   type: number
 *                   description: 已啟用的功能旗標數量
 *                 flagsInProduction:
 *                   type: number
 *                   description: 在生產環境中的功能旗標數量
 *                 evaluationCount:
 *                   type: number
 *                   description: 功能旗標評估次數
 *             example:
 *               totalFlags: 5
 *               enabledFlags: 3
 *               flagsInProduction: 2
 *               evaluationCount: 1250
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         description: 內部伺服器錯誤
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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
 * @swagger
 * /api/v1/feature-flags:
 *   post:
 *     summary: 創建功能旗標
 *     description: 創建新的功能旗標配置（需要管理員權限）
 *     tags:
 *       - Feature Flags
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - config
 *             properties:
 *               name:
 *                 type: string
 *                 description: 功能旗標名稱
 *               config:
 *                 type: object
 *                 properties:
 *                   enabled:
 *                     type: boolean
 *                     description: 是否啟用
 *                   rolloutPercentage:
 *                     type: number
 *                     minimum: 0
 *                     maximum: 100
 *                     description: 推出百分比
 *                   environments:
 *                     type: array
 *                     items:
 *                       type: string
 *                     description: 支援的環境
 *                   userGroups:
 *                     type: array
 *                     items:
 *                       type: string
 *                     description: 支援的用戶群組
 *                   description:
 *                     type: string
 *                     description: 功能描述
 *           example:
 *             name: "new_dashboard_feature"
 *             config:
 *               enabled: true
 *               rolloutPercentage: 25
 *               environments: ["development", "staging"]
 *               userGroups: ["beta_testers"]
 *               description: "新版儀表板功能"
 *     responses:
 *       201:
 *         description: 成功創建功能旗標
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 name:
 *                   type: string
 *                 config:
 *                   $ref: '#/components/schemas/FeatureFlag'
 *       400:
 *         description: 請求參數錯誤
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         description: 內部伺服器錯誤
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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
 * @swagger
 * /api/v1/feature-flags/{name}:
 *   put:
 *     summary: 更新功能旗標
 *     description: 更新現有功能旗標的配置（需要管理員權限）
 *     tags:
 *       - Feature Flags
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: 功能旗標名稱
 *         example: "ai_tour_generation"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled:
 *                 type: boolean
 *                 description: 是否啟用
 *               rolloutPercentage:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 100
 *                 description: 推出百分比
 *               environments:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: 支援的環境
 *               userGroups:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: 支援的用戶群組
 *               description:
 *                 type: string
 *                 description: 功能描述
 *           example:
 *             enabled: false
 *             rolloutPercentage: 0
 *             description: "暫時停用 AI 導覽功能進行維護"
 *     responses:
 *       200:
 *         description: 成功更新功能旗標
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 name:
 *                   type: string
 *                 updates:
 *                   type: object
 *       400:
 *         description: 請求參數錯誤
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         description: 內部伺服器錯誤
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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
 * @swagger
 * /api/v1/feature-flags/{name}:
 *   delete:
 *     summary: 刪除功能旗標
 *     description: 刪除指定的功能旗標（需要管理員權限）
 *     tags:
 *       - Feature Flags
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: 功能旗標名稱
 *         example: "deprecated_feature"
 *     responses:
 *       200:
 *         description: 成功刪除功能旗標
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 name:
 *                   type: string
 *             example:
 *               message: "功能旗標刪除成功"
 *               name: "deprecated_feature"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         description: 內部伺服器錯誤
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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
  }
);

/**
 * @swagger
 * /api/v1/feature-flags/{name}/toggle:
 *   post:
 *     summary: 切換功能旗標開關
 *     description: 快速切換功能旗標的啟用/停用狀態（需要管理員權限）
 *     tags:
 *       - Feature Flags
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: 功能旗標名稱
 *         example: "ai_tour_generation"
 *     responses:
 *       200:
 *         description: 成功切換功能旗標狀態
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 name:
 *                   type: string
 *                 enabled:
 *                   type: boolean
 *             example:
 *               message: "功能旗標狀態切換成功"
 *               name: "ai_tour_generation"
 *               enabled: false
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         description: 內部伺服器錯誤
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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
  }
);

/**
 * @swagger
 * /api/v1/feature-flags/{name}/rollout:
 *   post:
 *     summary: 調整推出百分比
 *     description: 調整功能旗標的金絲雀部署推出百分比（需要管理員權限）
 *     tags:
 *       - Feature Flags
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: 功能旗標名稱
 *         example: "ai_tour_generation"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - percentage
 *             properties:
 *               percentage:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 100
 *                 description: 推出百分比（0-100）
 *           example:
 *             percentage: 50
 *     responses:
 *       200:
 *         description: 成功更新推出百分比
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 name:
 *                   type: string
 *                 percentage:
 *                   type: number
 *             example:
 *               message: "推出百分比更新成功"
 *               name: "ai_tour_generation"
 *               percentage: 50
 *       400:
 *         description: 請求參數錯誤
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         description: 內部伺服器錯誤
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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
  }
);

module.exports = router;
