#!/usr/bin/env tsx
/**
 * AI服務手動測試工具
 *
 * 使用方法：
 * npm run test:ai
 * 或
 * tsx src/scripts/test-ai-service.ts
 */

import dotenv from 'dotenv';
import { AIService, LocationData, TourPreferences } from '../services/ai-service';
import { CacheService } from '../services/cache-service';
import winston from 'winston';

// 載入環境變數
dotenv.config();

// 設置日誌
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...rest }) => {
      return `${timestamp} [${level}]: ${message} ${Object.keys(rest).length ? JSON.stringify(rest, null, 2) : ''}`;
    })
  ),
  transports: [new winston.transports.Console()]
});

class AIServiceTester {
  private aiService: AIService;
  private cacheService: CacheService;

  constructor() {
    this.aiService = new AIService();
    this.cacheService = new CacheService();
  }

  /**
   * 測試用的地點資料
   */
  private getTestLocations(): LocationData[] {
    return [
      {
        name: '台北101',
        description: '台北最著名的地標性摩天大樓，曾為世界最高建築',
        coordinates: { lat: 25.034, lng: 121.5645 },
        category: 'landmark',
        merchantInfo: {
          id: 'taipei101',
          name: '台北101觀景台',
          highlights: ['360度全景視野', '高速電梯體驗', '世界級建築工藝']
        }
      },
      {
        name: '國立故宮博物院',
        description: '收藏大量中華文物和藝術品的博物館',
        coordinates: { lat: 25.1013, lng: 121.5492 },
        category: 'museum',
        merchantInfo: {
          id: 'npm',
          name: '故宮博物院',
          highlights: ['翠玉白菜', '肉形石', '清明上河圖']
        }
      },
      {
        name: '西門町',
        description: '台北著名的年輕人聚集地和購物區',
        coordinates: { lat: 25.042, lng: 121.5081 },
        category: 'shopping'
      }
    ];
  }

  /**
   * 測試用的偏好設定
   */
  private getTestPreferences(): TourPreferences[] {
    return [
      {
        language: 'zh-TW',
        duration: 15,
        interests: ['architecture', 'history'],
        audienceType: 'adult',
        difficulty: 'moderate'
      },
      {
        language: 'en-US',
        duration: 10,
        interests: ['culture', 'art'],
        audienceType: 'family',
        difficulty: 'easy'
      },
      {
        language: 'ja-JP',
        duration: 20,
        interests: ['food', 'shopping'],
        audienceType: 'solo',
        difficulty: 'challenging'
      }
    ];
  }

  /**
   * 測試導覽內容生成
   */
  async testTourContentGeneration(): Promise<void> {
    logger.info('🎯 開始測試導覽內容生成...');

    try {
      const locations = this.getTestLocations();
      const preferences = this.getTestPreferences();

      for (let i = 0; i < Math.min(locations.length, 2); i++) {
        const location = locations[i];
        const preference = preferences[i];

        logger.info(`📍 測試地點: ${location.name}`, {
          language: preference.language,
          duration: preference.duration,
          interests: preference.interests
        });

        const startTime = Date.now();
        const result = await this.aiService.generateTourContent(location, preference);
        const endTime = Date.now();

        logger.info('✅ 導覽內容生成成功', {
          title: result.title,
          language: result.language,
          sectionsCount: result.content.sections.length,
          estimatedDuration: result.estimatedDuration,
          confidence: result.metadata.confidence,
          processingTime: `${endTime - startTime}ms`
        });

        // 簡單驗證內容品質
        this.validateTourContent(result);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      logger.error('❌ 導覽內容生成測試失敗', { error: errorMessage });
    }
  }

  /**
   * 測試翻譯功能
   */
  async testTranslation(): Promise<void> {
    logger.info('🌍 開始測試翻譯功能...');

    const testTexts = [
      '歡迎來到台北101，這是台灣最著名的地標建築。',
      '故宮博物院收藏了豐富的中華文物和藝術珍品。',
      '西門町是年輕人的天堂，充滿活力和創意。'
    ];

    const targetLanguages = ['en-US', 'ja-JP', 'ko-KR'];

    try {
      for (const text of testTexts.slice(0, 2)) {
        for (const targetLang of targetLanguages.slice(0, 2)) {
          logger.info(`📝 翻譯測試: ${text.substring(0, 20)}... -> ${targetLang}`);

          const startTime = Date.now();
          const translated = await this.aiService.translateContent(text, targetLang);
          const endTime = Date.now();

          logger.info('✅ 翻譯完成', {
            originalLength: text.length,
            translatedLength: translated.length,
            targetLanguage: targetLang,
            processingTime: `${endTime - startTime}ms`,
            preview: translated.substring(0, 50) + '...'
          });
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      logger.error('❌ 翻譯功能測試失敗', { error: errorMessage });
    }
  }

  /**
   * 測試語音合成
   */
  async testSpeechSynthesis(): Promise<void> {
    logger.info('🔊 開始測試語音合成...');

    const testTexts = [
      '歡迎來到台北101觀景台，讓我為您介紹這座令人驚嘆的建築。',
      'Welcome to Taipei 101 Observatory. Let me introduce this amazing building.',
      'こんにちは、台北101展望台へようこそ。'
    ];

    const languages = ['zh-TW', 'en-US', 'ja-JP'];

    try {
      for (let i = 0; i < Math.min(testTexts.length, 2); i++) {
        const text = testTexts[i];
        const language = languages[i];

        logger.info(`🎵 語音合成測試: ${language}`, {
          textLength: text.length,
          preview: text.substring(0, 30) + '...'
        });

        const startTime = Date.now();
        const audioUrl = await this.aiService.generateSpeech(text, language);
        const endTime = Date.now();

        logger.info('✅ 語音合成完成', {
          audioUrl,
          language,
          processingTime: `${endTime - startTime}ms`
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      logger.error('❌ 語音合成測試失敗', { error: errorMessage });
    }
  }

  /**
   * 測試快取功能
   */
  async testCacheSystem(): Promise<void> {
    logger.info('💾 開始測試快取系統...');

    try {
      const testKey = 'test_cache_key';
      const testValue = JSON.stringify({ message: '這是測試快取資料', timestamp: Date.now() });

      // 測試設定快取
      await this.cacheService.set(testKey, testValue, 60);
      logger.info('✅ 快取設定成功');

      // 測試讀取快取
      const cachedValue = await this.cacheService.get(testKey);
      if (cachedValue === testValue) {
        logger.info('✅ 快取讀取成功');
      } else {
        logger.warn('⚠️ 快取讀取結果不符預期');
      }

      // 測試快取是否存在
      const exists = await this.cacheService.exists(testKey);
      logger.info(`✅ 快取存在檢查: ${exists ? '存在' : '不存在'}`);

      // 清理測試快取
      await this.cacheService.del(testKey);
      logger.info('✅ 測試快取清理完成');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      logger.warn('⚠️ 快取系統測試遇到問題 (可能Redis未配置)', { error: errorMessage });
    }
  }

  /**
   * 驗證導覽內容品質
   */
  private validateTourContent(content: any): void {
    const issues = [];

    if (!content.title || content.title.length < 5) {
      issues.push('標題太短或缺失');
    }

    if (!content.content.sections || content.content.sections.length === 0) {
      issues.push('缺少內容段落');
    }

    if (content.metadata.confidence < 0.7) {
      issues.push(`AI 信心度偏低: ${content.metadata.confidence}`);
    }

    if (issues.length > 0) {
      logger.warn('⚠️ 內容品質問題', { issues });
    } else {
      logger.info('✅ 內容品質檢查通過');
    }
  }

  /**
   * 運行完整測試套件
   */
  async runCompleteTest(): Promise<void> {
    logger.info('🚀 開始 AI 服務完整測試套件...');

    // 檢查環境變數
    this.checkEnvironmentVariables();

    const testSuite = [
      { name: '快取系統', test: () => this.testCacheSystem() },
      { name: '導覽內容生成', test: () => this.testTourContentGeneration() },
      { name: '翻譯功能', test: () => this.testTranslation() },
      { name: '語音合成', test: () => this.testSpeechSynthesis() }
    ];

    let passedTests = 0;
    let totalTests = testSuite.length;

    for (const { name, test } of testSuite) {
      logger.info(`\n📋 執行測試: ${name}`);
      logger.info('='.repeat(50));

      try {
        await test();
        passedTests++;
        logger.info(`✅ ${name} 測試通過\n`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '未知錯誤';
        logger.error(`❌ ${name} 測試失敗`, { error: errorMessage });
      }
    }

    logger.info('='.repeat(50));
    logger.info(`🎉 測試完成! 通過: ${passedTests}/${totalTests}`);

    if (passedTests === totalTests) {
      logger.info('🎊 所有測試都通過了！AI 服務運作正常。');
    } else {
      logger.warn('⚠️ 部分測試失敗，請檢查配置和服務狀態。');
    }
  }

  /**
   * 檢查必要的環境變數
   */
  private checkEnvironmentVariables(): void {
    const requiredEnvVars = ['GOOGLE_CLOUD_PROJECT_ID', 'GOOGLE_CLOUD_LOCATION'];

    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

    if (missingVars.length > 0) {
      logger.warn('⚠️ 缺少必要的環境變數', { missingVars });
      logger.info('請確保 .env 檔案包含以下變數:');
      missingVars.forEach(varName => {
        logger.info(`  ${varName}=your_value_here`);
      });
    } else {
      logger.info('✅ 環境變數檢查通過');
    }
  }
}

// 主執行函數
async function main() {
  const tester = new AIServiceTester();

  // 解析命令行參數
  const args = process.argv.slice(2);
  const testType = args[0] || 'all';

  switch (testType) {
    case 'generate':
      await tester.testTourContentGeneration();
      break;
    case 'translate':
      await tester.testTranslation();
      break;
    case 'speech':
      await tester.testSpeechSynthesis();
      break;
    case 'cache':
      await tester.testCacheSystem();
      break;
    case 'all':
    default:
      await tester.runCompleteTest();
      break;
  }

  process.exit(0);
}

// 錯誤處理
process.on('unhandledRejection', (reason, promise) => {
  logger.error('未處理的 Promise 拒絕', { reason, promise });
  process.exit(1);
});

process.on('uncaughtException', error => {
  logger.error('未捕獲的異常', { error: error.message, stack: error.stack });
  process.exit(1);
});

// 執行測試
if (require.main === module) {
  main().catch(error => {
    logger.error('測試執行失敗', { error: error.message });
    process.exit(1);
  });
}
