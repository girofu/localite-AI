const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../test/testApp');
const User = require('../models/User');
const jwtService = require('../services/jwtService');
const { redisConnection } = require('../config/redis');

// 模擬 Redis 連接
jest.mock('../config/redis', () => ({
  redisConnection: {
    exists: jest.fn(),
    set: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
    getClient: jest.fn().mockReturnValue({
      keys: jest.fn(),
    }),
  },
}));

describe('JWT Token Management Routes', () => {
  let testUser;
  let authHeaders;

  beforeAll(async () => {
    // 確保資料庫連接
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/localite_test');
    }

    // 清理可能存在的測試數據
    await User.deleteMany({ email: /test@localite/ });

    // 創建測試用戶 - 確保所有必要欄位都有值
    testUser = new User({
      firebaseUid: 'test-user-123', // 使用與認證中間件匹配的 UID
      email: 'test@localite.com',
      role: 'user',
      status: 'active',
      profile: {
        firstName: 'JWT',
        lastName: 'Test',
        displayName: 'JWT Test User',
      },
      emailVerified: true,
      providers: [
        {
          providerId: 'password',
          providerUid: 'jwt-test-user-123',
          connectedAt: new Date(),
        },
      ],
      preferences: {
        language: 'zh-TW',
        notifications: {
          email: true,
          push: true,
          marketing: false,
        },
        tourPreferences: {
          voiceEnabled: true,
          autoPlay: false,
          playbackSpeed: 1.0,
        },
        privacy: {
          shareProfile: false,
          shareLocation: true,
          dataCollection: true,
        },
      },
      stats: {
        loginCount: 0,
        toursCompleted: 0,
        totalTimeSpent: 0,
      },
    });
    await testUser.save();

    // 設置認證標頭（使用測試用戶）
    authHeaders = {
      'x-test-user': 'test-user',
      authorization: 'Bearer test-jwt-token-123',
    };
  }, 30000); // 增加超時時間到 30 秒

  afterAll(async () => {
    // 清理測試數據
    try {
      await User.deleteMany({ email: /test@localite/ });
    } catch (error) {
      console.warn('清理測試數據時出錯:', error.message);
    }
  }, 15000); // 增加清理超時時間

  beforeEach(() => {
    jest.clearAllMocks();
    // 預設 Redis 操作成功
    redisConnection.exists.mockResolvedValue(false);
    redisConnection.set.mockResolvedValue(true);
    redisConnection.get.mockResolvedValue(null);
    redisConnection.delete.mockResolvedValue(true);
    redisConnection.getClient().keys.mockResolvedValue([]);
  });

  describe('POST /api/v1/auth/generate-tokens', () => {
    it('應該成功生成 JWT token 對', async () => {
      const response = await request(app)
        .post('/api/v1/auth/generate-tokens')
        .set(authHeaders)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Token 生成成功',
        data: {
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
          tokenType: 'Bearer',
          expiresIn: expect.any(Number),
          sessionId: expect.any(String),
        },
      });

      // 驗證 token 格式正確
      expect(response.body.data.accessToken).toMatch(
        /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/,
      );
      expect(response.body.data.refreshToken).toMatch(
        /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/,
      );
    });

    it('應該在沒有認證時返回 401', async () => {
      const response = await request(app).post('/api/v1/auth/generate-tokens').expect(401);

      expect(response.body).toMatchObject({
        success: false,
        error: {
          message: '缺少認證 token',
          code: 'MISSING_TOKEN',
        },
      });
    });
  });

  describe('POST /api/v1/auth/refresh-token', () => {
    let validRefreshToken;

    beforeEach(() => {
      // 模擬有效的 refresh token
      validRefreshToken = 'valid.refresh.token';

      // 模擬 JWT 服務的 refreshAccessToken 方法
      jest.spyOn(jwtService, 'refreshAccessToken').mockResolvedValue({
        accessToken: 'new.access.token',
        tokenType: 'Bearer',
        expiresIn: 900,
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('應該成功刷新 access token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh-token')
        .send({ refreshToken: validRefreshToken })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Token 刷新成功',
        data: {
          accessToken: 'new.access.token',
          tokenType: 'Bearer',
          expiresIn: 900,
        },
      });

      expect(jwtService.refreshAccessToken).toHaveBeenCalledWith(
        validRefreshToken,
        expect.objectContaining({
          ipAddress: expect.any(String),
          deviceFingerprint: expect.any(String),
          loginMethod: 'token_refresh',
          timestamp: expect.any(String),
        }),
      );
    });

    it('應該在缺少 refresh token 時返回 400', async () => {
      const response = await request(app).post('/api/v1/auth/refresh-token').send({}).expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: {
          message: '缺少 refresh token',
          code: 'MISSING_REFRESH_TOKEN',
        },
      });
    });
  });

  describe('POST /api/v1/auth/revoke-token', () => {
    beforeEach(() => {
      jest.spyOn(jwtService, 'revokeToken').mockResolvedValue();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('應該成功撤銷當前 token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/revoke-token')
        .set(authHeaders)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Token 撤銷成功',
      });

      expect(jwtService.revokeToken).toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/auth/session-info', () => {
    beforeEach(() => {
      jest.spyOn(jwtService, 'getUserSessions').mockResolvedValue([
        {
          sessionId: 'session-123',
          createdAt: new Date('2024-01-01T00:00:00Z'),
          lastActivity: new Date('2024-01-01T01:00:00Z'),
        },
      ]);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('應該成功獲取用戶的 session 資訊', async () => {
      const response = await request(app)
        .get('/api/v1/auth/session-info')
        .set(authHeaders)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Session 資訊獲取成功',
        data: {
          sessions: [
            {
              sessionId: 'session-123',
              createdAt: '2024-01-01T00:00:00.000Z',
              lastActivity: '2024-01-01T01:00:00.000Z',
            },
          ],
        },
      });

      expect(jwtService.getUserSessions).toHaveBeenCalledWith('test-user-123');
    });
  });

  // 新增 Session 撤銷相關整合測試
  describe('POST /api/v1/auth/revoke-session', () => {
    const targetSessionId = 'session-456';

    beforeEach(() => {
      jest.spyOn(jwtService, 'getSession').mockResolvedValue({
        sessionId: targetSessionId,
        uid: 'test-user-123',
        createdAt: new Date('2024-01-01T02:00:00Z'),
        lastActivity: new Date('2024-01-01T03:00:00Z'),
      });
      jest.spyOn(jwtService, 'revokeSession').mockResolvedValue();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('應該成功撤銷指定的 session', async () => {
      const response = await request(app)
        .post('/api/v1/auth/revoke-session')
        .set(authHeaders)
        .send({ sessionId: targetSessionId })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Session 撤銷成功',
        data: {
          revokedSessionId: targetSessionId,
        },
      });

      expect(jwtService.getSession).toHaveBeenCalledWith(targetSessionId);
      expect(jwtService.revokeSession).toHaveBeenCalledWith(targetSessionId);
    });

    it('應該在缺少 sessionId 時返回 400', async () => {
      const response = await request(app)
        .post('/api/v1/auth/revoke-session')
        .set(authHeaders)
        .send({})
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: {
          message: '缺少 sessionId 參數',
          code: 'MISSING_SESSION_ID',
        },
      });
    });
  });

  describe('POST /api/v1/auth/revoke-all-other-sessions', () => {
    beforeEach(() => {
      jest.spyOn(jwtService, 'revokeAllUserTokens').mockResolvedValue(3);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('應該成功撤銷所有 Session', async () => {
      const response = await request(app)
        .post('/api/v1/auth/revoke-all-other-sessions')
        .set(authHeaders)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: '所有 Session 撤銷成功',
        data: {
          revokedCount: 3,
        },
      });

      expect(jwtService.revokeAllUserTokens).toHaveBeenCalledWith('test-user-123');
    });
  });
});
