import request from 'supertest';
import express from 'express';
import { TourController } from '../controllers/tour-controller';
import { AIService } from '../services/ai-service';

// Mock dependencies
jest.mock('../services/ai-service');
jest.mock('../middleware/auth-middleware', () => ({
  authenticateToken: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    (req as any).user = { uid: 'test-user-123', email: 'test@example.com' };
    next();
  }
}));
jest.mock('../middleware/rate-limit-middleware', () => ({
  rateLimiter: {
    ai: (req: express.Request, res: express.Response, next: express.NextFunction) => next()
  }
}));

describe('Tour API Integration Tests', () => {
  let app: express.Application;
  let _mockAIService: jest.Mocked<AIService>;

  beforeEach(() => {
    // Setup Express app for testing
    app = express();
    app.use(express.json());
    
    // Mock AIService
    mockAIService = new AIService() as jest.Mocked<AIService>;
    
    // Setup routes (simplified for testing)
    const tourController = new TourController();
    
    app.post('/api/v1/tours/generate', async (req, res, next) => {
      req.user = { uid: 'test-user-123', email: 'test@example.com' };
      await tourController.generateTour(req, res, next);
    });
    
    app.post('/api/v1/tours/speech', async (req, res, next) => {
      req.user = { uid: 'test-user-123', email: 'test@example.com' };
      await tourController.generateSpeech(req, res, next);
    });
    
    app.post('/api/v1/tours/translate', async (req, res, next) => {
      req.user = { uid: 'test-user-123', email: 'test@example.com' };
      await tourController.translateTour(req, res, next);
    });
    
    app.get('/api/v1/tours/languages', async (req, res, next) => {
      await tourController.getAvailableLanguages(req, res, next);
    });

    // Error handling middleware
    app.use((error: any, req: any, res: any, next: any) => {
      res.status(500).json({
        success: false,
        message: error.message || '伺服器錯誤',
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    });
  });

  describe('POST /api/v1/tours/generate', () => {
    it('應該成功生成導覽內容', async () => {
      // Arrange
      const mockTourContent = {
        title: '探索台北101',
        description: '深度導覽台北地標',
        estimatedDuration: 15,
        content: {
          introduction: '歡迎來到台北101',
          sections: [
            {
              title: '建築特色',
              content: '台北101是台灣最高的摩天大樓...',
              timestamp: 0
            }
          ],
          conclusion: '感謝您的參觀'
        },
        language: 'zh-TW',
        metadata: {
          generatedAt: new Date().toISOString(),
          version: '1.0',
          confidence: 0.95
        }
      };

      (AIService.prototype.generateTourContent as jest.Mock).mockResolvedValue(mockTourContent);

      const requestBody = {
        location: {
          name: '台北101',
          description: '台北最著名的地標性摩天大樓',
          coordinates: { lat: 25.0340, lng: 121.5645 },
          category: 'landmark'
        },
        preferences: {
          language: 'zh-TW',
          duration: 15,
          interests: ['architecture', 'history'],
          audienceType: 'adult',
          difficulty: 'moderate'
        }
      };

      // Act
      const response = await request(app)
        .post('/api/v1/tours/generate')
        .send(requestBody)
        .expect(200);

      // Assert
      expect(response.body.success).toBe(true);
      expect(response.body.data.title).toBe('探索台北101');
      expect(response.body.data.language).toBe('zh-TW');
      expect(response.body.data.content.sections).toHaveLength(1);
    });

    it('應該處理缺少必要參數的請求', async () => {
      // Act
      const response = await request(app)
        .post('/api/v1/tours/generate')
        .send({
          location: {
            name: '台北101'
            // 缺少必要的 coordinates, category 等
          }
        })
        .expect(400);

      // Assert
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('請求參數');
    });

    it('應該處理AI服務錯誤', async () => {
      // Arrange
      (AIService.prototype.generateTourContent as jest.Mock).mockRejectedValue(
        new Error('AI服務暫時不可用')
      );

      const requestBody = {
        location: {
          name: '台北101',
          description: '台北最著名的地標性摩天大樓',
          coordinates: { lat: 25.0340, lng: 121.5645 },
          category: 'landmark'
        },
        preferences: {
          language: 'zh-TW',
          duration: 15,
          interests: ['architecture'],
          audienceType: 'adult',
          difficulty: 'moderate'
        }
      };

      // Act
      const response = await request(app)
        .post('/api/v1/tours/generate')
        .send(requestBody)
        .expect(500);

      // Assert
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('AI服務暫時不可用');
    });
  });

  describe('POST /api/v1/tours/speech', () => {
    it('應該成功生成語音檔案', async () => {
      // Arrange
      const mockAudioUrl = '/api/v1/audio/test_123456.mp3';
      (AIService.prototype.generateSpeech as jest.Mock).mockResolvedValue(mockAudioUrl);

      const requestBody = {
        text: '歡迎來到台北101，讓我為您介紹這座令人驚嘆的建築。',
        language: 'zh-TW'
      };

      // Act
      const response = await request(app)
        .post('/api/v1/tours/speech')
        .send(requestBody)
        .expect(200);

      // Assert
      expect(response.body.success).toBe(true);
      expect(response.body.data.audioUrl).toBe(mockAudioUrl);
      expect(response.body.data.language).toBe('zh-TW');
    });

    it('應該處理文字太長的請求', async () => {
      // Arrange
      const longText = 'a'.repeat(6000); // 超過5000字符限制

      // Act
      const response = await request(app)
        .post('/api/v1/tours/speech')
        .send({
          text: longText,
          language: 'zh-TW'
        })
        .expect(400);

      // Assert
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/tours/translate', () => {
    it('應該成功翻譯內容', async () => {
      // Arrange
      const mockTranslatedContent = 'Welcome to Taipei 101';
      (AIService.prototype.translateContent as jest.Mock).mockResolvedValue(mockTranslatedContent);

      const requestBody = {
        content: '歡迎來到台北101',
        targetLanguage: 'en-US'
      };

      // Act
      const response = await request(app)
        .post('/api/v1/tours/translate')
        .send(requestBody)
        .expect(200);

      // Assert
      expect(response.body.success).toBe(true);
      expect(response.body.data.translatedContent).toBe(mockTranslatedContent);
      expect(response.body.data.targetLanguage).toBe('en-US');
    });

    it('應該處理不支援的語言', async () => {
      // Act
      const response = await request(app)
        .post('/api/v1/tours/translate')
        .send({
          content: '測試內容',
          targetLanguage: 'invalid-lang'
        })
        .expect(400);

      // Assert
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/tours/languages', () => {
    it('應該返回可用語言列表', async () => {
      // Act
      const response = await request(app)
        .get('/api/v1/tours/languages')
        .expect(200);

      // Assert
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBeGreaterThan(0);
      
      const zhTW = response.body.data.find((lang: any) => lang.code === 'zh-TW');
      expect(zhTW).toBeDefined();
      expect(zhTW.name).toBe('繁體中文');
      
      const enUS = response.body.data.find((lang: any) => lang.code === 'en-US');
      expect(enUS).toBeDefined();
      expect(enUS.name).toBe('English');
    });
  });

  describe('錯誤處理', () => {
    it('應該處理未預期的錯誤', async () => {
      // Arrange
      (AIService.prototype.generateTourContent as jest.Mock).mockImplementation(() => {
        throw new Error('意外的錯誤');
      });

      // Act
      const response = await request(app)
        .post('/api/v1/tours/generate')
        .send({
          location: {
            name: '測試地點',
            description: '測試描述',
            coordinates: { lat: 25.0340, lng: 121.5645 },
            category: 'test'
          },
          preferences: {
            language: 'zh-TW',
            duration: 10,
            interests: ['test'],
            audienceType: 'adult',
            difficulty: 'easy'
          }
        })
        .expect(500);

      // Assert
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('意外的錯誤');
    });
  });
}); 