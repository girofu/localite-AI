import { Router } from 'express';
import { authenticateFirebaseUser } from '../middleware/auth';
import { validateRequest, schemas } from '../middleware/validation';
import { authController } from '../controllers/authController';

const router = Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         email:
 *           type: string
 *         displayName:
 *           type: string
 *         role:
 *           type: string
 *           enum: [user, merchant, admin]
 */

/**
 * @swagger
 * /api/v1/auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: 用戶註冊
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               displayName:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [user, merchant]
 *     responses:
 *       201:
 *         description: 註冊成功
 *       400:
 *         description: 請求參數錯誤
 */
router.post('/register', 
  authenticateFirebaseUser,
  validateRequest({ body: schemas.user.register }),
  authController.register
);

/**
 * @swagger
 * /api/v1/auth/profile:
 *   get:
 *     tags: [Auth]
 *     summary: 獲取用戶資料
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 成功獲取用戶資料
 */
router.get('/profile', 
  authenticateFirebaseUser,
  authController.getProfile
);

/**
 * @swagger
 * /api/v1/auth/profile:
 *   put:
 *     tags: [Auth]
 *     summary: 更新用戶資料
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               displayName:
 *                 type: string
 *               avatar:
 *                 type: string
 */
router.put('/profile',
  authenticateFirebaseUser,
  validateRequest({ body: schemas.user.update }),
  authController.updateProfile
);

/**
 * @swagger
 * /api/v1/auth/verify-token:
 *   post:
 *     tags: [Auth]
 *     summary: 驗證 Token
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Token 有效
 *       401:
 *         description: Token 無效
 */
router.post('/verify-token',
  authenticateFirebaseUser,
  authController.verifyToken
);

export default router; 