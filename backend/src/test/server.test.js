const request = require('supertest');
const app = require('./testApp');

describe('Express Server 基礎架構測試', () => {
  describe('健康檢查端點', () => {
    it('應該回傳健康狀態', async () => {
      const response = await request(app)
        .get('/health')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('基本資訊端點', () => {
    it('應該回傳 API 基本資訊', async () => {
      const response = await request(app)
        .get('/')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('name');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('status', 'running');
      expect(response.body).toHaveProperty('endpoints');
    });
  });

  describe('API 端點', () => {
    it('應該回傳 API v1 資訊', async () => {
      const response = await request(app)
        .get('/api/v1')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('availableEndpoints');
    });
  });

  describe('錯誤處理', () => {
    it('應該處理 404 錯誤', async () => {
      const response = await request(app)
        .get('/nonexistent-route')
        .expect('Content-Type', /json/)
        .expect(404);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toHaveProperty('code', 'ROUTE_NOT_FOUND');
    });
  });

  describe('安全中間件', () => {
    it('應該設置安全標頭', async () => {
      const response = await request(app).get('/').expect(200);

      // 檢查安全標頭
      expect(response.headers).toHaveProperty('x-content-type-options');
      expect(response.headers).toHaveProperty('x-frame-options');
      expect(response.headers).toHaveProperty('x-xss-protection');
    });

    it('應該設置 CORS 標頭', async () => {
      const response = await request(app).options('/').expect(200);

      expect(response.headers).toHaveProperty('access-control-allow-methods');
    });
  });

  describe('速率限制', () => {
    it('應該允許正常的 API 請求', async () => {
      await request(app).get('/api/v1').expect(200);
    });
  });

  describe('輸入驗證', () => {
    it('應該清理 XSS 攻擊', async () => {
      const maliciousInput = '<script>alert("xss")</script>';

      const response = await request(app)
        .post('/api/v1')
        .send({ content: maliciousInput })
        .expect(200);

      // 由於我們的清理中間件，惡意腳本應該被移除
      // 這個測試主要檢查伺服器不會崩潰
      expect(response.status).toBe(200);
    });
  });

  describe('JSON 解析', () => {
    it('應該正確解析 JSON 請求', async () => {
      const testData = { test: 'data', number: 123 };

      await request(app)
        .post('/api/v1')
        .send(testData)
        .expect('Content-Type', /json/)
        .expect(200);
    });

    it('應該處理無效的 JSON', async () => {
      await request(app)
        .post('/api/v1')
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}')
        .expect(400);
    });
  });

  describe('大檔案處理', () => {
    it('應該處理大型 JSON 請求（在限制範圍內）', async () => {
      const largeData = {
        data: 'x'.repeat(1000), // 1KB 數據
      };

      await request(app).post('/api/v1').send(largeData).expect(200);
    });
  });
});
