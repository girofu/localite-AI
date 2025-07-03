const jwt = require('jsonwebtoken');
const jwtService = require('./jwtService');
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

describe('JWT Service', () => {
  const mockUser = {
    firebaseUid: 'test-firebase-uid',
    email: 'test@example.com',
    role: 'user',
    permissions: ['read'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // 預設 Redis 操作成功
    redisConnection.exists.mockResolvedValue(false);
    redisConnection.set.mockResolvedValue(true);
    redisConnection.get.mockResolvedValue(null);
    redisConnection.delete.mockResolvedValue(true);
  });

  afterAll(() => {
    // 清理定時器
    if (jwtService.sessionCleanupTimer) {
      clearInterval(jwtService.sessionCleanupTimer);
    }
  });

  describe('Token Generation', () => {
    it('should generate access token with correct payload', () => {
      const token = jwtService.generateAccessToken({
        uid: mockUser.firebaseUid,
        email: mockUser.email,
        role: mockUser.role,
      });

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');

      const decoded = jwt.decode(token);
      expect(decoded.uid).toBe(mockUser.firebaseUid);
      expect(decoded.email).toBe(mockUser.email);
      expect(decoded.role).toBe(mockUser.role);
      expect(decoded.type).toBe('access');
      expect(decoded.jti).toBeDefined();
    });

    it('should generate refresh token with correct payload', () => {
      const token = jwtService.generateRefreshToken({
        uid: mockUser.firebaseUid,
        email: mockUser.email,
      });

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');

      const decoded = jwt.decode(token);
      expect(decoded.uid).toBe(mockUser.firebaseUid);
      expect(decoded.email).toBe(mockUser.email);
      expect(decoded.type).toBe('refresh');
      expect(decoded.jti).toBeDefined();
    });

    it('should generate token pair successfully', async () => {
      const tokenPair = await jwtService.generateTokenPair(mockUser);

      expect(tokenPair).toHaveProperty('accessToken');
      expect(tokenPair).toHaveProperty('refreshToken');
      expect(tokenPair).toHaveProperty('tokenType', 'Bearer');
      expect(tokenPair).toHaveProperty('expiresIn');
      expect(tokenPair).toHaveProperty('sessionId');

      // 檢查 Redis 呼叫（refresh token + session + user sessions list）
      expect(redisConnection.set).toHaveBeenCalledTimes(3);
    });
  });

  describe('Token Verification', () => {
    let validAccessToken;
    let validRefreshToken;
    let sessionId;

    beforeEach(async () => {
      const tokenPair = await jwtService.generateTokenPair(mockUser);
      validAccessToken = tokenPair.accessToken;
      validRefreshToken = tokenPair.refreshToken;
      sessionId = tokenPair.sessionId;
    });

    it('should verify valid access token', async () => {
      const verified = await jwtService.verifyAccessToken(validAccessToken);

      expect(verified).toBeDefined();
      expect(verified.uid).toBe(mockUser.firebaseUid);
      expect(verified.email).toBe(mockUser.email);
      expect(verified.type).toBe('access');
    });

    it('should reject blacklisted token', async () => {
      // 模擬 token 在黑名單中
      redisConnection.exists.mockResolvedValue(true);

      await expect(jwtService.verifyAccessToken(validAccessToken)).rejects.toThrow(
        'Token 已被撤銷'
      );
    });

    it('should reject invalid token format', async () => {
      await expect(jwtService.verifyAccessToken('invalid-token')).rejects.toThrow(
        '無效的 token 格式'
      );
    });

    it('should verify valid refresh token', async () => {
      // 模擬 Redis 中存在 refresh token
      const refreshTokenData = {
        uid: mockUser.firebaseUid,
        email: mockUser.email,
        sessionId,
        createdAt: new Date().toISOString(),
      };
      redisConnection.get.mockResolvedValue(refreshTokenData);

      const verified = await jwtService.verifyRefreshToken(validRefreshToken);

      expect(verified).toBeDefined();
      expect(verified.uid).toBe(mockUser.firebaseUid);
      expect(verified.type).toBe('refresh');
    });

    it('should reject refresh token not in Redis', async () => {
      // 模擬 Redis 中不存在 refresh token
      redisConnection.get.mockResolvedValue(null);

      await expect(jwtService.verifyRefreshToken(validRefreshToken)).rejects.toThrow(
        'Refresh token 不存在或已過期'
      );
    });
  });

  describe('Token Refresh', () => {
    let validRefreshToken;
    let sessionId;

    beforeEach(async () => {
      const tokenPair = await jwtService.generateTokenPair(mockUser);
      validRefreshToken = tokenPair.refreshToken;
      sessionId = tokenPair.sessionId;
    });

    it('should refresh access token successfully', async () => {
      // 模擬 Redis 中存在 refresh token
      const refreshTokenData = {
        uid: mockUser.firebaseUid,
        email: mockUser.email,
        role: mockUser.role,
        sessionId,
        createdAt: new Date().toISOString(),
      };
      redisConnection.get
        .mockResolvedValueOnce(refreshTokenData) // verifyRefreshToken 調用
        .mockResolvedValueOnce(refreshTokenData) // refreshAccessToken 調用
        .mockResolvedValueOnce({
          // getSession 調用
          uid: mockUser.firebaseUid,
          email: mockUser.email,
          role: mockUser.role,
          sessionId,
        });

      const result = await jwtService.refreshAccessToken(validRefreshToken);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('tokenType', 'Bearer');
      expect(result).toHaveProperty('expiresIn');

      // 檢查 Redis 更新調用
      expect(redisConnection.set).toHaveBeenCalled();
    });

    it('should fail when refresh token is invalid', async () => {
      // 模擬 Redis 中不存在 refresh token
      redisConnection.get.mockResolvedValue(null);

      await expect(jwtService.refreshAccessToken(validRefreshToken)).rejects.toThrow(
        'Refresh token 不存在或已過期'
      );
    });
  });

  describe('Token Revocation', () => {
    let validAccessToken;
    let validRefreshToken;

    beforeEach(async () => {
      const tokenPair = await jwtService.generateTokenPair(mockUser);
      validAccessToken = tokenPair.accessToken;
      validRefreshToken = tokenPair.refreshToken;
    });

    it('should revoke access token successfully', async () => {
      const result = await jwtService.revokeToken(validAccessToken);

      expect(result).toBe(true);
      expect(redisConnection.set).toHaveBeenCalled(); // 加入黑名單
    });

    it('should revoke refresh token successfully', async () => {
      // 模擬 session 存在
      redisConnection.get.mockResolvedValue({
        uid: mockUser.firebaseUid,
        accessTokenId: 'access-token-id',
        refreshTokenId: 'refresh-token-id',
      });

      const result = await jwtService.revokeToken(validRefreshToken);

      expect(result).toBe(true);
      expect(redisConnection.delete).toHaveBeenCalled(); // 刪除 refresh token
    });

    it('should revoke all user tokens', async () => {
      // 模擬用戶有多個活躍 session
      const userSessions = ['session1', 'session2'];

      // 模擬完整的撤銷流程
      redisConnection.get
        .mockResolvedValueOnce(userSessions) // getUserSessionList 調用
        .mockResolvedValueOnce({
          sessionId: 'session1',
          uid: mockUser.firebaseUid,
          accessTokenId: 'token1',
          refreshTokenId: 'refresh1',
          isActive: true,
        }) // 第一個 session 的詳細信息
        .mockResolvedValueOnce({
          sessionId: 'session2',
          uid: mockUser.firebaseUid,
          accessTokenId: 'token2',
          refreshTokenId: 'refresh2',
          isActive: true,
        }) // 第二個 session 的詳細信息
        .mockResolvedValueOnce({
          sessionId: 'session1',
          uid: mockUser.firebaseUid,
          accessTokenId: 'token1',
          refreshTokenId: 'refresh1',
          isActive: true,
        }) // revokeSession 第一次調用
        .mockResolvedValueOnce(userSessions) // removeFromUserSessions 第一次調用
        .mockResolvedValueOnce({
          sessionId: 'session2',
          uid: mockUser.firebaseUid,
          accessTokenId: 'token2',
          refreshTokenId: 'refresh2',
          isActive: true,
        }) // revokeSession 第二次調用
        .mockResolvedValueOnce(['session2']); // removeFromUserSessions 第二次調用

      const result = await jwtService.revokeAllUserTokens(mockUser.firebaseUid);

      expect(result).toBe(2);
    });
  });

  describe('Session Management', () => {
    const sessionId = 'test-session-id';
    const sessionData = {
      uid: mockUser.firebaseUid,
      email: mockUser.email,
      role: mockUser.role,
      createdAt: new Date().toISOString(),
    };

    it('should create session successfully', async () => {
      // 模擬 enforceConcurrentSessionLimit 調用
      redisConnection.get
        .mockResolvedValueOnce([]) // getUserSessionList for enforceConcurrentSessionLimit
        .mockResolvedValueOnce([]); // getUserSessionList for addToUserSessions

      await jwtService.createSession(sessionId, sessionData);

      // 檢查基本的 session 設置
      expect(redisConnection.set).toHaveBeenCalledWith(
        `session:${sessionId}`,
        expect.objectContaining({
          uid: sessionData.uid,
          email: sessionData.email,
          role: sessionData.role,
          isActive: true,
          securityFlags: expect.any(Object),
        }),
        { ttl: expect.any(Number) }
      );
    });

    it('should get session successfully', async () => {
      redisConnection.get.mockResolvedValue(sessionData);

      const result = await jwtService.getSession(sessionId);

      expect(result).toEqual(sessionData);
      expect(redisConnection.get).toHaveBeenCalledWith(`session:${sessionId}`);
    });

    it('should update session successfully', async () => {
      redisConnection.get.mockResolvedValue(sessionData);

      const updates = { lastActivity: new Date().toISOString() };
      await jwtService.updateSession(sessionId, updates);

      expect(redisConnection.set).toHaveBeenCalledWith(
        `session:${sessionId}`,
        { ...sessionData, ...updates },
        { ttl: expect.any(Number) }
      );
    });

    it('should revoke session successfully', async () => {
      const session = {
        ...sessionData,
        accessTokenId: 'access-token-id',
        refreshTokenId: 'refresh-token-id',
      };
      redisConnection.get.mockResolvedValue(session);

      await jwtService.revokeSession(sessionId);

      // 檢查撤銷操作（標記撤銷、加入黑名單）
      expect(redisConnection.set).toHaveBeenCalled();
      // 新的撤銷邏輯不立即刪除，而是標記為撤銷狀態
      expect(redisConnection.delete).toHaveBeenCalledTimes(1); // 刪除 refresh token
    });
  });

  describe('Utility Methods', () => {
    it('should parse expiry string correctly', () => {
      // eslint-disable-next-line global-require
      const JWTService = require('./jwtService').constructor;
      expect(JWTService.parseExpiry('15m')).toBe(900);
      expect(JWTService.parseExpiry('2h')).toBe(7200);
      expect(JWTService.parseExpiry('7d')).toBe(604800);
      expect(JWTService.parseExpiry('30s')).toBe(30);
      expect(JWTService.parseExpiry(3600)).toBe(3600);
      expect(JWTService.parseExpiry('invalid')).toBe(900); // 預設值
    });

    it('should generate secure token', () => {
      // eslint-disable-next-line global-require
      const JWTService = require('./jwtService').constructor;
      const token = JWTService.generateSecureToken(16);
      expect(token).toHaveLength(32); // hex 編碼長度是原始長度的 2 倍
      expect(typeof token).toBe('string');
    });
  });

  describe('Error Handling', () => {
    it('should handle Redis connection errors gracefully', async () => {
      redisConnection.exists.mockRejectedValue(new Error('Redis connection failed'));

      // 應該不阻止 token 驗證流程
      const token = jwtService.generateAccessToken({
        uid: mockUser.firebaseUid,
        email: mockUser.email,
      });

      const verified = await jwtService.verifyAccessToken(token);
      expect(verified).toBeDefined();
    });

    it('should handle malformed tokens', async () => {
      await expect(jwtService.verifyAccessToken('malformed.token')).rejects.toThrow(
        '無效的 token 格式'
      );
    });

    it('should handle expired tokens', done => {
      // 測試過期 token - 使用實際過期的 token
      const payload = { uid: mockUser.firebaseUid, email: mockUser.email };
      const expiredToken = jwt.sign(
        { ...payload, type: 'access', jti: 'test-jti' },
        process.env.JWT_SECRET || 'localite-jwt-secret-key',
        { expiresIn: '1ms', issuer: 'localite', audience: 'localite-users' }
      );

      // 等待 token 過期
      setTimeout(async () => {
        try {
          await expect(jwtService.verifyAccessToken(expiredToken)).rejects.toThrow('Token 已過期');
          done();
        } catch (error) {
          done(error);
        }
      }, 10);
    });
  });
});
