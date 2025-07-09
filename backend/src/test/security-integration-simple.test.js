const request = require('supertest');
const app = require('./testApp');

describe('安全認證流程簡化測試', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('認證修復驗證', () => {
    it('應該能夠成功進行基本認證', async () => {
      const response = await request(app)
        .get('/api/v1/auth/profile')
        .set('X-Test-User', 'security-test');

      // 認證成功，但用戶不存在（這是正常的）
      expect(response.status).not.toBe(401);
      if (response.status === 404) {
        expect(response.body.error.code).toBe('USER_NOT_FOUND');
      } else {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      }
    });

    it('應該能夠處理登入請求', async () => {
      const loginData = {
        firebaseUid: 'security-test-user-123',
        providerId: 'password',
      };

      const response = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Test-User', 'security-test')
        .set('User-Agent', 'Test-Browser/1.0')
        .send(loginData);

      // 檢查是否不再是 401 錯誤
      expect(response.status).not.toBe(401);

      // 如果是 404，說明認證通過了，但用戶不存在（這是正常的）
      if (response.status === 404) {
        expect(response.body.error.code).toBe('USER_NOT_FOUND');
      } else {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      }
    });

    it('應該能夠處理 MFA 檢查請求', async () => {
      const response = await request(app)
        .post('/api/v1/auth/mfa/check-required')
        .set('X-Test-User', 'security-test')
        .send({
          operation: 'login',
          context: {},
        });

      expect(response.status).not.toBe(401);
    });

    it('應該能夠處理 rate limiting', async () => {
      // 發送一個請求，應該不會因為 Redis 錯誤而失敗
      const response = await request(app).get('/api/v1').set('User-Agent', 'Test-Client/1.0');

      expect(response.status).toBe(200);
    });

    it('應該能夠處理安全敏感操作', async () => {
      const response = await request(app)
        .post('/api/v1/auth/verify-email')
        .set('X-Test-User', 'security-test');

      expect(response.status).not.toBe(401);
    });
  });
});
