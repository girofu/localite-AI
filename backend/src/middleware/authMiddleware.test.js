// Mock Firebase config first - before requiring the module
const mockVerifyIdToken = jest.fn();
const mockGetAuth = jest.fn(() => ({
  verifyIdToken: mockVerifyIdToken,
}));

jest.mock('../config/firebase', () => ({
  getAuth: mockGetAuth,
}));

// Mock logger
jest.mock('./requestLogger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const { authenticate, requireRole, optionalAuth, AuthMiddleware } = require('./authMiddleware');

describe('AuthMiddleware', () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    req = {
      headers: {},
      path: '/test',
      method: 'GET',
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();

    // 重置環境變數
    process.env.NODE_ENV = 'test';

    // 清理所有 mocks
    jest.clearAllMocks();
  });

  describe('authenticate 中間件', () => {
    test('應該在有效 token 時成功認證用戶', async () => {
      const mockToken = 'valid-firebase-token';
      const mockDecodedToken = {
        uid: 'user123',
        email: 'test@example.com',
        email_verified: true,
        name: 'Test User',
        role: 'user',
      };

      req.headers.authorization = `Bearer ${mockToken}`;
      mockVerifyIdToken.mockResolvedValue(mockDecodedToken);

      await authenticate(req, res, next);

      expect(mockVerifyIdToken).toHaveBeenCalledWith(mockToken);
      expect(req.user).toEqual({
        uid: 'user123',
        email: 'test@example.com',
        email_verified: true,
        name: 'Test User',
        picture: undefined,
        role: 'user',
        tokenType: 'firebase',
        firebase: {
          identities: undefined,
          sign_in_provider: undefined,
        },
      });
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('應該在沒有 Authorization header 時返回 401', async () => {
      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          message: '缺少認證 token',
          code: 'MISSING_TOKEN',
        },
      });
      expect(next).not.toHaveBeenCalled();
    });

    test('應該在無效 token 格式時返回 401', async () => {
      req.headers.authorization = 'InvalidFormat token';

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          message: '缺少認證 token',
          code: 'MISSING_TOKEN',
        },
      });
      expect(next).not.toHaveBeenCalled();
    });

    test('應該在 token 過期時返回 401', async () => {
      const mockToken = 'expired-token';
      const mockError = new Error('Token expired');
      mockError.code = 'auth/id-token-expired';

      req.headers.authorization = `Bearer ${mockToken}`;
      mockVerifyIdToken.mockRejectedValue(mockError);

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          message: '所有認證方式都失敗',
          code: 'AUTHENTICATION_FAILED',
        },
      });
      expect(next).not.toHaveBeenCalled();
    });

    test('應該在 token 被撤銷時返回 401', async () => {
      const mockToken = 'revoked-token';
      const mockError = new Error('Token revoked');
      mockError.code = 'auth/id-token-revoked';

      req.headers.authorization = `Bearer ${mockToken}`;
      mockVerifyIdToken.mockRejectedValue(mockError);

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          message: '所有認證方式都失敗',
          code: 'AUTHENTICATION_FAILED',
        },
      });
      expect(next).not.toHaveBeenCalled();
    });

    test('應該在開發環境支援測試用戶', async () => {
      process.env.NODE_ENV = 'development';
      req.headers['x-test-user'] = 'test-user';

      await authenticate(req, res, next);

      expect(req.user).toEqual({
        uid: 'test-user-123',
        email: 'test@localite.com',
        email_verified: true,
        role: 'user',
        name: 'Test User',
      });
      expect(next).toHaveBeenCalled();
      expect(mockVerifyIdToken).not.toHaveBeenCalled();
    });

    test('應該在生產環境忽略測試用戶標頭', async () => {
      process.env.NODE_ENV = 'production';
      req.headers['x-test-user'] = 'test-user';

      await authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          message: '缺少認證 token',
          code: 'MISSING_TOKEN',
        },
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('requireRole 中間件', () => {
    test('應該允許有正確角色的用戶通過', () => {
      req.user = { uid: 'user123', role: 'admin' };
      const middleware = requireRole('admin');

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('應該允許有多個角色中任一角色的用戶通過', () => {
      req.user = { uid: 'user123', role: 'merchant' };
      const middleware = requireRole(['admin', 'merchant']);

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('應該拒絕沒有正確角色的用戶', () => {
      req.user = { uid: 'user123', role: 'user' };
      const middleware = requireRole('admin');

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          message: '權限不足',
          code: 'INSUFFICIENT_PERMISSIONS',
          required: ['admin'],
          current: 'user',
        },
      });
      expect(next).not.toHaveBeenCalled();
    });

    test('應該拒絕未認證的用戶', () => {
      const middleware = requireRole('admin');

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          message: '未認證的用戶',
          code: 'UNAUTHENTICATED',
        },
      });
      expect(next).not.toHaveBeenCalled();
    });

    test('應該為沒有角色的用戶分配預設角色', () => {
      req.user = { uid: 'user123' }; // 沒有 role 屬性
      const middleware = requireRole('user');

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('optionalAuth 中間件', () => {
    test('應該在有有效 token 時設置用戶資訊', async () => {
      const mockToken = 'valid-firebase-token';
      const mockDecodedToken = {
        uid: 'user123',
        email: 'test@example.com',
        email_verified: true,
        name: 'Test User',
        role: 'user',
      };

      req.headers.authorization = `Bearer ${mockToken}`;
      mockVerifyIdToken.mockResolvedValue(mockDecodedToken);

      await optionalAuth(req, res, next);

      expect(req.user).toBeDefined();
      expect(req.user.uid).toBe('user123');
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('應該在沒有 token 時繼續執行', async () => {
      await optionalAuth(req, res, next);

      expect(req.user).toBeUndefined();
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('應該在 token 無效時繼續執行（不設置用戶）', async () => {
      const mockToken = 'invalid-token';
      req.headers.authorization = `Bearer ${mockToken}`;
      mockVerifyIdToken.mockRejectedValue(new Error('Invalid token'));

      await optionalAuth(req, res, next);

      expect(req.user).toBeUndefined();
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('應該在開發環境支援測試用戶', async () => {
      process.env.NODE_ENV = 'development';
      req.headers['x-test-user'] = 'test-merchant';

      await optionalAuth(req, res, next);

      expect(req.user).toEqual({
        uid: 'test-merchant-123',
        email: 'merchant@localite.com',
        email_verified: true,
        role: 'merchant',
        name: 'Test Merchant',
      });
      expect(next).toHaveBeenCalled();
    });
  });

  describe('AuthMiddleware 類別', () => {
    let authMiddleware;

    beforeEach(() => {
      authMiddleware = new AuthMiddleware();
    });

    test('extractToken 應該正確提取 Bearer token', () => {
      const testCases = [
        { input: 'Bearer token123', expected: 'token123' },
        { input: 'bearer token123', expected: null },
        { input: 'Token token123', expected: null },
        { input: 'Bearer', expected: null },
        { input: '', expected: null },
        { input: undefined, expected: null },
      ];

      testCases.forEach(({ input, expected }) => {
        const testReq = { headers: { authorization: input } };
        const result = authMiddleware.extractToken(testReq);
        expect(result).toBe(expected);
      });
    });

    test('handleTestUser 應該在開發環境返回測試用戶', () => {
      process.env.NODE_ENV = 'development';
      const testReq = { headers: { 'x-test-user': 'test-admin' } };

      const result = authMiddleware.handleTestUser(testReq);

      expect(result).toEqual({
        uid: 'test-admin-123',
        email: 'admin@localite.com',
        email_verified: true,
        role: 'admin',
        name: 'Test Admin',
      });
    });

    test('handleTestUser 應該在生產環境返回 null', () => {
      process.env.NODE_ENV = 'production';
      const testReq = { headers: { 'x-test-user': 'test-user' } };

      const result = authMiddleware.handleTestUser(testReq);

      expect(result).toBe(null);
    });

    test('handleTestUser 應該在無效測試用戶時返回 null', () => {
      process.env.NODE_ENV = 'development';
      const testReq = { headers: { 'x-test-user': 'invalid-user' } };

      const result = authMiddleware.handleTestUser(testReq);

      expect(result).toBe(null);
    });
  });
});
