const express = require('express');
const User = require('../models/User');
const { getAuth } = require('../config/firebase');
const { authenticate } = require('../middleware/authMiddleware');
const { logger } = require('../middleware/requestLogger');

const router = express.Router();

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
router.post('/register', authenticate, async (req, res) => {
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
});

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
router.get('/profile', authenticate, async (req, res) => {
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
router.post('/verify-email', authenticate, async (req, res) => {
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
router.post('/login', authenticate, async (req, res) => {
  try {
    const { firebaseUid, providerId } = req.body;

    const user = await User.findByFirebaseUid(firebaseUid || req.user.uid);

    if (!user) {
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
});

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

module.exports = router;
