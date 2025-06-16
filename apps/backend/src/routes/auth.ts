import { Router } from 'express';
import { authenticateToken } from '../middleware/auth-middleware';
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
 *         id:
 *           type: string
 *         firebaseUid:
 *           type: string
 *         email:
 *           type: string
 *         name:
 *           type: string
 *         role:
 *           type: string
 *           enum: [user, merchant, admin]
 *         emailVerified:
 *           type: boolean
 *         avatar:
 *           type: string
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/v1/auth/register:
 *   post:
 *     summary: 註冊新用戶
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - name
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 6
 *               name:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [user, merchant]
 *                 default: user
 */
router.post('/register',
  authenticateToken,
  validateRequest({ body: schemas.user.register }),
  authController.register
);

/**
 * @swagger
 * /api/v1/auth/profile:
 *   get:
 *     summary: 獲取用戶資料
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 */
router.get('/profile',
  authenticateToken,
  authController.getProfile
);

/**
 * @swagger
 * /api/v1/auth/profile:
 *   put:
 *     summary: 更新用戶資料
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               avatar:
 *                 type: string
 */
router.put('/profile',
  authenticateToken,
  validateRequest({ body: schemas.user.update }),
  authController.updateProfile
);

/**
 * @swagger
 * /api/v1/auth/delete:
 *   delete:
 *     summary: 刪除用戶帳戶
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/delete',
  authenticateToken,
  authController.deleteAccount
);

export default router; 