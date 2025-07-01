const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const cors = require("cors");
const { body, validationResult } = require("express-validator");

/**
 * 安全標頭配置
 */
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
});

/**
 * CORS 配置
 */
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      "http://localhost:3000",
      "http://localhost:19006",
      "http://localhost:8081",
      process.env.FRONTEND_URL,
      process.env.ADMIN_URL,
    ].filter(Boolean);

    // 允許沒有 origin 的請求（移動應用）
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error("CORS 不允許此來源"));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};

/**
 * 速率限制配置
 */
const createRateLimiter = (windowMs, max, message) => {
  return rateLimit({
    windowMs,
    max,
    message: {
      error: message || "請求過於頻繁，請稍後再試",
      retryAfter: Math.ceil(windowMs / 1000),
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        error: {
          message: "請求過於頻繁，請稍後再試",
          code: "RATE_LIMIT_EXCEEDED",
          retryAfter: Math.ceil(windowMs / 1000),
        },
      });
    },
  });
};

// 一般 API 速率限制
const apiLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 分鐘
  100, // 100 次請求
  "一般 API 請求過於頻繁"
);

// 認證 API 速率限制
const authLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 分鐘
  5, // 5 次請求
  "認證請求過於頻繁"
);

// 嚴格的速率限制（用於敏感操作）
const strictLimiter = createRateLimiter(
  60 * 60 * 1000, // 1 小時
  3, // 3 次請求
  "敏感操作請求過於頻繁"
);

/**
 * 驗證結果檢查中間件
 */
const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: {
        message: "輸入驗證失敗",
        code: "VALIDATION_ERROR",
        details: errors.array(),
      },
    });
  }
  next();
};

/**
 * 常用驗證規則
 */
const validationRules = {
  email: body("email")
    .isEmail()
    .normalizeEmail()
    .withMessage("請輸入有效的電子郵件地址"),

  password: body("password")
    .isLength({ min: 8 })
    .withMessage("密碼至少需要 8 個字符")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage("密碼必須包含大小寫字母和數字"),

  phone: body("phone")
    .isMobilePhone("zh-TW")
    .withMessage("請輸入有效的手機號碼"),

  required: (field) =>
    body(field).notEmpty().withMessage(`${field} 為必填欄位`),

  objectId: (field) => body(field).isMongoId().withMessage(`${field} 格式無效`),
};

/**
 * 清理輸入資料
 */
const sanitizeInput = (req, res, next) => {
  // 移除可能的 XSS 攻擊字符
  const sanitize = (obj) => {
    if (typeof obj === "string") {
      return obj.replace(
        /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
        ""
      );
    }
    if (typeof obj === "object" && obj !== null) {
      Object.keys(obj).forEach((key) => {
        obj[key] = sanitize(obj[key]);
      });
    }
    return obj;
  };

  req.body = sanitize(req.body);
  req.query = sanitize(req.query);
  req.params = sanitize(req.params);

  next();
};

module.exports = {
  securityHeaders,
  corsOptions,
  apiLimiter,
  authLimiter,
  strictLimiter,
  validateRequest,
  validationRules,
  sanitizeInput,
};
