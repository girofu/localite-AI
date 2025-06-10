import request from 'supertest';
import app from '../index';
import { User } from '../models/User';
import mongoose from 'mongoose';

// 測試用的 Mock Firebase token
const mockFirebaseToken = 'mock-firebase-token';
const mockUser = {
  uid: 'mock-firebase-uid',
  email: 'test@example.com',
  email_verified: true
};

// Mock Firebase Admin
jest.mock('firebase-admin', () => ({
  apps: [],
  initializeApp: jest.fn(),
  auth: () => ({
    verifyIdToken: jest.fn().mockResolvedValue(mockUser)
  }),
  credential: {
    cert: jest.fn()
  }
}));

// Mock 資料庫連線
jest.mock('../config/database', () => ({
  initializeDatabase: jest.fn(),
  connectMongoDB: jest.fn(),
  connectRedis: jest.fn(),
  cache: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn()
  }
}));

describe('認證 API 測試', () => {
  beforeAll(async () => {
    // 連接測試資料庫
    const mongoUri = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/localite-test';
    await mongoose.connect(mongoUri);
  });

  afterAll(async () => {
    // 清理測試資料庫
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  });

  beforeEach(async () => {
    // 清理測試數據
    await User.deleteMany({});
  });

  describe('POST /api/v1/auth/register', () => {
    it('應該成功註冊新用戶', async () => {
      const registerData = {
        email: 'test@example.com',
        displayName: '測試用戶',
        role: 'user'
      };

      const response = await request(app)
        .post('/api/v1/auth/register')
        .set('Authorization', `Bearer ${mockFirebaseToken}`)
        .send(registerData)
        .expect(201);

      expect(response.body.message).toBe('註冊成功');
      expect(response.body.user.email).toBe(registerData.email);
      expect(response.body.user.displayName).toBe(registerData.displayName);
    });

    it('應該拒絕重複註冊', async () => {
      // 先創建一個用戶
      await new User({
        firebaseUid: mockUser.uid,
        email: 'test@example.com',
        displayName: '已存在用戶'
      }).save();

      const registerData = {
        email: 'test@example.com',
        displayName: '測試用戶',
        role: 'user'
      };

      const response = await request(app)
        .post('/api/v1/auth/register')
        .set('Authorization', `Bearer ${mockFirebaseToken}`)
        .send(registerData)
        .expect(409);

      expect(response.body.error).toBe('USER_EXISTS');
    });

    it('應該拒絕無效的請求參數', async () => {
      const invalidData = {
        email: 'invalid-email',
        displayName: '', // 空白名稱
        role: 'invalid-role'
      };

      const response = await request(app)
        .post('/api/v1/auth/register')
        .set('Authorization', `Bearer ${mockFirebaseToken}`)
        .send(invalidData)
        .expect(400);

      expect(response.body.error).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/auth/profile', () => {
    it('應該成功獲取用戶資料', async () => {
      // 先創建一個用戶
      const user = await new User({
        firebaseUid: mockUser.uid,
        email: 'test@example.com',
        displayName: '測試用戶'
      }).save();

      const response = await request(app)
        .get('/api/v1/auth/profile')
        .set('Authorization', `Bearer ${mockFirebaseToken}`)
        .expect(200);

      expect(response.body.user.email).toBe(user.email);
      expect(response.body.user.displayName).toBe(user.displayName);
    });

    it('應該拒絕未認證的請求', async () => {
      const response = await request(app)
        .get('/api/v1/auth/profile')
        .expect(401);

      expect(response.body.error).toBe('UNAUTHORIZED');
    });
  });

  describe('PUT /api/v1/auth/profile', () => {
    it('應該成功更新用戶資料', async () => {
      // 先創建一個用戶
      await new User({
        firebaseUid: mockUser.uid,
        email: 'test@example.com',
        displayName: '原始名稱'
      }).save();

      const updateData = {
        displayName: '更新名稱',
        avatar: 'https://example.com/avatar.jpg'
      };

      const response = await request(app)
        .put('/api/v1/auth/profile')
        .set('Authorization', `Bearer ${mockFirebaseToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.message).toBe('更新成功');
      expect(response.body.user.displayName).toBe(updateData.displayName);
      expect(response.body.user.avatar).toBe(updateData.avatar);
    });
  });

  describe('POST /api/v1/auth/verify-token', () => {
    it('應該成功驗證有效 token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/verify-token')
        .set('Authorization', `Bearer ${mockFirebaseToken}`)
        .expect(200);

      expect(response.body.valid).toBe(true);
      expect(response.body.user.uid).toBe(mockUser.uid);
      expect(response.body.user.email).toBe(mockUser.email);
    });
  });
}); 