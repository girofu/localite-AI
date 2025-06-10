import { Request, Response } from 'express';
import { User } from '../models/User';
import { cache } from '../config/database';

export const authController = {
  /**
   * 用戶註冊
   */
  async register(req: Request, res: Response) {
    try {
      const { email, displayName, role = 'user' } = req.body;
      const firebaseUid = req.userId!;

      // 檢查用戶是否已存在
      const existingUser = await User.findOne({
        $or: [
          { firebaseUid },
          { email }
        ]
      });

      if (existingUser) {
        return res.status(409).json({
          error: 'USER_EXISTS',
          message: '用戶已存在'
        });
      }

      // 創建新用戶
      const newUser = new User({
        firebaseUid,
        email,
        displayName,
        role
      });

      await newUser.save();

      // 清除相關快取
      await cache.del(`user:${firebaseUid}`);

      res.status(201).json({
        message: '註冊成功',
        user: newUser.toJSON()
      });

    } catch (error) {
      console.error('註冊錯誤:', error);
      res.status(500).json({
        error: 'REGISTRATION_FAILED',
        message: '註冊失敗'
      });
    }
  },

  /**
   * 獲取用戶資料
   */
  async getProfile(req: Request, res: Response) {
    try {
      const firebaseUid = req.userId!;

      // 先從快取獲取
      const cachedUser = await cache.get(`user:${firebaseUid}`);
      if (cachedUser) {
        return res.json({
          user: JSON.parse(cachedUser)
        });
      }

      // 從資料庫獲取
      const user = await User.findByFirebaseUid(firebaseUid);
      
      if (!user) {
        return res.status(404).json({
          error: 'USER_NOT_FOUND',
          message: '用戶不存在'
        });
      }

      // 更新最後登入時間
      await user.updateLastLogin();

      // 快取用戶資料 (30分鐘)
      await cache.set(`user:${firebaseUid}`, JSON.stringify(user.toJSON()), 1800);

      res.json({
        user: user.toJSON()
      });

    } catch (error) {
      console.error('獲取用戶資料錯誤:', error);
      res.status(500).json({
        error: 'FETCH_PROFILE_FAILED',
        message: '獲取用戶資料失敗'
      });
    }
  },

  /**
   * 更新用戶資料
   */
  async updateProfile(req: Request, res: Response) {
    try {
      const firebaseUid = req.userId!;
      const updateData = req.body;

      const user = await User.findByFirebaseUid(firebaseUid);
      
      if (!user) {
        return res.status(404).json({
          error: 'USER_NOT_FOUND',
          message: '用戶不存在'
        });
      }

      // 更新用戶資料
      Object.keys(updateData).forEach(key => {
        if (key === 'preferences' && updateData[key]) {
          user.preferences = { ...user.preferences, ...updateData[key] };
        } else if (key === 'profile' && updateData[key]) {
          user.profile = { ...user.profile, ...updateData[key] };
        } else if (key === 'displayName' && updateData[key]) {
          user.displayName = updateData[key];
        } else if (key === 'avatar' && updateData[key]) {
          user.avatar = updateData[key];
        }
      });

      await user.save();

      // 清除快取
      await cache.del(`user:${firebaseUid}`);

      res.json({
        message: '更新成功',
        user: user.toJSON()
      });

    } catch (error) {
      console.error('更新用戶資料錯誤:', error);
      res.status(500).json({
        error: 'UPDATE_PROFILE_FAILED',
        message: '更新用戶資料失敗'
      });
    }
  },

  /**
   * 驗證 Token
   */
  async verifyToken(req: Request, res: Response) {
    try {
      const firebaseUid = req.userId!;
      const user = req.user!;

      res.json({
        valid: true,
        user: {
          uid: firebaseUid,
          email: user.email,
          role: user.role || 'user'
        }
      });

    } catch (error) {
      console.error('Token 驗證錯誤:', error);
      res.status(500).json({
        error: 'TOKEN_VERIFICATION_FAILED',
        message: 'Token 驗證失敗'
      });
    }
  }
}; 