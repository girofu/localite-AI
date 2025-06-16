import { AIService, LocationData, TourPreferences } from '../services/ai-service';
import { CacheService } from '../services/cache-service';

// Mock Google Cloud services
jest.mock('@google-cloud/vertexai');
jest.mock('@google-cloud/text-to-speech');  
jest.mock('@google-cloud/translate/build/src/v3');
jest.mock('../services/cache-service');

describe('AIService', () => {
  let aiService: AIService;
  let mockCacheService: jest.Mocked<CacheService>;

  const mockLocation: LocationData = {
    name: '台北101',
    description: '台北最著名的地標性摩天大樓',
    coordinates: { lat: 25.0340, lng: 121.5645 },
    category: 'landmark',
    merchantInfo: {
      id: 'merchant001',
      name: '台北101觀景台',
      highlights: ['360度景觀', '高速電梯', '世界級建築']
    }
  };

  const mockPreferences: TourPreferences = {
    language: 'zh-TW',
    duration: 15,
    interests: ['architecture', 'history'],
    audienceType: 'adult',
    difficulty: 'moderate'
  };

  beforeEach(() => {
    // 設置環境變數
    process.env.GOOGLE_CLOUD_PROJECT_ID = 'test-project';
    process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';
    
    // Mock cache service
    mockCacheService = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      expire: jest.fn()
    } as jest.Mocked<CacheService>;

    (CacheService as jest.MockedClass<typeof CacheService>).mockImplementation(() => mockCacheService);
    
    aiService = new AIService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateTourContent', () => {
    it('應該成功生成導覽內容', async () => {
      // Arrange
      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue('OK');

      // Mock Vertex AI response
      const mockVertexAI = require('@google-cloud/vertexai').VertexAI;
      const mockGenerateContentResult = {
        response: {
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  title: '探索台北101',
                  description: '深度導覽台北地標',
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
                  }
                })
              }]
            }
          }]
        }
      };

      mockVertexAI.prototype.getGenerativeModel = jest.fn().mockReturnValue({
        generateContent: jest.fn().mockResolvedValue(mockGenerateContentResult)
      });

      // Act
      const result = await aiService.generateTourContent(mockLocation, mockPreferences);

      // Assert
      expect(result).toBeDefined();
      expect(result.title).toBe('探索台北101');
      expect(result.language).toBe('zh-TW');
      expect(result.content.sections).toHaveLength(1);
      expect(mockCacheService.set).toHaveBeenCalled();
    });

    it('應該從快取返回內容', async () => {
      // Arrange
      const cachedContent = {
        title: '快取的導覽內容',
        description: '來自快取',
        estimatedDuration: 15,
        content: {
          introduction: '快取內容',
          sections: [],
          conclusion: '結束'
        },
        language: 'zh-TW',
        metadata: {
          generatedAt: new Date().toISOString(),
          version: '1.0',
          confidence: 0.9
        }
      };

      mockCacheService.get.mockResolvedValue(JSON.stringify(cachedContent));

      // Act
      const result = await aiService.generateTourContent(mockLocation, mockPreferences);

      // Assert
      expect(result.title).toBe('快取的導覽內容');
      expect(mockCacheService.set).not.toHaveBeenCalled();
    });

    it('應該處理AI服務錯誤', async () => {
      // Arrange
      mockCacheService.get.mockResolvedValue(null);
      
      const mockVertexAI = require('@google-cloud/vertexai').VertexAI;
      mockVertexAI.prototype.getGenerativeModel = jest.fn().mockReturnValue({
        generateContent: jest.fn().mockRejectedValue(new Error('AI服務暫時不可用'))
      });

      // Act & Assert
      await expect(
        aiService.generateTourContent(mockLocation, mockPreferences)
      ).rejects.toThrow('AI 導覽服務錯誤');
    });
  });

  describe('translateContent', () => {
    it('應該成功翻譯內容', async () => {
      // Arrange
      const mockTranslateClient = require('@google-cloud/translate/build/src/v3').TranslationServiceClient;
      mockTranslateClient.prototype.translateText = jest.fn().mockResolvedValue([{
        translations: [{
          translatedText: 'Welcome to Taipei 101'
        }]
      }]);

      // Act
      const result = await aiService.translateContent('歡迎來到台北101', 'en-US');

      // Assert
      expect(result).toBe('Welcome to Taipei 101');
    });

    it('翻譯失敗時應該返回原始內容', async () => {
      // Arrange
      const mockTranslateClient = require('@google-cloud/translate/build/src/v3').TranslationServiceClient;
      mockTranslateClient.prototype.translateText = jest.fn().mockRejectedValue(new Error('翻譯服務錯誤'));

      const originalText = '歡迎來到台北101';

      // Act
      const result = await aiService.translateContent(originalText, 'en-US');

      // Assert
      expect(result).toBe(originalText);
    });
  });

  describe('generateSpeech', () => {
    it('應該成功生成語音檔案', async () => {
      // Arrange
      const mockTTSClient = require('@google-cloud/text-to-speech').TextToSpeechClient;
      mockTTSClient.prototype.synthesizeSpeech = jest.fn().mockResolvedValue([{
        audioContent: Buffer.from('mock audio data')
      }]);

      // Mock fs.writeFile
      jest.doMock('fs', () => ({
        promises: {
          writeFile: jest.fn().mockResolvedValue(undefined)
        }
      }));

      // Act
      const result = await aiService.generateSpeech('測試文字', 'zh-TW');

      // Assert
      expect(result).toMatch(/\/api\/v1\/audio\/.+\.mp3$/);
      expect(mockTTSClient.prototype.synthesizeSpeech).toHaveBeenCalledWith(
        expect.objectContaining({
          input: { text: '測試文字' },
          voice: expect.objectContaining({
            languageCode: 'zh-TW'
          })
        })
      );
    });

    it('語音合成失敗時應該拋出錯誤', async () => {
      // Arrange
      const mockTTSClient = require('@google-cloud/text-to-speech').TextToSpeechClient;
      mockTTSClient.prototype.synthesizeSpeech = jest.fn().mockRejectedValue(new Error('TTS服務錯誤'));

      // Act & Assert
      await expect(
        aiService.generateSpeech('測試文字', 'zh-TW')
      ).rejects.toThrow('TTS服務錯誤');
    });
  });

  describe('快取機制', () => {
    it('應該生成正確的快取鍵', async () => {
      // Arrange
      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue('OK');

      const mockVertexAI = require('@google-cloud/vertexai').VertexAI;
      mockVertexAI.prototype.getGenerativeModel = jest.fn().mockReturnValue({
        generateContent: jest.fn().mockResolvedValue({
          response: {
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    title: '測試',
                    content: { sections: [] }
                  })
                }]
              }
            }]
          }
        })
      });

      // Act
      await aiService.generateTourContent(mockLocation, mockPreferences);

      // Assert
      expect(mockCacheService.get).toHaveBeenCalledWith(
        expect.stringContaining('tour_content_')
      );
      expect(mockCacheService.set).toHaveBeenCalledWith(
        expect.stringContaining('tour_content_'),
        expect.any(String),
        86400 // 24小時
      );
    });
  });
}); 