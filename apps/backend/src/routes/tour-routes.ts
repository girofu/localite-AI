import { Router, Request, Response, NextFunction } from 'express';
import { TourController, tourValidation } from '../controllers/tour-controller';
import { authenticateToken } from '../middleware/auth-middleware';
import { rateLimiter } from '../middleware/rate-limit-middleware';

const router = Router();
const tourController = new TourController();

/**
 * @swagger
 * components:
 *   schemas:
 *     LocationData:
 *       type: object
 *       required:
 *         - name
 *         - description
 *         - coordinates
 *         - category
 *       properties:
 *         name:
 *           type: string
 *           description: 地點名稱
 *           example: "台北101"
 *         description:
 *           type: string
 *           description: 地點描述
 *           example: "台北最著名的地標性摩天大樓"
 *         coordinates:
 *           type: object
 *           properties:
 *             lat:
 *               type: number
 *               example: 25.0340
 *             lng:
 *               type: number
 *               example: 121.5645
 *         category:
 *           type: string
 *           example: "landmark"
 *         merchantInfo:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *             name:
 *               type: string
 *             highlights:
 *               type: array
 *               items:
 *                 type: string
 *
 *     TourPreferences:
 *       type: object
 *       required:
 *         - language
 *         - duration
 *         - interests
 *         - audienceType
 *         - difficulty
 *       properties:
 *         language:
 *           type: string
 *           enum: [zh-TW, en-US, ja-JP, ko-KR, es-ES, fr-FR]
 *           example: "zh-TW"
 *         duration:
 *           type: integer
 *           minimum: 5
 *           maximum: 60
 *           example: 15
 *         interests:
 *           type: array
 *           items:
 *             type: string
 *           minItems: 1
 *           maxItems: 5
 *           example: ["culture", "history", "architecture"]
 *         audienceType:
 *           type: string
 *           enum: [family, adult, solo]
 *           example: "adult"
 *         difficulty:
 *           type: string
 *           enum: [easy, moderate, challenging]
 *           example: "moderate"
 *
 *     GeneratedTourContent:
 *       type: object
 *       properties:
 *         title:
 *           type: string
 *         description:
 *           type: string
 *         estimatedDuration:
 *           type: integer
 *         content:
 *           type: object
 *           properties:
 *             introduction:
 *               type: string
 *             sections:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   title:
 *                     type: string
 *                   content:
 *                     type: string
 *                   audioUrl:
 *                     type: string
 *                   timestamp:
 *                     type: integer
 *             conclusion:
 *               type: string
 *         language:
 *           type: string
 *         metadata:
 *           type: object
 *           properties:
 *             generatedAt:
 *               type: string
 *             version:
 *               type: string
 *             confidence:
 *               type: number
 */

/**
 * @swagger
 * /api/v1/tours/generate:
 *   post:
 *     summary: 生成 AI 導覽內容
 *     tags: [Tours]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - location
 *               - preferences
 *             properties:
 *               location:
 *                 $ref: '#/components/schemas/LocationData'
 *               preferences:
 *                 $ref: '#/components/schemas/TourPreferences'
 *     responses:
 *       200:
 *         description: 導覽內容生成成功
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
 *                   $ref: '#/components/schemas/GeneratedTourContent'
 *       400:
 *         description: 請求參數錯誤
 *       401:
 *         description: 未授權
 *       429:
 *         description: 請求過於頻繁
 *       500:
 *         description: 服務器錯誤
 */
router.post('/generate', 
  authenticateToken,
  rateLimiter.ai, // AI 服務專用的速率限制
  tourValidation.generateTour,
  (req: Request, res: Response, next: NextFunction) => tourController.generateTour(req, res, next)
);

/**
 * @swagger
 * /api/v1/tours/speech:
 *   post:
 *     summary: 生成語音檔案
 *     tags: [Tours]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - text
 *             properties:
 *               text:
 *                 type: string
 *                 maxLength: 5000
 *                 description: 要轉換為語音的文字
 *               language:
 *                 type: string
 *                 enum: [zh-TW, en-US, ja-JP, ko-KR]
 *                 default: zh-TW
 *                 description: 語音語言
 *     responses:
 *       200:
 *         description: 語音生成成功
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
 *                     audioUrl:
 *                       type: string
 *                     language:
 *                       type: string
 *                     textLength:
 *                       type: integer
 */
router.post('/speech',
  authenticateToken,
  rateLimiter.tts, // TTS 服務專用的速率限制
  tourValidation.generateSpeech,
  (req: Request, res: Response, next: NextFunction) => tourController.generateSpeech(req, res, next)
);

/**
 * @swagger
 * /api/v1/tours/translate:
 *   post:
 *     summary: 翻譯導覽內容
 *     tags: [Tours]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *               - targetLanguage
 *             properties:
 *               content:
 *                 type: string
 *                 maxLength: 10000
 *                 description: 要翻譯的內容
 *               targetLanguage:
 *                 type: string
 *                 enum: [zh-TW, en-US, ja-JP, ko-KR, es-ES, fr-FR]
 *                 description: 目標語言
 *     responses:
 *       200:
 *         description: 翻譯完成
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
 *                     originalContent:
 *                       type: string
 *                     translatedContent:
 *                       type: string
 *                     targetLanguage:
 *                       type: string
 */
router.post('/translate',
  authenticateToken,
  rateLimiter.translate, // 翻譯服務專用的速率限制
  tourValidation.translateTour,
  (req: Request, res: Response, next: NextFunction) => tourController.translateTour(req, res, next)
);

/**
 * @swagger
 * /api/v1/tours/languages:
 *   get:
 *     summary: 獲取可用的語言選項
 *     tags: [Tours]
 *     responses:
 *       200:
 *         description: 可用語言列表
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
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       code:
 *                         type: string
 *                       name:
 *                         type: string
 *                       nativeName:
 *                         type: string
 */
router.get('/languages',
  (req, res, next) => tourController.getAvailableLanguages(req, res, next)
);

/**
 * @swagger
 * /api/v1/tours/templates:
 *   get:
 *     summary: 獲取導覽內容模板
 *     tags: [Tours]
 *     responses:
 *       200:
 *         description: 導覽模板列表
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
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       description:
 *                         type: string
 *                       duration:
 *                         type: integer
 *                       interests:
 *                         type: array
 *                         items:
 *                           type: string
 *                       audienceType:
 *                         type: string
 */
router.get('/templates',
  (req, res, next) => tourController.getTourTemplates(req, res, next)
);

export default router; 