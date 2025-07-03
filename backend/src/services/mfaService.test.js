const MFAService = require('./mfaService');
const { redisConnection } = require('../config/redis');
const { logger } = require('../middleware/requestLogger');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');

// Mock dependencies
jest.mock('../config/redis', () => ({
  redisConnection: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
    keys: jest.fn(),
    ttl: jest.fn(),
    ping: jest.fn(),
  },
}));

jest.mock('../middleware/requestLogger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('otplib', () => ({
  authenticator: {
    generateSecret: jest.fn(),
    verify: jest.fn(),
    keyuri: jest.fn(),
    options: {},
  },
}));

jest.mock('qrcode', () => ({
  toDataURL: jest.fn(),
}));

describe('MFAService', () => {
  let mfaService;
  const testUid = 'test-user-123';
  const testCode = '123456';

  beforeEach(() => {
    // 清理所有 mock 調用
    jest.clearAllMocks();
    mfaService = new MFAService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('應該正確初始化 MFA 服務配置', () => {
      expect(mfaService.totpConfig).toBeDefined();
      expect(mfaService.smsConfig).toBeDefined();
      expect(mfaService.backupCodeConfig).toBeDefined();
      expect(mfaService.MFA_STATUS).toBeDefined();
      expect(mfaService.MFA_TYPE).toBeDefined();
      expect(mfaService.VERIFICATION_RESULT).toBeDefined();
    });

    it('應該設置正確的 Redis 鍵前綴', () => {
      expect(mfaService.mfaPrefix).toBe('mfa:');
      expect(mfaService.totpSecretPrefix).toBe('totp_secret:');
      expect(mfaService.smsCodePrefix).toBe('sms_code:');
      expect(mfaService.backupCodesPrefix).toBe('backup_codes:');
    });

    it('應該記錄初始化日誌', () => {
      expect(logger.info).toHaveBeenCalledWith('MFA 服務初始化完成', {
        totpConfig: mfaService.totpConfig,
        smsConfig: mfaService.smsConfig,
        backupCodeConfig: mfaService.backupCodeConfig,
      });
    });
  });

  describe('getUserMFAStatus', () => {
    it('應該返回預設 MFA 狀態當用戶沒有 MFA 記錄時', async () => {
      redisConnection.get.mockResolvedValue(null);
      mfaService.getBackupCodesRemaining = jest.fn().mockResolvedValue(0);

      const result = await mfaService.getUserMFAStatus(testUid);

      expect(result).toEqual({
        status: 'disabled',
        enabledMethods: [],
        pendingMethods: [],
        backupCodesRemaining: 0,
        lastUpdated: null,
      });
    });

    it('應該返回用戶的 MFA 狀態', async () => {
      const mockStatus = {
        status: 'enabled',
        enabledMethods: ['totp'],
        pendingMethods: [],
        lastUpdated: '2024-01-01T00:00:00.000Z',
      };
      redisConnection.get.mockResolvedValue(JSON.stringify(mockStatus));
      mfaService.getBackupCodesRemaining = jest.fn().mockResolvedValue(5);

      const result = await mfaService.getUserMFAStatus(testUid);

      expect(result).toEqual({
        ...mockStatus,
        backupCodesRemaining: 5,
      });
    });

    it('應該處理 Redis 錯誤', async () => {
      const error = new Error('Redis 連接失敗');
      redisConnection.get.mockRejectedValue(error);

      await expect(mfaService.getUserMFAStatus(testUid)).rejects.toThrow('獲取 MFA 狀態失敗');
      expect(logger.error).toHaveBeenCalledWith('獲取用戶 MFA 狀態失敗', {
        uid: testUid,
        error: error.message,
        stack: error.stack,
      });
    });
  });

  describe('setUserMFAStatus', () => {
    it('應該設置用戶 MFA 狀態', async () => {
      const statusData = {
        status: 'enabled',
        enabledMethods: ['totp'],
        pendingMethods: [],
      };
      redisConnection.set.mockResolvedValue('OK');

      await mfaService.setUserMFAStatus(testUid, statusData);

      expect(redisConnection.set).toHaveBeenCalledWith(
        `mfa_status:${testUid}`,
        expect.stringContaining('"status":"enabled"')
      );
      expect(logger.info).toHaveBeenCalledWith('用戶 MFA 狀態更新成功', {
        uid: testUid,
        status: statusData.status,
        enabledMethods: statusData.enabledMethods,
      });
    });

    it('應該處理設置錯誤', async () => {
      const error = new Error('Redis 寫入失敗');
      redisConnection.set.mockRejectedValue(error);

      await expect(mfaService.setUserMFAStatus(testUid, {})).rejects.toThrow('設置 MFA 狀態失敗');
      expect(logger.error).toHaveBeenCalledWith('設置用戶 MFA 狀態失敗', {
        uid: testUid,
        error: error.message,
        stack: error.stack,
      });
    });
  });

  describe('isMFAEnabled', () => {
    it('應該返回 true 當 MFA 啟用且有方法時', async () => {
      mfaService.getUserMFAStatus = jest.fn().mockResolvedValue({
        status: 'enabled',
        enabledMethods: ['totp'],
      });

      const result = await mfaService.isMFAEnabled(testUid);

      expect(result).toBe(true);
    });

    it('應該返回 false 當 MFA 未啟用時', async () => {
      mfaService.getUserMFAStatus = jest.fn().mockResolvedValue({
        status: 'disabled',
        enabledMethods: [],
      });

      const result = await mfaService.isMFAEnabled(testUid);

      expect(result).toBe(false);
    });

    it('應該返回 false 當 MFA 啟用但沒有方法時', async () => {
      mfaService.getUserMFAStatus = jest.fn().mockResolvedValue({
        status: 'enabled',
        enabledMethods: [],
      });

      const result = await mfaService.isMFAEnabled(testUid);

      expect(result).toBe(false);
    });

    it('應該處理錯誤並返回 false', async () => {
      const error = new Error('獲取狀態失敗');
      mfaService.getUserMFAStatus = jest.fn().mockRejectedValue(error);

      const result = await mfaService.isMFAEnabled(testUid);

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('檢查 MFA 狀態失敗', {
        uid: testUid,
        error: error.message,
      });
    });
  });

  describe('incrementAttemptCounter', () => {
    it('應該增加嘗試次數計數器', async () => {
      redisConnection.incr.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
      redisConnection.expire.mockResolvedValue(1);

      const result = await mfaService.incrementAttemptCounter(testUid, 'totp');

      expect(redisConnection.incr).toHaveBeenCalledTimes(2);
      expect(redisConnection.expire).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        currentAttempts: 1,
        dailyAttempts: 1,
      });
    });

    it('應該處理 Redis 錯誤', async () => {
      const error = new Error('Redis 錯誤');
      redisConnection.incr.mockRejectedValue(error);

      await expect(mfaService.incrementAttemptCounter(testUid, 'totp')).rejects.toThrow(
        '增加嘗試次數失敗'
      );
      expect(logger.error).toHaveBeenCalledWith('增加嘗試次數失敗', {
        uid: testUid,
        type: 'totp',
        error: error.message,
      });
    });
  });

  describe('isAttemptLimitExceeded', () => {
    it('應該返回 false 當嘗試次數未超限時', async () => {
      redisConnection.get.mockResolvedValueOnce('1').mockResolvedValueOnce('1');

      const result = await mfaService.isAttemptLimitExceeded(testUid, 'sms');

      expect(result).toBe(false);
    });

    it('應該返回 true 當短期嘗試次數超限時', async () => {
      redisConnection.get.mockResolvedValueOnce('5').mockResolvedValueOnce('1');

      const result = await mfaService.isAttemptLimitExceeded(testUid, 'sms');

      expect(result).toBe(true);
    });

    it('應該返回 true 當每日嘗試次數超限時', async () => {
      redisConnection.get.mockResolvedValueOnce('1').mockResolvedValueOnce('15');

      const result = await mfaService.isAttemptLimitExceeded(testUid, 'sms');

      expect(result).toBe(true);
    });

    it('應該處理 Redis 錯誤並返回 false', async () => {
      const error = new Error('Redis 錯誤');
      redisConnection.get.mockRejectedValue(error);

      const result = await mfaService.isAttemptLimitExceeded(testUid, 'sms');

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('檢查嘗試限制失敗', {
        uid: testUid,
        type: 'sms',
        error: error.message,
      });
    });
  });

  describe('resetAttemptCounter', () => {
    it('應該重置嘗試計數器', async () => {
      redisConnection.del.mockResolvedValue(1);

      await mfaService.resetAttemptCounter(testUid, 'totp');

      expect(redisConnection.del).toHaveBeenCalledWith(`mfa_attempts:${testUid}:totp`);
      expect(logger.info).toHaveBeenCalledWith('MFA 嘗試次數重置', {
        uid: testUid,
        type: 'totp',
      });
    });

    it('應該處理 Redis 錯誤', async () => {
      const error = new Error('Redis 錯誤');
      redisConnection.del.mockRejectedValue(error);

      await mfaService.resetAttemptCounter(testUid, 'totp');

      expect(logger.error).toHaveBeenCalledWith('重置嘗試次數失敗', {
        uid: testUid,
        type: 'totp',
        error: error.message,
      });
    });
  });

  describe('generateSecureCode', () => {
    it('應該生成指定長度的數字代碼', () => {
      const code = mfaService.generateSecureCode(6);

      expect(code).toHaveLength(6);
      expect(/^\d{6}$/.test(code)).toBe(true);
    });

    it('應該生成不同的代碼', () => {
      const code1 = mfaService.generateSecureCode(6);
      const code2 = mfaService.generateSecureCode(6);

      expect(code1).not.toBe(code2);
    });

    it('應該使用預設長度 6', () => {
      const code = mfaService.generateSecureCode();

      expect(code).toHaveLength(6);
    });
  });

  describe('generateSecureAlphanumericCode', () => {
    it('應該生成指定長度的字母數字代碼', () => {
      const code = mfaService.generateSecureAlphanumericCode(8);

      expect(code).toHaveLength(8);
      expect(/^[0-9A-Z]{8}$/.test(code)).toBe(true);
    });

    it('應該生成不同的代碼', () => {
      const code1 = mfaService.generateSecureAlphanumericCode(8);
      const code2 = mfaService.generateSecureAlphanumericCode(8);

      expect(code1).not.toBe(code2);
    });

    it('應該使用預設長度 8', () => {
      const code = mfaService.generateSecureAlphanumericCode();

      expect(code).toHaveLength(8);
    });
  });

  describe('getDateString', () => {
    it('應該返回正確的日期字符串格式', () => {
      // Mock Date
      const mockDate = new Date('2024-01-15T10:30:00.000Z');
      jest.spyOn(global, 'Date').mockImplementation(() => mockDate);

      const dateString = mfaService.getDateString();

      expect(dateString).toBe('2024-01-15');

      // 恢復 Date
      global.Date.mockRestore();
    });
  });

  describe('checkRedisConnection', () => {
    it('應該返回 true 當 Redis 連接正常時', async () => {
      redisConnection.ping.mockResolvedValue('PONG');

      const result = await mfaService.checkRedisConnection();

      expect(result).toBe(true);
    });

    it('應該返回 false 當 Redis 連接失敗時', async () => {
      const error = new Error('Redis 連接失敗');
      redisConnection.ping.mockRejectedValue(error);

      const result = await mfaService.checkRedisConnection();

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('Redis 連接檢查失敗', {
        error: error.message,
      });
    });
  });

  describe('getBackupCodesRemaining', () => {
    it('應該返回 0 當沒有備用碼時', async () => {
      redisConnection.get.mockResolvedValue(null);

      const result = await mfaService.getBackupCodesRemaining(testUid);

      expect(result).toBe(0);
    });

    it('應該返回剩餘備用碼數量', async () => {
      const mockBackupCodes = {
        codes: [
          { code: 'ABC123', used: false },
          { code: 'DEF456', used: true },
          { code: 'GHI789', used: false },
        ],
      };
      redisConnection.get.mockResolvedValue(JSON.stringify(mockBackupCodes));

      const result = await mfaService.getBackupCodesRemaining(testUid);

      expect(result).toBe(2);
    });

    it('應該處理 Redis 錯誤並返回 0', async () => {
      const error = new Error('Redis 錯誤');
      redisConnection.get.mockRejectedValue(error);

      const result = await mfaService.getBackupCodesRemaining(testUid);

      expect(result).toBe(0);
      expect(logger.error).toHaveBeenCalledWith('獲取備用碼剩餘數量失敗', {
        uid: testUid,
        error: error.message,
      });
    });
  });

  describe('verifyMFACode', () => {
    beforeEach(() => {
      mfaService.isAttemptLimitExceeded = jest.fn().mockResolvedValue(false);
      mfaService.incrementAttemptCounter = jest
        .fn()
        .mockResolvedValue({ currentAttempts: 1, dailyAttempts: 1 });
      mfaService.resetAttemptCounter = jest.fn().mockResolvedValue();
    });

    it('應該返回錯誤當嘗試次數超限時', async () => {
      mfaService.isAttemptLimitExceeded.mockResolvedValue(true);

      const result = await mfaService.verifyMFACode(testUid, testCode, 'totp');

      expect(result).toEqual({
        success: false,
        result: 'too_many_attempts',
        message: '嘗試次數過多，請稍後再試',
      });
    });

    it('應該調用對應的驗證方法 - TOTP', async () => {
      mfaService.verifyTOTPCode = jest.fn().mockResolvedValue({
        success: true,
        result: 'success',
        message: '驗證成功',
      });

      const result = await mfaService.verifyMFACode(testUid, testCode, 'totp');

      expect(mfaService.verifyTOTPCode).toHaveBeenCalledWith(testUid, testCode);
      expect(mfaService.resetAttemptCounter).toHaveBeenCalledWith(testUid, 'totp');
      expect(result.success).toBe(true);
    });

    it('應該調用對應的驗證方法 - SMS', async () => {
      mfaService.verifySMSCode = jest.fn().mockResolvedValue({
        success: true,
        result: 'success',
        message: '驗證成功',
      });

      const result = await mfaService.verifyMFACode(testUid, testCode, 'sms');

      expect(mfaService.verifySMSCode).toHaveBeenCalledWith(testUid, testCode);
      expect(result.success).toBe(true);
    });

    it('應該調用對應的驗證方法 - 備用碼', async () => {
      mfaService.verifyBackupCode = jest.fn().mockResolvedValue({
        success: true,
        result: 'success',
        message: '驗證成功',
      });

      const result = await mfaService.verifyMFACode(testUid, testCode, 'backup_code');

      expect(mfaService.verifyBackupCode).toHaveBeenCalledWith(testUid, testCode);
      expect(result.success).toBe(true);
    });

    it('應該處理不支援的 MFA 類型', async () => {
      const result = await mfaService.verifyMFACode(testUid, testCode, 'invalid_type');

      expect(result).toEqual({
        success: false,
        result: 'invalid_code',
        message: '驗證失敗，請重試',
      });
    });

    it('應該處理驗證失敗的情況', async () => {
      mfaService.verifyTOTPCode = jest.fn().mockResolvedValue({
        success: false,
        result: 'invalid_code',
        message: '驗證碼錯誤',
      });

      const result = await mfaService.verifyMFACode(testUid, testCode, 'totp');

      expect(mfaService.resetAttemptCounter).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
    });
  });

  describe('cleanupExpiredMFAData', () => {
    it('應該清理過期的 MFA 資料', async () => {
      const mockKeys = ['mfa:user1:data', 'mfa:user2:data'];
      redisConnection.keys.mockResolvedValue(mockKeys);
      redisConnection.ttl.mockResolvedValue(-1);
      redisConnection.get.mockResolvedValue(
        JSON.stringify({
          createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25 小時前
        })
      );
      redisConnection.del.mockResolvedValue(1);

      const result = await mfaService.cleanupExpiredMFAData();

      expect(result).toBe(2);
      expect(redisConnection.del).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalledWith('MFA 過期資料清理完成', {
        uid: 'all',
        cleanedCount: 2,
      });
    });

    it('應該處理特定用戶的清理', async () => {
      const mockKeys = [`mfa:${testUid}:data`];
      redisConnection.keys.mockResolvedValue(mockKeys);
      redisConnection.ttl.mockResolvedValue(-1);
      redisConnection.get.mockResolvedValue(
        JSON.stringify({
          createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        })
      );
      redisConnection.del.mockResolvedValue(1);

      const result = await mfaService.cleanupExpiredMFAData(testUid);

      expect(result).toBe(1);
      expect(redisConnection.keys).toHaveBeenCalledWith(`mfa:${testUid}:*`);
    });

    it('應該處理清理錯誤', async () => {
      const error = new Error('Redis 錯誤');
      redisConnection.keys.mockRejectedValue(error);

      await expect(mfaService.cleanupExpiredMFAData()).rejects.toThrow('清理 MFA 過期資料失敗');
      expect(logger.error).toHaveBeenCalledWith('清理 MFA 過期資料失敗', {
        uid: null,
        error: error.message,
      });
    });
  });

  describe('verifyTOTPCode', () => {
    beforeEach(() => {
      mfaService.getTOTPSecret = jest.fn();
    });

    it('應該返回錯誤當 TOTP 未設置時', async () => {
      mfaService.getTOTPSecret.mockResolvedValue(null);

      const result = await mfaService.verifyTOTPCode(testUid, testCode);

      expect(result).toEqual({
        success: false,
        result: 'invalid_code',
        message: 'TOTP 未設置',
      });
    });

    it('應該驗證成功當代碼正確時', async () => {
      const mockSecret = 'MOCK_SECRET';
      mfaService.getTOTPSecret.mockResolvedValue(mockSecret);
      authenticator.verify.mockReturnValue(true);

      const result = await mfaService.verifyTOTPCode(testUid, testCode);

      expect(authenticator.verify).toHaveBeenCalledWith({
        token: testCode,
        secret: mockSecret,
      });
      expect(result).toEqual({
        success: true,
        result: 'success',
        message: 'TOTP 驗證成功',
      });
    });

    it('應該驗證失敗當代碼錯誤時', async () => {
      const mockSecret = 'MOCK_SECRET';
      mfaService.getTOTPSecret.mockResolvedValue(mockSecret);
      authenticator.verify.mockReturnValue(false);

      const result = await mfaService.verifyTOTPCode(testUid, testCode);

      expect(result).toEqual({
        success: false,
        result: 'invalid_code',
        message: 'TOTP 驗證碼無效',
      });
    });

    it('應該處理驗證過程中的錯誤', async () => {
      mfaService.getTOTPSecret.mockRejectedValue(new Error('Redis 錯誤'));

      const result = await mfaService.verifyTOTPCode(testUid, testCode);

      expect(result).toEqual({
        success: false,
        result: 'invalid_code',
        message: 'TOTP 驗證失敗',
      });
    });
  });

  describe('SMS 驗證功能', () => {
    const mockPhone = '+886912345678';
    const mockCode = '123456';
    const mockMessageId = 'sim_123456789_abc123';

    describe('generateSMSCode', () => {
      it('應該生成指定長度的 SMS 驗證碼', () => {
        const result = mfaService.generateSMSCode();

        expect(result).toMatch(/^\d{6}$/);
        expect(result.length).toBe(6);
      });
    });

    describe('simulateSMSService', () => {
      it('應該模擬成功發送 SMS', async () => {
        // 臨時禁用隨機失敗，確保測試可預測
        jest.spyOn(Math, 'random').mockReturnValue(0.5); // 大於 0.1，不會失敗

        const result = await mfaService.simulateSMSService(mockPhone, mockCode);

        expect(result.success).toBe(true);
        expect(result.messageId).toBeDefined();
        expect(result.message).toBe('驗證碼發送成功');

        Math.random.mockRestore();
      });

      it('應該記錄 SMS 發送日誌', async () => {
        await mfaService.simulateSMSService(mockPhone, mockCode);

        expect(logger.info).toHaveBeenCalledWith('SMS 驗證碼模擬發送', {
          phone: mockPhone,
          code: '***',
          timestamp: expect.any(String),
        });
      });
    });

    describe('checkSMSResendInterval', () => {
      it('應該允許重送當沒有記錄時', async () => {
        redisConnection.get.mockResolvedValue(null);

        const result = await mfaService.checkSMSResendInterval(testUid);

        expect(result).toEqual({
          canResend: true,
          remainingTime: 0,
        });
      });

      it('應該計算剩餘重送時間', async () => {
        const currentTime = Date.now();
        const lastSentTime = currentTime - 30000; // 30 秒前
        redisConnection.get.mockResolvedValue(lastSentTime.toString());

        const result = await mfaService.checkSMSResendInterval(testUid);

        expect(result.canResend).toBe(false);
        expect(result.remainingTime).toBe(30);
      });

      it('應該允許重送當時間間隔已過', async () => {
        const currentTime = Date.now();
        const lastSentTime = currentTime - 70000; // 70 秒前
        redisConnection.get.mockResolvedValue(lastSentTime.toString());

        const result = await mfaService.checkSMSResendInterval(testUid);

        expect(result.canResend).toBe(true);
        expect(result.remainingTime).toBe(0);
      });
    });

    describe('sendSMSCode', () => {
      beforeEach(() => {
        jest.spyOn(mfaService, 'simulateSMSService').mockResolvedValue({
          success: true,
          messageId: mockMessageId,
          message: '驗證碼發送成功',
        });
        jest.spyOn(mfaService, 'checkSMSResendInterval').mockResolvedValue({
          canResend: true,
          remainingTime: 0,
        });
      });

      it('應該成功發送 SMS 驗證碼', async () => {
        redisConnection.get.mockResolvedValue(null); // 沒有每日限制
        redisConnection.set.mockResolvedValue('OK');
        redisConnection.incr.mockResolvedValue(1);
        redisConnection.expire.mockResolvedValue(1);

        const result = await mfaService.sendSMSCode(testUid, mockPhone);

        expect(result.success).toBe(true);
        expect(result.message).toBe('驗證碼已發送');
        expect(result.messageId).toBe(mockMessageId);
      });

      it('應該驗證手機號碼格式', async () => {
        const invalidPhone = '123';

        const result = await mfaService.sendSMSCode(testUid, invalidPhone);

        expect(result.success).toBe(false);
        expect(result.message).toBe('手機號碼格式不正確');
      });

      it('應該檢查每日發送限制', async () => {
        redisConnection.get.mockResolvedValue('10'); // 已達上限

        const result = await mfaService.sendSMSCode(testUid, mockPhone);

        expect(result.success).toBe(false);
        expect(result.message).toBe('今日發送次數已達上限');
      });

      it('應該檢查重送間隔', async () => {
        redisConnection.get.mockResolvedValue(null); // 確保沒有每日限制
        jest.spyOn(mfaService, 'checkSMSResendInterval').mockResolvedValue({
          canResend: false,
          remainingTime: 30,
        });

        const result = await mfaService.sendSMSCode(testUid, mockPhone, true);

        expect(result.success).toBe(false);
        expect(result.message).toBe('請等待 30 秒後再重送');
      });

      it('應該處理 SMS 發送失敗', async () => {
        jest.spyOn(mfaService, 'simulateSMSService').mockResolvedValue({
          success: false,
          message: 'SMS 服務不可用',
        });
        redisConnection.get.mockResolvedValue(null);
        redisConnection.set.mockResolvedValue('OK');
        redisConnection.del.mockResolvedValue(1);

        const result = await mfaService.sendSMSCode(testUid, mockPhone);

        expect(result.success).toBe(false);
        expect(result.message).toBe('SMS 服務不可用');
        expect(redisConnection.del).toHaveBeenCalled();
      });
    });

    describe('verifySMSCode', () => {
      const mockCodeData = {
        code: mockCode,
        phone: mockPhone,
        createdAt: Date.now(),
        expiresAt: Date.now() + 300000, // 5 分鐘後過期
        attempts: 0,
      };

      beforeEach(() => {
        jest.spyOn(mfaService, 'isAttemptLimitExceeded').mockResolvedValue(false);
        jest
          .spyOn(mfaService, 'incrementAttemptCounter')
          .mockResolvedValue({ currentAttempts: 1, dailyAttempts: 1 });
        jest.spyOn(mfaService, 'resetAttemptCounter').mockResolvedValue();
      });

      it('應該成功驗證正確的 SMS 驗證碼', async () => {
        redisConnection.get.mockResolvedValue(JSON.stringify(mockCodeData));
        redisConnection.del.mockResolvedValue(1);

        const result = await mfaService.verifySMSCode(testUid, mockCode);

        expect(result.success).toBe(true);
        expect(result.result).toBe('success');
        expect(result.message).toBe('驗證成功');
      });

      it('應該拒絕錯誤的驗證碼', async () => {
        redisConnection.get.mockResolvedValue(JSON.stringify(mockCodeData));
        redisConnection.set.mockResolvedValue('OK');

        const result = await mfaService.verifySMSCode(testUid, '999999');

        expect(result.success).toBe(false);
        expect(result.result).toBe('invalid_code');
        expect(result.message).toBe('驗證碼不正確');
      });

      it('應該拒絕已過期的驗證碼', async () => {
        const expiredCodeData = {
          ...mockCodeData,
          expiresAt: Date.now() - 1000, // 1 秒前過期
        };
        redisConnection.get.mockResolvedValue(JSON.stringify(expiredCodeData));
        redisConnection.del.mockResolvedValue(1);

        const result = await mfaService.verifySMSCode(testUid, mockCode);

        expect(result.success).toBe(false);
        expect(result.result).toBe('expired');
        expect(result.message).toBe('驗證碼已過期');
      });

      it('應該拒絕嘗試次數過多的驗證碼', async () => {
        const exceededCodeData = {
          ...mockCodeData,
          attempts: 3,
        };
        redisConnection.get.mockResolvedValue(JSON.stringify(exceededCodeData));
        redisConnection.del.mockResolvedValue(1);

        const result = await mfaService.verifySMSCode(testUid, mockCode);

        expect(result.success).toBe(false);
        expect(result.result).toBe('too_many_attempts');
        expect(result.message).toBe('此驗證碼嘗試次數已達上限');
      });

      it('應該拒絕當達到嘗試次數限制時', async () => {
        jest.spyOn(mfaService, 'isAttemptLimitExceeded').mockResolvedValue(true);

        const result = await mfaService.verifySMSCode(testUid, mockCode);

        expect(result.success).toBe(false);
        expect(result.result).toBe('too_many_attempts');
        expect(result.message).toBe('嘗試次數過多，請稍後再試');
      });

      it('應該拒絕當驗證碼不存在時', async () => {
        redisConnection.get.mockResolvedValue(null);

        const result = await mfaService.verifySMSCode(testUid, mockCode);

        expect(result.success).toBe(false);
        expect(result.result).toBe('expired');
        expect(result.message).toBe('驗證碼已過期或不存在');
      });

      it('應該驗證輸入參數', async () => {
        const result = await mfaService.verifySMSCode('', '');

        expect(result.success).toBe(false);
        expect(result.result).toBe('invalid_code');
        expect(result.message).toBe('用戶 ID 和驗證碼不能為空');
      });
    });

    describe('setupSMS', () => {
      beforeEach(() => {
        jest.spyOn(mfaService, 'getUserMFAStatus').mockResolvedValue({
          status: 'disabled',
          enabledMethods: [],
          pendingMethods: [],
        });
        jest.spyOn(mfaService, 'sendSMSCode').mockResolvedValue({
          success: true,
          message: '驗證碼已發送',
          expiresIn: 300,
        });
        jest.spyOn(mfaService, 'setUserMFAStatus').mockResolvedValue();
      });

      it('應該成功設置 SMS 驗證', async () => {
        const result = await mfaService.setupSMS(testUid, mockPhone);

        expect(result.success).toBe(true);
        expect(result.message).toBe('驗證碼已發送，請輸入驗證碼以完成設置');
      });

      it('應該拒絕重複設置已啟用的 SMS', async () => {
        jest.spyOn(mfaService, 'getUserMFAStatus').mockResolvedValue({
          status: 'enabled',
          enabledMethods: ['sms'],
          pendingMethods: [],
        });

        const result = await mfaService.setupSMS(testUid, mockPhone);

        expect(result.success).toBe(false);
        expect(result.message).toBe('SMS 驗證已經設置並啟用');
      });

      it('應該處理發送 SMS 失敗的情況', async () => {
        jest.spyOn(mfaService, 'sendSMSCode').mockResolvedValue({
          success: false,
          message: 'SMS 服務不可用',
        });

        const result = await mfaService.setupSMS(testUid, mockPhone);

        expect(result.success).toBe(false);
        expect(result.message).toBe('SMS 服務不可用');
      });
    });

    describe('enableSMS', () => {
      beforeEach(() => {
        jest.spyOn(mfaService, 'verifySMSCode').mockResolvedValue({
          success: true,
          result: 'success',
          message: '驗證成功',
        });
        jest.spyOn(mfaService, 'getUserMFAStatus').mockResolvedValue({
          status: 'pending',
          enabledMethods: [],
          pendingMethods: ['sms'],
        });
        jest.spyOn(mfaService, 'setUserMFAStatus').mockResolvedValue();
      });

      it('應該成功啟用 SMS 驗證', async () => {
        const result = await mfaService.enableSMS(testUid, mockCode);

        expect(result.success).toBe(true);
        expect(result.message).toBe('SMS 驗證已成功啟用');
        expect(result.enabledMethods).toContain('sms');
      });

      it('應該拒絕啟用當驗證碼無效時', async () => {
        jest.spyOn(mfaService, 'verifySMSCode').mockResolvedValue({
          success: false,
          result: 'invalid_code',
          message: '驗證碼不正確',
        });

        const result = await mfaService.enableSMS(testUid, mockCode);

        expect(result.success).toBe(false);
        expect(result.result).toBe('invalid_code');
        expect(result.message).toBe('驗證碼不正確');
      });
    });

    describe('disableSMS', () => {
      beforeEach(() => {
        jest.spyOn(mfaService, 'getUserMFAStatus').mockResolvedValue({
          status: 'enabled',
          enabledMethods: ['sms', 'totp'],
          pendingMethods: [],
        });
        jest.spyOn(mfaService, 'setUserMFAStatus').mockResolvedValue();
        redisConnection.del.mockResolvedValue(1);
      });

      it('應該成功禁用 SMS 驗證', async () => {
        const result = await mfaService.disableSMS(testUid);

        expect(result.success).toBe(true);
        expect(result.message).toBe('SMS 驗證已禁用');
        expect(result.enabledMethods).not.toContain('sms');
        expect(result.enabledMethods).toContain('totp');
      });

      it('應該將整體狀態設為 disabled 當沒有其他方法時', async () => {
        jest.spyOn(mfaService, 'getUserMFAStatus').mockResolvedValue({
          status: 'enabled',
          enabledMethods: ['sms'],
          pendingMethods: [],
        });

        const result = await mfaService.disableSMS(testUid);

        expect(result.success).toBe(true);
        expect(result.enabledMethods).toHaveLength(0);
      });

      it('應該清除 SMS 驗證碼', async () => {
        await mfaService.disableSMS(testUid);

        expect(redisConnection.del).toHaveBeenCalledWith(`sms_code:${testUid}`);
      });
    });

    describe('isSMSEnabled', () => {
      it('應該返回 true 當 SMS 已啟用時', async () => {
        jest.spyOn(mfaService, 'getUserMFAStatus').mockResolvedValue({
          status: 'enabled',
          enabledMethods: ['sms'],
          pendingMethods: [],
        });

        const result = await mfaService.isSMSEnabled(testUid);

        expect(result).toBe(true);
      });

      it('應該返回 false 當 SMS 未啟用時', async () => {
        jest.spyOn(mfaService, 'getUserMFAStatus').mockResolvedValue({
          status: 'disabled',
          enabledMethods: [],
          pendingMethods: [],
        });

        const result = await mfaService.isSMSEnabled(testUid);

        expect(result).toBe(false);
      });

      it('應該處理錯誤並返回 false', async () => {
        jest.spyOn(mfaService, 'getUserMFAStatus').mockRejectedValue(new Error('獲取狀態失敗'));

        const result = await mfaService.isSMSEnabled(testUid);

        expect(result).toBe(false);
      });
    });
  });

  describe('TOTP 管理功能', () => {
    const mockSecret = 'JBSWY3DPEHPK3PXP';
    const mockEmail = 'test@example.com';
    const mockQRCode = 'data:image/png;base64,mock-qr-code';

    describe('generateTOTPSecret', () => {
      it('應該生成 TOTP 秘鑰', () => {
        authenticator.generateSecret.mockReturnValue(mockSecret);

        const result = mfaService.generateTOTPSecret();

        expect(result).toBe(mockSecret);
        expect(authenticator.generateSecret).toHaveBeenCalled();
      });

      it('應該處理生成錯誤', () => {
        authenticator.generateSecret.mockImplementation(() => {
          throw new Error('生成失敗');
        });

        expect(() => mfaService.generateTOTPSecret()).toThrow('生成 TOTP 秘鑰失敗');
      });
    });

    describe('getTOTPSecret', () => {
      it('應該返回用戶的 TOTP 秘鑰', async () => {
        const mockData = {
          secret: mockSecret,
          enabled: true,
        };
        redisConnection.get.mockResolvedValue(JSON.stringify(mockData));

        const result = await mfaService.getTOTPSecret(testUid);

        expect(result).toBe(mockSecret);
        expect(redisConnection.get).toHaveBeenCalledWith(`totp_secret:${testUid}`);
      });

      it('應該返回 null 當沒有秘鑰時', async () => {
        redisConnection.get.mockResolvedValue(null);

        const result = await mfaService.getTOTPSecret(testUid);

        expect(result).toBeNull();
      });

      it('應該處理 Redis 錯誤', async () => {
        redisConnection.get.mockRejectedValue(new Error('Redis 錯誤'));

        const result = await mfaService.getTOTPSecret(testUid);

        expect(result).toBeNull();
      });
    });

    describe('storeTOTPSecret', () => {
      it('應該存儲 TOTP 秘鑰', async () => {
        redisConnection.set.mockResolvedValue('OK');

        const result = await mfaService.storeTOTPSecret(testUid, mockSecret);

        expect(result).toBe(true);
        expect(redisConnection.set).toHaveBeenCalledWith(
          `totp_secret:${testUid}`,
          expect.stringContaining(mockSecret)
        );
      });

      it('應該處理存儲錯誤', async () => {
        redisConnection.set.mockRejectedValue(new Error('Redis 錯誤'));

        const result = await mfaService.storeTOTPSecret(testUid, mockSecret);

        expect(result).toBe(false);
      });
    });

    describe('generateTOTPQRCode', () => {
      it('應該生成 QR 碼', async () => {
        const mockOtpauth = 'otpauth://totp/test';
        authenticator.keyuri.mockReturnValue(mockOtpauth);
        QRCode.toDataURL.mockResolvedValue(mockQRCode);

        const result = await mfaService.generateTOTPQRCode(testUid, mockEmail, mockSecret);

        expect(result).toBe(mockQRCode);
        expect(authenticator.keyuri).toHaveBeenCalledWith(mockEmail, 'Localite', mockSecret);
        expect(QRCode.toDataURL).toHaveBeenCalledWith(mockOtpauth, expect.any(Object));
      });

      it('應該處理 QR 碼生成錯誤', async () => {
        QRCode.toDataURL.mockRejectedValue(new Error('QR 碼生成失敗'));

        await expect(mfaService.generateTOTPQRCode(testUid, mockEmail, mockSecret)).rejects.toThrow(
          '生成 QR 碼失敗'
        );
      });
    });

    describe('setupTOTP', () => {
      beforeEach(() => {
        mfaService.getTOTPSecret = jest.fn();
        mfaService.generateTOTPSecret = jest.fn();
        mfaService.storeTOTPSecret = jest.fn();
        mfaService.generateTOTPQRCode = jest.fn();
        mfaService.getUserMFAStatus = jest.fn();
        mfaService.setUserMFAStatus = jest.fn();
      });

      it('應該設置新的 TOTP', async () => {
        mfaService.getTOTPSecret.mockResolvedValue(null);
        mfaService.generateTOTPSecret.mockReturnValue(mockSecret);
        mfaService.storeTOTPSecret.mockResolvedValue(true);
        mfaService.generateTOTPQRCode.mockResolvedValue(mockQRCode);
        mfaService.getUserMFAStatus.mockResolvedValue({
          status: 'disabled',
          enabledMethods: [],
          pendingMethods: [],
        });

        const result = await mfaService.setupTOTP(testUid, mockEmail);

        expect(result.success).toBe(true);
        expect(result.secret).toBe(mockSecret);
        expect(result.qrCode).toBe(mockQRCode);
      });

      it('應該拒絕重複設置已啟用的 TOTP', async () => {
        const mockData = { enabled: true };
        mfaService.getTOTPSecret.mockResolvedValue(mockSecret);
        redisConnection.get.mockResolvedValue(JSON.stringify(mockData));

        const result = await mfaService.setupTOTP(testUid, mockEmail);

        expect(result).toEqual({
          success: false,
          message: 'TOTP 已經設置並啟用',
        });
      });
    });

    describe('enableTOTP', () => {
      beforeEach(() => {
        mfaService.verifyTOTPCode = jest.fn();
        mfaService.getUserMFAStatus = jest.fn();
        mfaService.setUserMFAStatus = jest.fn();
      });

      it('應該啟用 TOTP 當驗證成功時', async () => {
        const mockData = { secret: mockSecret, enabled: false };
        redisConnection.get.mockResolvedValue(JSON.stringify(mockData));
        redisConnection.set.mockResolvedValue('OK');
        mfaService.verifyTOTPCode.mockResolvedValue({ success: true });
        mfaService.getUserMFAStatus.mockResolvedValue({
          status: 'pending',
          enabledMethods: [],
          pendingMethods: ['totp'],
        });

        const result = await mfaService.enableTOTP(testUid, testCode);

        expect(result).toEqual({
          success: true,
          message: 'TOTP 啟用成功',
        });
      });

      it('應該拒絕啟用當 TOTP 未設置時', async () => {
        redisConnection.get.mockResolvedValue(null);

        const result = await mfaService.enableTOTP(testUid, testCode);

        expect(result).toEqual({
          success: false,
          message: 'TOTP 尚未設置',
        });
      });

      it('應該拒絕啟用當驗證碼無效時', async () => {
        const mockData = { secret: mockSecret, enabled: false };
        redisConnection.get.mockResolvedValue(JSON.stringify(mockData));
        mfaService.verifyTOTPCode.mockResolvedValue({ success: false });

        const result = await mfaService.enableTOTP(testUid, testCode);

        expect(result).toEqual({
          success: false,
          message: 'TOTP 驗證碼無效，無法啟用',
        });
      });
    });

    describe('disableTOTP', () => {
      beforeEach(() => {
        mfaService.getUserMFAStatus = jest.fn();
        mfaService.setUserMFAStatus = jest.fn();
      });

      it('應該禁用 TOTP', async () => {
        redisConnection.del.mockResolvedValue(1);
        mfaService.getUserMFAStatus.mockResolvedValue({
          status: 'enabled',
          enabledMethods: ['totp'],
          pendingMethods: [],
        });

        const result = await mfaService.disableTOTP(testUid);

        expect(result).toEqual({
          success: true,
          message: 'TOTP 禁用成功',
        });
        expect(redisConnection.del).toHaveBeenCalledWith(`totp_secret:${testUid}`);
      });

      it('應該處理禁用錯誤', async () => {
        redisConnection.del.mockRejectedValue(new Error('Redis 錯誤'));

        const result = await mfaService.disableTOTP(testUid);

        expect(result).toEqual({
          success: false,
          message: 'TOTP 禁用失敗',
        });
      });
    });

    describe('isTOTPEnabled', () => {
      it('應該返回 true 當 TOTP 已啟用時', async () => {
        const mockData = { secret: mockSecret, enabled: true };
        redisConnection.get.mockResolvedValue(JSON.stringify(mockData));

        const result = await mfaService.isTOTPEnabled(testUid);

        expect(result).toBe(true);
      });

      it('應該返回 false 當 TOTP 未啟用時', async () => {
        const mockData = { secret: mockSecret, enabled: false };
        redisConnection.get.mockResolvedValue(JSON.stringify(mockData));

        const result = await mfaService.isTOTPEnabled(testUid);

        expect(result).toBe(false);
      });

      it('應該返回 false 當沒有 TOTP 資料時', async () => {
        redisConnection.get.mockResolvedValue(null);

        const result = await mfaService.isTOTPEnabled(testUid);

        expect(result).toBe(false);
      });
    });
  });

  describe('備用碼驗證功能', () => {
    it('verifyBackupCode 應該驗證備用碼', async () => {
      const testBackupCode = 'ABC12345';
      const mockBackupCodes = {
        codes: [
          { code: testBackupCode, used: false, usedAt: null },
          { code: 'XYZ67890', used: true, usedAt: '2024-01-01T00:00:00.000Z' },
        ],
        createdAt: '2024-01-01T00:00:00.000Z',
        lastUsedAt: null,
        enabled: true,
      };

      redisConnection.get.mockResolvedValue(JSON.stringify(mockBackupCodes));
      redisConnection.set.mockResolvedValue('OK');

      const result = await mfaService.verifyBackupCode(testUid, testBackupCode);

      expect(result).toEqual({
        success: true,
        result: 'success',
        message: '備用碼驗證成功',
        remainingCodes: 0,
      });
      expect(redisConnection.set).toHaveBeenCalled();
    });

    it('verifyBackupCode 應該拒絕已使用的備用碼', async () => {
      const testBackupCode = 'USED1234';
      const mockBackupCodes = {
        codes: [{ code: testBackupCode, used: true, usedAt: '2024-01-01T00:00:00.000Z' }],
        createdAt: '2024-01-01T00:00:00.000Z',
        lastUsedAt: null,
        enabled: true,
      };

      redisConnection.get.mockResolvedValue(JSON.stringify(mockBackupCodes));

      const result = await mfaService.verifyBackupCode(testUid, testBackupCode);

      expect(result).toEqual({
        success: false,
        result: 'invalid_code',
        message: '備用碼無效或已使用',
      });
    });

    it('verifyBackupCode 應該處理不存在的備用碼', async () => {
      redisConnection.get.mockResolvedValue(null);

      const result = await mfaService.verifyBackupCode(testUid, 'NONEXIST');

      expect(result).toEqual({
        success: false,
        result: 'invalid_code',
        message: '備用碼不存在或已過期',
      });
    });
  });

  describe('備用碼管理功能', () => {
    const mockBackupCodes = ['ABC12345', 'XYZ67890', 'DEF13579'];

    beforeEach(() => {
      jest.spyOn(mfaService, 'generateSecureAlphanumericCode').mockReturnValue('MOCK1234');
      jest.spyOn(mfaService, 'getUserMFAStatus').mockResolvedValue({
        status: 'disabled',
        enabledMethods: [],
        pendingMethods: [],
      });
      jest.spyOn(mfaService, 'setUserMFAStatus').mockResolvedValue();
    });

    describe('generateBackupCodes', () => {
      it('應該生成指定數量的備用碼', () => {
        const codes = mfaService.generateBackupCodes();

        expect(codes).toHaveLength(mfaService.backupCodeConfig.totalCodes);
        expect(codes.every(code => typeof code === 'string')).toBe(true);
      });

      it('應該處理生成錯誤', () => {
        jest.spyOn(mfaService, 'generateSecureAlphanumericCode').mockImplementation(() => {
          throw new Error('生成失敗');
        });

        expect(() => mfaService.generateBackupCodes()).toThrow('生成備用碼失敗');
      });
    });

    describe('storeBackupCodes', () => {
      it('應該存儲備用碼到 Redis', async () => {
        redisConnection.set.mockResolvedValue('OK');

        const result = await mfaService.storeBackupCodes(testUid, mockBackupCodes);

        expect(result).toBe(true);
        expect(redisConnection.set).toHaveBeenCalledWith(
          `backup_codes:${testUid}`,
          expect.stringContaining('ABC12345')
        );
      });

      it('應該處理存儲錯誤', async () => {
        redisConnection.set.mockRejectedValue(new Error('Redis 錯誤'));

        const result = await mfaService.storeBackupCodes(testUid, mockBackupCodes);

        expect(result).toBe(false);
      });
    });

    describe('setupBackupCodes', () => {
      beforeEach(() => {
        jest.spyOn(mfaService, 'generateBackupCodes').mockReturnValue(mockBackupCodes);
        jest.spyOn(mfaService, 'storeBackupCodes').mockResolvedValue(true);
        jest.spyOn(mfaService, 'getBackupCodes').mockResolvedValue({
          success: false,
          enabled: false,
        });
      });

      it('應該成功設置備用碼', async () => {
        const result = await mfaService.setupBackupCodes(testUid);

        expect(result).toEqual({
          success: true,
          message: '備用碼設置成功',
          codes: mockBackupCodes,
          warning: '請安全保存這些備用碼，它們只會顯示一次',
        });
      });

      it('應該拒絕重複設置已啟用的備用碼', async () => {
        jest.spyOn(mfaService, 'getBackupCodes').mockResolvedValue({
          success: true,
          enabled: true,
        });

        const result = await mfaService.setupBackupCodes(testUid);

        expect(result).toEqual({
          success: false,
          message: '備用碼已經設置並啟用',
        });
      });

      it('應該處理設置錯誤', async () => {
        jest.spyOn(mfaService, 'storeBackupCodes').mockResolvedValue(false);

        const result = await mfaService.setupBackupCodes(testUid);

        expect(result).toEqual({
          success: false,
          message: '設置備用碼失敗',
        });
      });
    });

    describe('regenerateBackupCodes', () => {
      beforeEach(() => {
        jest.spyOn(mfaService, 'generateBackupCodes').mockReturnValue(mockBackupCodes);
        jest.spyOn(mfaService, 'storeBackupCodes').mockResolvedValue(true);
        jest.spyOn(mfaService, 'enableBackupCodes').mockResolvedValue({ success: true });
      });

      it('應該重新生成備用碼', async () => {
        const result = await mfaService.regenerateBackupCodes(testUid);

        expect(result).toEqual({
          success: true,
          message: '備用碼重新生成成功',
          codes: mockBackupCodes,
          warning: '舊的備用碼已失效，請安全保存這些新的備用碼',
        });
      });

      it('應該自動啟用新備用碼當之前已啟用時', async () => {
        jest.spyOn(mfaService, 'getUserMFAStatus').mockResolvedValue({
          status: 'enabled',
          enabledMethods: ['backup_code'],
          pendingMethods: [],
        });

        await mfaService.regenerateBackupCodes(testUid);

        expect(mfaService.enableBackupCodes).toHaveBeenCalledWith(testUid);
      });

      it('應該處理重新生成錯誤', async () => {
        jest.spyOn(mfaService, 'storeBackupCodes').mockResolvedValue(false);

        const result = await mfaService.regenerateBackupCodes(testUid);

        expect(result).toEqual({
          success: false,
          message: '重新生成備用碼失敗',
        });
      });
    });

    describe('getBackupCodes', () => {
      const mockStoredCodes = {
        codes: [
          { code: 'ABC12345', used: false, usedAt: null },
          { code: 'XYZ67890', used: true, usedAt: '2024-01-01T00:00:00.000Z' },
        ],
        createdAt: '2024-01-01T00:00:00.000Z',
        lastUsedAt: null,
        enabled: true,
      };

      it('應該返回備用碼信息', async () => {
        redisConnection.get.mockResolvedValue(JSON.stringify(mockStoredCodes));

        const result = await mfaService.getBackupCodes(testUid);

        expect(result).toEqual({
          success: true,
          codes: [{ code: 'ABC12345', used: false, usedAt: null }],
          enabled: true,
          totalCodes: 2,
          usedCodes: 1,
          remainingCodes: 1,
          createdAt: '2024-01-01T00:00:00.000Z',
          lastUsedAt: null,
        });
      });

      it('應該包含已使用的備用碼當 includeUsed 為 true 時', async () => {
        redisConnection.get.mockResolvedValue(JSON.stringify(mockStoredCodes));

        const result = await mfaService.getBackupCodes(testUid, true);

        expect(result.codes).toHaveLength(2);
      });

      it('應該處理不存在的備用碼', async () => {
        redisConnection.get.mockResolvedValue(null);

        const result = await mfaService.getBackupCodes(testUid);

        expect(result).toEqual({
          success: false,
          message: '備用碼不存在',
          codes: [],
          enabled: false,
        });
      });
    });

    describe('enableBackupCodes', () => {
      const mockStoredCodes = {
        codes: [{ code: 'ABC12345', used: false, usedAt: null }],
        createdAt: '2024-01-01T00:00:00.000Z',
        lastUsedAt: null,
        enabled: false,
      };

      it('應該啟用備用碼', async () => {
        redisConnection.get.mockResolvedValue(JSON.stringify(mockStoredCodes));
        redisConnection.set.mockResolvedValue('OK');

        const result = await mfaService.enableBackupCodes(testUid);

        expect(result).toEqual({
          success: true,
          message: '備用碼已啟用',
          enabledMethods: ['backup_code'],
        });
      });

      it('應該處理備用碼不存在的情況', async () => {
        redisConnection.get.mockResolvedValue(null);

        const result = await mfaService.enableBackupCodes(testUid);

        expect(result).toEqual({
          success: false,
          message: '備用碼不存在，請先設置備用碼',
        });
      });
    });

    describe('disableBackupCodes', () => {
      it('應該禁用備用碼', async () => {
        jest.spyOn(mfaService, 'getUserMFAStatus').mockResolvedValue({
          status: 'enabled',
          enabledMethods: ['backup_code'],
          pendingMethods: [],
        });
        redisConnection.del.mockResolvedValue(1);

        const result = await mfaService.disableBackupCodes(testUid);

        expect(result).toEqual({
          success: true,
          message: '備用碼已禁用',
          enabledMethods: [],
        });
        expect(redisConnection.del).toHaveBeenCalledWith(`backup_codes:${testUid}`);
      });
    });

    describe('isBackupCodeEnabled', () => {
      it('應該返回 true 當備用碼已啟用時', async () => {
        jest.spyOn(mfaService, 'getUserMFAStatus').mockResolvedValue({
          status: 'enabled',
          enabledMethods: ['backup_code'],
          pendingMethods: [],
        });

        const result = await mfaService.isBackupCodeEnabled(testUid);

        expect(result).toBe(true);
      });

      it('應該返回 false 當備用碼未啟用時', async () => {
        jest.spyOn(mfaService, 'getUserMFAStatus').mockResolvedValue({
          status: 'disabled',
          enabledMethods: [],
          pendingMethods: [],
        });

        const result = await mfaService.isBackupCodeEnabled(testUid);

        expect(result).toBe(false);
      });
    });
  });
});
