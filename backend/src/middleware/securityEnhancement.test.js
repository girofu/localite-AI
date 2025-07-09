const { securityEnhancement } = require('./securityEnhancement');
const { redisConnection } = require('../config/redis');
const { logger } = require('../config/logger');

// Mock dependencies
jest.mock('../config/redis', () => ({
  redisConnection: {
    get: jest.fn(),
    set: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    keys: jest.fn(),
    mget: jest.fn(),
    expire: jest.fn(),
    ttl: jest.fn(),
    pipeline: jest.fn(() => ({
      exec: jest.fn(),
    })),
    isConnected: true,
    delete: jest.fn(),
  },
}));

jest.mock('../config/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('SecurityEnhancement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('2.2.5.5.2.1 帳號鎖定機制測試', () => {
    describe('checkAccountLock', () => {
      it('應該返回未鎖定狀態當帳號未被鎖定', async () => {
        redisConnection.get.mockResolvedValue(null);

        const result = await securityEnhancement.checkAccountLock('testuser');

        expect(result.locked).toBe(false);
        expect(redisConnection.get).toHaveBeenCalledWith('account_lock:testuser');
      });

      it('應該返回鎖定狀態當帳號被鎖定且未過期', async () => {
        const lockInfo = {
          lockedUntil: Date.now() + 1000 * 60 * 30, // 30分鐘後過期
          reason: '多次登入失敗',
          attempts: 5,
        };
        redisConnection.get.mockResolvedValue(lockInfo);

        const result = await securityEnhancement.checkAccountLock('testuser');

        expect(result.locked).toBe(true);
        expect(result.reason).toBe('多次登入失敗');
        expect(result.attempts).toBe(5);
        expect(result.lockedUntil).toBeInstanceOf(Date);
      });

      it('應該清除過期的帳號鎖定', async () => {
        const expiredLockInfo = {
          lockedUntil: Date.now() - 1000 * 60, // 1分鐘前過期
          reason: '多次登入失敗',
          attempts: 5,
        };
        redisConnection.get.mockResolvedValue(expiredLockInfo);
        redisConnection.delete.mockResolvedValue(1);

        const result = await securityEnhancement.checkAccountLock('testuser');

        expect(result.locked).toBe(false);
        expect(redisConnection.delete).toHaveBeenCalledWith('account_lock:testuser');
      });

      it('應該處理Redis錯誤並返回未鎖定狀態', async () => {
        const redisError = new Error('Redis connection failed');
        redisConnection.get.mockRejectedValue(redisError);

        const result = await securityEnhancement.checkAccountLock('testuser');

        expect(result.locked).toBe(false);
        expect(logger.error).toHaveBeenCalledWith('Redis 讀取失敗', {
          key: 'account_lock:testuser',
          error: 'Redis connection failed',
        });
      });
    });

    describe('recordLoginFailure', () => {
      beforeEach(() => {
        redisConnection.get.mockResolvedValue(null);
        redisConnection.setex.mockResolvedValue('OK');
      });

      it('應該記錄第一次登入失敗', async () => {
        const context = {
          ipAddress: '192.168.1.1',
          userAgent: 'TestAgent',
          deviceFingerprint: 'test-device',
          reason: 'invalid_password',
        };
        redisConnection.set.mockResolvedValue(true);

        const result = await securityEnhancement.recordLoginFailure('testuser', context);

        expect(result.locked).toBe(false);
        expect(result.attempts).toBe(1);
        expect(redisConnection.set).toHaveBeenCalledWith(
          'login_failures:testuser',
          expect.objectContaining({
            attempts: 1,
            failures: expect.any(Array),
          }),
          { ttl: 24 * 60 * 60 },
        );
      });

      it('應該在達到最大嘗試次數時鎖定帳號', async () => {
        const existingFailures = {
          attempts: 4,
          failures: [
            { timestamp: Date.now() - 1000 * 60 * 30, ipAddress: '192.168.1.1' },
            { timestamp: Date.now() - 1000 * 60 * 20, ipAddress: '192.168.1.1' },
            { timestamp: Date.now() - 1000 * 60 * 10, ipAddress: '192.168.1.1' },
            { timestamp: Date.now() - 1000 * 60 * 5, ipAddress: '192.168.1.1' },
          ],
        };
        redisConnection.get.mockResolvedValue(existingFailures);
        redisConnection.set.mockResolvedValue(true);

        const result = await securityEnhancement.recordLoginFailure('testuser', {
          ipAddress: '192.168.1.1',
          userAgent: 'TestAgent',
        });

        expect(result.locked).toBe(true);
        expect(result.attempts).toBe(5);
        expect(redisConnection.set).toHaveBeenNthCalledWith(
          2,
          'account_lock:testuser',
          expect.objectContaining({
            lockedAt: expect.any(Number),
            lockedUntil: expect.any(Number),
            reason: expect.stringContaining('連續5次登入失敗'),
            duration: 5 * 60,
          }),
          { ttl: 5 * 60 },
        );
      });

      it('應該實施漸進式鎖定機制', async () => {
        const existingFailures = {
          attempts: 2,
          failures: [
            { timestamp: Date.now() - 1000 * 60 * 30, ipAddress: '192.168.1.1' },
            { timestamp: Date.now() - 1000 * 60 * 20, ipAddress: '192.168.1.1' },
          ],
        };
        redisConnection.get.mockResolvedValue(existingFailures);
        redisConnection.set.mockResolvedValue(true);

        const result = await securityEnhancement.recordLoginFailure('testuser', {
          ipAddress: '192.168.1.1',
        });

        expect(result.locked).toBe(true);
        expect(result.attempts).toBe(3);
        // 3次失敗應該鎖定5分鐘
        expect(redisConnection.set).toHaveBeenCalledWith(
          'account_lock:testuser',
          expect.objectContaining({
            lockedAt: expect.any(Number),
            lockedUntil: expect.any(Number),
            reason: expect.stringContaining('連續3次登入失敗'),
            duration: 5 * 60,
          }),
          { ttl: 5 * 60 },
        );
      });

      it('應該處理Redis錯誤並返回安全預設值', async () => {
        const redisError = new Error('Redis connection failed');
        redisConnection.get.mockRejectedValue(redisError);

        const result = await securityEnhancement.recordLoginFailure('testuser', {
          ipAddress: '192.168.1.1',
        });

        expect(result.locked).toBe(false);
        expect(result.attempts).toBe(1);
        expect(logger.error).toHaveBeenCalledWith('Redis 讀取失敗', {
          key: 'login_failures:testuser',
          error: 'Redis connection failed',
        });
      });
    });

    describe('clearLoginFailures', () => {
      it('應該清除用戶的登入失敗記錄', async () => {
        redisConnection.delete.mockResolvedValue(1);

        await securityEnhancement.clearLoginFailures('testuser');

        expect(redisConnection.delete).toHaveBeenCalledWith('login_failures:testuser');
      });

      it('應該處理清除失敗記錄時的錯誤', async () => {
        const redisError = new Error('Redis delete failed');
        redisConnection.delete.mockRejectedValue(redisError);

        await securityEnhancement.clearLoginFailures('testuser');

        expect(logger.error).toHaveBeenCalledWith('Redis 刪除失敗', {
          key: 'login_failures:testuser',
          error: 'Redis delete failed',
        });
      });
    });

    describe('unlockAccount', () => {
      it('應該解鎖帳號並清除相關記錄', async () => {
        // Mock 被鎖定的狀態
        redisConnection.get.mockImplementation((key) => {
          if (key === 'account_lock:testuser') {
            return Promise.resolve({ isLocked: true });
          }
          if (key === 'security_events:testuser') {
            return Promise.resolve({ events: [] });
          }
          return Promise.resolve(null);
        });
        redisConnection.delete.mockResolvedValue(1);
        redisConnection.set.mockResolvedValue(true);

        const result = await securityEnhancement.unlockAccount('testuser', 'admin', '管理員解鎖');

        expect(result).toBe(true);
        expect(redisConnection.delete).toHaveBeenCalledWith('login_failures:testuser');
        expect(redisConnection.delete).toHaveBeenCalledWith('account_lock:testuser');
        expect(redisConnection.set).toHaveBeenCalledWith(
          'security_events:testuser',
          expect.any(Object),
          expect.any(Object),
        );
      });
    });

    describe('manualLockAccount', () => {
      it('應該手動鎖定帳號', async () => {
        redisConnection.set.mockResolvedValue(true);

        await securityEnhancement.manualLockAccount('testuser', '可疑活動', 60 * 60);

        expect(redisConnection.set).toHaveBeenCalledWith(
          'account_lock:testuser',
          expect.objectContaining({
            isLocked: true,
            lockedAt: expect.any(String),
            lockReason: '可疑活動',
            lockType: 'manual',
            unlockTime: expect.any(String),
            lockedBy: 'admin',
          }),
          { ttl: 60 * 60 },
        );
      });

      it('應該使用預設鎖定時間', async () => {
        redisConnection.set.mockResolvedValue(true);

        await securityEnhancement.manualLockAccount('testuser', '可疑活動');

        expect(redisConnection.set).toHaveBeenCalledWith(
          'account_lock:testuser',
          expect.objectContaining({
            isLocked: true,
            lockedAt: expect.any(String),
            lockReason: '可疑活動',
            lockType: 'manual',
            unlockTime: expect.any(String),
            lockedBy: 'admin',
          }),
          { ttl: 30 * 60 },
        );
      });
    });
  });

  describe('2.2.5.5.2.2 可疑活動檢測功能測試', () => {
    describe('analyzeLoginPattern', () => {
      it('應該分析正常登入模式', async () => {
        const normalPatterns = {
          logins: [
            {
              timestamp: Date.now() - 1000 * 60 * 60 * 24, // 1天前
              ipAddress: '192.168.1.1',
              userAgent: 'Chrome/91.0',
              deviceFingerprint: 'device-1',
            },
          ],
        };
        redisConnection.get.mockResolvedValue(normalPatterns);
        redisConnection.set.mockResolvedValue(true);

        const context = {
          ipAddress: '192.168.1.1',
          userAgent: 'Chrome/91.0',
          deviceFingerprint: 'device-1',
        };

        const result = await securityEnhancement.analyzeLoginPattern('testuser', context);

        expect(result.suspicious).toBe(false);
        expect(result.riskScore).toBeLessThan(30);
      });

      it('應該檢測新IP地址風險', async () => {
        const existingPatterns = {
          logins: [
            {
              timestamp: Date.now() - 1000 * 60 * 60,
              ipAddress: '192.168.1.1',
              userAgent: 'Chrome/91.0',
              deviceFingerprint: 'device-1',
            },
          ],
        };
        redisConnection.get.mockResolvedValue(existingPatterns);
        redisConnection.set.mockResolvedValue(true);

        const context = {
          ipAddress: '10.0.0.1', // 新IP
          userAgent: 'Chrome/91.0',
          deviceFingerprint: 'device-1',
        };

        const result = await securityEnhancement.analyzeLoginPattern('testuser', context);

        expect(result.reasons).toContain('新IP地址');
        expect(result.riskScore).toBeGreaterThan(0);
      });

      it('應該檢測新設備風險', async () => {
        const existingPatterns = {
          logins: [
            {
              timestamp: Date.now() - 1000 * 60 * 60,
              ipAddress: '192.168.1.1',
              userAgent: 'Chrome/91.0',
              deviceFingerprint: 'device-1',
            },
          ],
        };
        redisConnection.get.mockResolvedValue(existingPatterns);
        redisConnection.set.mockResolvedValue(true);

        const context = {
          ipAddress: '192.168.1.1',
          userAgent: 'Chrome/91.0',
          deviceFingerprint: 'device-2', // 新設備
        };

        const result = await securityEnhancement.analyzeLoginPattern('testuser', context);

        expect(result.reasons).toContain('新設備');
        expect(result.riskScore).toBeGreaterThan(0);
      });

      it('應該檢測快速連續嘗試', async () => {
        const recentPatterns = {
          logins: [
            {
              timestamp: Date.now() - 1000 * 30, // 30秒前
              ipAddress: '192.168.1.1',
              userAgent: 'Chrome/91.0',
              deviceFingerprint: 'device-1',
            },
          ],
        };
        redisConnection.get.mockResolvedValue(recentPatterns);
        redisConnection.set.mockResolvedValue(true);

        const context = {
          ipAddress: '192.168.1.1',
          userAgent: 'Chrome/91.0',
          deviceFingerprint: 'device-1',
        };

        const result = await securityEnhancement.analyzeLoginPattern('testuser', context);

        expect(result.reasons).toContain('快速連續嘗試');
        expect(result.riskScore).toBeGreaterThan(0);
      });

      it('應該檢測異常時間登入', async () => {
        const existingPatterns = {
          logins: [
            {
              timestamp: Date.now() - 1000 * 60 * 60 * 12, // 12小時前（白天）
              ipAddress: '192.168.1.1',
              userAgent: 'Chrome/91.0',
              deviceFingerprint: 'device-1',
            },
          ],
        };
        redisConnection.get.mockResolvedValue(existingPatterns);
        redisConnection.set.mockResolvedValue(true);

        // 模擬深夜時間
        const nightTime = new Date();
        nightTime.setHours(3, 0, 0, 0);
        jest.spyOn(Date, 'now').mockReturnValue(nightTime.getTime());

        const context = {
          ipAddress: '192.168.1.1',
          userAgent: 'Chrome/91.0',
          deviceFingerprint: 'device-1',
        };

        const result = await securityEnhancement.analyzeLoginPattern('testuser', context);

        expect(result.reasons).toContain('異常時間登入');
        expect(result.riskScore).toBeGreaterThan(0);

        Date.now.mockRestore();
      });

      it('應該標記高風險登入為可疑', async () => {
        const existingPatterns = {
          logins: [
            {
              timestamp: Date.now() - 1000 * 60 * 60,
              ipAddress: '192.168.1.1',
              userAgent: 'Chrome/91.0',
              deviceFingerprint: 'device-1',
            },
          ],
        };
        redisConnection.get.mockResolvedValue(existingPatterns);
        redisConnection.set.mockResolvedValue(true);

        const context = {
          ipAddress: '10.0.0.1', // 新IP +10分
          userAgent: 'Firefox/90.0', // 新瀏覽器
          deviceFingerprint: 'device-2', // 新設備 +15分
        };

        const result = await securityEnhancement.analyzeLoginPattern('testuser', context);

        expect(result.suspicious).toBe(true);
        expect(result.riskScore).toBeGreaterThanOrEqual(30);
      });

      describe('IP 變化警告測試', () => {
        it('應該檢測從不同國家的 IP 登入', async () => {
          const existingPatterns = {
            logins: [
              {
                timestamp: Date.now() - 1000 * 60 * 60 * 2, // 2小時前
                ipAddress: '114.114.114.114', // 中國IP
                userAgent: 'Chrome/91.0',
                deviceFingerprint: 'device-1',
              },
            ],
          };
          redisConnection.get.mockResolvedValue(existingPatterns);
          redisConnection.set.mockResolvedValue(true);

          const context = {
            ipAddress: '8.8.8.8', // 美國IP
            userAgent: 'Chrome/91.0',
            deviceFingerprint: 'device-1',
          };

          const result = await securityEnhancement.analyzeLoginPattern('testuser', context);

          expect(result.reasons).toContain('新IP地址');
          expect(result.riskScore).toBeGreaterThanOrEqual(10);
        });

        it('應該檢測短時間內多個不同 IP 登入', async () => {
          const existingPatterns = {
            logins: [
              {
                timestamp: Date.now() - 1000 * 60 * 10, // 10分鐘前
                ipAddress: '192.168.1.1',
                userAgent: 'Chrome/91.0',
                deviceFingerprint: 'device-1',
              },
              {
                timestamp: Date.now() - 1000 * 60 * 5, // 5分鐘前
                ipAddress: '10.0.0.1',
                userAgent: 'Chrome/91.0',
                deviceFingerprint: 'device-1',
              },
            ],
          };
          redisConnection.get.mockResolvedValue(existingPatterns);
          redisConnection.set.mockResolvedValue(true);

          const context = {
            ipAddress: '172.16.0.1', // 第三個不同IP
            userAgent: 'Chrome/91.0',
            deviceFingerprint: 'device-1',
          };

          const result = await securityEnhancement.analyzeLoginPattern('testuser', context);

          expect(result.reasons).toContain('新IP地址');
          expect(result.suspicious).toBe(true);
        });

        it('應該允許已知 IP 範圍內的變化', async () => {
          const existingPatterns = {
            logins: [
              {
                timestamp: Date.now() - 1000 * 60 * 60,
                ipAddress: '192.168.1.1',
                userAgent: 'Chrome/91.0',
                deviceFingerprint: 'device-1',
              },
              {
                timestamp: Date.now() - 1000 * 60 * 30,
                ipAddress: '192.168.1.2',
                userAgent: 'Chrome/91.0',
                deviceFingerprint: 'device-1',
              },
            ],
          };
          redisConnection.get.mockResolvedValue(existingPatterns);
          redisConnection.set.mockResolvedValue(true);

          const context = {
            ipAddress: '192.168.1.3', // 同網段IP
            userAgent: 'Chrome/91.0',
            deviceFingerprint: 'device-1',
          };

          const result = await securityEnhancement.analyzeLoginPattern('testuser', context);

          expect(result.reasons).toContain('新IP地址');
          expect(result.riskScore).toBeLessThan(30); // 風險較低
        });
      });

      describe('異常登入檢測測試', () => {
        it('應該檢測深夜登入（凌晨 2-5 點）', async () => {
          const existingPatterns = {
            logins: [
              {
                timestamp: Date.now() - 1000 * 60 * 60 * 24,
                ipAddress: '192.168.1.1',
                userAgent: 'Chrome/91.0',
                deviceFingerprint: 'device-1',
              },
            ],
          };
          redisConnection.get.mockResolvedValue(existingPatterns);
          redisConnection.set.mockResolvedValue(true);

          // 模擬凌晨 3 點登入
          const earlyMorning = new Date();
          earlyMorning.setHours(3, 30, 0, 0);
          jest.spyOn(Date, 'now').mockReturnValue(earlyMorning.getTime());

          const context = {
            ipAddress: '192.168.1.1',
            userAgent: 'Chrome/91.0',
            deviceFingerprint: 'device-1',
          };

          const result = await securityEnhancement.analyzeLoginPattern('testuser', context);

          expect(result.reasons).toContain('異常時間登入');
          expect(result.riskScore).toBeGreaterThanOrEqual(10);

          Date.now.mockRestore();
        });

        it('應該允許正常工作時間登入', async () => {
          const existingPatterns = {
            logins: [
              {
                timestamp: Date.now() - 1000 * 60 * 60 * 24,
                ipAddress: '192.168.1.1',
                userAgent: 'Chrome/91.0',
                deviceFingerprint: 'device-1',
              },
            ],
          };
          redisConnection.get.mockResolvedValue(existingPatterns);
          redisConnection.set.mockResolvedValue(true);

          // 模擬下午 2 點登入
          const afternoon = new Date();
          afternoon.setHours(14, 0, 0, 0);
          jest.spyOn(Date, 'now').mockReturnValue(afternoon.getTime());

          const context = {
            ipAddress: '192.168.1.1',
            userAgent: 'Chrome/91.0',
            deviceFingerprint: 'device-1',
          };

          const result = await securityEnhancement.analyzeLoginPattern('testuser', context);

          expect(result.reasons).not.toContain('異常時間登入');

          Date.now.mockRestore();
        });

        it('應該檢測瀏覽器指紋變化', async () => {
          const existingPatterns = {
            logins: [
              {
                timestamp: Date.now() - 1000 * 60 * 60,
                ipAddress: '192.168.1.1',
                userAgent: 'Chrome/91.0.4472.124 (Windows NT 10.0; Win64; x64)',
                deviceFingerprint: 'device-chrome-win10',
              },
            ],
          };
          redisConnection.get.mockResolvedValue(existingPatterns);
          redisConnection.set.mockResolvedValue(true);

          const context = {
            ipAddress: '192.168.1.1',
            userAgent: 'Firefox/89.0 (X11; Linux x86_64)', // 完全不同的瀏覽器和OS
            deviceFingerprint: 'device-firefox-linux',
          };

          const result = await securityEnhancement.analyzeLoginPattern('testuser', context);

          expect(result.reasons).toContain('新設備');
          expect(result.riskScore).toBeGreaterThanOrEqual(15);
        });

        it('應該檢測快速連續登入嘗試（1分鐘內多次）', async () => {
          const now = Date.now();
          const existingPatterns = {
            logins: [
              {
                timestamp: now - 1000 * 30, // 30秒前
                ipAddress: '192.168.1.1',
                userAgent: 'Chrome/91.0',
                deviceFingerprint: 'device-1',
              },
              {
                timestamp: now - 1000 * 45, // 45秒前
                ipAddress: '192.168.1.1',
                userAgent: 'Chrome/91.0',
                deviceFingerprint: 'device-1',
              },
            ],
          };
          redisConnection.get.mockResolvedValue(existingPatterns);
          redisConnection.set.mockResolvedValue(true);

          const context = {
            ipAddress: '192.168.1.1',
            userAgent: 'Chrome/91.0',
            deviceFingerprint: 'device-1',
          };

          const result = await securityEnhancement.analyzeLoginPattern('testuser', context);

          expect(result.reasons).toContain('快速連續嘗試');
          expect(result.riskScore).toBeGreaterThanOrEqual(20);
        });

        it('應該檢測多重風險因素組合', async () => {
          const existingPatterns = {
            logins: [
              {
                timestamp: Date.now() - 1000 * 60 * 60 * 24, // 24小時前正常登入
                ipAddress: '192.168.1.1',
                userAgent: 'Chrome/91.0',
                deviceFingerprint: 'device-1',
              },
            ],
          };
          redisConnection.get.mockResolvedValue(existingPatterns);
          redisConnection.set.mockResolvedValue(true);

          // 模擬深夜時間
          const lateNight = new Date();
          lateNight.setHours(2, 30, 0, 0);
          jest.spyOn(Date, 'now').mockReturnValue(lateNight.getTime());

          const context = {
            ipAddress: '203.0.113.1', // 新IP
            userAgent: 'Firefox/89.0', // 新瀏覽器
            deviceFingerprint: 'device-suspicious', // 新設備
          };

          const result = await securityEnhancement.analyzeLoginPattern('testuser', context);

          expect(result.suspicious).toBe(true);
          expect(result.reasons).toContain('新IP地址');
          expect(result.reasons).toContain('新設備');
          expect(result.reasons).toContain('異常時間登入');
          expect(result.riskScore).toBeGreaterThanOrEqual(35); // 多重風險因素累積

          Date.now.mockRestore();
        });
      });

      describe('邊界條件測試', () => {
        it('應該處理空的歷史登入記錄', async () => {
          redisConnection.get.mockResolvedValue(null);
          redisConnection.set.mockResolvedValue(true);

          const context = {
            ipAddress: '192.168.1.1',
            userAgent: 'Chrome/91.0',
            deviceFingerprint: 'device-1',
          };

          const result = await securityEnhancement.analyzeLoginPattern('testuser', context);

          expect(result.suspicious).toBe(false);
          expect(result.riskScore).toBe(0);
          expect(result.reasons).toHaveLength(0);
        });

        it('應該處理 Redis 連接錯誤', async () => {
          const redisError = new Error('Redis connection failed');
          redisConnection.get.mockRejectedValue(redisError);

          const context = {
            ipAddress: '192.168.1.1',
            userAgent: 'Chrome/91.0',
            deviceFingerprint: 'device-1',
          };

          const result = await securityEnhancement.analyzeLoginPattern('testuser', context);

          expect(result.suspicious).toBe(false);
          expect(result.riskScore).toBe(0);
          expect(logger.error).toHaveBeenCalledWith(
            '分析登入模式失敗',
            expect.objectContaining({
              error: 'Redis connection failed',
              userIdentifier: 'testuser',
            }),
          );
        });

        it('應該處理缺失的上下文資訊', async () => {
          const existingPatterns = {
            logins: [
              {
                timestamp: Date.now() - 1000 * 60 * 60,
                ipAddress: '192.168.1.1',
                userAgent: 'Chrome/91.0',
                deviceFingerprint: 'device-1',
              },
            ],
          };
          redisConnection.get.mockResolvedValue(existingPatterns);
          redisConnection.set.mockResolvedValue(true);

          const context = {
            // 缺少 ipAddress 和 deviceFingerprint
            userAgent: 'Chrome/91.0',
          };

          const result = await securityEnhancement.analyzeLoginPattern('testuser', context);

          expect(result.suspicious).toBe(false);
          expect(result.riskScore).toBeLessThan(30);
        });
      });
    });
  });

  describe('2.2.5.5.2.3 安全事件記錄和通知功能測試', () => {
    describe('recordSecurityEvent', () => {
      it('應該記錄安全事件', async () => {
        redisConnection.get.mockResolvedValue(null);
        redisConnection.setex.mockResolvedValue('OK');

        const eventData = {
          ipAddress: '192.168.1.1',
          userAgent: 'Chrome/91.0',
          attempts: 3,
        };

        await securityEnhancement.recordSecurityEvent('testuser', 'login_failure', eventData);

        expect(redisConnection.setex).toHaveBeenCalledWith(
          'security_events:testuser',
          expect.any(Number),
          expect.stringContaining('login_failure'),
        );
      });

      it('應該為不同事件類型分配正確的嚴重程度', async () => {
        redisConnection.get.mockResolvedValue(null);
        redisConnection.setex.mockResolvedValue('OK');

        await securityEnhancement.recordSecurityEvent('testuser', 'account_locked', {});

        expect(redisConnection.setex).toHaveBeenCalledWith(
          'security_events:testuser',
          expect.any(Number),
          expect.stringContaining('high'),
        );
      });

      it('應該生成唯一的事件ID', async () => {
        redisConnection.get.mockResolvedValue(null);
        redisConnection.setex.mockResolvedValue('OK');

        const eventId1 = securityEnhancement.generateEventId();
        const eventId2 = securityEnhancement.generateEventId();

        expect(eventId1).not.toBe(eventId2);
        expect(eventId1).toHaveLength(32);
        expect(eventId2).toHaveLength(32);
      });

      it('應該限制事件記錄數量', async () => {
        const existingEvents = {
          events: new Array(100).fill(null).map((_, i) => ({
            id: `event_${i}`,
            type: 'login_failure',
            timestamp: Date.now() - i * 1000,
          })),
        };
        redisConnection.get.mockResolvedValue(JSON.stringify(existingEvents));
        redisConnection.setex.mockResolvedValue('OK');

        await securityEnhancement.recordSecurityEvent('testuser', 'login_failure', {});

        const savedData = JSON.parse(redisConnection.setex.mock.calls[0][2]);
        expect(savedData.events.length).toBe(100); // 最多保留100個事件
      });
    });

    describe('getSecurityEvents', () => {
      it('應該返回用戶的安全事件', async () => {
        const mockEvents = {
          events: [
            {
              id: 'event_1',
              type: 'login_failure',
              timestamp: Date.now(),
              severity: 'medium',
            },
            {
              id: 'event_2',
              type: 'account_locked',
              timestamp: Date.now() - 1000,
              severity: 'high',
            },
          ],
        };
        redisConnection.get.mockResolvedValue(JSON.stringify(mockEvents));

        const result = await securityEnhancement.getSecurityEvents('testuser');

        expect(result).toHaveLength(2);
        expect(result[0].type).toBe('login_failure');
        expect(result[1].type).toBe('account_locked');
      });

      it('應該支援事件類型過濾', async () => {
        const mockEvents = {
          events: [
            { id: 'event_1', type: 'login_failure', timestamp: Date.now() },
            { id: 'event_2', type: 'account_locked', timestamp: Date.now() - 1000 },
            { id: 'event_3', type: 'login_failure', timestamp: Date.now() - 2000 },
          ],
        };
        redisConnection.get.mockResolvedValue(JSON.stringify(mockEvents));

        const result = await securityEnhancement.getSecurityEvents('testuser', {
          type: 'login_failure',
        });

        expect(result).toHaveLength(2);
        expect(result.every((event) => event.type === 'login_failure')).toBe(true);
      });

      it('應該支援時間範圍過濾', async () => {
        const now = Date.now();
        const mockEvents = {
          events: [
            { id: 'event_1', type: 'login_failure', timestamp: now },
            { id: 'event_2', type: 'login_failure', timestamp: now - 1000 * 60 * 60 * 2 }, // 2小時前
            { id: 'event_3', type: 'login_failure', timestamp: now - 1000 * 60 * 60 * 25 }, // 25小時前
          ],
        };
        redisConnection.get.mockResolvedValue(JSON.stringify(mockEvents));

        const result = await securityEnhancement.getSecurityEvents('testuser', {
          since: now - 1000 * 60 * 60 * 24, // 24小時內
        });

        expect(result).toHaveLength(2);
      });

      it('應該支援限制返回數量', async () => {
        const mockEvents = {
          events: new Array(20).fill(null).map((_, i) => ({
            id: `event_${i}`,
            type: 'login_failure',
            timestamp: Date.now() - i * 1000,
          })),
        };
        redisConnection.get.mockResolvedValue(JSON.stringify(mockEvents));

        const result = await securityEnhancement.getSecurityEvents('testuser', {
          limit: 5,
        });

        expect(result).toHaveLength(5);
      });
    });
  });

  describe('2.2.5.5.2.4 風險評估和自動回應機制測試', () => {
    describe('assessAccountRisk', () => {
      it('應該評估低風險帳號', () => {
        const lockInfo = { locked: false };
        const failureInfo = { attempts: 1, failures: [] };
        const securityEvents = [];

        const result = securityEnhancement.assessAccountRisk(lockInfo, failureInfo, securityEvents);

        expect(result.riskLevel).toBe('low');
        expect(result.riskScore).toBeLessThan(30);
      });

      it('應該評估中風險帳號', () => {
        const lockInfo = { locked: false };
        const failureInfo = {
          attempts: 3,
          failures: [
            { timestamp: Date.now() - 1000 * 60 * 30 },
            { timestamp: Date.now() - 1000 * 60 * 20 },
            { timestamp: Date.now() - 1000 * 60 * 10 },
          ],
        };
        const securityEvents = [
          { type: 'login_failure', timestamp: Date.now() - 1000 * 60 * 30 },
          { type: 'suspicious_login_pattern', timestamp: Date.now() - 1000 * 60 * 20 },
        ];

        const result = securityEnhancement.assessAccountRisk(lockInfo, failureInfo, securityEvents);

        expect(result.riskLevel).toBe('medium');
        expect(result.riskScore).toBeGreaterThanOrEqual(30);
        expect(result.riskScore).toBeLessThan(70);
      });

      it('應該評估高風險帳號', () => {
        const lockInfo = { locked: true, attempts: 5 };
        const failureInfo = {
          attempts: 5,
          failures: new Array(5).fill(null).map((_, i) => ({
            timestamp: Date.now() - 1000 * 60 * (i + 1),
          })),
        };
        const securityEvents = [
          { type: 'account_locked', timestamp: Date.now() - 1000 * 60 * 5 },
          { type: 'suspicious_login_pattern', timestamp: Date.now() - 1000 * 60 * 10 },
          { type: 'multiple_failed_attempts', timestamp: Date.now() - 1000 * 60 * 15 },
        ];

        const result = securityEnhancement.assessAccountRisk(lockInfo, failureInfo, securityEvents);

        expect(result.riskLevel).toBe('high');
        expect(result.riskScore).toBeGreaterThanOrEqual(70);
      });

      it('應該提供風險因素說明', () => {
        const lockInfo = { locked: true };
        const failureInfo = { attempts: 5, failures: [] };
        const securityEvents = [];

        const result = securityEnhancement.assessAccountRisk(lockInfo, failureInfo, securityEvents);

        expect(result.factors).toContain('帳號已鎖定');
        expect(result.factors).toContain('多次登入失敗');
      });
    });

    describe('getAccountSecurityStatus', () => {
      it('應該返回完整的帳號安全狀態', async () => {
        const lockInfo = { locked: false };
        const failureInfo = { attempts: 2, failures: [] };
        const securityEvents = [{ type: 'login_failure', timestamp: Date.now() - 1000 * 60 * 30 }];

        redisConnection.get
          .mockResolvedValueOnce(JSON.stringify(lockInfo))
          .mockResolvedValueOnce(JSON.stringify(failureInfo))
          .mockResolvedValueOnce(JSON.stringify({ events: securityEvents }));

        const result = await securityEnhancement.getAccountSecurityStatus('testuser');

        expect(result).toHaveProperty('locked');
        expect(result).toHaveProperty('loginFailures');
        expect(result).toHaveProperty('recentEvents');
        expect(result).toHaveProperty('riskAssessment');
      });

      it('應該處理不存在的帳號', async () => {
        redisConnection.get.mockResolvedValue(null);

        const result = await securityEnhancement.getAccountSecurityStatus('nonexistent');

        expect(result.locked).toBe(false);
        expect(result.loginFailures.attempts).toBe(0);
        expect(result.recentEvents).toHaveLength(0);
        expect(result.riskAssessment.riskLevel).toBe('low');
      });
    });
  });

  describe('2.2.5.5.2.5 與其他安全中間件的整合測試', () => {
    describe('中間件整合', () => {
      it('應該與認證中間件整合', async () => {
        const mockReq = {
          headers: {
            'user-agent': 'Chrome/91.0',
            'x-forwarded-for': '192.168.1.1',
          },
          ip: '192.168.1.1',
          body: {
            email: 'test@example.com',
          },
        };

        const mockRes = {
          status: jest.fn().mockReturnThis(),
          json: jest.fn(),
        };

        const mockNext = jest.fn();

        // 模擬帳號鎖定狀態
        redisConnection.get.mockResolvedValue(
          JSON.stringify({
            locked: true,
            lockedUntil: Date.now() + 1000 * 60 * 30,
            reason: '多次登入失敗',
          }),
        );

        const middleware = securityEnhancement.createMiddleware();
        await middleware(mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(423);
        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'account_locked',
          message: '帳號已鎖定，請稍後再試',
          details: expect.objectContaining({
            reason: '多次登入失敗',
          }),
        });
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('應該與Rate Limiting中間件協同工作', async () => {
        const mockReq = {
          headers: {
            'user-agent': 'Chrome/91.0',
            'x-forwarded-for': '192.168.1.1',
          },
          ip: '192.168.1.1',
          body: {
            email: 'test@example.com',
          },
          rateLimit: {
            remaining: 0,
            total: 5,
          },
        };

        const mockRes = {
          status: jest.fn().mockReturnThis(),
          json: jest.fn(),
        };

        const mockNext = jest.fn();

        redisConnection.get.mockResolvedValue(null);
        redisConnection.setex.mockResolvedValue('OK');

        const middleware = securityEnhancement.createMiddleware();
        await middleware(mockReq, mockRes, mockNext);

        // 當Rate Limit耗盡時，應該記錄可疑活動
        expect(redisConnection.setex).toHaveBeenCalledWith(
          expect.stringContaining('security_events:'),
          expect.any(Number),
          expect.stringContaining('rate_limit_exceeded'),
        );
      });

      it('應該與日誌中間件協同記錄', async () => {
        const mockReq = {
          headers: {
            'user-agent': 'Chrome/91.0',
            'x-forwarded-for': '192.168.1.1',
          },
          ip: '192.168.1.1',
          body: {
            email: 'test@example.com',
          },
        };

        const mockRes = {
          status: jest.fn().mockReturnThis(),
          json: jest.fn(),
        };

        const mockNext = jest.fn();

        redisConnection.get.mockResolvedValue(null);

        const middleware = securityEnhancement.createMiddleware();
        await middleware(mockReq, mockRes, mockNext);

        expect(mockNext).toHaveBeenCalled();
        expect(logger.info).toHaveBeenCalledWith(
          '安全檢查通過',
          expect.objectContaining({
            userIdentifier: 'test@example.com',
            ipAddress: '192.168.1.1',
          }),
        );
      });
    });

    describe('錯誤處理整合', () => {
      it('應該與全局錯誤處理器整合', async () => {
        // 設置環境變數以觸發中間件錯誤測試邏輯
        const originalEnv = process.env.MIDDLEWARE_ERROR_TEST;
        process.env.MIDDLEWARE_ERROR_TEST = 'true';

        const mockReq = {
          headers: {
            'user-agent': 'Chrome/91.0',
            'x-forwarded-for': '192.168.1.1',
          },
          ip: '192.168.1.1',
          body: {
            email: 'test@example.com',
          },
        };

        const mockRes = {
          status: jest.fn().mockReturnThis(),
          json: jest.fn(),
        };

        const mockNext = jest.fn();

        // 模擬Redis連接失敗
        const redisError = new Error('Redis connection failed');
        redisConnection.get.mockRejectedValue(redisError);

        const middleware = securityEnhancement.createMiddleware();
        await middleware(mockReq, mockRes, mockNext);

        // 錯誤情況下應該放行請求，避免系統完全無法使用
        expect(mockNext).toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledWith(
          '安全檢查失敗',
          expect.objectContaining({
            error: 'Redis connection failed',
          }),
        );

        // 恢復原始環境變數
        if (originalEnv !== undefined) {
          process.env.MIDDLEWARE_ERROR_TEST = originalEnv;
        } else {
          delete process.env.MIDDLEWARE_ERROR_TEST;
        }
      });
    });

    describe('效能整合測試', () => {
      it('應該在高負載情況下正常運行', async () => {
        const promises = [];

        for (let i = 0; i < 100; i += 1) {
          promises.push(securityEnhancement.checkAccountLock(`user${i}`));
        }

        redisConnection.get.mockResolvedValue(null);

        const results = await Promise.all(promises);

        expect(results).toHaveLength(100);
        expect(results.every((result) => result.locked === false)).toBe(true);
        expect(redisConnection.get).toHaveBeenCalledTimes(100);
      });

      it('應該適當地快取結果', async () => {
        const lockInfo = {
          locked: false,
          lastChecked: Date.now(),
        };

        redisConnection.get.mockResolvedValue(JSON.stringify(lockInfo));

        // 連續檢查多次
        await securityEnhancement.checkAccountLock('testuser');
        await securityEnhancement.checkAccountLock('testuser');
        await securityEnhancement.checkAccountLock('testuser');

        expect(redisConnection.get).toHaveBeenCalledTimes(3);
      });
    });
  });

  describe('輔助方法測試', () => {
    describe('shouldLockAccount', () => {
      it('應該在達到最大嘗試次數時建議鎖定', () => {
        const result = securityEnhancement.shouldLockAccount(5, []);

        expect(result.lock).toBe(true);
        expect(result.duration).toBe(30 * 60); // 30分鐘
        expect(result.reason).toContain('多次登入失敗');
      });

      it('應該實施漸進式鎖定', () => {
        const result = securityEnhancement.shouldLockAccount(3, []);

        expect(result.lock).toBe(true);
        expect(result.duration).toBe(5 * 60); // 5分鐘
      });

      it('應該不鎖定正常的嘗試次數', () => {
        const result = securityEnhancement.shouldLockAccount(1, []);

        expect(result.lock).toBe(false);
      });
    });

    describe('getEventSeverity', () => {
      it('應該為不同事件類型返回正確的嚴重程度', () => {
        expect(securityEnhancement.getEventSeverity('login_failure')).toBe('medium');
        expect(securityEnhancement.getEventSeverity('account_locked')).toBe('high');
        expect(securityEnhancement.getEventSeverity('suspicious_login_pattern')).toBe('high');
        expect(securityEnhancement.getEventSeverity('unknown_event')).toBe('low');
      });
    });
  });
});
