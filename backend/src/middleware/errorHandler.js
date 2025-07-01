const { logger } = require("./requestLogger");

/**
 * 自訂錯誤類
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 處理 Mongoose 驗證錯誤
 */
const handleValidationError = (err) => {
  const errors = Object.values(err.errors).map((error) => error.message);
  return new AppError(
    `驗證錯誤: ${errors.join(", ")}`,
    400,
    "VALIDATION_ERROR"
  );
};

/**
 * 處理 MongoDB 重複鍵錯誤
 */
const handleDuplicateKeyError = (err) => {
  const field = Object.keys(err.keyValue)[0];
  return new AppError(`${field} 已存在`, 409, "DUPLICATE_ERROR");
};

/**
 * 處理 JWT 錯誤
 */
const handleJWTError = () => new AppError("無效的 token", 401, "INVALID_TOKEN");

const handleJWTExpiredError = () =>
  new AppError("Token 已過期", 401, "EXPIRED_TOKEN");

/**
 * 錯誤處理中間件
 */
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // 記錄錯誤
  logger.error({
    type: "error",
    error: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get("User-Agent"),
    timestamp: new Date().toISOString(),
  });

  // Mongoose 驗證錯誤
  if (err.name === "ValidationError") {
    error = handleValidationError(err);
  }

  // MongoDB 重複鍵錯誤
  if (err.code === 11000) {
    error = handleDuplicateKeyError(err);
  }

  // JWT 錯誤
  if (err.name === "JsonWebTokenError") {
    error = handleJWTError();
  }

  if (err.name === "TokenExpiredError") {
    error = handleJWTExpiredError();
  }

  // 回應錯誤
  res.status(error.statusCode || 500).json({
    success: false,
    error: {
      message: error.message || "伺服器內部錯誤",
      code: error.code || "INTERNAL_ERROR",
      ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
    },
  });
};

/**
 * 處理未捕獲的路由
 */
const notFound = (req, res, next) => {
  const error = new AppError(
    `路由 ${req.originalUrl} 不存在`,
    404,
    "ROUTE_NOT_FOUND"
  );
  next(error);
};

module.exports = {
  AppError,
  errorHandler,
  notFound,
};
