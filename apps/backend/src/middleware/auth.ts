import { Request, Response, NextFunction } from 'express';
import { getAuth } from '../config/firebase';
import { DecodedIdToken } from 'firebase-admin/auth';

// 擴展 Request 類型以包含用戶資訊
declare global {
  namespace Express {
    interface Request {
      user?: DecodedIdToken;
      userId?: string;
    }
  }
}

/**
 * Firebase 認證中間件
 * 驗證 Authorization header 中的 Bearer token
 */
export const authenticateFirebaseUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: '缺少或無效的認證標頭'
      });
    }

    const idToken = authHeader.split('Bearer ')[1];
    
    if (!idToken) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: '缺少認證 token'
      });
    }

    // 驗證 Firebase ID token
    const decodedToken = await getAuth().verifyIdToken(idToken);
    req.user = decodedToken;
    req.userId = decodedToken.uid;
    
    next();
  } catch (error) {
    console.error('認證錯誤:', error);
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: '無效的認證 token'
    });
  }
};

/**
 * 角色權限中間件
 */
export const requireRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: '需要認證'
      });
    }

    const userRole = req.user.role || 'user';
    
    if (!roles.includes(userRole)) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: '權限不足'
      });
    }

    next();
  };
};

/**
 * 商戶權限中間件
 */
export const requireMerchant = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: '需要認證'
    });
  }

  const userRole = req.user.role || 'user';
  
  if (!['merchant', 'admin'].includes(userRole)) {
    return res.status(403).json({
      error: 'FORBIDDEN',
      message: '需要商戶權限'
    });
  }

  next();
}; 