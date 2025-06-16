import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

// 配置導入
import { initializeDatabase } from './config/database';
import { initializeFirebase } from './config/firebase';

// 路由導入
import authRoutes from './routes/auth';
import tourRoutes from './routes/tour-routes';

// 載入環境變數
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

// Swagger 配置
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: '在地人 AI 導覽系統 API',
      version: '1.0.0',
      description: '在地人 AI 導覽系統的後端 API 文檔',
    },
    servers: [
      {
        url: process.env.API_BASE_URL || `http://localhost:${PORT}`,
        description: '開發環境',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  },
  apis: ['./src/routes/*.ts'],
};

const specs = swaggerJsdoc(swaggerOptions);

// 安全性中間件
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));

// 速率限制
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分鐘
  max: 100, // 限制每個 IP 每 15 分鐘最多 100 個請求
  message: {
    error: 'RATE_LIMIT_EXCEEDED',
    message: '請求過於頻繁，請稍後再試'
  }
});
app.use(limiter);

// 一般中間件
app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// API 文檔
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs, {
  explorer: true,
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: '在地人 AI 導覽系統 API 文檔'
}));

// 健康檢查端點
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'localite-backend',
    version: '1.0.0'
  });
});

// API 根路由
app.get('/api', (req, res) => {
  res.json({
    message: '在地人 AI 導覽系統 - 後端 API',
    version: '1.0.0',
    status: 'running',
    documentation: '/api-docs',
    endpoints: {
      health: '/health',
      auth: '/api/v1/auth',
      tours: '/api/v1/tours',
      users: '/api/v1/users'
    }
  });
});

// API v1 路由
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/tours', tourRoutes);

// 404 處理
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'ROUTE_NOT_FOUND',
    message: `路由 ${req.originalUrl} 不存在`,
    path: req.originalUrl,
    method: req.method
  });
});

// 全域錯誤處理
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('全域錯誤:', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip
  });

  res.status(err.status || 500).json({
    error: 'INTERNAL_SERVER_ERROR',
    message: process.env.NODE_ENV === 'production' ? '內部伺服器錯誤' : err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 啟動函數
async function startServer() {
  try {
    // 初始化 Firebase
    initializeFirebase();
    
    // 初始化資料庫
    await initializeDatabase();
    
    // 啟動伺服器
    app.listen(PORT, () => {
      console.log('\n🚀 === 在地人 AI 導覽系統 後端服務啟動 ===');
      console.log(`📍 伺服器地址: http://localhost:${PORT}`);
      console.log(`📊 健康檢查: http://localhost:${PORT}/health`);
      console.log(`📝 API 根路由: http://localhost:${PORT}/api`);
      console.log(`📚 API 文檔: http://localhost:${PORT}/api-docs`);
      console.log(`🌍 運行環境: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🕐 啟動時間: ${new Date().toLocaleString('zh-TW')}`);
      console.log('================================================\n');
    });

  } catch (error) {
    console.error('❌ 伺服器啟動失敗:', error);
    process.exit(1);
  }
}

// 優雅關閉處理
process.on('SIGTERM', () => {
  console.log('📴 收到 SIGTERM 信號，正在關閉伺服器...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('📴 收到 SIGINT 信號，正在關閉伺服器...');
  process.exit(0);
});

// 啟動伺服器
startServer();

export default app; 