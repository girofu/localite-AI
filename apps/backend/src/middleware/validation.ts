import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';

/**
 * 請求驗證中間件
 */
export const validateRequest = (schema: {
  body?: Joi.ObjectSchema;
  query?: Joi.ObjectSchema;
  params?: Joi.ObjectSchema;
}) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors: any = {};

    // 驗證請求體
    if (schema.body) {
      const { error } = schema.body.validate(req.body);
      if (error) {
        errors.body = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message
        }));
      }
    }

    // 驗證查詢參數
    if (schema.query) {
      const { error } = schema.query.validate(req.query);
      if (error) {
        errors.query = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message
        }));
      }
    }

    // 驗證路徑參數
    if (schema.params) {
      const { error } = schema.params.validate(req.params);
      if (error) {
        errors.params = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message
        }));
      }
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: '請求參數驗證失敗',
        details: errors
      });
    }

    next();
  };
};

// 常用驗證規則
export const schemas = {
  // 用戶相關
  user: {
    register: Joi.object({
      email: Joi.string().email().required(),
      displayName: Joi.string().min(1).max(50).required(),
      role: Joi.string().valid('user', 'merchant', 'admin').default('user')
    }),
    update: Joi.object({
      displayName: Joi.string().min(1).max(50),
      avatar: Joi.string().uri(),
      preferences: Joi.object()
    })
  },

  // 導覽相關
  tour: {
    create: Joi.object({
      title: Joi.string().min(1).max(100).required(),
      description: Joi.string().max(500),
      category: Joi.string().required(),
      location: Joi.object({
        address: Joi.string().required(),
        coordinates: Joi.object({
          lat: Joi.number().min(-90).max(90).required(),
          lng: Joi.number().min(-180).max(180).required()
        }).required()
      }).required(),
      price: Joi.number().min(0),
      duration: Joi.number().min(1), // 分鐘
      maxParticipants: Joi.number().min(1),
      languages: Joi.array().items(Joi.string()).min(1).required()
    }),
    update: Joi.object({
      title: Joi.string().min(1).max(100),
      description: Joi.string().max(500),
      category: Joi.string(),
      location: Joi.object({
        address: Joi.string(),
        coordinates: Joi.object({
          lat: Joi.number().min(-90).max(90),
          lng: Joi.number().min(-180).max(180)
        })
      }),
      price: Joi.number().min(0),
      duration: Joi.number().min(1),
      maxParticipants: Joi.number().min(1),
      languages: Joi.array().items(Joi.string()).min(1),
      isActive: Joi.boolean()
    })
  },

  // 查詢參數
  query: {
    pagination: Joi.object({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(100).default(20),
      sort: Joi.string(),
      order: Joi.string().valid('asc', 'desc').default('desc')
    }),
    search: Joi.object({
      q: Joi.string().min(1),
      category: Joi.string(),
      location: Joi.string(),
      language: Joi.string(),
      minPrice: Joi.number().min(0),
      maxPrice: Joi.number().min(0)
    })
  },

  // 路徑參數
  params: {
    id: Joi.object({
      id: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required()
    }),
    userId: Joi.object({
      userId: Joi.string().required()
    })
  }
}; 