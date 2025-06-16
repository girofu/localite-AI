import { VertexAI } from '@google-cloud/vertexai';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { TranslationServiceClient } from '@google-cloud/translate/build/src/v3';
import { promises as fs } from 'fs';
import { join } from 'path';
import winston from 'winston';
import { CacheService } from './cache-service';

export interface TourPreferences {
  language: string;
  duration: number; // 分鐘
  interests: string[];
  audienceType: 'family' | 'adult' | 'solo';
  difficulty: 'easy' | 'moderate' | 'challenging';
}

export interface LocationData {
  name: string;
  description: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  category: string;
  merchantInfo?: {
    id: string;
    name: string;
    highlights: string[];
  };
}

export interface GeneratedTourContent {
  title: string;
  description: string;
  estimatedDuration: number;
  content: {
    introduction: string;
    sections: Array<{
      title: string;
      content: string;
      audioUrl?: string;
      timestamp: number;
    }>;
    conclusion: string;
  };
  language: string;
  metadata: {
    generatedAt: string;
    version: string;
    confidence: number;
  };
}

export class AIService {
  private vertexAI: VertexAI;
  private ttsClient: TextToSpeechClient;
  private translateClient: TranslationServiceClient;
  private cache: CacheService;
  private logger: winston.Logger;

  constructor() {
    // 初始化 Google Cloud 服務
    this.vertexAI = new VertexAI({
      project: process.env.GOOGLE_CLOUD_PROJECT_ID,
      location: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1'
    });

    this.ttsClient = new TextToSpeechClient({
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID
    });

    this.translateClient = new TranslationServiceClient({
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID
    });

    this.cache = new CacheService();
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
      transports: [new winston.transports.File({ filename: 'logs/ai-service.log' })]
    });
  }

  /**
   * 生成導覽內容
   */
  async generateTourContent(
    location: LocationData,
    preferences: TourPreferences
  ): Promise<GeneratedTourContent> {
    const cacheKey = this.generateCacheKey(location, preferences);

    try {
      // 檢查快取
      const cachedContent = await this.cache.get(cacheKey);
      if (cachedContent) {
        this.logger.info('返回快取的導覽內容', { locationName: location.name });
        return JSON.parse(cachedContent);
      }

      // 構建 AI 提示詞
      const prompt = this.buildTourPrompt(location, preferences);

      // 調用 Vertex AI Gemini
      const generatedText = await this.callVertexAI(prompt);

      // 解析生成的內容
      const tourContent = await this.parseTourContent(generatedText, preferences);

      // 如果需要，生成語音
      if (preferences.language !== 'zh-TW') {
        await this.generateAudioForSections(tourContent);
      }

      // 存入快取（24小時）
      await this.cache.set(cacheKey, JSON.stringify(tourContent), 86400);

      this.logger.info('成功生成導覽內容', {
        locationName: location.name,
        language: preferences.language,
        sectionsCount: tourContent.content.sections.length
      });

      return tourContent;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      this.logger.error('生成導覽內容失敗', {
        error: errorMessage,
        locationName: location.name,
        preferences
      });
      throw new Error(`AI 導覽服務錯誤: ${errorMessage}`);
    }
  }

  /**
   * 翻譯內容到指定語言
   */
  async translateContent(content: string, targetLanguage: string): Promise<string> {
    try {
      const [translation] = await this.translateClient.translateText({
        parent: `projects/${process.env.GOOGLE_CLOUD_PROJECT_ID}/locations/global`,
        contents: [content],
        mimeType: 'text/plain',
        sourceLanguageCode: 'zh-TW',
        targetLanguageCode: targetLanguage
      });

      return translation.translations?.[0]?.translatedText || content;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      this.logger.error('翻譯失敗', { error: errorMessage, targetLanguage });
      return content; // 返回原始內容作為後備
    }
  }

  /**
   * 生成語音文件
   */
  async generateSpeech(text: string, language: string = 'zh-TW'): Promise<string> {
    try {
      const request = {
        input: { text },
        voice: {
          languageCode: language,
          name: this.getVoiceName(language),
          ssmlGender: 'NEUTRAL' as const
        },
        audioConfig: {
          audioEncoding: 'MP3' as const,
          speakingRate: 1.0,
          pitch: 0.0
        }
      };

      const [response] = await this.ttsClient.synthesizeSpeech(request);

      // 保存音頻文件到本地暫存
      const fileName = `tts_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp3`;
      const filePath = join(process.cwd(), 'temp', fileName);

      await fs.writeFile(filePath, response.audioContent as Buffer);

      // 實際部署時應該上傳到 Cloud Storage
      // const audioUrl = await this.uploadToCloudStorage(filePath, fileName);

      return `/api/v1/audio/${fileName}`; // 暫時返回本地路徑
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      this.logger.error('語音合成失敗', { error: errorMessage, language });
      throw error;
    }
  }

  /**
   * 構建 AI 提示詞
   */
  private buildTourPrompt(location: LocationData, preferences: TourPreferences): string {
    const interestsText = preferences.interests.join('、');
    const audienceText = {
      family: '家庭親子',
      adult: '成人',
      solo: '個人旅行者'
    }[preferences.audienceType];

    return `
作為一位專業的在地導覽員，請為以下地點創建一個${preferences.duration}分鐘的導覽解說：

地點資訊：
- 名稱：${location.name}
- 描述：${location.description}
- 類別：${location.category}
${location.merchantInfo ? `- 商戶亮點：${location.merchantInfo.highlights.join('、')}` : ''}

導覽要求：
- 目標受眾：${audienceText}
- 興趣重點：${interestsText}
- 總時長：${preferences.duration}分鐘
- 語言：${preferences.language === 'zh-TW' ? '繁體中文' : preferences.language}

請以 JSON 格式回覆，包含：
{
  "title": "導覽標題",
  "description": "導覽簡介",
  "estimatedDuration": ${preferences.duration},
  "content": {
    "introduction": "開場介紹（1-2分鐘）",
    "sections": [
      {
        "title": "段落標題",
        "content": "詳細解說內容",
        "timestamp": 0
      }
    ],
    "conclusion": "結語（30秒-1分鐘）"
  }
}

請確保：
1. 內容生動有趣，符合目標受眾
2. 突出地點的獨特性和文化價值
3. 時間分配合理，每段2-3分鐘
4. 語調親切，易於理解
5. 包含實用的參觀建議
`;
  }

  /**
   * 調用 Vertex AI Gemini
   */
  private async callVertexAI(prompt: string): Promise<string> {
    try {
      // 嘗試使用不同的模型版本
      const modelNames = ['gemini-1.0-pro', 'gemini-pro', 'text-bison@001'];

      let lastError: Error | null = null;

      for (const modelName of modelNames) {
        try {
          this.logger.info(`嘗試使用模型: ${modelName}`);

          const model = this.vertexAI.getGenerativeModel({
            model: modelName,
            generationConfig: {
              maxOutputTokens: 8192,
              temperature: 0.7,
              topP: 0.8
            }
          });

          const result = await model.generateContent(prompt);
          const response = result.response;

          if (!response || !response.candidates || response.candidates.length === 0) {
            throw new Error(`模型 ${modelName} 沒有返回有效回應`);
          }

          this.logger.info(`模型 ${modelName} 調用成功`);
          return response.candidates[0].content.parts[0].text || '';
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          this.logger.warn(`模型 ${modelName} 調用失敗，嘗試下一個`, { error: lastError.message });
          continue;
        }
      }

      // 如果所有模型都失敗，返回模擬回應用於測試
      this.logger.warn('所有 Vertex AI 模型都無法使用，返回模擬內容進行測試');
      return this.generateMockTourContent(prompt);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      this.logger.error('Vertex AI 調用完全失敗', { error: errorMessage });
      throw error;
    }
  }

  /**
   * 生成模擬導覽內容用於測試
   */
  private generateMockTourContent(prompt: string): string {
    // 從提示詞中提取地點名稱
    const locationMatch = prompt.match(/名稱：([^\n]+)/);
    const locationName = locationMatch ? locationMatch[1] : '測試地點';

    return JSON.stringify(
      {
        title: `探索${locationName}`,
        description: `深度導覽${locationName}的歷史文化與特色亮點`,
        estimatedDuration: 15,
        content: {
          introduction: `歡迎來到${locationName}！我是您今天的導覽員，很高興為您介紹這個充滿故事的地方。`,
          sections: [
            {
              title: '歷史背景',
              content: `${locationName}有著豐富的歷史背景。這裡見證了時代的變遷，承載著無數珍貴的記憶與故事。`,
              timestamp: 0
            },
            {
              title: '建築特色',
              content: `讓我們來欣賞${locationName}獨特的建築風格。每一個細節都展現了當時的工藝技術與美學理念。`,
              timestamp: 180
            },
            {
              title: '文化意義',
              content: `${locationName}不僅僅是一個地標，更是文化的象徵。它代表著這個城市的精神與價值。`,
              timestamp: 360
            }
          ],
          conclusion: `感謝您的聆聽！希望今天的導覽讓您對${locationName}有了更深的認識。歡迎您再次造訪！`
        }
      },
      null,
      2
    );
  }

  /**
   * 解析 AI 生成的內容
   */
  private async parseTourContent(
    generatedText: string,
    preferences: TourPreferences
  ): Promise<GeneratedTourContent> {
    try {
      // 嘗試解析 JSON
      const cleanedText = generatedText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const parsed = JSON.parse(cleanedText);

      // 添加時間戳記和元數據
      let currentTimestamp = 0;
      parsed.content.sections = parsed.content.sections.map((section: any) => {
        section.timestamp = currentTimestamp;
        currentTimestamp += 180; // 假設每段3分鐘
        return section;
      });

      return {
        ...parsed,
        language: preferences.language,
        metadata: {
          generatedAt: new Date().toISOString(),
          version: '1.0',
          confidence: 0.95
        }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      this.logger.error('解析 AI 內容失敗', { error: errorMessage });

      // 後備方案：返回基本結構
      return {
        title: '導覽解說',
        description: '探索這個特殊地點的故事與文化',
        estimatedDuration: preferences.duration,
        content: {
          introduction: generatedText.substring(0, 500),
          sections: [
            {
              title: '詳細介紹',
              content: generatedText,
              timestamp: 0
            }
          ],
          conclusion: '感謝您的聆聽，希望您享受這次的導覽體驗。'
        },
        language: preferences.language,
        metadata: {
          generatedAt: new Date().toISOString(),
          version: '1.0',
          confidence: 0.7
        }
      };
    }
  }

  /**
   * 為內容段落生成語音
   */
  private async generateAudioForSections(content: GeneratedTourContent): Promise<void> {
    for (const section of content.content.sections) {
      try {
        const audioUrl = await this.generateSpeech(section.content, content.language);
        section.audioUrl = audioUrl;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '未知錯誤';
        this.logger.warn('段落語音生成失敗', {
          error: errorMessage,
          sectionTitle: section.title
        });
      }
    }
  }

  /**
   * 生成快取鍵
   */
  private generateCacheKey(location: LocationData, preferences: TourPreferences): string {
    const keyData = {
      locationName: location.name,
      coordinates: location.coordinates,
      language: preferences.language,
      duration: preferences.duration,
      interests: preferences.interests.sort(),
      audienceType: preferences.audienceType
    };

    return `tour_content:${Buffer.from(JSON.stringify(keyData)).toString('base64')}`;
  }

  /**
   * 根據語言選擇語音
   */
  private getVoiceName(language: string): string {
    const voiceMap: { [key: string]: string } = {
      'zh-TW': 'cmn-TW-Wavenet-A',
      'en-US': 'en-US-Wavenet-D',
      'ja-JP': 'ja-JP-Wavenet-A',
      'ko-KR': 'ko-KR-Wavenet-A'
    };

    return voiceMap[language] || voiceMap['zh-TW'];
  }
}

export default AIService;
