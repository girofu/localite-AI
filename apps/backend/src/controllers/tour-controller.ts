import { Request, Response, NextFunction } from 'express';
import { AIService, TourPreferences, LocationData } from '../services/ai-service';
import { body, validationResult } from 'express-validator';
import winston from 'winston';

export class TourController {
  private aiService: AIService | null = null;
  private logger: winston.Logger;

  constructor() {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.File({ filename: 'logs/tour-controller.log' })
      ]
    });
  }

  private getAIService(): AIService {
    if (!this.aiService) {
      this.aiService = new AIService();
    }
    return this.aiService;
  }

  /**
   * 生成導覽內容
   * POST /api/v1/tours/generate
   */
  async generateTour(req: Request, res: Response, next: NextFunction) {
    try {
      // 驗證請求
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: '請求參數有誤',
          errors: errors.array()
        });
      }

      const { location, preferences } = req.body;

      this.logger.info('開始生成導覽內容', {
        locationName: location.name,
        userId: req.user?.uid,
        preferences
      });

      const tourContent = await this.getAIService().generateTourContent(location, preferences);

      this.logger.info('導覽內容生成成功', {
        locationName: location.name,
        userId: req.user?.uid,
        contentId: tourContent.metadata.generatedAt
      });

      res.status(200).json({
        success: true,
        message: '導覽內容生成成功',
        data: tourContent
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error('生成導覽內容失敗', {
        error: errorMessage,
        userId: req.user?.uid,
        stack: errorStack
      });

      next(error);
    }
  }

  /**
   * 獲取語音檔案
   * POST /api/v1/tours/speech
   */
  async generateSpeech(req: Request, res: Response, next: NextFunction) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: '請求參數有誤',
          errors: errors.array()
        });
      }

      const { text, language = 'zh-TW' } = req.body;

      this.logger.info('開始生成語音', {
        textLength: text.length,
        language,
        userId: req.user?.uid
      });

      const audioUrl = await this.getAIService().generateSpeech(text, language);

      res.status(200).json({
        success: true,
        message: '語音生成成功',
        data: {
          audioUrl,
          language,
          textLength: text.length
        }
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      this.logger.error('語音生成失敗', {
        error: errorMessage,
        userId: req.user?.uid
      });

      next(error);
    }
  }

  /**
   * 翻譯導覽內容
   * POST /api/v1/tours/translate
   */
  async translateTour(req: Request, res: Response, next: NextFunction) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: '請求參數有誤',
          errors: errors.array()
        });
      }

      const { content, targetLanguage } = req.body;

      this.logger.info('開始翻譯內容', {
        targetLanguage,
        contentLength: content.length,
        userId: req.user?.uid
      });

      const translatedContent = await this.getAIService().translateContent(content, targetLanguage);

      res.status(200).json({
        success: true,
        message: '翻譯完成',
        data: {
          originalContent: content,
          translatedContent,
          targetLanguage
        }
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      this.logger.error('翻譯失敗', {
        error: errorMessage,
        userId: req.user?.uid
      });

      next(error);
    }
  }

  /**
   * 獲取可用的語言選項
   * GET /api/v1/tours/languages
   */
  async getAvailableLanguages(req: Request, res: Response, next: NextFunction) {
    try {
      const languages = [
        { code: 'zh-TW', name: '繁體中文', nativeName: '繁體中文' },
        { code: 'en-US', name: 'English', nativeName: 'English' },
        { code: 'ja-JP', name: 'Japanese', nativeName: '日本語' },
        { code: 'ko-KR', name: 'Korean', nativeName: '한국어' },
        { code: 'es-ES', name: 'Spanish', nativeName: 'Español' },
        { code: 'fr-FR', name: 'French', nativeName: 'Français' }
      ];

      res.status(200).json({
        success: true,
        message: '可用語言列表',
        data: languages
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      this.logger.error('獲取語言列表失敗', {
        error: errorMessage
      });

      next(error);
    }
  }

  /**
   * 獲取導覽內容模板
   * GET /api/v1/tours/templates
   */
  async getTourTemplates(req: Request, res: Response, next: NextFunction) {
    try {
      const templates = [
        {
          id: 'cultural',
          name: '文化歷史導覽',
          description: '深度探索地點的歷史文化背景',
          duration: 15,
          interests: ['history', 'culture', 'architecture'],
          audienceType: 'adult'
        },
        {
          id: 'family',
          name: '親子友善導覽',
          description: '適合全家大小的輕鬆導覽',
          duration: 10,
          interests: ['family', 'fun', 'interactive'],
          audienceType: 'family'
        },
        {
          id: 'adventure',
          name: '探險體驗導覽',
          description: '刺激有趣的探險式導覽',
          duration: 20,
          interests: ['adventure', 'nature', 'challenge'],
          audienceType: 'solo'
        },
        {
          id: 'food',
          name: '美食文化導覽',
          description: '探索在地美食和飲食文化',
          duration: 12,
          interests: ['food', 'culture', 'local'],
          audienceType: 'adult'
        }
      ];

      res.status(200).json({
        success: true,
        message: '導覽模板列表',
        data: templates
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      this.logger.error('獲取導覽模板失敗', {
        error: errorMessage
      });

      next(error);
    }
  }
}

/**
 * 驗證中間件
 */
export const tourValidation = {
  generateTour: [
    body('location.name').notEmpty().withMessage('地點名稱不能為空'),
    body('location.description').notEmpty().withMessage('地點描述不能為空'),
    body('location.coordinates.lat')
      .isFloat({ min: -90, max: 90 })
      .withMessage('緯度必須在-90到90之間'),
    body('location.coordinates.lng')
      .isFloat({ min: -180, max: 180 })
      .withMessage('經度必須在-180到180之間'),
    body('preferences.language')
      .isIn(['zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'es-ES', 'fr-FR'])
      .withMessage('不支援的語言'),
    body('preferences.duration')
      .isInt({ min: 5, max: 60 })
      .withMessage('導覽時長必須在5-60分鐘之間'),
    body('preferences.interests')
      .isArray({ min: 1, max: 5 })
      .withMessage('興趣必須至少選擇1項，最多5項'),
    body('preferences.audienceType')
      .isIn(['family', 'adult', 'solo'])
      .withMessage('受眾類型無效'),
    body('preferences.difficulty')
      .isIn(['easy', 'moderate', 'challenging'])
      .withMessage('難度等級無效')
  ],

  generateSpeech: [
    body('text')
      .notEmpty()
      .isLength({ max: 5000 })
      .withMessage('文字內容不能為空且長度不能超過5000字'),
    body('language')
      .optional()
      .isIn(['zh-TW', 'en-US', 'ja-JP', 'ko-KR'])
      .withMessage('不支援的語言')
  ],

  translateTour: [
    body('content')
      .notEmpty()
      .isLength({ max: 10000 })
      .withMessage('翻譯內容不能為空且長度不能超過10000字'),
    body('targetLanguage')
      .isIn(['zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'es-ES', 'fr-FR'])
      .withMessage('不支援的目標語言')
  ]
};

export default TourController; 