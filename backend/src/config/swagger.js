const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Localite AI 導覽系統 API',
      version: '1.0.0',
      description: `
        Localite AI 導覽系統後端 API 服務
        
        ## 功能特色
        - 🤖 AI 導覽內容生成
        - 🗣️ 多語言文字轉語音
        - 🏪 商戶管理系統
        - 🔒 安全認證機制
        - ⚡ 快取優化
        
        ## 認證方式
        使用 Bearer Token 進行 API 認證：
        \`\`\`
        Authorization: Bearer <your-token>
        \`\`\`
      `,
      contact: {
        name: 'Localite 開發團隊',
        email: 'dev@localite.com',
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
    },
    servers: [
      {
        url: process.env.API_BASE_URL || 'http://localhost:8000',
        description: '開發環境',
      },
      {
        url: 'https://api.localite.com',
        description: '生產環境',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT 認證 token',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false,
            },
            error: {
              type: 'object',
              properties: {
                message: {
                  type: 'string',
                  description: '錯誤訊息',
                },
                code: {
                  type: 'string',
                  description: '錯誤代碼',
                },
                details: {
                  type: 'array',
                  items: {
                    type: 'object',
                  },
                  description: '詳細錯誤資訊',
                },
              },
            },
          },
        },
        SuccessResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true,
            },
            data: {
              type: 'object',
              description: '回應資料',
            },
            message: {
              type: 'string',
              description: '成功訊息',
            },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: '用戶 ID',
            },
            email: {
              type: 'string',
              format: 'email',
              description: '電子郵件',
            },
            name: {
              type: 'string',
              description: '用戶姓名',
            },
            role: {
              type: 'string',
              enum: ['user', 'merchant', 'admin'],
              description: '用戶角色',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: '創建時間',
            },
          },
        },
        Tour: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: '導覽 ID',
            },
            title: {
              type: 'string',
              description: '導覽標題',
            },
            description: {
              type: 'string',
              description: '導覽描述',
            },
            content: {
              type: 'object',
              description: '導覽內容（多語言）',
            },
            merchantId: {
              type: 'string',
              description: '商戶 ID',
            },
            location: {
              type: 'object',
              properties: {
                lat: { type: 'number' },
                lng: { type: 'number' },
                address: { type: 'string' },
              },
            },
            status: {
              type: 'string',
              enum: ['draft', 'published', 'archived'],
              description: '狀態',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
      },
      responses: {
        UnauthorizedError: {
          description: '未認證',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
              example: {
                success: false,
                error: {
                  message: '未提供有效的認證 token',
                  code: 'UNAUTHORIZED',
                },
              },
            },
          },
        },
        ForbiddenError: {
          description: '權限不足',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
              example: {
                success: false,
                error: {
                  message: '權限不足',
                  code: 'FORBIDDEN',
                },
              },
            },
          },
        },
        NotFoundError: {
          description: '資源不存在',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
              example: {
                success: false,
                error: {
                  message: '請求的資源不存在',
                  code: 'NOT_FOUND',
                },
              },
            },
          },
        },
        ValidationError: {
          description: '輸入驗證錯誤',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
              example: {
                success: false,
                error: {
                  message: '輸入驗證失敗',
                  code: 'VALIDATION_ERROR',
                  details: [
                    {
                      field: 'email',
                      message: '請輸入有效的電子郵件地址',
                    },
                  ],
                },
              },
            },
          },
        },
        RateLimitError: {
          description: '請求過於頻繁',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
              example: {
                success: false,
                error: {
                  message: '請求過於頻繁，請稍後再試',
                  code: 'RATE_LIMIT_EXCEEDED',
                  retryAfter: 900,
                },
              },
            },
          },
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
    tags: [
      {
        name: 'Authentication',
        description: '用戶認證相關 API',
      },
      {
        name: 'Tours',
        description: '導覽管理相關 API',
      },
      {
        name: 'Merchants',
        description: '商戶管理相關 API',
      },
      {
        name: 'System',
        description: '系統相關 API',
      },
    ],
  },
  apis: ['./src/routes/*.js', './src/controllers/*.js', './src/models/*.js'],
};

const specs = swaggerJsdoc(options);

const swaggerSetup = {
  swaggerUi,
  specs,
  customOptions: {
    customCss: `
      .swagger-ui .topbar { display: none }
      .swagger-ui .info .title { color: #2196F3 }
    `,
    customSiteTitle: 'Localite API 文檔',
    customfavIcon: '/favicon.ico',
  },
};

module.exports = swaggerSetup;
