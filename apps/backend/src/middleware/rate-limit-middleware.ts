import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import winston from 'winston';
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/rate-limit.log' })
  ]
});

/**
 * 基於記憶體的速率限制存儲（開發環境使用）
 * 生產環境建議使用 Redis 或其他持久化存儲
 */

/**
 * 生成用戶識別鍵
 */
const generateKey = (req: Request): string => {
  // 優先使用已認證用戶的 UID
  if (req.user?.uid) {
    return `user:${req.user.uid}`;
  }
  
  // 後備使用 IP 地址
  return `ip:${req.ip}`;
};

/**
 * 自定義錯誤處理
 */
const rateLimitHandler = (req: Request, res: Response) => {
  logger.warn('速率限制觸發', {
    key: generateKey(req),
    path: req.path,
    method: req.method,
    userAgent: req.get('User-Agent')
  });

  res.status(429).json({
    success: false,
    message: '請求過於頻繁，請稍後再試',
    code: 'RATE_LIMIT_EXCEEDED',
    retryAfter: Math.ceil(60), // 建議1分鐘後重試
  });
};

/**
 * AI 服務速率限制 - 較嚴格，因為 AI 調用成本高
 */
export const aiRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1小時
  max: 50, // 每小時最多50次請求
  keyGenerator: generateKey,
  handler: rateLimitHandler,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'AI 服務請求過於頻繁，請稍後再試',
    code: 'AI_RATE_LIMIT_EXCEEDED'
  }
});

/**
 * TTS 服務速率限制
 */
export const ttsRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1小時
  max: 100, // 每小時最多100次請求
  keyGenerator: generateKey,
  handler: rateLimitHandler,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'TTS 服務請求過於頻繁，請稍後再試',
    code: 'TTS_RATE_LIMIT_EXCEEDED'
  }
});

/**
 * 翻譯服務速率限制
 */
export const translateRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1小時
  max: 200, // 每小時最多200次請求
  keyGenerator: generateKey,
  handler: rateLimitHandler,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: '翻譯服務請求過於頻繁，請稍後再試',
    code: 'TRANSLATE_RATE_LIMIT_EXCEEDED'
  }
});

/**
 * 一般 API 速率限制
 */
export const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分鐘
  max: 1000, // 每15分鐘最多1000次請求
  keyGenerator: generateKey,
  handler: rateLimitHandler,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: '請求過於頻繁，請稍後再試',
    code: 'GENERAL_RATE_LIMIT_EXCEEDED'
  }
});

/**
 * 認證相關 API 速率限制 - 更嚴格
 */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分鐘
  max: 20, // 每15分鐘最多20次認證請求
  keyGenerator: (req: Request) => `auth:${req.ip}`, // 認證請求只能用 IP
  handler: (req: Request, res: Response) => {
    logger.warn('認證速率限制觸發', {
      ip: req.ip,
      path: req.path,
      userAgent: req.get('User-Agent')
    });

    res.status(429).json({
      success: false,
      message: '認證請求過於頻繁，請稍後再試',
      code: 'AUTH_RATE_LIMIT_EXCEEDED',
      retryAfter: Math.ceil(15 * 60), // 建議15分鐘後重試
    });
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * 檔案上傳速率限制
 */
export const uploadRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1小時
  max: 50, // 每小時最多50次上傳
  keyGenerator: generateKey,
  handler: rateLimitHandler,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: '檔案上傳請求過於頻繁，請稍後再試',
    code: 'UPLOAD_RATE_LIMIT_EXCEEDED'
  }
});

/**
 * 商戶相關 API 速率限制
 */
export const merchantRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1小時
  max: 500, // 每小時最多500次請求
  keyGenerator: generateKey,
  handler: rateLimitHandler,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: '商戶 API 請求過於頻繁，請稍後再試',
    code: 'MERCHANT_RATE_LIMIT_EXCEEDED'
  }
});

// 導出所有速率限制器
export const rateLimiter = {
  ai: aiRateLimit,
  tts: ttsRateLimit,
  translate: translateRateLimit,
  general: generalRateLimit,
  auth: authRateLimit,
  upload: uploadRateLimit,
  merchant: merchantRateLimit
};

export default rateLimiter; 