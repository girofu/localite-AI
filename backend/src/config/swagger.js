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

        // 功能旗標相關 Schema
        FeatureFlag: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: '功能旗標名稱',
              example: 'ai_tour_generation',
            },
            enabled: {
              type: 'boolean',
              description: '是否啟用',
              example: true,
            },
            rolloutPercentage: {
              type: 'number',
              minimum: 0,
              maximum: 100,
              description: '推廣百分比（金絲雀部署）',
              example: 50,
            },
            environments: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['development', 'test', 'staging', 'production'],
              },
              description: '支援的環境',
              example: ['development', 'production'],
            },
            userGroups: {
              type: 'array',
              items: {
                type: 'string',
              },
              description: '目標用戶群體',
              example: ['beta_users', 'premium_users'],
            },
            description: {
              type: 'string',
              description: '功能描述',
              example: 'AI 導覽內容生成功能',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: '創建時間',
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
              description: '更新時間',
            },
          },
          required: ['name', 'enabled', 'rolloutPercentage', 'environments'],
        },

        FeatureFlagEvaluationContext: {
          type: 'object',
          properties: {
            userId: {
              type: 'string',
              description: '用戶 ID',
              example: 'user-123',
            },
            userGroups: {
              type: 'array',
              items: {
                type: 'string',
              },
              description: '用戶所屬群體',
              example: ['beta_users'],
            },
            environment: {
              type: 'string',
              enum: ['development', 'test', 'staging', 'production'],
              description: '當前環境',
              example: 'production',
            },
          },
        },

        // 監控系統相關 Schema
        PerformanceMetrics: {
          type: 'object',
          properties: {
            timestamp: {
              type: 'string',
              format: 'date-time',
              description: '時間戳記',
            },
            cpu: {
              type: 'object',
              properties: {
                usage: {
                  type: 'number',
                  description: 'CPU 使用率 (%)',
                  example: 45.5,
                },
                loadAvg: {
                  type: 'array',
                  items: {
                    type: 'number',
                  },
                  description: '系統負載平均值',
                  example: [1.2, 1.5, 1.8],
                },
              },
            },
            memory: {
              type: 'object',
              properties: {
                usage: {
                  type: 'number',
                  description: '記憶體使用率 (%)',
                  example: 72.3,
                },
                total: {
                  type: 'number',
                  description: '總記憶體 (MB)',
                  example: 8192,
                },
                used: {
                  type: 'number',
                  description: '已使用記憶體 (MB)',
                  example: 5923,
                },
                free: {
                  type: 'number',
                  description: '可用記憶體 (MB)',
                  example: 2269,
                },
              },
            },
            requests: {
              type: 'object',
              properties: {
                total: {
                  type: 'number',
                  description: '總請求數',
                  example: 1524,
                },
                perMinute: {
                  type: 'number',
                  description: '每分鐘請求數',
                  example: 42,
                },
                averageResponseTime: {
                  type: 'number',
                  description: '平均響應時間 (ms)',
                  example: 156.7,
                },
              },
            },
          },
        },

        SystemHealth: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['healthy', 'warning', 'critical'],
              description: '系統健康狀態',
              example: 'healthy',
            },
            services: {
              type: 'object',
              properties: {
                database: {
                  type: 'object',
                  properties: {
                    status: {
                      type: 'string',
                      enum: ['connected', 'disconnected', 'error'],
                    },
                    responseTime: {
                      type: 'number',
                      description: '響應時間 (ms)',
                    },
                  },
                },
                redis: {
                  type: 'object',
                  properties: {
                    status: {
                      type: 'string',
                      enum: ['connected', 'disconnected', 'error'],
                    },
                    responseTime: {
                      type: 'number',
                      description: '響應時間 (ms)',
                    },
                  },
                },
                firebase: {
                  type: 'object',
                  properties: {
                    status: {
                      type: 'string',
                      enum: ['connected', 'disconnected', 'error'],
                    },
                    responseTime: {
                      type: 'number',
                      description: '響應時間 (ms)',
                    },
                  },
                },
              },
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              description: '檢查時間',
            },
          },
        },

        ErrorReport: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: '錯誤報告 ID',
            },
            message: {
              type: 'string',
              description: '錯誤訊息',
            },
            stack: {
              type: 'string',
              description: '錯誤堆疊',
            },
            level: {
              type: 'string',
              enum: ['info', 'warning', 'error', 'critical'],
              description: '錯誤級別',
            },
            context: {
              type: 'object',
              description: '錯誤上下文資訊',
            },
            count: {
              type: 'number',
              description: '錯誤次數',
            },
            firstOccurred: {
              type: 'string',
              format: 'date-time',
              description: '首次發生時間',
            },
            lastOccurred: {
              type: 'string',
              format: 'date-time',
              description: '最後發生時間',
            },
          },
        },

        // 商戶相關 Schema
        Merchant: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: '商戶 ID',
            },
            name: {
              type: 'string',
              description: '商戶名稱',
            },
            email: {
              type: 'string',
              format: 'email',
              description: '聯絡信箱',
            },
            phone: {
              type: 'string',
              description: '聯絡電話',
            },
            address: {
              type: 'string',
              description: '商戶地址',
            },
            description: {
              type: 'string',
              description: '商戶描述',
            },
            status: {
              type: 'string',
              enum: ['pending', 'approved', 'rejected', 'suspended'],
              description: '審核狀態',
            },
            documents: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: {
                    type: 'string',
                    description: '文件類型',
                  },
                  url: {
                    type: 'string',
                    description: '文件 URL',
                  },
                },
              },
              description: '認證文件',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: '註冊時間',
            },
            approvedAt: {
              type: 'string',
              format: 'date-time',
              description: '審核通過時間',
            },
          },
        },

        // 產品相關 Schema
        Product: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: '產品 ID',
            },
            name: {
              type: 'string',
              description: '產品名稱',
            },
            description: {
              type: 'string',
              description: '產品描述',
            },
            price: {
              type: 'number',
              description: '價格',
            },
            currency: {
              type: 'string',
              description: '貨幣',
              example: 'TWD',
            },
            category: {
              type: 'string',
              description: '產品分類',
            },
            images: {
              type: 'array',
              items: {
                type: 'string',
              },
              description: '產品圖片 URLs',
            },
            merchantId: {
              type: 'string',
              description: '所屬商戶 ID',
            },
            status: {
              type: 'string',
              enum: ['active', 'inactive', 'out_of_stock'],
              description: '產品狀態',
            },
            inventory: {
              type: 'number',
              description: '庫存數量',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: '建立時間',
            },
          },
        },

        // AI 服務相關 Schema
        AIGenerationRequest: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: '生成提示內容',
              example: '為台北101景點生成導覽內容，包含歷史背景和建築特色',
            },
            language: {
              type: 'string',
              enum: ['zh-TW', 'zh-CN', 'en-US', 'ja-JP'],
              description: '目標語言',
              example: 'zh-TW',
            },
            tone: {
              type: 'string',
              enum: ['professional', 'casual', 'friendly', 'educational'],
              description: '語調風格',
              example: 'friendly',
            },
            maxLength: {
              type: 'number',
              description: '最大字數限制',
              example: 500,
            },
            context: {
              type: 'object',
              description: '額外上下文資訊',
              properties: {
                location: {
                  type: 'string',
                  description: '地點名稱',
                },
                category: {
                  type: 'string',
                  description: '景點類別',
                },
                targetAudience: {
                  type: 'string',
                  description: '目標受眾',
                },
              },
            },
          },
          required: ['prompt', 'language'],
        },

        AIGenerationResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true,
            },
            data: {
              type: 'object',
              properties: {
                content: {
                  type: 'string',
                  description: '生成的內容',
                },
                language: {
                  type: 'string',
                  description: '內容語言',
                },
                wordCount: {
                  type: 'number',
                  description: '字數統計',
                },
                generatedAt: {
                  type: 'string',
                  format: 'date-time',
                  description: '生成時間',
                },
              },
            },
            metadata: {
              type: 'object',
              properties: {
                modelUsed: {
                  type: 'string',
                  description: '使用的 AI 模型',
                },
                processingTime: {
                  type: 'number',
                  description: '處理時間（毫秒）',
                },
                tokensUsed: {
                  type: 'number',
                  description: '使用的 token 數量',
                },
              },
            },
          },
        },

        TTSRequest: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: '要轉換為語音的文字',
              example: '歡迎來到台北101，這是台灣最著名的地標建築',
            },
            language: {
              type: 'string',
              enum: ['zh-TW', 'zh-CN', 'en-US', 'ja-JP'],
              description: '語音語言',
              example: 'zh-TW',
            },
            voice: {
              type: 'string',
              description: '語音模型',
              example: 'zh-TW-Wavenet-A',
            },
            speed: {
              type: 'number',
              minimum: 0.25,
              maximum: 4.0,
              description: '語速倍率',
              example: 1.0,
            },
            pitch: {
              type: 'number',
              minimum: -20.0,
              maximum: 20.0,
              description: '音調調整',
              example: 0.0,
            },
            audioFormat: {
              type: 'string',
              enum: ['mp3', 'wav', 'ogg'],
              description: '音訊格式',
              example: 'mp3',
            },
          },
          required: ['text', 'language'],
        },

        TTSResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true,
            },
            data: {
              type: 'object',
              properties: {
                audioUrl: {
                  type: 'string',
                  description: '音訊檔案 URL',
                  example: 'https://storage.googleapis.com/bucket/audio-123.mp3',
                },
                duration: {
                  type: 'number',
                  description: '音訊長度（秒）',
                  example: 15.5,
                },
                size: {
                  type: 'number',
                  description: '檔案大小（bytes）',
                  example: 245760,
                },
                format: {
                  type: 'string',
                  description: '音訊格式',
                  example: 'mp3',
                },
              },
            },
          },
        },

        // 檔案上傳相關 Schema
        FileUploadRequest: {
          type: 'object',
          properties: {
            file: {
              type: 'string',
              format: 'binary',
              description: '上傳的檔案',
            },
            category: {
              type: 'string',
              enum: ['image', 'audio', 'video', 'document'],
              description: '檔案類別',
            },
            tags: {
              type: 'array',
              items: {
                type: 'string',
              },
              description: '檔案標籤',
            },
          },
          required: ['file'],
        },

        FileUploadResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true,
            },
            data: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: '檔案 ID',
                },
                filename: {
                  type: 'string',
                  description: '檔案名稱',
                },
                url: {
                  type: 'string',
                  description: '檔案 URL',
                },
                size: {
                  type: 'number',
                  description: '檔案大小（bytes）',
                },
                mimeType: {
                  type: 'string',
                  description: 'MIME 類型',
                },
                uploadedAt: {
                  type: 'string',
                  format: 'date-time',
                  description: '上傳時間',
                },
              },
            },
          },
        },

        // 分頁相關 Schema
        PaginationQuery: {
          type: 'object',
          properties: {
            page: {
              type: 'number',
              minimum: 1,
              description: '頁碼',
              example: 1,
            },
            limit: {
              type: 'number',
              minimum: 1,
              maximum: 100,
              description: '每頁筆數',
              example: 20,
            },
            sort: {
              type: 'string',
              description: '排序欄位',
              example: 'createdAt',
            },
            order: {
              type: 'string',
              enum: ['asc', 'desc'],
              description: '排序方向',
              example: 'desc',
            },
          },
        },

        PaginatedResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true,
            },
            data: {
              type: 'array',
              items: {
                type: 'object',
              },
              description: '資料列表',
            },
            pagination: {
              type: 'object',
              properties: {
                page: {
                  type: 'number',
                  description: '當前頁碼',
                  example: 1,
                },
                limit: {
                  type: 'number',
                  description: '每頁筆數',
                  example: 20,
                },
                total: {
                  type: 'number',
                  description: '總筆數',
                  example: 156,
                },
                totalPages: {
                  type: 'number',
                  description: '總頁數',
                  example: 8,
                },
                hasNext: {
                  type: 'boolean',
                  description: '是否有下一頁',
                  example: true,
                },
                hasPrev: {
                  type: 'boolean',
                  description: '是否有上一頁',
                  example: false,
                },
              },
            },
          },
        },

        // 搜尋相關 Schema
        SearchQuery: {
          type: 'object',
          properties: {
            q: {
              type: 'string',
              description: '搜尋關鍵字',
              example: '台北101',
            },
            category: {
              type: 'string',
              description: '分類篩選',
            },
            location: {
              type: 'string',
              description: '地點篩選',
            },
            priceMin: {
              type: 'number',
              description: '最低價格',
            },
            priceMax: {
              type: 'number',
              description: '最高價格',
            },
            dateFrom: {
              type: 'string',
              format: 'date',
              description: '開始日期',
            },
            dateTo: {
              type: 'string',
              format: 'date',
              description: '結束日期',
            },
          },
        },

        SearchResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true,
            },
            data: {
              type: 'object',
              properties: {
                results: {
                  type: 'array',
                  items: {
                    type: 'object',
                  },
                  description: '搜尋結果',
                },
                query: {
                  type: 'string',
                  description: '搜尋查詢',
                },
                total: {
                  type: 'number',
                  description: '結果總數',
                },
                searchTime: {
                  type: 'number',
                  description: '搜尋耗時（毫秒）',
                },
                suggestions: {
                  type: 'array',
                  items: {
                    type: 'string',
                  },
                  description: '搜尋建議',
                },
              },
            },
          },
        },

        // 通知相關 Schema
        NotificationRequest: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: '通知標題',
              example: '新的導覽內容',
            },
            body: {
              type: 'string',
              description: '通知內容',
              example: '您關注的景點有新的導覽內容上線了',
            },
            data: {
              type: 'object',
              description: '額外資料',
            },
            recipients: {
              type: 'array',
              items: {
                type: 'string',
              },
              description: '接收者列表（用戶 ID 或 token）',
            },
            schedule: {
              type: 'string',
              format: 'date-time',
              description: '排程發送時間（可選）',
            },
          },
          required: ['title', 'body', 'recipients'],
        },

        // 快取相關 Schema
        CacheEntry: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: '快取鍵值',
            },
            value: {
              type: 'object',
              description: '快取內容',
            },
            ttl: {
              type: 'number',
              description: '存活時間（秒）',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: '建立時間',
            },
            expiresAt: {
              type: 'string',
              format: 'date-time',
              description: '過期時間',
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
        name: 'Products',
        description: '商品管理相關 API',
      },
      {
        name: 'AI Services',
        description: 'AI 服務相關 API（內容生成、翻譯等）',
      },
      {
        name: 'Text-to-Speech',
        description: '語音合成相關 API',
      },
      {
        name: 'File Management',
        description: '檔案上傳與管理相關 API',
      },
      {
        name: 'Search',
        description: '搜尋與篩選相關 API',
      },
      {
        name: 'Notifications',
        description: '推播通知相關 API',
      },
      {
        name: 'Feature Flags',
        description: '功能旗標管理相關 API',
      },
      {
        name: 'Monitoring',
        description: '系統監控相關 API',
      },
      {
        name: 'Cache',
        description: '快取管理相關 API',
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
      .swagger-ui .scheme-container { background: #fafafa; padding: 15px; border-radius: 5px; }
    `,
    customSiteTitle: 'Localite API 文檔',
    customfavIcon: '/favicon.ico',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      showExtensions: true,
      showCommonExtensions: true,
      tryItOutEnabled: true,
      supportedSubmitMethods: ['get', 'post', 'put', 'delete', 'patch'],
    },
  },
};

module.exports = swaggerSetup;
