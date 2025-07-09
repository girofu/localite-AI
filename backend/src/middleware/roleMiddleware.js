const { redisConnection } = require('../config/redis');
const { logger } = require('../config/logger');

/**
 * 角色權限中間件
 * 提供角色驗證、權限檢查、快取機制等功能
 */
class RoleMiddleware {
  constructor() {
    // 角色層級定義 - 數字越小權限越高
    this.ROLE_HIERARCHY = {
      superadmin: 0,
      admin: 1,
      merchant: 2,
      user: 3,
      guest: 4,
    };

    // 角色權限映射
    this.ROLE_PERMISSIONS = {
      superadmin: [
        'system.admin',
        'user.manage',
        'merchant.manage',
        'content.manage',
        'monitoring.view',
        'security.manage',
        'feature.manage',
      ],
      admin: [
        'user.manage',
        'merchant.manage',
        'content.manage',
        'monitoring.view',
        'security.manage',
      ],
      merchant: [
        'content.create',
        'content.update',
        'content.delete',
        'product.manage',
        'order.view',
        'analytics.view',
      ],
      user: ['content.read', 'profile.update', 'tour.use', 'rating.create'],
      guest: ['content.read', 'tour.use'],
    };

    // 權限繼承 - 高級角色繼承低級角色的權限
    this.PERMISSION_INHERITANCE = {
      superadmin: ['admin', 'merchant', 'user', 'guest'],
      admin: ['merchant', 'user', 'guest'],
      merchant: ['user', 'guest'],
      user: ['guest'],
      guest: [],
    };

    // Redis 快取前綴
    this.CACHE_PREFIX = {
      USER_ROLE: 'user_role:',
      ROLE_PERMISSIONS: 'role_permissions:',
      PERMISSION_CHECK: 'permission_check:',
    };

    // 快取過期時間（秒）
    this.CACHE_TTL = {
      USER_ROLE: 300, // 5分鐘
      ROLE_PERMISSIONS: 600, // 10分鐘
      PERMISSION_CHECK: 180, // 3分鐘
    };
  }

  /**
   * 獲取角色的所有權限（包括繼承的權限）
   * @param {string} role - 角色名稱
   * @returns {Array} 權限列表
   */
  getRolePermissions(role) {
    if (!role || !this.ROLE_PERMISSIONS[role]) {
      return this.ROLE_PERMISSIONS.guest || [];
    }

    const directPermissions = this.ROLE_PERMISSIONS[role] || [];
    const inheritedRoles = this.PERMISSION_INHERITANCE[role] || [];

    // 合併直接權限和繼承權限
    const allPermissions = new Set(directPermissions);

    // 使用 forEach 替代 for...of 以避免 ESLint 錯誤
    inheritedRoles.forEach((inheritedRole) => {
      const inheritedPermissions = this.ROLE_PERMISSIONS[inheritedRole] || [];
      inheritedPermissions.forEach((permission) => allPermissions.add(permission));
    });

    return Array.from(allPermissions);
  }

  /**
   * 檢查角色是否具有特定權限
   * @param {string} role - 角色名稱
   * @param {string} permission - 權限名稱
   * @returns {boolean} 是否具有權限
   */
  hasPermission(role, permission) {
    const permissions = this.getRolePermissions(role);
    return permissions.includes(permission);
  }

  /**
   * 檢查角色層級是否足夠
   * @param {string} userRole - 用戶角色
   * @param {string} requiredRole - 所需角色
   * @returns {boolean} 是否滿足角色要求
   */
  hasRoleLevel(userRole, requiredRole) {
    const userLevel = this.ROLE_HIERARCHY[userRole] ?? 999;
    const requiredLevel = this.ROLE_HIERARCHY[requiredRole] ?? 999;

    return userLevel <= requiredLevel;
  }

  /**
   * 從快取獲取用戶角色
   * @param {string} userId - 用戶ID
   * @returns {Promise<string|null>} 用戶角色或null
   */
  async getCachedUserRole(userId) {
    try {
      const cacheKey = `${this.CACHE_PREFIX.USER_ROLE}${userId}`;
      const cachedRole = await redisConnection.get(cacheKey);

      if (cachedRole) {
        logger.debug('從快取獲取用戶角色', { userId, role: cachedRole });
        return cachedRole;
      }

      return null;
    } catch (error) {
      logger.error('獲取快取用戶角色失敗', {
        userId,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * 快取用戶角色
   * @param {string} userId - 用戶ID
   * @param {string} role - 用戶角色
   * @returns {Promise<boolean>} 是否成功
   */
  async cacheUserRole(userId, role) {
    try {
      const cacheKey = `${this.CACHE_PREFIX.USER_ROLE}${userId}`;
      await redisConnection.set(cacheKey, role, { ttl: this.CACHE_TTL.USER_ROLE });

      logger.debug('快取用戶角色', { userId, role });
      return true;
    } catch (error) {
      logger.error('快取用戶角色失敗', {
        userId,
        role,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * 從快取獲取權限檢查結果
   * @param {string} userId - 用戶ID
   * @param {string} permission - 權限名稱
   * @returns {Promise<boolean|null>} 權限檢查結果或null
   */
  async getCachedPermissionCheck(userId, permission) {
    try {
      const cacheKey = `${this.CACHE_PREFIX.PERMISSION_CHECK}${userId}:${permission}`;
      const result = await redisConnection.get(cacheKey);

      if (result !== null) {
        logger.debug('從快取獲取權限檢查結果', {
          userId,
          permission,
          result,
        });
        return result;
      }

      return null;
    } catch (error) {
      logger.error('獲取快取權限檢查失敗', {
        userId,
        permission,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * 快取權限檢查結果
   * @param {string} userId - 用戶ID
   * @param {string} permission - 權限名稱
   * @param {boolean} result - 檢查結果
   */
  async cachePermissionCheck(userId, permission, result) {
    try {
      const cacheKey = `${this.CACHE_PREFIX.PERMISSION_CHECK}${userId}:${permission}`;
      await redisConnection.set(cacheKey, result, { ttl: this.CACHE_TTL.PERMISSION_CHECK });

      logger.debug('快取權限檢查結果', {
        userId,
        permission,
        result,
      });
      return true;
    } catch (error) {
      logger.error('快取權限檢查失敗', {
        userId,
        permission,
        result,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * 清理用戶相關的快取
   * @param {string} userId - 用戶ID
   */
  async clearUserCache(userId) {
    try {
      const patterns = [
        `${this.CACHE_PREFIX.USER_ROLE}${userId}`,
        `${this.CACHE_PREFIX.PERMISSION_CHECK}${userId}:*`,
      ];

      // 使用 Promise.all 並行處理所有 patterns，避免 await in loop
      const deletePromises = patterns.map((pattern) => redisConnection.keys(pattern)
        .then((keys) => {
          if (keys.length > 0) {
            return redisConnection.del(...keys);
          }
          return Promise.resolve();
        }));

      await Promise.all(deletePromises);

      logger.info('清理用戶快取', { userId });
      return true;
    } catch (error) {
      logger.error('清理用戶快取失敗', {
        userId,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * 角色驗證中間件工廠函數
   * @param {string|string[]} allowedRoles - 允許的角色
   * @param {Object} options - 配置選項
   * @returns {Function} Express 中間件函數
   */
  requireRole(allowedRoles, options = {}) {
    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    const {
      errorMessage = '權限不足',
      errorCode = 'INSUFFICIENT_ROLE',
      statusCode = 403,
      useCache = true,
    } = options;

    return async (req, res, next) => {
      try {
        // 檢查用戶是否已認證
        if (!req.user) {
          logger.warn('未認證用戶嘗試存取受保護資源', {
            path: req.path,
            method: req.method,
            ip: req.ip,
          });

          return res.status(401).json({
            success: false,
            error: {
              message: '未認證的用戶',
              code: 'UNAUTHENTICATED',
            },
          });
        }

        const userId = req.user.uid;
        let userRole = req.user.role;

        // 如果啟用快取，嘗試從快取獲取角色
        if (useCache && !userRole) {
          userRole = await this.getCachedUserRole(userId);
        }

        // 如果還沒有角色，使用預設角色
        if (!userRole) {
          userRole = 'user';

          // 快取預設角色
          if (useCache) {
            await this.cacheUserRole(userId, userRole);
          }
        }

        // 檢查角色是否被允許
        const hasAccess = roles.some((allowedRole) => this.hasRoleLevel(userRole, allowedRole));

        if (!hasAccess) {
          logger.warn('用戶角色權限不足', {
            userId,
            userRole,
            requiredRoles: roles,
            path: req.path,
            method: req.method,
            ip: req.ip,
          });

          return res.status(statusCode).json({
            success: false,
            error: {
              message: errorMessage,
              code: errorCode,
              required: roles,
              current: userRole,
            },
          });
        }

        // 在請求對象中添加角色資訊
        req.userRole = userRole;
        req.userPermissions = this.getRolePermissions(userRole);

        logger.info('角色驗證成功', {
          userId,
          userRole,
          requiredRoles: roles,
          path: req.path,
          method: req.method,
        });

        return next();
      } catch (error) {
        logger.error('角色驗證中間件錯誤', {
          error: error.message,
          stack: error.stack,
          userId: req.user?.uid,
          path: req.path,
          method: req.method,
        });

        return res.status(500).json({
          success: false,
          error: {
            message: '角色驗證失敗',
            code: 'ROLE_VERIFICATION_ERROR',
          },
        });
      }
    };
  }

  /**
   * 權限檢查中間件工廠函數
   * @param {string|string[]} requiredPermissions - 所需權限
   * @param {Object} options - 配置選項
   * @returns {Function} Express 中間件函數
   */
  requirePermission(requiredPermissions, options = {}) {
    const permissions = Array.isArray(requiredPermissions)
      ? requiredPermissions
      : [requiredPermissions];
    const {
      errorMessage = '權限不足',
      errorCode = 'INSUFFICIENT_PERMISSION',
      statusCode = 403,
      requireAll = false,
      useCache = true,
    } = options;

    return async (req, res, next) => {
      try {
        // 檢查用戶是否已認證
        if (!req.user) {
          return res.status(401).json({
            success: false,
            error: {
              message: '未認證的用戶',
              code: 'UNAUTHENTICATED',
            },
          });
        }

        const userId = req.user.uid;
        let userRole = req.user.role || req.userRole;

        // 如果啟用快取，嘗試從快取獲取角色
        if (useCache && !userRole) {
          userRole = await this.getCachedUserRole(userId);
        }

        // 如果還沒有角色，使用預設角色
        if (!userRole) {
          userRole = 'user';
        }

        // 檢查權限
        const userPermissions = this.getRolePermissions(userRole);

        // 使用 Promise.all 並行處理所有權限檢查，避免 await in loop
        const permissionChecks = permissions.map((permission) => {
          // 檢查快取
          const checkPermission = async () => {
            let hasPermission = null;
            if (useCache) {
              hasPermission = await this.getCachedPermissionCheck(userId, permission);
            }

            // 如果快取中沒有，進行實際檢查
            if (hasPermission === null) {
              hasPermission = userPermissions.includes(permission);

              // 快取結果
              if (useCache) {
                await this.cachePermissionCheck(userId, permission, hasPermission);
              }
            }

            return { permission, hasPermission };
          };

          return checkPermission();
        });

        const permissionCheckResults = await Promise.all(permissionChecks);
        const permissionResults = {};

        // 建立權限結果映射
        permissionCheckResults.forEach((result) => {
          permissionResults[result.permission] = result.hasPermission;
        });

        let hasAccess = false;

        // 根據 requireAll 選項決定邏輯
        if (requireAll) {
          // 需要所有權限
          hasAccess = Object.values(permissionResults).every((result) => result === true);
        } else {
          // 需要任一權限
          hasAccess = Object.values(permissionResults).some((result) => result === true);
        }

        if (!hasAccess) {
          logger.warn('用戶權限不足', {
            userId,
            userRole,
            requiredPermissions: permissions,
            userPermissions,
            permissionResults,
            requireAll,
            path: req.path,
            method: req.method,
            ip: req.ip,
          });

          return res.status(statusCode).json({
            success: false,
            error: {
              message: errorMessage,
              code: errorCode,
              required: permissions,
              current: userPermissions,
              requireAll,
            },
          });
        }

        // 在請求對象中添加權限資訊
        req.userRole = userRole;
        req.userPermissions = userPermissions;
        req.permissionResults = permissionResults;

        logger.info('權限檢查成功', {
          userId,
          userRole,
          requiredPermissions: permissions,
          path: req.path,
          method: req.method,
        });

        return next();
      } catch (error) {
        logger.error('權限檢查中間件錯誤', {
          error: error.message,
          stack: error.stack,
          userId: req.user?.uid,
          path: req.path,
          method: req.method,
        });

        return res.status(500).json({
          success: false,
          error: {
            message: '權限檢查失敗',
            code: 'PERMISSION_CHECK_ERROR',
          },
        });
      }
    };
  }

  /**
   * 組合角色和權限檢查的中間件
   * @param {string|string[]} allowedRoles - 允許的角色
   * @param {string|string[]} requiredPermissions - 所需權限
   * @param {Object} options - 配置選項
   * @returns {Function} Express 中間件函數
   */
  requireRoleAndPermission(allowedRoles, requiredPermissions, options = {}) {
    const roleMiddleware = this.requireRole(allowedRoles, options);
    const permissionMiddleware = this.requirePermission(requiredPermissions, options);

    return async (req, res, next) => {
      // 先檢查角色
      roleMiddleware(req, res, (roleError) => {
        if (roleError) {
          return next(roleError);
        }

        // 再檢查權限
        return permissionMiddleware(req, res, next);
      });
    };
  }

  /**
   * 可選的角色檢查中間件
   * 如果用戶已認證則檢查角色，否則繼續執行
   * @param {string|string[]} allowedRoles - 允許的角色
   * @param {Object} options - 配置選項
   * @returns {Function} Express 中間件函數
   */
  optionalRole(allowedRoles, options = {}) {
    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    const { useCache = true } = options;

    return async (req, res, next) => {
      try {
        // 如果沒有用戶資訊，直接繼續
        if (!req.user) {
          return next();
        }

        const userId = req.user.uid;
        let userRole = req.user.role;

        // 如果啟用快取，嘗試從快取獲取角色
        if (useCache && !userRole) {
          userRole = await this.getCachedUserRole(userId);
        }

        // 如果還沒有角色，使用預設角色
        if (!userRole) {
          userRole = 'user';
        }

        // 檢查角色並設置資訊
        req.userRole = userRole;
        req.userPermissions = this.getRolePermissions(userRole);
        req.hasRequiredRole = roles.some((role) => this.hasRoleLevel(userRole, role));

        logger.debug('可選角色檢查', {
          userId,
          userRole,
          requiredRoles: roles,
          hasRequiredRole: req.hasRequiredRole,
          path: req.path,
        });

        return next();
      } catch (error) {
        logger.error('可選角色檢查錯誤', {
          error: error.message,
          userId: req.user?.uid,
          path: req.path,
        });

        // 可選檢查失敗時繼續執行
        return next();
      }
    };
  }
}

// 建立單例實例
const roleMiddleware = new RoleMiddleware();

module.exports = {
  roleMiddleware,
  RoleMiddleware,
  requireRole: roleMiddleware.requireRole.bind(roleMiddleware),
  requirePermission: roleMiddleware.requirePermission.bind(roleMiddleware),
  requireRoleAndPermission: roleMiddleware.requireRoleAndPermission.bind(roleMiddleware),
  optionalRole: roleMiddleware.optionalRole.bind(roleMiddleware),
};
