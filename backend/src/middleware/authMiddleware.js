const { getAuth } = require('../config/firebase');
const { logger } = require('./requestLogger');
const jwtService = require('../services/jwtService');

/**
 * Firebase Authentication 中間件
 * 驗證 Firebase ID Token 並將用戶資訊附加到 request 對象
 */
class AuthMiddleware {
  constructor() {
    this.auth = null;
  }

  /**
   * 獲取 Firebase Auth 實例（懶加載）
   */
  getFirebaseAuth() {
    if (!this.auth) {
      try {
        this.auth = getAuth();
      } catch (error) {
        logger.error('Firebase Auth 初始化失敗', { error: error.message });
        throw new Error('認證服務不可用');
      }
    }
    return this.auth;
  }

  /**
   * 從請求中提取 Bearer Token
   */
  // eslint-disable-next-line class-methods-use-this
  extractToken(req) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return null;
    }

    if (!authHeader.startsWith('Bearer ')) {
      return null;
    }

    return authHeader.slice(7); // 移除 "Bearer " 前綴
  }

  /**
   * 開發環境測試用戶 bypass
   * 允許在開發環境和測試環境使用特殊標頭跳過認證
   */
  // eslint-disable-next-line class-methods-use-this
  handleTestUser(req) {
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      return null;
    }

    // 處理大小寫不敏感的標頭
    const testHeader = req.headers['x-test-user'] || req.headers['X-Test-User'];
    if (!testHeader) {
      return null;
    }

    // 根據測試標頭值返回模擬用戶資訊
    const testUsers = {
      'test-user': {
        uid: 'test-user-123',
        email: 'test@localite.com',
        email_verified: true,
        role: 'user',
        name: 'Test User',
      },
      'test-merchant': {
        uid: 'test-merchant-123',
        email: 'merchant@localite.com',
        email_verified: true,
        role: 'merchant',
        name: 'Test Merchant',
      },
      'test-admin': {
        uid: 'test-admin-123',
        email: 'admin@localite.com',
        email_verified: true,
        role: 'admin',
        name: 'Test Admin',
      },
      'security-test': {
        uid: 'security-test-user-123',
        email: 'security-test@localite.com',
        email_verified: true,
        role: 'user',
        name: 'Security Test User',
      },
      'jwt-test': {
        uid: 'jwt-test-user-123',
        email: 'jwt-test@localite.com',
        email_verified: true,
        role: 'user',
        name: 'JWT Test User',
      },
    };

    const testUser = testUsers[testHeader];
    if (testUser) {
      logger.info('使用測試用戶', {
        testUser: testHeader,
        uid: testUser.uid,
        environment: process.env.NODE_ENV,
      });
      return testUser;
    }

    return null;
  }

  /**
   * 驗證 JWT Access Token（系統內部 token）
   */
  // eslint-disable-next-line class-methods-use-this
  async verifyJWTToken(accessToken) {
    try {
      const decoded = await jwtService.verifyAccessToken(accessToken);

      logger.info('JWT token 驗證成功', {
        uid: decoded.uid,
        email: decoded.email,
        sessionId: decoded.sessionId,
      });

      return {
        uid: decoded.uid,
        email: decoded.email,
        role: decoded.role || 'user',
        permissions: decoded.permissions || [],
        sessionId: decoded.sessionId,
        tokenType: 'jwt',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      logger.warn('JWT token 驗證失敗', { error: errorMessage });
      throw new Error(`JWT 驗證失敗: ${errorMessage}`);
    }
  }

  /**
   * 驗證 Firebase ID Token
   */
  async verifyFirebaseToken(idToken) {
    try {
      const auth = this.getFirebaseAuth();
      const decodedToken = await auth.verifyIdToken(idToken);

      logger.info('Firebase token 驗證成功', {
        uid: decodedToken.uid,
        email: decodedToken.email,
      });

      return decodedToken;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';

      // 記錄具體的驗證失敗原因
      if (error.code === 'auth/id-token-expired') {
        logger.warn('Firebase token 已過期', { error: errorMessage });
        throw new Error('認證 token 已過期，請重新登入');
      } else if (error.code === 'auth/id-token-revoked') {
        logger.warn('Firebase token 已被撤銷', { error: errorMessage });
        throw new Error('認證 token 已被撤銷，請重新登入');
      } else if (error.code === 'auth/invalid-id-token') {
        logger.warn('Firebase token 格式無效', { error: errorMessage });
        throw new Error('認證 token 格式無效');
      } else {
        logger.error('Firebase token 驗證失敗', { error: errorMessage });
        throw new Error('認證驗證失敗');
      }
    }
  }

  /**
   * 認證中間件主要邏輯
   */
  authenticate = async (req, res, next) => {
    try {
      // 開發環境：檢查測試用戶
      const testUser = this.handleTestUser(req);
      if (testUser) {
        req.user = testUser;
        return next();
      }

      // 提取 token
      const idToken = this.extractToken(req);
      if (!idToken) {
        return res.status(401).json({
          success: false,
          error: {
            message: '缺少認證 token',
            code: 'MISSING_TOKEN',
          },
        });
      }

      // 雙重驗證：優先嘗試 JWT，後備到 Firebase
      let user;

      try {
        // 優先嘗試 JWT 驗證
        user = await this.verifyJWTToken(idToken);
        logger.info('使用 JWT token 認證');
      } catch (jwtError) {
        logger.info('JWT 驗證失敗，嘗試 Firebase 驗證', {
          jwtError: jwtError.message,
        });

        try {
          // 後備到 Firebase 驗證
          const decodedToken = await this.verifyFirebaseToken(idToken);
          user = {
            uid: decodedToken.uid,
            email: decodedToken.email,
            email_verified: decodedToken.email_verified,
            name: decodedToken.name,
            picture: decodedToken.picture,
            role: decodedToken.role || 'user',
            tokenType: 'firebase',
            firebase: {
              identities: decodedToken.firebase?.identities,
              sign_in_provider: decodedToken.firebase?.sign_in_provider,
            },
          };
          logger.info('使用 Firebase token 認證');
        } catch (firebaseError) {
          logger.error('Firebase 驗證也失敗', {
            firebaseError: firebaseError.message,
          });
          throw new Error('所有認證方式都失敗');
        }
      }

      // 將用戶資訊附加到 request 對象
      req.user = user;

      logger.info('用戶認證成功', {
        uid: req.user.uid,
        email: req.user.email,
        role: req.user.role,
      });

      return next();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '認證失敗';

      logger.error('認證中間件錯誤', {
        error: errorMessage,
        path: req.path,
        method: req.method,
      });

      return res.status(401).json({
        success: false,
        error: {
          message: errorMessage,
          code: 'AUTHENTICATION_FAILED',
        },
      });
    }
  };

  /**
   * 角色檢查中間件工廠函數
   * @param {string|string[]} allowedRoles 允許的角色
   */
  // eslint-disable-next-line class-methods-use-this
  requireRole = allowedRoles => {
    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: {
            message: '未認證的用戶',
            code: 'UNAUTHENTICATED',
          },
        });
      }

      const userRole = req.user.role || 'user';
      if (!roles.includes(userRole)) {
        logger.warn('用戶權限不足', {
          uid: req.user.uid,
          userRole,
          requiredRoles: roles,
          path: req.path,
        });

        return res.status(403).json({
          success: false,
          error: {
            message: '權限不足',
            code: 'INSUFFICIENT_PERMISSIONS',
            required: roles,
            current: userRole,
          },
        });
      }

      return next();
    };
  };

  /**
   * 可選認證中間件
   * 如果有 token 則驗證，沒有則繼續
   */
  optionalAuth = async (req, res, next) => {
    try {
      // 開發環境：檢查測試用戶
      const testUser = this.handleTestUser(req);
      if (testUser) {
        req.user = testUser;
        return next();
      }

      // 提取 token
      const idToken = this.extractToken(req);
      if (!idToken) {
        // 沒有 token，繼續執行但不設置 req.user
        return next();
      }

      // 有 token，嘗試驗證
      const decodedToken = await this.verifyFirebaseToken(idToken);
      req.user = {
        uid: decodedToken.uid,
        email: decodedToken.email,
        email_verified: decodedToken.email_verified,
        name: decodedToken.name,
        picture: decodedToken.picture,
        role: decodedToken.role || 'user',
      };

      return next();
    } catch (error) {
      // 可選認證失敗時，記錄錯誤但繼續執行
      logger.warn('可選認證失敗', { error: error.message });
      return next();
    }
  };
}

// 建立單例實例
const authMiddleware = new AuthMiddleware();

module.exports = {
  authenticate: authMiddleware.authenticate,
  authMiddleware: authMiddleware.authenticate,
  requireRole: authMiddleware.requireRole,
  optionalAuth: authMiddleware.optionalAuth,
  AuthMiddleware, // 導出類別以便測試
};
