import { Request, Response, NextFunction } from 'express';
import { auth } from '../config/firebase-config';
import { DecodedIdToken } from 'firebase-admin/auth';
import winston from 'winston';

// 擴展 Request 類型以包含用戶資訊
declare global {
  namespace Express {
    interface Request {
      user?: DecodedIdToken & {
        role?: string;
      };
    }
  }
}

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/auth-middleware.log' })
  ]
});

/**
 * Firebase JWT 認證中間件
 */
export const authenticateToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // 開發環境測試bypass
    if (process.env.NODE_ENV === 'development') {
      const testHeader = req.headers['x-test-user'];
      if (testHeader === 'test-user') {
        req.user = {
          uid: 'test-user-123',
          email: 'test@localite.com',
          role: 'user',
          name: 'Test User',
          aud: 'test',
          auth_time: Date.now(),
          exp: Date.now() + 3600000,
          firebase: {
            identities: {},
            sign_in_provider: 'test'
          },
          iat: Date.now(),
          iss: 'test',
          sub: 'test-user-123'
        };
        logger.info('開發環境測試用戶認證', { uid: req.user.uid });
        return next();
      }
    }

    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: '缺少授權標頭'
      });
    }

    const token = authHeader.split(' ')[1]; // Bearer <token>
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: '缺少授權令牌'
      });
    }

    // 驗證 Firebase JWT
    const decodedToken = await auth.verifyIdToken(token);
    
    // 設置用戶資訊到請求對象
    req.user = {
      ...decodedToken,
      role: decodedToken.role || 'user'
    };

    logger.info('用戶認證成功', {
      uid: req.user.uid,
      email: req.user.email,
      path: req.path,
      method: req.method
    });

    next();

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知錯誤';
    const errorCode = error && typeof error === 'object' && 'code' in error ? (error as any).code : undefined;
    
    logger.error('認證失敗', {
      error: errorMessage,
      path: req.path,
      method: req.method,
      ip: req.ip
    });

    if (errorCode === 'auth/id-token-expired') {
      return res.status(401).json({
        success: false,
        message: '授權令牌已過期',
        code: 'TOKEN_EXPIRED'
      });
    }

    if (errorCode === 'auth/id-token-revoked') {
      return res.status(401).json({
        success: false,
        message: '授權令牌已被撤銷',
        code: 'TOKEN_REVOKED'
      });
    }

    return res.status(401).json({
      success: false,
      message: '無效的授權令牌',
      code: 'INVALID_TOKEN'
    });
  }
};

/**
 * 角色權限檢查中間件
 */
export const requireRole = (requiredRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: '未認證的用戶'
      });
    }

    const userRole = req.user.role || 'user';
    
    if (!requiredRoles.includes(userRole)) {
      logger.warn('權限不足', {
        uid: req.user.uid,
        userRole,
        requiredRoles,
        path: req.path
      });

      return res.status(403).json({
        success: false,
        message: '權限不足',
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    next();
  };
};

/**
 * 可選認證中間件（不強制要求認證）
 */
export const optionalAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader) {
      const token = authHeader.split(' ')[1];
      
      if (token) {
        const decodedToken = await auth.verifyIdToken(token);
        req.user = {
          ...decodedToken,
          role: decodedToken.role || 'user'
        };
      }
    }

    next();
  } catch (error) {
    // 可選認證失敗時不阻止請求，只記錄日誌
    const errorMessage = error instanceof Error ? error.message : '未知錯誤';
    logger.debug('可選認證失敗', {
      error: errorMessage,
      path: req.path
    });
    
    next();
  }
};

/**
 * 檢查用戶是否為商戶
 */
export const requireMerchant = requireRole(['merchant', 'admin']);

/**
 * 檢查用戶是否為管理員
 */
export const requireAdmin = requireRole(['admin']);

export default {
  authenticateToken,
  requireRole,
  optionalAuth,
  requireMerchant,
  requireAdmin
}; 