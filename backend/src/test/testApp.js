const express = require("express");
const cors = require("cors");

// 簡化的錯誤處理中間件
const errorHandler = (err, req, res, next) => {
  res.status(err.statusCode || 500).json({
    success: false,
    error: {
      message: err.message || "伺服器內部錯誤",
      code: err.code || "INTERNAL_ERROR",
    },
  });
};

const notFound = (req, res, next) => {
  res.status(404).json({
    success: false,
    error: {
      message: `路由 ${req.originalUrl} 不存在`,
      code: "ROUTE_NOT_FOUND",
    },
  });
};

const {
  securityHeaders,
  corsOptions,
  apiLimiter,
  sanitizeInput,
} = require("../middleware/security");

// 模擬 logger
const mockLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  log: () => {},
};

// 模擬請求記錄中間件
const mockRequestLogger = (req, res, next) => {
  next();
};

const app = express();

// 信任代理
app.set("trust proxy", 1);

// 安全性中間件
app.use(securityHeaders);
app.use(cors(corsOptions));

// 請求記錄（模擬）
app.use(mockRequestLogger);

// 速率限制
app.use("/api/", apiLimiter);

// 輸入清理
app.use(sanitizeInput);

// 請求解析中間件
app.use(
  express.json({
    limit: "10mb",
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb",
  })
);

// 模擬健康檢查端點
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    services: {
      initialized: true,
      mongodb: true,
      mysql: true,
      redis: true,
    },
    allHealthy: true,
  });
});

// 基本資訊端點
app.get("/", (req, res) => {
  res.json({
    name: "Localite AI 導覽系統 API",
    version: "1.0.0",
    status: "running",
    timestamp: new Date().toISOString(),
    endpoints: {
      health: "/health",
      apiDocs: "/api-docs",
      api: "/api/v1",
    },
  });
});

// API 路由（測試用）
app.use("/api/v1", (req, res) => {
  res.json({
    message: "Localite API v1 測試模式",
    availableEndpoints: {
      auth: "/api/v1/auth",
      tours: "/api/v1/tours",
      merchants: "/api/v1/merchants",
      users: "/api/v1/users",
    },
    documentation: "/api-docs",
  });
});

// 404 處理
app.use("*", notFound);

// 全域錯誤處理
app.use(errorHandler);

module.exports = app;
