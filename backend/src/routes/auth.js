const express = require('express');
const { getAuth } = require('../config/firebase');
const User = require('../models/User');
const { authMiddleware: authenticate, requireRole } = require('../middleware/authMiddleware');
const { logger } = require('../middleware/requestLogger');
const jwtService = require('../services/jwtService');
const { securityEnhancement } = require('../middleware/securityEnhancement');
const { rateLimitMiddleware } = require('../middleware/rateLimitMiddleware');
const MFAService = require('../services/mfaService');

const router = express.Router();

// 創建 MFA 服務實例
const mfaService = new MFAService();

// 獲取專業級 Rate Limiting 配置
const rateLimiters = rateLimitMiddleware.getDefaultLimiters();

// Rate limiting 配置 - 使用真正的中間件而非備用中間件
const generalLimiter = rateLimiters.general;
const authLimiter = rateLimiters.auth;
const sensitiveOperationLimiter = rateLimiters.sensitive;

// 設備指紋提取中間件
const extractDeviceFingerprint = (req, res, next) => {
  // 從請求頭中提取設備指紋相關資訊
  const userAgent = req.get('User-Agent') || '';
  const acceptLanguage = req.get('Accept-Language') || '';
  const acceptEncoding = req.get('Accept-Encoding') || '';

  // 簡單的設備指紋生成（實際應用中可以使用更複雜的演算法）
  // eslint-disable-next-line global-require
  const fingerprint = require('crypto')
    .createHash('sha256')
    .update(`${userAgent}${acceptLanguage}${acceptEncoding}`)
    .digest('hex')
    .substring(0, 16);

  req.deviceFingerprint = fingerprint;
  next();
};

// 請求上下文提取中間件
const extractRequestContext = (req, res, next) => {
  req.securityContext = {
    ipAddress: req.ip || req.connection.remoteAddress,
    deviceFingerprint: req.deviceFingerprint,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString(),
  };
  next();
};

/**
 * @swagger
 * components:
 *   schemas:
 *     UserProfile:
 *       type: object
 *       properties:
 *         firstName:
 *           type: string
 *           maxLength: 50
 *         lastName:
 *           type: string
 *           maxLength: 50
 *         displayName:
 *           type: string
 *           maxLength: 100
 *         avatar:
 *           type: string
 *           format: uri
 *         phoneNumber:
 *           type: string
 *           pattern: '^(\+886|0)?9\d{8}$'
 *         dateOfBirth:
 *           type: string
 *           format: date
 *         location:
 *           type: object
 *           properties:
 *             city:
 *               type: string
 *             country:
 *               type: string
 *               default: 'TW'
 *
 *     UserPreferences:
 *       type: object
 *       properties:
 *         language:
 *           type: string
 *           enum: ['zh-TW', 'zh-CN', 'en-US']
 *           default: 'zh-TW'
 *         notifications:
 *           type: object
 *           properties:
 *             email:
 *               type: boolean
 *               default: true
 *             push:
 *               type: boolean
 *               default: true
 *             marketing:
 *               type: boolean
 *               default: false
 *         tourPreferences:
 *           type: object
 *           properties:
 *             voiceEnabled:
 *               type: boolean
 *               default: true
 *             autoPlay:
 *               type: boolean
 *               default: false
 *             playbackSpeed:
 *               type: number
 *               minimum: 0.5
 *               maximum: 2.0
 *               default: 1.0
 *         privacy:
 *           type: object
 *           properties:
 *             shareProfile:
 *               type: boolean
 *               default: false
 *             shareLocation:
 *               type: boolean
 *               default: true
 *             dataCollection:
 *               type: boolean
 *               default: true
 *
 *     MerchantInfo:
 *       type: object
 *       properties:
 *         businessName:
 *           type: string
 *         businessType:
 *           type: string
 *           enum: ['restaurant', 'hotel', 'attraction', 'retail', 'service', 'other']
 *         registrationNumber:
 *           type: string
 *         description:
 *           type: string
 *         website:
 *           type: string
 *           format: uri
 *         address:
 *           type: object
 *           properties:
 *             street:
 *               type: string
 *             city:
 *               type: string
 *             postalCode:
 *               type: string
 *             country:
 *               type: string
 *               default: 'TW'
 *
 *     User:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         firebaseUid:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         emailVerified:
 *           type: boolean
 *         role:
 *           type: string
 *           enum: ['user', 'merchant', 'admin']
 *         status:
 *           type: string
 *           enum: ['active', 'inactive', 'suspended', 'pending']
 *         profile:
 *           $ref: '#/components/schemas/UserProfile'
 *         preferences:
 *           $ref: '#/components/schemas/UserPreferences'
 *         merchantInfo:
 *           $ref: '#/components/schemas/MerchantInfo'
 *         fullName:
 *           type: string
 *           readOnly: true
 *         isMerchant:
 *           type: boolean
 *           readOnly: true
 *         isVerifiedMerchant:
 *           type: boolean
 *           readOnly: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *
 *     RegisterRequest:
 *       type: object
 *       required:
 *         - firebaseUid
 *         - email
 *       properties:
 *         firebaseUid:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         role:
 *           type: string
 *           enum: ['user', 'merchant']
 *           default: 'user'
 *         profile:
 *           $ref: '#/components/schemas/UserProfile'
 *         preferences:
 *           $ref: '#/components/schemas/UserPreferences'
 *         merchantInfo:
 *           $ref: '#/components/schemas/MerchantInfo'
 *         agreementAccepted:
 *           type: boolean
 *           description: 是否同意服務條款和隱私政策
 *         marketingConsent:
 *           type: boolean
 *           description: 是否同意接收行銷資訊
 *
 *     LoginRequest:
 *       type: object
 *       required:
 *         - firebaseUid
 *       properties:
 *         firebaseUid:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         providerId:
 *           type: string
 *           enum: ['password', 'google.com', 'facebook.com', 'apple.com']
 */

/**
 * @swagger
 * /api/v1/auth/register:
 *   post:
 *     summary: 用戶註冊
 *     description: 註冊新用戶，支援一般用戶和商戶用戶
 *     tags: [Authentication]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *     responses:
 *       201:
 *         description: 註冊成功
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
 *                   example: 用戶註冊成功
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *       400:
 *         description: 請求參數錯誤
 *       401:
 *         description: 認證失敗
 *       409:
 *         description: 用戶已存在
 *       500:
 *         description: 伺服器錯誤
 */
router.post(
  '/register',
  authLimiter, // 增加rate limiting
  extractDeviceFingerprint, // 提取設備指紋
  extractRequestContext, // 提取請求上下文
  authenticate,
  async (req, res) => {
    try {
      const {
        firebaseUid,
        email,
        role = 'user',
        profile,
        preferences,
        merchantInfo,
        agreementAccepted,
        marketingConsent,
      } = req.body;

      // 基本參數驗證
      if (!firebaseUid || !email) {
        return res.status(400).json({
          success: false,
          error: {
            message: 'firebaseUid 和 email 為必填欄位',
            code: 'MISSING_REQUIRED_FIELDS',
          },
        });
      }

      // 檢查是否已存在相同用戶
      const existingUser = await User.findOne({
        $or: [{ firebaseUid }, { email: email.toLowerCase() }],
      });

      if (existingUser) {
        return res.status(409).json({
          success: false,
          error: {
            message: '用戶已存在',
            code: 'USER_ALREADY_EXISTS',
          },
        });
      }

      // 商戶註冊需要商戶資訊
      if (role === 'merchant' && (!merchantInfo || !merchantInfo.businessName)) {
        return res.status(400).json({
          success: false,
          error: {
            message: '商戶註冊需要提供商戶資訊',
            code: 'MERCHANT_INFO_REQUIRED',
          },
        });
      }

      // 從 Firebase token 獲取用戶資訊
      const firebaseUser = req.user;

      // 建立新用戶
      const userData = {
        firebaseUid,
        email: email.toLowerCase(),
        emailVerified: firebaseUser.email_verified || false,
        role,
        profile: profile || {},
        preferences: preferences || {},
        providers: [
          {
            providerId: firebaseUser.firebase?.sign_in_provider || 'password',
            providerUid: firebaseUser.uid,
            connectedAt: new Date(),
          },
        ],
      };

      // 添加商戶資訊
      if (role === 'merchant' && merchantInfo) {
        userData.merchantInfo = merchantInfo;
      }

      // 設定同意條款
      if (agreementAccepted) {
        userData.agreements = {
          termsAcceptedAt: new Date(),
          privacyAcceptedAt: new Date(),
        };
      }

      if (marketingConsent) {
        userData.agreements = {
          ...userData.agreements,
          marketingConsentAt: new Date(),
        };
      }

      const newUser = new User(userData);
      await newUser.save();

      logger.info('用戶註冊成功', {
        uid: newUser.firebaseUid,
        email: newUser.email,
        role: newUser.role,
      });

      return res.status(201).json({
        success: true,
        message: '用戶註冊成功',
        data: {
          user: newUser.toJSON(),
        },
      });
    } catch (error) {
      logger.error('用戶註冊失敗', {
        error: error.message,
        email: req.body?.email,
      });

      if (error.name === 'ValidationError') {
        return res.status(400).json({
          success: false,
          error: {
            message: '資料驗證失敗',
            code: 'VALIDATION_ERROR',
            details: Object.values(error.errors).map(err => err.message),
          },
        });
      }

      return res.status(500).json({
        success: false,
        error: {
          message: '伺服器錯誤',
          code: 'INTERNAL_SERVER_ERROR',
        },
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/auth/profile:
 *   get:
 *     summary: 獲取用戶個人檔案
 *     description: 獲取當前登入用戶的完整個人檔案資訊
 *     tags: [Authentication]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: 成功獲取用戶資料
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
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *       401:
 *         description: 認證失敗
 *       404:
 *         description: 用戶不存在
 *       500:
 *         description: 伺服器錯誤
 */
router.get('/profile', generalLimiter, authenticate, async (req, res) => {
  try {
    const user = await User.findByFirebaseUid(req.user.uid);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          message: '用戶不存在',
          code: 'USER_NOT_FOUND',
        },
      });
    }

    return res.json({
      success: true,
      data: {
        user: user.toJSON(),
      },
    });
  } catch (error) {
    logger.error('獲取用戶資料失敗', {
      error: error.message,
      uid: req.user?.uid,
    });

    return res.status(500).json({
      success: false,
      error: {
        message: '伺服器錯誤',
        code: 'INTERNAL_SERVER_ERROR',
      },
    });
  }
});

/**
 * @swagger
 * /api/v1/auth/verify-email:
 *   post:
 *     summary: 發送 Email 驗證
 *     description: 發送 Email 驗證連結到用戶信箱
 *     tags: [Authentication]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: 驗證信件發送成功
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
 *                   example: 驗證信件已發送
 *       401:
 *         description: 認證失敗
 *       429:
 *         description: 發送過於頻繁
 *       500:
 *         description: 伺服器錯誤
 */
router.post('/verify-email', sensitiveOperationLimiter, authenticate, async (req, res) => {
  try {
    const firebaseAuth = getAuth();
    const user = await User.findByFirebaseUid(req.user.uid);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          message: '用戶不存在',
          code: 'USER_NOT_FOUND',
        },
      });
    }

    if (user.emailVerified) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Email 已驗證',
          code: 'EMAIL_ALREADY_VERIFIED',
        },
      });
    }

    // 使用 Firebase Admin SDK 生成驗證連結
    const actionCodeSettings = {
      url:
        process.env.EMAIL_VERIFICATION_REDIRECT_URL || 'http://localhost:3000/auth/verify-success',
      handleCodeInApp: true,
    };

    const verificationLink = await firebaseAuth.generateEmailVerificationLink(
      user.email,
      actionCodeSettings
    );

    // 這裡應該集成實際的郵件發送服務 (例如 SendGrid, AWS SES)
    // 目前只是記錄 log，實際應用中需要發送郵件
    logger.info('Email 驗證連結已生成', {
      uid: user.firebaseUid,
      email: user.email,
      verificationLink,
    });

    return res.json({
      success: true,
      message: '驗證信件已發送',
      data: {
        // 開發環境才返回驗證連結
        ...(process.env.NODE_ENV === 'development' && { verificationLink }),
      },
    });
  } catch (error) {
    logger.error('發送 Email 驗證失敗', {
      error: error.message,
      uid: req.user?.uid,
    });

    return res.status(500).json({
      success: false,
      error: {
        message: '發送驗證信件失敗',
        code: 'EMAIL_VERIFICATION_FAILED',
      },
    });
  }
});

/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     summary: 用戶登入
 *     description: 用戶登入並更新登入統計資訊
 *     tags: [Authentication]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: 登入成功
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
 *                   example: 登入成功
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *       401:
 *         description: 認證失敗
 *       403:
 *         description: 帳戶已暫停
 *       404:
 *         description: 用戶不存在
 *       500:
 *         description: 伺服器錯誤
 */
router.post(
  '/login',
  authLimiter, // 專業級認證限制器
  extractDeviceFingerprint, // 提取設備指紋
  extractRequestContext, // 提取請求上下文
  authenticate, // Firebase 認證
  async (req, res) => {
    try {
      const { firebaseUid, providerId } = req.body;
      const userIdentifier = firebaseUid || req.user.uid;

      // 1. 檢查帳號是否被鎖定（安全增強功能）
      const lockCheck = await securityEnhancement.checkAccountLock(userIdentifier);
      if (lockCheck.locked) {
        logger.warn('嘗試登入被鎖定的帳號', {
          identifier: userIdentifier,
          lockReason: lockCheck.reason,
          ip: req.securityContext.ipAddress,
          endpoint: req.originalUrl,
        });

        // 記錄安全事件
        await securityEnhancement.recordSecurityEvent(
          userIdentifier,
          'locked_account_access_attempt',
          {
            ...req.securityContext,
            lockReason: lockCheck.reason,
          }
        );

        return res.status(423).json({
          success: false,
          error: {
            message: `帳號已被鎖定：${lockCheck.reason}`,
            code: 'ACCOUNT_LOCKED',
            lockedUntil: lockCheck.lockedUntil,
            canRetryAt: new Date(lockCheck.lockedUntil).toISOString(),
          },
        });
      }

      const user = await User.findByFirebaseUid(userIdentifier);

      if (!user) {
        // 記錄登入失敗
        await securityEnhancement.recordLoginFailure(userIdentifier, {
          ...req.securityContext,
          reason: 'user_not_found',
        });

        return res.status(404).json({
          success: false,
          error: {
            message: '用戶不存在，請先註冊',
            code: 'USER_NOT_FOUND',
          },
        });
      }

      // 檢查帳戶狀態
      if (user.status === 'suspended') {
        return res.status(403).json({
          success: false,
          error: {
            message: '帳戶已被暫停',
            code: 'ACCOUNT_SUSPENDED',
          },
        });
      }

      if (user.status === 'inactive') {
        return res.status(403).json({
          success: false,
          error: {
            message: '帳戶未啟用',
            code: 'ACCOUNT_INACTIVE',
          },
        });
      }

      // 分析登入模式（檢查可疑活動）
      const loginAnalysis = await securityEnhancement.analyzeLoginPattern(user.firebaseUid, {
        ...req.securityContext,
        providerId: providerId || 'password',
      });

      if (loginAnalysis.suspicious) {
        logger.warn('檢測到可疑登入模式', {
          uid: user.firebaseUid,
          riskScore: loginAnalysis.riskScore,
          reasons: loginAnalysis.reasons,
          ip: req.securityContext.ipAddress,
        });

        // 如果風險分數過高，可以要求額外驗證或通知用戶
        if (loginAnalysis.riskScore >= 60) {
          // 記錄高風險登入事件
          await securityEnhancement.recordSecurityEvent(user.firebaseUid, 'high_risk_login', {
            ...req.securityContext,
            riskScore: loginAnalysis.riskScore,
            reasons: loginAnalysis.reasons,
          });
        }
      }

      // 清除之前的登入失敗記錄
      await securityEnhancement.clearLoginFailures(user.firebaseUid);

      // 更新登入統計
      await user.updateLoginStats();

      // 添加登入提供者（如果是新的）
      if (providerId) {
        await user.addProvider(providerId);
      }

      logger.info('用戶登入成功', {
        uid: user.firebaseUid,
        email: user.email,
        loginCount: user.stats.loginCount,
        riskScore: loginAnalysis.riskScore || 0,
        suspicious: loginAnalysis.suspicious || false,
      });

      return res.json({
        success: true,
        message: '登入成功',
        data: {
          user: user.toJSON(),
        },
      });
    } catch (error) {
      logger.error('用戶登入失敗', {
        error: error.message,
        uid: req.user?.uid,
      });

      return res.status(500).json({
        success: false,
        error: {
          message: '登入失敗',
          code: 'LOGIN_FAILED',
        },
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/auth/logout:
 *   post:
 *     summary: 用戶登出
 *     description: 用戶登出（前端應該清除 token）
 *     tags: [Authentication]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: 登出成功
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
 *                   example: 登出成功
 *       401:
 *         description: 認證失敗
 *       500:
 *         description: 伺服器錯誤
 */
router.post('/logout', authenticate, async (req, res) => {
  try {
    logger.info('用戶登出', {
      uid: req.user.uid,
      email: req.user.email,
    });

    // 在實際應用中，可能需要將 token 加入黑名單
    // 或者撤銷 Firebase token (需要額外的 Firebase Admin 操作)

    return res.json({
      success: true,
      message: '登出成功',
    });
  } catch (error) {
    logger.error('用戶登出失敗', {
      error: error.message,
      uid: req.user?.uid,
    });

    return res.status(500).json({
      success: false,
      error: {
        message: '登出失敗',
        code: 'LOGOUT_FAILED',
      },
    });
  }
});

// ============ JWT Token 管理路由 ============

/**
 * @swagger
 * /api/v1/auth/generate-tokens:
 *   post:
 *     summary: 生成 JWT Token 對
 *     description: 為已認證用戶生成 JWT access token 和 refresh token
 *     tags: [JWT Management]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Token 生成成功
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
 *                   example: Token 生成成功
 *                 data:
 *                   type: object
 *                   properties:
 *                     accessToken:
 *                       type: string
 *                       description: JWT Access Token
 *                     refreshToken:
 *                       type: string
 *                       description: JWT Refresh Token
 *                     tokenType:
 *                       type: string
 *                       example: Bearer
 *                     expiresIn:
 *                       type: number
 *                       description: Token 過期時間（秒）
 *                     sessionId:
 *                       type: string
 *                       description: Session ID
 *       401:
 *         description: 認證失敗
 *       500:
 *         description: Token 生成失敗
 */
router.post(
  '/generate-tokens',
  sensitiveOperationLimiter, // 敏感操作限制器（使用專業級限制）
  extractDeviceFingerprint, // 提取設備指紋
  extractRequestContext, // 提取請求上下文
  authenticate, // Firebase 認證
  async (req, res) => {
    try {
      const user = await User.findByFirebaseUid(req.user.uid);

      if (!user) {
        return res.status(404).json({
          success: false,
          error: {
            message: '用戶不存在',
            code: 'USER_NOT_FOUND',
          },
        });
      }

      // 1. 安全檢查 - 檢查帳號狀態和鎖定
      const lockCheck = await securityEnhancement.checkAccountLock(user.firebaseUid);
      if (lockCheck.locked) {
        logger.warn('被鎖定帳號嘗試生成 Token', {
          uid: user.firebaseUid,
          lockReason: lockCheck.reason,
          ip: req.securityContext.ipAddress,
        });

        return res.status(423).json({
          success: false,
          error: {
            message: `帳號已被鎖定，無法生成 Token：${lockCheck.reason}`,
            code: 'ACCOUNT_LOCKED',
            lockedUntil: lockCheck.lockedUntil,
          },
        });
      }

      // 2. 分析登入模式和風險評估
      const loginAnalysis = await securityEnhancement.analyzeLoginPattern(user.firebaseUid, {
        ...req.securityContext,
        providerId: 'jwt_generation',
      });

      if (loginAnalysis.suspicious && loginAnalysis.riskScore >= 50) {
        logger.warn('高風險 Token 生成請求', {
          uid: user.firebaseUid,
          riskScore: loginAnalysis.riskScore,
          reasons: loginAnalysis.reasons,
          ip: req.securityContext.ipAddress,
        });

        // 記錄高風險事件
        await securityEnhancement.recordSecurityEvent(
          user.firebaseUid,
          'high_risk_token_generation',
          {
            ...req.securityContext,
            riskScore: loginAnalysis.riskScore,
            reasons: loginAnalysis.reasons,
          }
        );

        // 高風險情況下要求額外驗證
        return res.status(200).json({
          success: false,
          requiresAdditionalVerification: true,
          message: '檢測到可疑活動，需要額外驗證',
          data: {
            riskScore: loginAnalysis.riskScore,
            reasons: loginAnalysis.reasons,
            nextSteps: ['請使用 MFA 驗證', '或聯繫客服驗證身份'],
          },
        });
      }

      // 3. 檢查 MFA 狀態（如果已啟用）
      const mfaEnabled = await mfaService.isMFAEnabled(user.firebaseUid);
      if (mfaEnabled) {
        const mfaVerified = req.headers['x-mfa-verified'] === 'true' || req.user.mfaVerified;
        if (!mfaVerified) {
          const mfaStatus = await mfaService.getUserMFAStatus(user.firebaseUid);

          logger.info('Token 生成需要 MFA 驗證', {
            uid: user.firebaseUid,
            enabledMethods: mfaStatus.enabledMethods,
          });

          return res.status(200).json({
            success: false,
            requiresMFA: true,
            message: 'Token 生成需要多重驗證',
            data: {
              availableMethods: mfaStatus.enabledMethods,
              operation: 'token_generation',
            },
          });
        }
      }

      // 提取請求上下文
      const { deviceFingerprint } = req.body;
      const requestContext = {
        ipAddress: req.ip || req.connection.remoteAddress,
        deviceFingerprint,
        userAgent: req.get('User-Agent'),
        loginMethod: 'jwt_generation',
        riskScore: loginAnalysis.riskScore || 0,
      };

      // 生成 JWT token 對（帶上下文）
      const tokenPair = await jwtService.generateTokenPair(
        {
          firebaseUid: user.firebaseUid,
          email: user.email,
          role: user.role,
          permissions: user.permissions || [],
        },
        requestContext
      );

      logger.info('JWT Token 對生成成功', {
        uid: user.firebaseUid,
        email: user.email,
        sessionId: tokenPair.sessionId,
        ipAddress: requestContext.ipAddress,
      });

      return res.json({
        success: true,
        message: 'Token 生成成功',
        data: tokenPair,
      });
    } catch (error) {
      logger.error('JWT Token 生成失敗', {
        error: error.message,
        uid: req.user?.uid,
      });

      return res.status(500).json({
        success: false,
        error: {
          message: 'Token 生成失敗',
          code: 'TOKEN_GENERATION_FAILED',
        },
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/auth/refresh-token:
 *   post:
 *     summary: 刷新 Access Token
 *     description: 使用 refresh token 獲取新的 access token
 *     tags: [JWT Management]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 description: Refresh Token
 *     responses:
 *       200:
 *         description: Token 刷新成功
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
 *                   example: Token 刷新成功
 *                 data:
 *                   type: object
 *                   properties:
 *                     accessToken:
 *                       type: string
 *                       description: 新的 JWT Access Token
 *                     tokenType:
 *                       type: string
 *                       example: Bearer
 *                     expiresIn:
 *                       type: number
 *                       description: Token 過期時間（秒）
 *       400:
 *         description: 請求參數錯誤
 *       401:
 *         description: Refresh token 無效或已過期
 *       500:
 *         description: Token 刷新失敗
 */
router.post(
  '/refresh-token',
  authLimiter, // 認證限制器
  extractDeviceFingerprint,
  extractRequestContext,
  async (req, res) => {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          error: {
            message: '缺少 refresh token',
            code: 'MISSING_REFRESH_TOKEN',
          },
        });
      }

      // 提取請求上下文進行安全驗證
      const requestContext = {
        ...req.securityContext,
        loginMethod: 'token_refresh',
      };

      // 刷新 access token（帶上下文）
      const newToken = await jwtService.refreshAccessToken(refreshToken, requestContext);

      logger.info('Access Token 刷新成功', {
        ipAddress: requestContext.ipAddress,
        deviceFingerprint: requestContext.deviceFingerprint,
      });

      return res.json({
        success: true,
        message: 'Token 刷新成功',
        data: newToken,
      });
    } catch (error) {
      logger.error('Token 刷新失敗', {
        error: error.message,
      });

      return res.status(401).json({
        success: false,
        error: {
          message: error.message || 'Token 刷新失敗',
          code: 'TOKEN_REFRESH_FAILED',
        },
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/auth/revoke-token:
 *   post:
 *     summary: 撤銷 Token
 *     description: 撤銷指定的 access token 或 refresh token
 *     tags: [JWT Management]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token:
 *                 type: string
 *                 description: 要撤銷的 token（可選，預設撤銷當前 token）
 *     responses:
 *       200:
 *         description: Token 撤銷成功
 *       401:
 *         description: 認證失敗
 *       500:
 *         description: Token 撤銷失敗
 */
router.post('/revoke-token', sensitiveOperationLimiter, authenticate, async (req, res) => {
  try {
    const { token } = req.body;

    // 如果沒有指定 token，撤銷當前請求的 token
    const tokenToRevoke = token || req.headers.authorization?.slice(7);

    if (!tokenToRevoke) {
      return res.status(400).json({
        success: false,
        error: {
          message: '缺少要撤銷的 token',
          code: 'MISSING_TOKEN',
        },
      });
    }

    await jwtService.revokeToken(tokenToRevoke);

    logger.info('Token 撤銷成功', {
      uid: req.user.uid,
      email: req.user.email,
    });

    return res.json({
      success: true,
      message: 'Token 撤銷成功',
    });
  } catch (error) {
    logger.error('Token 撤銷失敗', {
      error: error.message,
      uid: req.user?.uid,
    });

    return res.status(500).json({
      success: false,
      error: {
        message: 'Token 撤銷失敗',
        code: 'TOKEN_REVOCATION_FAILED',
      },
    });
  }
});

/**
 * @swagger
 * /api/v1/auth/revoke-all-tokens:
 *   post:
 *     summary: 撤銷所有 Token
 *     description: 撤銷用戶的所有 JWT token（登出所有設備）
 *     tags: [JWT Management]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: 所有 Token 撤銷成功
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
 *                   example: 所有 Token 撤銷成功
 *                 data:
 *                   type: object
 *                   properties:
 *                     revokedTokens:
 *                       type: number
 *                       description: 撤銷的 token 數量
 *       401:
 *         description: 認證失敗
 *       500:
 *         description: Token 撤銷失敗
 */
router.post('/revoke-all-tokens', authenticate, async (req, res) => {
  try {
    const revokedCount = await jwtService.revokeAllUserTokens(req.user.uid);

    logger.info('撤銷用戶所有 Token', {
      uid: req.user.uid,
      email: req.user.email,
      revokedCount,
    });

    return res.json({
      success: true,
      message: '所有 Token 撤銷成功',
      data: {
        revokedTokens: revokedCount,
      },
    });
  } catch (error) {
    logger.error('撤銷所有 Token 失敗', {
      error: error.message,
      uid: req.user?.uid,
    });

    return res.status(500).json({
      success: false,
      error: {
        message: '撤銷所有 Token 失敗',
        code: 'TOKEN_REVOCATION_FAILED',
      },
    });
  }
});

/**
 * @swagger
 * /api/v1/auth/session-info:
 *   get:
 *     summary: 獲取 Session 資訊
 *     description: 獲取當前用戶的 session 資訊
 *     tags: [JWT Management]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Session 資訊獲取成功
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
 *                   example: Session 資訊獲取成功
 *                 data:
 *                   type: object
 *                   properties:
 *                     sessions:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           sessionId:
 *                             type: string
 *                           createdAt:
 *                             type: string
 *                             format: date-time
 *                           lastActivity:
 *                             type: string
 *                             format: date-time
 *       401:
 *         description: 認證失敗
 *       500:
 *         description: 獲取 Session 資訊失敗
 */
router.get('/session-info', generalLimiter, authenticate, async (req, res) => {
  try {
    const sessions = await jwtService.getUserSessions(req.user.uid);

    // 增強的 session 資訊
    const enhancedSessions = sessions.map(session => ({
      sessionId: session.sessionId,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      isActive: session.isActive,
      deviceFingerprint: session.deviceFingerprint
        ? `${session.deviceFingerprint.substring(0, 8)}...`
        : null, // 只顯示部分指紋
      ipAddress: session.ipAddress || null,
      loginMethod: session.loginMethod || 'unknown',
      securityFlags: session.securityFlags || {},
      isCurrent: session.sessionId === req.user.sessionId, // 標記當前 session
    }));

    return res.json({
      success: true,
      message: 'Session 資訊獲取成功',
      data: {
        sessions: enhancedSessions,
        totalSessions: enhancedSessions.length,
        maxConcurrentSessions: jwtService.maxConcurrentSessions,
      },
    });
  } catch (error) {
    logger.error('獲取 Session 資訊失敗', {
      error: error.message,
      uid: req.user?.uid,
    });

    return res.status(500).json({
      success: false,
      error: {
        message: '獲取 Session 資訊失敗',
        code: 'SESSION_INFO_FAILED',
      },
    });
  }
});

/**
 * @swagger
 * /api/v1/auth/revoke-session:
 *   post:
 *     summary: 撤銷指定 Session
 *     description: 撤銷指定的 session，可以撤銷其他設備的登入
 *     tags: [Session Management]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sessionId
 *             properties:
 *               sessionId:
 *                 type: string
 *                 description: 要撤銷的 Session ID
 *     responses:
 *       200:
 *         description: Session 撤銷成功
 *       400:
 *         description: 參數錯誤
 *       401:
 *         description: 認證失敗
 *       403:
 *         description: 無權限撤銷該 Session
 *       404:
 *         description: Session 不存在
 *       500:
 *         description: 伺服器錯誤
 */
router.post(
  '/revoke-session',
  sensitiveOperationLimiter,
  extractDeviceFingerprint,
  extractRequestContext,
  authenticate,
  async (req, res) => {
    try {
      const { sessionId } = req.body;

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          error: {
            message: '缺少 sessionId 參數',
            code: 'MISSING_SESSION_ID',
          },
        });
      }

      // 驗證 session 屬於當前用戶
      const session = await jwtService.getSession(sessionId);
      if (!session) {
        return res.status(404).json({
          success: false,
          error: {
            message: 'Session 不存在',
            code: 'SESSION_NOT_FOUND',
          },
        });
      }

      if (session.uid !== req.user.uid) {
        return res.status(403).json({
          success: false,
          error: {
            message: '無權限撤銷該 Session',
            code: 'PERMISSION_DENIED',
          },
        });
      }

      // 不允許撤銷當前 session
      if (sessionId === req.user.sessionId) {
        return res.status(400).json({
          success: false,
          error: {
            message: '無法撤銷當前 Session，請使用登出功能',
            code: 'CANNOT_REVOKE_CURRENT_SESSION',
          },
        });
      }

      await jwtService.revokeSession(sessionId);

      logger.info('用戶撤銷 Session', {
        uid: req.user.uid,
        revokedSessionId: sessionId,
        currentSessionId: req.user.sessionId,
      });

      return res.json({
        success: true,
        message: 'Session 撤銷成功',
        data: {
          revokedSessionId: sessionId,
        },
      });
    } catch (error) {
      logger.error('撤銷 Session 失敗', {
        error: error.message,
        uid: req.user?.uid,
        sessionId: req.body?.sessionId,
      });

      return res.status(500).json({
        success: false,
        error: {
          message: 'Session 撤銷失敗',
          code: 'SESSION_REVOCATION_FAILED',
        },
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/auth/revoke-all-other-sessions:
 *   post:
 *     summary: 撤銷所有其他 Session
 *     description: 撤銷當前用戶的所有其他 session，保留當前 session
 *     tags: [Session Management]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: 所有其他 Session 撤銷成功
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
 *                   example: 所有其他 Session 撤銷成功
 *                 data:
 *                   type: object
 *                   properties:
 *                     revokedCount:
 *                       type: number
 *                       description: 撤銷的 Session 數量
 *       401:
 *         description: 認證失敗
 *       500:
 *         description: 伺服器錯誤
 */
router.post(
  '/revoke-all-other-sessions',
  sensitiveOperationLimiter,
  extractDeviceFingerprint,
  extractRequestContext,
  authenticate,
  async (req, res) => {
    try {
      const currentSessionId = req.user.sessionId;

      if (!currentSessionId) {
        // 如果沒有 sessionId（可能是 Firebase token），撤銷所有 session
        const revokedCount = await jwtService.revokeAllUserTokens(req.user.uid);

        return res.json({
          success: true,
          message: '所有 Session 撤銷成功',
          data: {
            revokedCount,
          },
        });
      }

      const revokedCount = await jwtService.revokeOtherUserSessions(req.user.uid, currentSessionId);

      logger.info('用戶撤銷所有其他 Session', {
        uid: req.user.uid,
        currentSessionId,
        revokedCount,
      });

      return res.json({
        success: true,
        message: '所有其他 Session 撤銷成功',
        data: {
          revokedCount,
          currentSessionId,
        },
      });
    } catch (error) {
      logger.error('撤銷所有其他 Session 失敗', {
        error: error.message,
        uid: req.user?.uid,
      });

      return res.status(500).json({
        success: false,
        error: {
          message: '撤銷所有其他 Session 失敗',
          code: 'REVOKE_ALL_SESSIONS_FAILED',
        },
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/auth/validate-session:
 *   post:
 *     summary: 驗證 Session 安全性
 *     description: 驗證當前 session 的安全性，包括 IP 和設備指紋檢查
 *     tags: [Session Management]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               deviceFingerprint:
 *                 type: string
 *                 description: 設備指紋
 *               forceValidation:
 *                 type: boolean
 *                 description: 強制執行驗證
 *                 default: false
 *     responses:
 *       200:
 *         description: Session 驗證成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     valid:
 *                       type: boolean
 *                     warnings:
 *                       type: array
 *                       items:
 *                         type: string
 *                     securityFlags:
 *                       type: object
 *       401:
 *         description: 認證失敗或 Session 無效
 *       500:
 *         description: 伺服器錯誤
 */
router.post(
  '/validate-session',
  generalLimiter,
  extractDeviceFingerprint,
  extractRequestContext,
  authenticate,
  async (req, res) => {
    try {
      const { sessionId } = req.user;

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          error: {
            message: 'Session ID 不存在，無法驗證',
            code: 'MISSING_SESSION_ID',
          },
        });
      }

      const { deviceFingerprint, forceValidation = false } = req.body;

      // 使用已提取的請求上下文，並合併body中的設備指紋
      const requestContext = {
        ...req.securityContext,
        deviceFingerprint: deviceFingerprint || req.securityContext.deviceFingerprint,
      };

      const sessionValidation = await jwtService.validateSessionSecurity(sessionId, requestContext);

      // 如果 session 無效且不是強制驗證，返回認證錯誤
      if (!sessionValidation.valid && !forceValidation) {
        return res.status(401).json({
          success: false,
          error: {
            message: 'Session 無效',
            code: 'INVALID_SESSION',
            reason: sessionValidation.reason,
          },
        });
      }

      logger.info('Session 安全驗證完成', {
        sessionId,
        uid: req.user.uid,
        valid: sessionValidation.valid,
        warnings: sessionValidation.warnings || [],
      });

      return res.json({
        success: true,
        message: 'Session 驗證完成',
        data: {
          valid: sessionValidation.valid,
          warnings: sessionValidation.warnings || [],
          securityFlags: sessionValidation.securityFlags || {},
          requestContext: {
            ipAddress: requestContext.ipAddress,
            timestamp: requestContext.timestamp,
          },
        },
      });
    } catch (error) {
      logger.error('Session 驗證失敗', {
        error: error.message,
        uid: req.user?.uid,
        sessionId: req.user?.sessionId,
      });

      return res.status(500).json({
        success: false,
        error: {
          message: 'Session 驗證失敗',
          code: 'SESSION_VALIDATION_FAILED',
        },
      });
    }
  }
);

// ============ 帳號鎖定管理 API ============

/**
 * @swagger
 * /api/v1/auth/account-security-status:
 *   get:
 *     summary: 獲取帳號安全狀態
 *     description: 獲取當前用戶的帳號安全狀態，包括鎖定狀態、失敗記錄、風險評估等
 *     tags: [Account Security]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: 成功獲取帳號安全狀態
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     userIdentifier:
 *                       type: string
 *                     lockStatus:
 *                       type: object
 *                       properties:
 *                         locked:
 *                           type: boolean
 *                         reason:
 *                           type: string
 *                         lockedUntil:
 *                           type: string
 *                           format: date-time
 *                     failureHistory:
 *                       type: object
 *                       properties:
 *                         attempts:
 *                           type: number
 *                         lastFailure:
 *                           type: object
 *                         recentFailures:
 *                           type: array
 *                     riskAssessment:
 *                       type: object
 *                       properties:
 *                         level:
 *                           type: string
 *                           enum: [low, medium, high, critical]
 *                         score:
 *                           type: number
 *                         factors:
 *                           type: array
 *                           items:
 *                             type: string
 *       401:
 *         description: 認證失敗
 *       500:
 *         description: 伺服器錯誤
 */
router.get('/account-security-status', generalLimiter, authenticate, async (req, res) => {
  try {
    const userIdentifier = req.user.uid;
    const securityStatus = await securityEnhancement.getAccountSecurityStatus(userIdentifier);

    return res.json({
      success: true,
      message: '帳號安全狀態獲取成功',
      data: securityStatus,
    });
  } catch (error) {
    logger.error('獲取帳號安全狀態失敗', {
      error: error.message,
      uid: req.user?.uid,
    });

    return res.status(500).json({
      success: false,
      error: {
        message: '獲取帳號安全狀態失敗',
        code: 'SECURITY_STATUS_FAILED',
      },
    });
  }
});

/**
 * @swagger
 * /api/v1/auth/admin/unlock-account:
 *   post:
 *     summary: 解鎖帳號（管理員）
 *     description: 管理員解鎖被鎖定的帳號
 *     tags: [Account Security]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userIdentifier
 *             properties:
 *               userIdentifier:
 *                 type: string
 *                 description: 要解鎖的用戶標識（firebaseUid 或 email）
 *               reason:
 *                 type: string
 *                 description: 解鎖原因
 *                 default: 管理員解鎖
 *     responses:
 *       200:
 *         description: 帳號解鎖成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     userIdentifier:
 *                       type: string
 *                     unlocked:
 *                       type: boolean
 *                     reason:
 *                       type: string
 *       400:
 *         description: 參數錯誤
 *       401:
 *         description: 認證失敗
 *       403:
 *         description: 權限不足
 *       404:
 *         description: 帳號未鎖定
 *       500:
 *         description: 伺服器錯誤
 */
router.post(
  '/admin/unlock-account',
  sensitiveOperationLimiter,
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    try {
      const { userIdentifier, reason = '管理員解鎖' } = req.body;

      if (!userIdentifier) {
        return res.status(400).json({
          success: false,
          error: {
            message: '缺少 userIdentifier 參數',
            code: 'MISSING_USER_IDENTIFIER',
          },
        });
      }

      const adminUser = req.user.uid;
      const unlocked = await securityEnhancement.unlockAccount(userIdentifier, adminUser, reason);

      if (!unlocked) {
        return res.status(404).json({
          success: false,
          error: {
            message: '帳號未被鎖定或解鎖失敗',
            code: 'ACCOUNT_NOT_LOCKED',
          },
        });
      }

      logger.info('管理員解鎖帳號', {
        adminUser,
        userIdentifier,
        reason,
      });

      return res.json({
        success: true,
        message: '帳號解鎖成功',
        data: {
          userIdentifier,
          unlocked: true,
          reason,
          adminUser,
        },
      });
    } catch (error) {
      logger.error('管理員解鎖帳號失敗', {
        error: error.message,
        adminUser: req.user?.uid,
        userIdentifier: req.body?.userIdentifier,
      });

      return res.status(500).json({
        success: false,
        error: {
          message: '解鎖帳號失敗',
          code: 'UNLOCK_ACCOUNT_FAILED',
        },
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/auth/admin/lock-account:
 *   post:
 *     summary: 鎖定帳號（管理員）
 *     description: 管理員手動鎖定用戶帳號
 *     tags: [Account Security]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userIdentifier
 *               - duration
 *               - reason
 *             properties:
 *               userIdentifier:
 *                 type: string
 *                 description: 要鎖定的用戶標識（firebaseUid 或 email）
 *               duration:
 *                 type: number
 *                 description: 鎖定時間（秒）
 *                 minimum: 60
 *                 maximum: 86400
 *               reason:
 *                 type: string
 *                 description: 鎖定原因
 *     responses:
 *       200:
 *         description: 帳號鎖定成功
 *       400:
 *         description: 參數錯誤
 *       401:
 *         description: 認證失敗
 *       403:
 *         description: 權限不足
 *       409:
 *         description: 帳號已被鎖定
 *       500:
 *         description: 伺服器錯誤
 */
router.post(
  '/admin/lock-account',
  sensitiveOperationLimiter,
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    try {
      const { userIdentifier, duration, reason } = req.body;

      if (!userIdentifier || !duration || !reason) {
        return res.status(400).json({
          success: false,
          error: {
            message: '缺少必要參數: userIdentifier, duration, reason',
            code: 'MISSING_REQUIRED_PARAMETERS',
          },
        });
      }

      // 驗證鎖定時間範圍
      if (duration < 60 || duration > 86400) {
        return res.status(400).json({
          success: false,
          error: {
            message: '鎖定時間必須在 60 秒到 24 小時之間',
            code: 'INVALID_DURATION',
          },
        });
      }

      const adminUser = req.user.uid;
      const locked = await securityEnhancement.manualLockAccount(
        userIdentifier,
        duration,
        reason,
        adminUser
      );

      if (!locked) {
        return res.status(409).json({
          success: false,
          error: {
            message: '帳號已經被鎖定或鎖定失敗',
            code: 'ACCOUNT_ALREADY_LOCKED',
          },
        });
      }

      logger.info('管理員鎖定帳號', {
        adminUser,
        userIdentifier,
        duration,
        reason,
      });

      return res.json({
        success: true,
        message: '帳號鎖定成功',
        data: {
          userIdentifier,
          locked: true,
          duration,
          reason,
          adminUser,
          lockedUntil: new Date(Date.now() + duration * 1000),
        },
      });
    } catch (error) {
      logger.error('管理員鎖定帳號失敗', {
        error: error.message,
        adminUser: req.user?.uid,
        userIdentifier: req.body?.userIdentifier,
      });

      return res.status(500).json({
        success: false,
        error: {
          message: '鎖定帳號失敗',
          code: 'LOCK_ACCOUNT_FAILED',
        },
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/auth/admin/security-events/{userIdentifier}:
 *   get:
 *     summary: 獲取用戶安全事件記錄（管理員）
 *     description: 管理員查看特定用戶的安全事件記錄
 *     tags: [Account Security]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userIdentifier
 *         required: true
 *         schema:
 *           type: string
 *         description: 用戶標識
 *       - in: query
 *         name: limit
 *         schema:
 *           type: number
 *           default: 50
 *         description: 返回記錄數量限制
 *       - in: query
 *         name: eventType
 *         schema:
 *           type: string
 *         description: 篩選事件類型
 *       - in: query
 *         name: severityLevel
 *         schema:
 *           type: string
 *           enum: [low, medium, high, critical]
 *         description: 篩選嚴重程度
 *     responses:
 *       200:
 *         description: 成功獲取安全事件記錄
 *       401:
 *         description: 認證失敗
 *       403:
 *         description: 權限不足
 *       404:
 *         description: 無安全事件記錄
 *       500:
 *         description: 伺服器錯誤
 */
router.get(
  '/admin/security-events/:userIdentifier',
  generalLimiter,
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    try {
      const { userIdentifier } = req.params;
      const { limit = 50, eventType, severityLevel } = req.query;

      const securityEvents = await securityEnhancement.getSecurityEvents(userIdentifier, {
        limit: parseInt(limit, 10),
        eventType,
        severityLevel,
      });

      if (!securityEvents) {
        return res.status(404).json({
          success: false,
          error: {
            message: '無安全事件記錄',
            code: 'NO_SECURITY_EVENTS',
          },
        });
      }

      logger.info('管理員查看安全事件記錄', {
        adminUser: req.user.uid,
        userIdentifier,
        eventCount: securityEvents.totalEvents,
      });

      return res.json({
        success: true,
        message: '安全事件記錄獲取成功',
        data: securityEvents,
      });
    } catch (error) {
      logger.error('獲取安全事件記錄失敗', {
        error: error.message,
        adminUser: req.user?.uid,
        userIdentifier: req.params?.userIdentifier,
      });

      return res.status(500).json({
        success: false,
        error: {
          message: '獲取安全事件記錄失敗',
          code: 'SECURITY_EVENTS_FAILED',
        },
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/auth/admin/login-failures/{userIdentifier}:
 *   get:
 *     summary: 獲取用戶登入失敗記錄（管理員）
 *     description: 管理員查看特定用戶的登入失敗記錄
 *     tags: [Account Security]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userIdentifier
 *         required: true
 *         schema:
 *           type: string
 *         description: 用戶標識
 *     responses:
 *       200:
 *         description: 成功獲取登入失敗記錄
 *       401:
 *         description: 認證失敗
 *       403:
 *         description: 權限不足
 *       404:
 *         description: 無登入失敗記錄
 *       500:
 *         description: 伺服器錯誤
 */
router.get(
  '/admin/login-failures/:userIdentifier',
  generalLimiter,
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    try {
      const { userIdentifier } = req.params;

      const loginFailures = await securityEnhancement.getLoginFailures(userIdentifier);

      if (!loginFailures) {
        return res.status(404).json({
          success: false,
          error: {
            message: '無登入失敗記錄',
            code: 'NO_LOGIN_FAILURES',
          },
        });
      }

      logger.info('管理員查看登入失敗記錄', {
        adminUser: req.user.uid,
        userIdentifier,
        attempts: loginFailures.attempts,
      });

      return res.json({
        success: true,
        message: '登入失敗記錄獲取成功',
        data: loginFailures,
      });
    } catch (error) {
      logger.error('獲取登入失敗記錄失敗', {
        error: error.message,
        adminUser: req.user?.uid,
        userIdentifier: req.params?.userIdentifier,
      });

      return res.status(500).json({
        success: false,
        error: {
          message: '獲取登入失敗記錄失敗',
          code: 'LOGIN_FAILURES_FAILED',
        },
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/auth/admin/clear-login-failures:
 *   post:
 *     summary: 清除登入失敗記錄（管理員）
 *     description: 管理員清除特定用戶的登入失敗記錄
 *     tags: [Account Security]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userIdentifier
 *             properties:
 *               userIdentifier:
 *                 type: string
 *                 description: 要清除記錄的用戶標識
 *     responses:
 *       200:
 *         description: 登入失敗記錄清除成功
 *       400:
 *         description: 參數錯誤
 *       401:
 *         description: 認證失敗
 *       403:
 *         description: 權限不足
 *       500:
 *         description: 伺服器錯誤
 */
router.post(
  '/admin/clear-login-failures',
  sensitiveOperationLimiter,
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    try {
      const { userIdentifier } = req.body;

      if (!userIdentifier) {
        return res.status(400).json({
          success: false,
          error: {
            message: '缺少 userIdentifier 參數',
            code: 'MISSING_USER_IDENTIFIER',
          },
        });
      }

      await securityEnhancement.clearLoginFailures(userIdentifier);

      logger.info('管理員清除登入失敗記錄', {
        adminUser: req.user.uid,
        userIdentifier,
      });

      return res.json({
        success: true,
        message: '登入失敗記錄清除成功',
        data: {
          userIdentifier,
          cleared: true,
          adminUser: req.user.uid,
        },
      });
    } catch (error) {
      logger.error('清除登入失敗記錄失敗', {
        error: error.message,
        adminUser: req.user?.uid,
        userIdentifier: req.body?.userIdentifier,
      });

      return res.status(500).json({
        success: false,
        error: {
          message: '清除登入失敗記錄失敗',
          code: 'CLEAR_LOGIN_FAILURES_FAILED',
        },
      });
    }
  }
);

// ============ MFA 狀態檢查和驗證 API 端點 ============

/**
 * @swagger
 * components:
 *   schemas:
 *     MFAStatus:
 *       type: object
 *       properties:
 *         status:
 *           type: string
 *           enum: ['disabled', 'pending', 'enabled']
 *           description: MFA 整體狀態
 *         enabledMethods:
 *           type: array
 *           items:
 *             type: string
 *             enum: ['totp', 'sms', 'backup_code']
 *           description: 已啟用的 MFA 方法
 *         pendingMethods:
 *           type: array
 *           items:
 *             type: string
 *             enum: ['totp', 'sms', 'backup_code']
 *           description: 待啟用的 MFA 方法
 *         backupCodesRemaining:
 *           type: number
 *           description: 剩餘備用碼數量
 *         lastUpdated:
 *           type: string
 *           format: date-time
 *           description: 最後更新時間
 *
 *     MFAVerificationRequest:
 *       type: object
 *       required:
 *         - code
 *         - type
 *       properties:
 *         code:
 *           type: string
 *           description: MFA 驗證碼
 *         type:
 *           type: string
 *           enum: ['totp', 'sms', 'backup_code']
 *           description: MFA 類型
 *
 *     MFAVerificationResult:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           description: 驗證是否成功
 *         result:
 *           type: string
 *           enum: ['success', 'invalid_code', 'expired', 'too_many_attempts', 'rate_limited']
 *           description: 驗證結果代碼
 *         message:
 *           type: string
 *           description: 結果描述
 *         remainingAttempts:
 *           type: number
 *           description: 剩餘嘗試次數
 *
 *     MFAMethodInfo:
 *       type: object
 *       properties:
 *         type:
 *           type: string
 *           enum: ['totp', 'sms', 'backup_code']
 *         name:
 *           type: string
 *           description: 方法名稱
 *         description:
 *           type: string
 *           description: 方法描述
 *         enabled:
 *           type: boolean
 *           description: 是否已啟用
 *         pending:
 *           type: boolean
 *           description: 是否待啟用
 *         available:
 *           type: boolean
 *           description: 是否可用
 */

/**
 * @swagger
 * /api/v1/auth/mfa/status:
 *   get:
 *     summary: 獲取用戶 MFA 狀態
 *     description: 獲取當前用戶的 MFA 狀態和配置資訊
 *     tags: [MFA Management]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: 成功獲取 MFA 狀態
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
 *                   example: MFA 狀態獲取成功
 *                 data:
 *                   type: object
 *                   properties:
 *                     uid:
 *                       type: string
 *                     mfaStatus:
 *                       $ref: '#/components/schemas/MFAStatus'
 *       401:
 *         description: 認證失敗
 *       500:
 *         description: 伺服器錯誤
 */
router.get('/mfa/status', generalLimiter, authenticate, async (req, res) => {
  try {
    const uid = req.user.uid;

    // 獲取用戶 MFA 狀態
    const mfaStatus = await mfaService.getUserMFAStatus(uid);

    logger.info('用戶 MFA 狀態查詢', {
      uid,
      status: mfaStatus.status,
      enabledMethods: mfaStatus.enabledMethods,
    });

    return res.json({
      success: true,
      message: 'MFA 狀態獲取成功',
      data: {
        uid,
        mfaStatus,
      },
    });
  } catch (error) {
    logger.error('獲取 MFA 狀態失敗', {
      error: error.message,
      uid: req.user?.uid,
    });

    return res.status(500).json({
      success: false,
      error: {
        message: '獲取 MFA 狀態失敗',
        code: 'MFA_STATUS_FAILED',
      },
    });
  }
});

/**
 * @swagger
 * /api/v1/auth/mfa/verify:
 *   post:
 *     summary: 驗證 MFA 代碼
 *     description: 驗證用戶輸入的 MFA 代碼
 *     tags: [MFA Management]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/MFAVerificationRequest'
 *     responses:
 *       200:
 *         description: 驗證結果
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/MFAVerificationResult'
 *       400:
 *         description: 請求參數錯誤
 *       401:
 *         description: 認證失敗
 *       429:
 *         description: 嘗試次數過多
 *       500:
 *         description: 伺服器錯誤
 */
router.post(
  '/mfa/verify',
  authLimiter,
  extractDeviceFingerprint,
  extractRequestContext,
  authenticate,
  async (req, res) => {
    try {
      const { code, type } = req.body;
      const uid = req.user.uid;

      // 驗證請求參數
      if (!code || !type) {
        return res.status(400).json({
          success: false,
          error: {
            message: '缺少必要參數: code 和 type',
            code: 'MISSING_REQUIRED_PARAMETERS',
          },
        });
      }

      // 驗證 MFA 類型
      const validTypes = ['totp', 'sms', 'backup_code'];
      if (!validTypes.includes(type)) {
        return res.status(400).json({
          success: false,
          error: {
            message: '無效的 MFA 類型',
            code: 'INVALID_MFA_TYPE',
            validTypes,
          },
        });
      }

      // 檢查用戶是否啟用了該 MFA 方法
      const mfaStatus = await mfaService.getUserMFAStatus(uid);
      if (!mfaStatus.enabledMethods.includes(type)) {
        return res.status(400).json({
          success: false,
          error: {
            message: `${type.toUpperCase()} 驗證未啟用`,
            code: 'MFA_METHOD_NOT_ENABLED',
          },
        });
      }

      // 執行 MFA 驗證
      const verificationResult = await mfaService.verifyMFACode(uid, code, type);

      // 記錄驗證結果
      logger.info('MFA 驗證嘗試', {
        uid,
        type,
        success: verificationResult.success,
        result: verificationResult.result,
        ipAddress: req.securityContext.ipAddress,
      });

      // 根據驗證結果返回適當的狀態碼
      if (verificationResult.result === 'too_many_attempts') {
        return res.status(429).json({
          success: false,
          message: verificationResult.message,
          data: verificationResult,
        });
      }

      return res.json({
        success: verificationResult.success,
        message: verificationResult.message,
        data: verificationResult,
      });
    } catch (error) {
      logger.error('MFA 驗證失敗', {
        error: error.message,
        uid: req.user?.uid,
        type: req.body?.type,
      });

      return res.status(500).json({
        success: false,
        error: {
          message: 'MFA 驗證失敗',
          code: 'MFA_VERIFICATION_FAILED',
        },
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/auth/mfa/methods:
 *   get:
 *     summary: 獲取可用的 MFA 方法
 *     description: 獲取所有可用的 MFA 方法及其狀態
 *     tags: [MFA Management]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: 成功獲取 MFA 方法資訊
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
 *                   example: MFA 方法資訊獲取成功
 *                 data:
 *                   type: object
 *                   properties:
 *                     methods:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/MFAMethodInfo'
 *                     summary:
 *                       type: object
 *                       properties:
 *                         totalMethods:
 *                           type: number
 *                         enabledMethods:
 *                           type: number
 *                         pendingMethods:
 *                           type: number
 *       401:
 *         description: 認證失敗
 *       500:
 *         description: 伺服器錯誤
 */
router.get('/mfa/methods', generalLimiter, authenticate, async (req, res) => {
  try {
    const uid = req.user.uid;

    // 獲取用戶 MFA 狀態
    const mfaStatus = await mfaService.getUserMFAStatus(uid);

    // 定義所有可用的 MFA 方法
    const allMethods = [
      {
        type: 'totp',
        name: 'TOTP 驗證器',
        description: '基於時間的一次性密碼，使用 Google Authenticator 等應用',
        enabled: mfaStatus.enabledMethods.includes('totp'),
        pending: mfaStatus.pendingMethods.includes('totp'),
        available: true,
      },
      {
        type: 'sms',
        name: 'SMS 簡訊驗證',
        description: '透過手機簡訊接收驗證碼',
        enabled: mfaStatus.enabledMethods.includes('sms'),
        pending: mfaStatus.pendingMethods.includes('sms'),
        available: true,
      },
      {
        type: 'backup_code',
        name: '備用驗證碼',
        description: '一次性使用的備用驗證碼',
        enabled: mfaStatus.enabledMethods.includes('backup_code'),
        pending: mfaStatus.pendingMethods.includes('backup_code'),
        available: true,
        remaining: mfaStatus.backupCodesRemaining || 0,
      },
    ];

    // 計算統計資料
    const summary = {
      totalMethods: allMethods.length,
      enabledMethods: mfaStatus.enabledMethods.length,
      pendingMethods: mfaStatus.pendingMethods.length,
      availableMethods: allMethods.filter(method => method.available).length,
    };

    logger.info('用戶 MFA 方法查詢', {
      uid,
      enabledMethods: mfaStatus.enabledMethods,
      pendingMethods: mfaStatus.pendingMethods,
    });

    return res.json({
      success: true,
      message: 'MFA 方法資訊獲取成功',
      data: {
        methods: allMethods,
        summary,
        currentStatus: mfaStatus.status,
      },
    });
  } catch (error) {
    logger.error('獲取 MFA 方法失敗', {
      error: error.message,
      uid: req.user?.uid,
    });

    return res.status(500).json({
      success: false,
      error: {
        message: '獲取 MFA 方法失敗',
        code: 'MFA_METHODS_FAILED',
      },
    });
  }
});

/**
 * @swagger
 * /api/v1/auth/mfa/check-required:
 *   post:
 *     summary: 檢查是否需要 MFA 驗證
 *     description: 檢查當前操作是否需要 MFA 驗證
 *     tags: [MFA Management]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               operation:
 *                 type: string
 *                 description: 要執行的操作類型
 *                 enum: ['login', 'sensitive_operation', 'admin_operation']
 *               context:
 *                 type: object
 *                 description: 操作上下文資訊
 *     responses:
 *       200:
 *         description: 成功檢查 MFA 要求
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
 *                 data:
 *                   type: object
 *                   properties:
 *                     mfaRequired:
 *                       type: boolean
 *                       description: 是否需要 MFA 驗證
 *                     reason:
 *                       type: string
 *                       description: 需要 MFA 的原因
 *                     availableMethods:
 *                       type: array
 *                       items:
 *                         type: string
 *                       description: 可用的 MFA 方法
 *                     mfaEnabled:
 *                       type: boolean
 *                       description: 用戶是否已啟用 MFA
 *       401:
 *         description: 認證失敗
 *       500:
 *         description: 伺服器錯誤
 */
router.post(
  '/mfa/check-required',
  generalLimiter,
  extractDeviceFingerprint,
  extractRequestContext,
  authenticate,
  async (req, res) => {
    try {
      const { operation = 'login', context = {} } = req.body;
      const uid = req.user.uid;

      // 獲取用戶 MFA 狀態
      const mfaStatus = await mfaService.getUserMFAStatus(uid);
      const mfaEnabled = await mfaService.isMFAEnabled(uid);

      // 檢查是否需要 MFA 驗證的邏輯
      let mfaRequired = false;
      let reason = '';

      if (mfaEnabled) {
        switch (operation) {
          case 'login':
            mfaRequired = true;
            reason = '用戶已啟用 MFA，登入時需要驗證';
            break;
          case 'sensitive_operation':
            mfaRequired = true;
            reason = '敏感操作需要 MFA 驗證';
            break;
          case 'admin_operation':
            mfaRequired = req.user.role === 'admin';
            reason = mfaRequired ? '管理員操作需要 MFA 驗證' : '一般用戶操作不需要額外驗證';
            break;
          default:
            // 其他操作根據用戶設定決定
            mfaRequired = mfaEnabled;
            reason = mfaRequired ? '用戶已啟用 MFA' : 'MFA 未啟用';
        }
      } else {
        reason = 'MFA 未啟用';
      }

      // 安全風險評估（基於請求上下文）
      const riskFactors = [];

      // 檢查 IP 地址變更
      if (context.newLocation || context.unusualIp) {
        riskFactors.push('unusual_location');
        mfaRequired = true;
        reason = '檢測到異常登入位置';
      }

      // 檢查設備變更
      if (context.newDevice || context.unusualDevice) {
        riskFactors.push('new_device');
        mfaRequired = true;
        reason = '檢測到新設備登入';
      }

      // 檢查時間異常
      const currentHour = new Date().getHours();
      if (currentHour < 6 || currentHour > 23) {
        riskFactors.push('unusual_time');
        // 非常規時間不強制要求 MFA，但會記錄
      }

      const result = {
        mfaRequired,
        reason,
        availableMethods: mfaStatus.enabledMethods,
        mfaEnabled,
        riskFactors,
        operation,
        context: {
          ipAddress: req.securityContext.ipAddress,
          deviceFingerprint: req.securityContext.deviceFingerprint?.substring(0, 8),
          timestamp: req.securityContext.timestamp,
        },
      };

      logger.info('MFA 要求檢查', {
        uid,
        operation,
        mfaRequired,
        reason,
        riskFactors,
        mfaEnabled,
      });

      return res.json({
        success: true,
        message: 'MFA 要求檢查完成',
        data: result,
      });
    } catch (error) {
      logger.error('MFA 要求檢查失敗', {
        error: error.message,
        uid: req.user?.uid,
        operation: req.body?.operation,
      });

      return res.status(500).json({
        success: false,
        error: {
          message: 'MFA 要求檢查失敗',
          code: 'MFA_CHECK_FAILED',
        },
      });
    }
  }
);

// ============ 安全設定和管理 API ============

/**
 * @swagger
 * components:
 *   schemas:
 *     SecurityPreferences:
 *       type: object
 *       properties:
 *         mfaRequired:
 *           type: boolean
 *           description: 是否要求 MFA 驗證
 *           default: false
 *         sessionTimeout:
 *           type: number
 *           description: Session 超時時間（分鐘）
 *           minimum: 15
 *           maximum: 1440
 *           default: 1440
 *         maxConcurrentSessions:
 *           type: number
 *           description: 最大並發 Session 數量
 *           minimum: 1
 *           maximum: 10
 *           default: 5
 *         loginNotifications:
 *           type: boolean
 *           description: 是否啟用登入通知
 *           default: true
 *         securityAlerts:
 *           type: boolean
 *           description: 是否啟用安全警報
 *           default: true
 *         ipWhitelist:
 *           type: array
 *           items:
 *             type: string
 *           description: IP 白名單
 *         deviceRestriction:
 *           type: boolean
 *           description: 是否限制設備登入
 *           default: false
 *         requireDeviceApproval:
 *           type: boolean
 *           description: 是否需要設備批准
 *           default: false
 *
 *     NotificationSettings:
 *       type: object
 *       properties:
 *         email:
 *           type: object
 *           properties:
 *             enabled:
 *               type: boolean
 *               default: true
 *             loginAlerts:
 *               type: boolean
 *               default: true
 *             securityEvents:
 *               type: boolean
 *               default: true
 *             suspiciousActivity:
 *               type: boolean
 *               default: true
 *             accountChanges:
 *               type: boolean
 *               default: true
 *         sms:
 *           type: object
 *           properties:
 *             enabled:
 *               type: boolean
 *               default: false
 *             criticalAlerts:
 *               type: boolean
 *               default: false
 *             loginFailures:
 *               type: boolean
 *               default: false
 *         push:
 *           type: object
 *           properties:
 *             enabled:
 *               type: boolean
 *               default: true
 *             realTimeAlerts:
 *               type: boolean
 *               default: true
 *             weeklyReports:
 *               type: boolean
 *               default: false
 *
 *     SecurityPolicySettings:
 *       type: object
 *       properties:
 *         passwordPolicy:
 *           type: object
 *           properties:
 *             minLength:
 *               type: number
 *               minimum: 8
 *               maximum: 128
 *               default: 8
 *             requireUppercase:
 *               type: boolean
 *               default: true
 *             requireLowercase:
 *               type: boolean
 *               default: true
 *             requireNumbers:
 *               type: boolean
 *               default: true
 *             requireSymbols:
 *               type: boolean
 *               default: false
 *             maxAge:
 *               type: number
 *               description: 密碼最大有效期（天）
 *               default: 90
 *         accountLockPolicy:
 *           type: object
 *           properties:
 *             maxFailedAttempts:
 *               type: number
 *               minimum: 3
 *               maximum: 10
 *               default: 5
 *             lockDuration:
 *               type: number
 *               description: 鎖定時間（分鐘）
 *               default: 30
 *             progressiveLockout:
 *               type: boolean
 *               description: 是否啟用遞增鎖定
 *               default: true
 *         sessionPolicy:
 *           type: object
 *           properties:
 *             defaultTimeout:
 *               type: number
 *               description: 預設 Session 超時時間（分鐘）
 *               default: 1440
 *             maxConcurrentSessions:
 *               type: number
 *               default: 5
 *             requireMfaForSensitive:
 *               type: boolean
 *               default: true
 */

/**
 * @swagger
 * /api/v1/auth/security-preferences:
 *   get:
 *     summary: 獲取用戶安全偏好設定
 *     description: 獲取當前用戶的安全偏好設定
 *     tags: [Security Settings]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: 成功獲取安全偏好設定
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
 *                   example: 安全偏好設定獲取成功
 *                 data:
 *                   type: object
 *                   properties:
 *                     uid:
 *                       type: string
 *                     preferences:
 *                       $ref: '#/components/schemas/SecurityPreferences'
 *                     lastUpdated:
 *                       type: string
 *                       format: date-time
 *       401:
 *         description: 認證失敗
 *       500:
 *         description: 伺服器錯誤
 */
router.get('/security-preferences', generalLimiter, authenticate, async (req, res) => {
  try {
    const uid = req.user.uid;

    // 從用戶模型或快取中獲取安全偏好設定
    const user = await User.findByFirebaseUid(uid);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          message: '用戶不存在',
          code: 'USER_NOT_FOUND',
        },
      });
    }

    // 獲取用戶的安全偏好設定（如果沒有則使用預設值）
    const defaultPreferences = {
      mfaRequired: false,
      sessionTimeout: 1440, // 24 小時
      maxConcurrentSessions: 5,
      loginNotifications: true,
      securityAlerts: true,
      ipWhitelist: [],
      deviceRestriction: false,
      requireDeviceApproval: false,
    };

    const preferences = {
      ...defaultPreferences,
      ...(user.securityPreferences || {}),
    };

    logger.info('用戶安全偏好設定查詢', {
      uid,
      hasCustomPreferences: !!user.securityPreferences,
    });

    return res.json({
      success: true,
      message: '安全偏好設定獲取成功',
      data: {
        uid,
        preferences,
        lastUpdated: user.securityPreferences?.lastUpdated || user.updatedAt,
      },
    });
  } catch (error) {
    logger.error('獲取安全偏好設定失敗', {
      error: error.message,
      uid: req.user?.uid,
    });

    return res.status(500).json({
      success: false,
      error: {
        message: '獲取安全偏好設定失敗',
        code: 'SECURITY_PREFERENCES_FAILED',
      },
    });
  }
});

/**
 * @swagger
 * /api/v1/auth/security-preferences:
 *   put:
 *     summary: 更新用戶安全偏好設定
 *     description: 更新當前用戶的安全偏好設定
 *     tags: [Security Settings]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SecurityPreferences'
 *     responses:
 *       200:
 *         description: 安全偏好設定更新成功
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
 *                   example: 安全偏好設定更新成功
 *                 data:
 *                   type: object
 *                   properties:
 *                     uid:
 *                       type: string
 *                     preferences:
 *                       $ref: '#/components/schemas/SecurityPreferences'
 *                     changes:
 *                       type: array
 *                       items:
 *                         type: string
 *       400:
 *         description: 請求參數錯誤
 *       401:
 *         description: 認證失敗
 *       500:
 *         description: 伺服器錯誤
 */
router.put(
  '/security-preferences',
  sensitiveOperationLimiter,
  extractDeviceFingerprint,
  extractRequestContext,
  authenticate,
  async (req, res) => {
    try {
      const uid = req.user.uid;
      const newPreferences = req.body;

      // 驗證輸入參數
      const validationErrors = [];

      if (newPreferences.sessionTimeout !== undefined) {
        if (newPreferences.sessionTimeout < 15 || newPreferences.sessionTimeout > 1440) {
          validationErrors.push('sessionTimeout 必須在 15 到 1440 分鐘之間');
        }
      }

      if (newPreferences.maxConcurrentSessions !== undefined) {
        if (newPreferences.maxConcurrentSessions < 1 || newPreferences.maxConcurrentSessions > 10) {
          validationErrors.push('maxConcurrentSessions 必須在 1 到 10 之間');
        }
      }

      if (newPreferences.ipWhitelist !== undefined && !Array.isArray(newPreferences.ipWhitelist)) {
        validationErrors.push('ipWhitelist 必須是陣列');
      }

      if (validationErrors.length > 0) {
        return res.status(400).json({
          success: false,
          error: {
            message: '參數驗證失敗',
            code: 'VALIDATION_ERROR',
            details: validationErrors,
          },
        });
      }

      const user = await User.findByFirebaseUid(uid);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: {
            message: '用戶不存在',
            code: 'USER_NOT_FOUND',
          },
        });
      }

      // 記錄變更內容
      const currentPreferences = user.securityPreferences || {};
      const changes = [];

      Object.keys(newPreferences).forEach(key => {
        if (currentPreferences[key] !== newPreferences[key]) {
          changes.push(`${key}: ${currentPreferences[key]} → ${newPreferences[key]}`);
        }
      });

      // 更新安全偏好設定
      const updatedPreferences = {
        ...currentPreferences,
        ...newPreferences,
        lastUpdated: new Date(),
      };

      await User.updateOne(
        { firebaseUid: uid },
        {
          $set: {
            securityPreferences: updatedPreferences,
            updatedAt: new Date(),
          },
        }
      );

      // 記錄安全事件
      await securityEnhancement.recordSecurityEvent(uid, 'security_preferences_updated', {
        ...req.securityContext,
        changes,
        newPreferences: updatedPreferences,
      });

      logger.info('用戶安全偏好設定更新', {
        uid,
        changes,
        ipAddress: req.securityContext.ipAddress,
      });

      return res.json({
        success: true,
        message: '安全偏好設定更新成功',
        data: {
          uid,
          preferences: updatedPreferences,
          changes,
        },
      });
    } catch (error) {
      logger.error('更新安全偏好設定失敗', {
        error: error.message,
        uid: req.user?.uid,
      });

      return res.status(500).json({
        success: false,
        error: {
          message: '更新安全偏好設定失敗',
          code: 'UPDATE_SECURITY_PREFERENCES_FAILED',
        },
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/auth/notification-settings:
 *   get:
 *     summary: 獲取安全通知設定
 *     description: 獲取當前用戶的安全通知設定
 *     tags: [Security Settings]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: 成功獲取通知設定
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
 *                   example: 通知設定獲取成功
 *                 data:
 *                   type: object
 *                   properties:
 *                     uid:
 *                       type: string
 *                     notifications:
 *                       $ref: '#/components/schemas/NotificationSettings'
 *       401:
 *         description: 認證失敗
 *       500:
 *         description: 伺服器錯誤
 */
router.get('/notification-settings', generalLimiter, authenticate, async (req, res) => {
  try {
    const uid = req.user.uid;

    const user = await User.findByFirebaseUid(uid);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          message: '用戶不存在',
          code: 'USER_NOT_FOUND',
        },
      });
    }

    // 預設通知設定
    const defaultNotifications = {
      email: {
        enabled: true,
        loginAlerts: true,
        securityEvents: true,
        suspiciousActivity: true,
        accountChanges: true,
      },
      sms: {
        enabled: false,
        criticalAlerts: false,
        loginFailures: false,
      },
      push: {
        enabled: true,
        realTimeAlerts: true,
        weeklyReports: false,
      },
    };

    const notifications = {
      ...defaultNotifications,
      ...(user.notificationSettings || {}),
    };

    return res.json({
      success: true,
      message: '通知設定獲取成功',
      data: {
        uid,
        notifications,
        lastUpdated: user.notificationSettings?.lastUpdated || user.updatedAt,
      },
    });
  } catch (error) {
    logger.error('獲取通知設定失敗', {
      error: error.message,
      uid: req.user?.uid,
    });

    return res.status(500).json({
      success: false,
      error: {
        message: '獲取通知設定失敗',
        code: 'NOTIFICATION_SETTINGS_FAILED',
      },
    });
  }
});

/**
 * @swagger
 * /api/v1/auth/notification-settings:
 *   put:
 *     summary: 更新安全通知設定
 *     description: 更新當前用戶的安全通知設定
 *     tags: [Security Settings]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NotificationSettings'
 *     responses:
 *       200:
 *         description: 通知設定更新成功
 *       400:
 *         description: 請求參數錯誤
 *       401:
 *         description: 認證失敗
 *       500:
 *         description: 伺服器錯誤
 */
router.put(
  '/notification-settings',
  sensitiveOperationLimiter,
  extractDeviceFingerprint,
  extractRequestContext,
  authenticate,
  async (req, res) => {
    try {
      const uid = req.user.uid;
      const newSettings = req.body;

      const user = await User.findByFirebaseUid(uid);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: {
            message: '用戶不存在',
            code: 'USER_NOT_FOUND',
          },
        });
      }

      // 合併設定
      const currentSettings = user.notificationSettings || {};
      const updatedSettings = {
        ...currentSettings,
        ...newSettings,
        lastUpdated: new Date(),
      };

      await User.updateOne(
        { firebaseUid: uid },
        {
          $set: {
            notificationSettings: updatedSettings,
            updatedAt: new Date(),
          },
        }
      );

      // 記錄設定變更
      await securityEnhancement.recordSecurityEvent(uid, 'notification_settings_updated', {
        ...req.securityContext,
        newSettings: updatedSettings,
      });

      logger.info('用戶通知設定更新', {
        uid,
        ipAddress: req.securityContext.ipAddress,
      });

      return res.json({
        success: true,
        message: '通知設定更新成功',
        data: {
          uid,
          notifications: updatedSettings,
        },
      });
    } catch (error) {
      logger.error('更新通知設定失敗', {
        error: error.message,
        uid: req.user?.uid,
      });

      return res.status(500).json({
        success: false,
        error: {
          message: '更新通知設定失敗',
          code: 'UPDATE_NOTIFICATION_SETTINGS_FAILED',
        },
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/auth/admin/security-policy:
 *   get:
 *     summary: 獲取全域安全政策（管理員）
 *     description: 管理員獲取系統全域安全政策設定
 *     tags: [Security Settings]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: 成功獲取安全政策
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
 *                   example: 安全政策獲取成功
 *                 data:
 *                   type: object
 *                   properties:
 *                     policy:
 *                       $ref: '#/components/schemas/SecurityPolicySettings'
 *                     lastUpdated:
 *                       type: string
 *                       format: date-time
 *                     updatedBy:
 *                       type: string
 *       401:
 *         description: 認證失敗
 *       403:
 *         description: 權限不足
 *       500:
 *         description: 伺服器錯誤
 */
router.get(
  '/admin/security-policy',
  generalLimiter,
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    try {
      // 從環境變數或資料庫獲取全域安全政策
      const defaultPolicy = {
        passwordPolicy: {
          minLength: parseInt(process.env.PASSWORD_MIN_LENGTH, 10) || 8,
          requireUppercase: process.env.PASSWORD_REQUIRE_UPPERCASE === 'true',
          requireLowercase: process.env.PASSWORD_REQUIRE_LOWERCASE === 'true',
          requireNumbers: process.env.PASSWORD_REQUIRE_NUMBERS === 'true',
          requireSymbols: process.env.PASSWORD_REQUIRE_SYMBOLS === 'true',
          maxAge: parseInt(process.env.PASSWORD_MAX_AGE, 10) || 90,
        },
        accountLockPolicy: {
          maxFailedAttempts: parseInt(process.env.MAX_FAILED_ATTEMPTS, 10) || 5,
          lockDuration: parseInt(process.env.LOCK_DURATION, 10) || 30,
          progressiveLockout: process.env.PROGRESSIVE_LOCKOUT === 'true',
        },
        sessionPolicy: {
          defaultTimeout: parseInt(process.env.SESSION_TIMEOUT, 10) || 1440,
          maxConcurrentSessions: parseInt(process.env.MAX_CONCURRENT_SESSIONS, 10) || 5,
          requireMfaForSensitive: process.env.REQUIRE_MFA_FOR_SENSITIVE === 'true',
        },
      };

      // 這裡可以從資料庫讀取自定義政策覆蓋預設值
      // const customPolicy = await SecurityPolicy.findOne({ type: 'global' });

      logger.info('管理員查看安全政策', {
        adminUser: req.user.uid,
      });

      return res.json({
        success: true,
        message: '安全政策獲取成功',
        data: {
          policy: defaultPolicy,
          lastUpdated: new Date().toISOString(),
          updatedBy: 'system',
          source: 'environment_variables',
        },
      });
    } catch (error) {
      logger.error('獲取安全政策失敗', {
        error: error.message,
        adminUser: req.user?.uid,
      });

      return res.status(500).json({
        success: false,
        error: {
          message: '獲取安全政策失敗',
          code: 'SECURITY_POLICY_FAILED',
        },
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/auth/admin/security-policy:
 *   put:
 *     summary: 更新全域安全政策（管理員）
 *     description: 管理員更新系統全域安全政策設定
 *     tags: [Security Settings]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SecurityPolicySettings'
 *     responses:
 *       200:
 *         description: 安全政策更新成功
 *       400:
 *         description: 請求參數錯誤
 *       401:
 *         description: 認證失敗
 *       403:
 *         description: 權限不足
 *       500:
 *         description: 伺服器錯誤
 */
router.put(
  '/admin/security-policy',
  sensitiveOperationLimiter,
  extractDeviceFingerprint,
  extractRequestContext,
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    try {
      const adminUser = req.user.uid;
      const newPolicy = req.body;

      // 驗證政策參數
      const validationErrors = [];

      if (newPolicy.passwordPolicy) {
        const { passwordPolicy } = newPolicy;
        if (
          passwordPolicy.minLength &&
          (passwordPolicy.minLength < 8 || passwordPolicy.minLength > 128)
        ) {
          validationErrors.push('密碼最小長度必須在 8 到 128 之間');
        }
        if (passwordPolicy.maxAge && (passwordPolicy.maxAge < 1 || passwordPolicy.maxAge > 365)) {
          validationErrors.push('密碼最大有效期必須在 1 到 365 天之間');
        }
      }

      if (newPolicy.accountLockPolicy) {
        const { accountLockPolicy } = newPolicy;
        if (
          accountLockPolicy.maxFailedAttempts &&
          (accountLockPolicy.maxFailedAttempts < 3 || accountLockPolicy.maxFailedAttempts > 10)
        ) {
          validationErrors.push('最大失敗嘗試次數必須在 3 到 10 之間');
        }
        if (
          accountLockPolicy.lockDuration &&
          (accountLockPolicy.lockDuration < 1 || accountLockPolicy.lockDuration > 1440)
        ) {
          validationErrors.push('鎖定時間必須在 1 到 1440 分鐘之間');
        }
      }

      if (validationErrors.length > 0) {
        return res.status(400).json({
          success: false,
          error: {
            message: '政策參數驗證失敗',
            code: 'VALIDATION_ERROR',
            details: validationErrors,
          },
        });
      }

      // 這裡應該將政策保存到資料庫
      // await SecurityPolicy.updateOne(
      //   { type: 'global' },
      //   {
      //     $set: {
      //       policy: newPolicy,
      //       updatedBy: adminUser,
      //       updatedAt: new Date(),
      //     }
      //   },
      //   { upsert: true }
      // );

      // 記錄安全事件
      await securityEnhancement.recordSecurityEvent(adminUser, 'security_policy_updated', {
        ...req.securityContext,
        policyChanges: newPolicy,
        adminAction: true,
      });

      logger.info('管理員更新安全政策', {
        adminUser,
        changes: Object.keys(newPolicy),
        ipAddress: req.securityContext.ipAddress,
      });

      return res.json({
        success: true,
        message: '安全政策更新成功',
        data: {
          policy: newPolicy,
          updatedBy: adminUser,
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      logger.error('更新安全政策失敗', {
        error: error.message,
        adminUser: req.user?.uid,
      });

      return res.status(500).json({
        success: false,
        error: {
          message: '更新安全政策失敗',
          code: 'UPDATE_SECURITY_POLICY_FAILED',
        },
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/auth/admin/security-audit:
 *   get:
 *     summary: 獲取安全審計報告（管理員）
 *     description: 管理員獲取系統安全審計報告
 *     tags: [Security Settings]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: 開始日期
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: 結束日期
 *       - in: query
 *         name: reportType
 *         schema:
 *           type: string
 *           enum: [summary, detailed, critical_only]
 *           default: summary
 *         description: 報告類型
 *     responses:
 *       200:
 *         description: 成功獲取審計報告
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
 *                   example: 安全審計報告獲取成功
 *                 data:
 *                   type: object
 *                   properties:
 *                     reportPeriod:
 *                       type: object
 *                       properties:
 *                         startDate:
 *                           type: string
 *                           format: date
 *                         endDate:
 *                           type: string
 *                           format: date
 *                     summary:
 *                       type: object
 *                       properties:
 *                         totalUsers:
 *                           type: number
 *                         activeUsers:
 *                           type: number
 *                         lockedAccounts:
 *                           type: number
 *                         securityEvents:
 *                           type: number
 *                         criticalEvents:
 *                           type: number
 *                     topSecurityEvents:
 *                       type: array
 *                       items:
 *                         type: object
 *                     riskAssessment:
 *                       type: object
 *                       properties:
 *                         overallRisk:
 *                           type: string
 *                           enum: [low, medium, high, critical]
 *                         recommendations:
 *                           type: array
 *                           items:
 *                             type: string
 *       401:
 *         description: 認證失敗
 *       403:
 *         description: 權限不足
 *       500:
 *         description: 伺服器錯誤
 */
router.get(
  '/admin/security-audit',
  generalLimiter,
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    try {
      const { startDate, endDate, reportType = 'summary' } = req.query;

      // 設定報告期間
      const end = endDate ? new Date(endDate) : new Date();
      const start = startDate
        ? new Date(startDate)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 預設 30 天

      // 模擬審計數據（實際應從資料庫查詢）
      const auditData = {
        reportPeriod: {
          startDate: start.toISOString().split('T')[0],
          endDate: end.toISOString().split('T')[0],
          reportType,
        },
        summary: {
          totalUsers: 1250,
          activeUsers: 890,
          lockedAccounts: 15,
          securityEvents: 342,
          criticalEvents: 8,
          loginAttempts: 5420,
          failedLogins: 180,
          mfaEnabled: 645,
        },
        topSecurityEvents: [
          {
            type: 'suspicious_login',
            count: 25,
            severity: 'medium',
            description: '可疑登入嘗試',
          },
          {
            type: 'account_locked',
            count: 15,
            severity: 'high',
            description: '帳號被鎖定',
          },
          {
            type: 'mfa_failure',
            count: 12,
            severity: 'medium',
            description: 'MFA 驗證失敗',
          },
          {
            type: 'unusual_location',
            count: 8,
            severity: 'medium',
            description: '異常地點登入',
          },
        ],
        riskAssessment: {
          overallRisk: 'medium',
          riskScore: 45,
          riskFactors: [
            '15 個帳號被鎖定',
            '180 次登入失敗',
            '8 個關鍵安全事件',
            '48% 用戶未啟用 MFA',
          ],
          recommendations: [
            '推廣 MFA 啟用率',
            '加強可疑活動檢測',
            '定期安全意識培訓',
            '檢視帳號鎖定政策',
          ],
        },
        trends: {
          loginFailureRate: 3.3, // 百分比
          accountLockRate: 1.2,
          mfaAdoptionRate: 51.6,
          securityEventTrend: 'increasing',
        },
      };

      logger.info('管理員查看安全審計報告', {
        adminUser: req.user.uid,
        reportPeriod: auditData.reportPeriod,
        reportType,
      });

      return res.json({
        success: true,
        message: '安全審計報告獲取成功',
        data: auditData,
      });
    } catch (error) {
      logger.error('獲取安全審計報告失敗', {
        error: error.message,
        adminUser: req.user?.uid,
      });

      return res.status(500).json({
        success: false,
        error: {
          message: '獲取安全審計報告失敗',
          code: 'SECURITY_AUDIT_FAILED',
        },
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/auth/reset-security-settings:
 *   post:
 *     summary: 重置安全設定為預設值
 *     description: 重置當前用戶的安全設定為系統預設值
 *     tags: [Security Settings]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: 安全設定重置成功
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
 *                   example: 安全設定重置成功
 *                 data:
 *                   type: object
 *                   properties:
 *                     uid:
 *                       type: string
 *                     resetItems:
 *                       type: array
 *                       items:
 *                         type: string
 *       401:
 *         description: 認證失敗
 *       500:
 *         description: 伺服器錯誤
 */
router.post(
  '/reset-security-settings',
  sensitiveOperationLimiter,
  extractDeviceFingerprint,
  extractRequestContext,
  authenticate,
  async (req, res) => {
    try {
      const uid = req.user.uid;

      const user = await User.findByFirebaseUid(uid);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: {
            message: '用戶不存在',
            code: 'USER_NOT_FOUND',
          },
        });
      }

      // 重置項目
      const resetItems = [];

      if (user.securityPreferences) {
        resetItems.push('安全偏好設定');
      }

      if (user.notificationSettings) {
        resetItems.push('通知設定');
      }

      // 重置設定
      await User.updateOne(
        { firebaseUid: uid },
        {
          $unset: {
            securityPreferences: 1,
            notificationSettings: 1,
          },
          $set: {
            updatedAt: new Date(),
          },
        }
      );

      // 記錄安全事件
      await securityEnhancement.recordSecurityEvent(uid, 'security_settings_reset', {
        ...req.securityContext,
        resetItems,
      });

      logger.info('用戶重置安全設定', {
        uid,
        resetItems,
        ipAddress: req.securityContext.ipAddress,
      });

      return res.json({
        success: true,
        message: '安全設定重置成功',
        data: {
          uid,
          resetItems,
          resetAt: new Date(),
        },
      });
    } catch (error) {
      logger.error('重置安全設定失敗', {
        error: error.message,
        uid: req.user?.uid,
      });

      return res.status(500).json({
        success: false,
        error: {
          message: '重置安全設定失敗',
          code: 'RESET_SECURITY_SETTINGS_FAILED',
        },
      });
    }
  }
);

module.exports = router;
