const crypto = require('crypto');
const { redisConnection } = require('../config/redis');
const { logger } = require('../middleware/requestLogger');
const { authenticator, totp } = require('otplib');
const QRCode = require('qrcode');

/**
 * MFA (Multi-Factor Authentication) 服務
 * 提供多重驗證功能，包括 TOTP、SMS 驗證碼和備用碼系統
 */
class MFAService {
  constructor() {
    // MFA 配置
    this.totpConfig = {
      algorithm: 'sha1',
      digits: 6,
      step: 30, // 30 秒有效期
      window: 1, // 允許前後一個時間窗口
      issuer: process.env.MFA_ISSUER || 'Localite',
    };

    this.smsConfig = {
      codeLength: 6,
      expiry: 300, // 5 分鐘有效期
      resendInterval: 60, // 60 秒後可重新發送
      maxAttempts: 3, // 最多嘗試 3 次
      maxDailyAttempts: 10, // 每日最多 10 次
    };

    this.backupCodeConfig = {
      codeLength: 8,
      totalCodes: 10, // 生成 10 個備用碼
      usageLimit: 1, // 每個備用碼只能使用一次
    };

    // Redis 鍵前綴
    this.mfaPrefix = 'mfa:';
    this.totpSecretPrefix = 'totp_secret:';
    this.smsCodePrefix = 'sms_code:';
    this.backupCodesPrefix = 'backup_codes:';
    this.mfaStatusPrefix = 'mfa_status:';
    this.attemptCounterPrefix = 'mfa_attempts:';
    this.dailyAttemptCounterPrefix = 'mfa_daily_attempts:';
    this.resendCounterPrefix = 'mfa_resend:';

    // MFA 狀態常數
    this.MFA_STATUS = {
      DISABLED: 'disabled',
      PENDING: 'pending',
      ENABLED: 'enabled',
    };

    // MFA 類型常數
    this.MFA_TYPE = {
      TOTP: 'totp',
      SMS: 'sms',
      BACKUP_CODE: 'backup_code',
    };

    // 驗證結果常數
    this.VERIFICATION_RESULT = {
      SUCCESS: 'success',
      INVALID_CODE: 'invalid_code',
      EXPIRED: 'expired',
      TOO_MANY_ATTEMPTS: 'too_many_attempts',
      RATE_LIMITED: 'rate_limited',
    };

    logger.info('MFA 服務初始化完成', {
      totpConfig: this.totpConfig,
      smsConfig: this.smsConfig,
      backupCodeConfig: this.backupCodeConfig,
    });
  }

  /**
   * 獲取用戶 MFA 狀態
   * @param {string} uid - 用戶 ID
   * @returns {Promise<Object>} MFA 狀態信息
   */
  async getUserMFAStatus(uid) {
    try {
      const statusKey = `${this.mfaStatusPrefix}${uid}`;
      const status = await redisConnection.get(statusKey);

      if (!status) {
        return {
          status: this.MFA_STATUS.DISABLED,
          enabledMethods: [],
          pendingMethods: [],
          backupCodesRemaining: 0,
          lastUpdated: null,
        };
      }

      const mfaStatus = JSON.parse(status);

      // 檢查備用碼剩餘數量
      const backupCodesRemaining = await this.getBackupCodesRemaining(uid);

      return {
        ...mfaStatus,
        backupCodesRemaining,
      };
    } catch (error) {
      logger.error('獲取用戶 MFA 狀態失敗', {
        uid,
        error: error.message,
        stack: error.stack,
      });
      throw new Error('獲取 MFA 狀態失敗');
    }
  }

  /**
   * 設置用戶 MFA 狀態
   * @param {string} uid - 用戶 ID
   * @param {Object} statusData - MFA 狀態資料
   */
  async setUserMFAStatus(uid, statusData) {
    try {
      const statusKey = `${this.mfaStatusPrefix}${uid}`;
      const mfaStatus = {
        ...statusData,
        lastUpdated: new Date().toISOString(),
      };

      await redisConnection.set(statusKey, JSON.stringify(mfaStatus));

      logger.info('用戶 MFA 狀態更新成功', {
        uid,
        status: mfaStatus.status,
        enabledMethods: mfaStatus.enabledMethods,
      });
    } catch (error) {
      logger.error('設置用戶 MFA 狀態失敗', {
        uid,
        error: error.message,
        stack: error.stack,
      });
      throw new Error('設置 MFA 狀態失敗');
    }
  }

  /**
   * 檢查用戶是否啟用 MFA
   * @param {string} uid - 用戶 ID
   * @returns {Promise<boolean>} 是否啟用 MFA
   */
  async isMFAEnabled(uid) {
    try {
      const status = await this.getUserMFAStatus(uid);
      return status.status === this.MFA_STATUS.ENABLED && status.enabledMethods.length > 0;
    } catch (error) {
      logger.error('檢查 MFA 狀態失敗', { uid, error: error.message });
      return false;
    }
  }

  /**
   * 增加嘗試次數計數器
   * @param {string} uid - 用戶 ID
   * @param {string} type - MFA 類型
   * @returns {Promise<number>} 當前嘗試次數
   */
  async incrementAttemptCounter(uid, type) {
    try {
      const counterKey = `${this.attemptCounterPrefix}${uid}:${type}`;
      const dailyCounterKey = `${this.dailyAttemptCounterPrefix}${uid}:${type}:${this.getDateString()}`;

      // 增加當前嘗試次數（短期）
      const currentAttempts = await redisConnection.incr(counterKey);
      await redisConnection.expire(counterKey, 3600); // 1 小時過期

      // 增加每日嘗試次數
      const dailyAttempts = await redisConnection.incr(dailyCounterKey);
      await redisConnection.expire(dailyCounterKey, 86400); // 24 小時過期

      logger.info('MFA 嘗試次數增加', {
        uid,
        type,
        currentAttempts,
        dailyAttempts,
      });

      return {
        currentAttempts,
        dailyAttempts,
      };
    } catch (error) {
      logger.error('增加嘗試次數失敗', {
        uid,
        type,
        error: error.message,
      });
      throw new Error('增加嘗試次數失敗');
    }
  }

  /**
   * 檢查是否超過嘗試限制
   * @param {string} uid - 用戶 ID
   * @param {string} type - MFA 類型
   * @returns {Promise<boolean>} 是否超過限制
   */
  async isAttemptLimitExceeded(uid, type) {
    try {
      const counterKey = `${this.attemptCounterPrefix}${uid}:${type}`;
      const dailyCounterKey = `${this.dailyAttemptCounterPrefix}${uid}:${type}:${this.getDateString()}`;

      const currentAttempts = (await redisConnection.get(counterKey)) || 0;
      const dailyAttempts = (await redisConnection.get(dailyCounterKey)) || 0;

      const maxAttempts =
        type === this.MFA_TYPE.SMS ? this.smsConfig.maxAttempts : this.backupCodeConfig.usageLimit;

      const maxDailyAttempts = type === this.MFA_TYPE.SMS ? this.smsConfig.maxDailyAttempts : 20; // 其他類型的每日限制

      return (
        parseInt(currentAttempts) >= maxAttempts || parseInt(dailyAttempts) >= maxDailyAttempts
      );
    } catch (error) {
      logger.error('檢查嘗試限制失敗', {
        uid,
        type,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * 重置嘗試計數器
   * @param {string} uid - 用戶 ID
   * @param {string} type - MFA 類型
   */
  async resetAttemptCounter(uid, type) {
    try {
      const counterKey = `${this.attemptCounterPrefix}${uid}:${type}`;
      await redisConnection.del(counterKey);

      logger.info('MFA 嘗試次數重置', { uid, type });
    } catch (error) {
      logger.error('重置嘗試次數失敗', {
        uid,
        type,
        error: error.message,
      });
    }
  }

  /**
   * 生成安全隨機代碼
   * @param {number} length - 代碼長度
   * @returns {string} 隨機代碼
   */
  generateSecureCode(length = 6) {
    const charset = '0123456789';
    let code = '';

    for (let i = 0; i < length; i++) {
      const randomIndex = crypto.randomInt(0, charset.length);
      code += charset[randomIndex];
    }

    return code;
  }

  /**
   * 生成安全字母數字代碼
   * @param {number} length - 代碼長度
   * @returns {string} 隨機字母數字代碼
   */
  generateSecureAlphanumericCode(length = 8) {
    const charset = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';

    for (let i = 0; i < length; i++) {
      const randomIndex = crypto.randomInt(0, charset.length);
      code += charset[randomIndex];
    }

    return code;
  }

  /**
   * 獲取當前日期字符串 (YYYY-MM-DD)
   * @returns {string} 日期字符串
   */
  getDateString() {
    return new Date().toISOString().split('T')[0];
  }

  /**
   * 檢查 Redis 連接狀態
   * @returns {Promise<boolean>} 連接狀態
   */
  async checkRedisConnection() {
    try {
      await redisConnection.ping();
      return true;
    } catch (error) {
      logger.error('Redis 連接檢查失敗', { error: error.message });
      return false;
    }
  }

  /**
   * 清理過期的 MFA 資料
   * @param {string} uid - 用戶 ID (可選，如果不提供則清理所有過期資料)
   */
  async cleanupExpiredMFAData(uid = null) {
    try {
      const pattern = uid ? `${this.mfaPrefix}${uid}:*` : `${this.mfaPrefix}*`;
      const keys = await redisConnection.keys(pattern);

      let cleanedCount = 0;
      for (const key of keys) {
        const ttl = await redisConnection.ttl(key);
        if (ttl === -1) {
          // 沒有過期時間的鍵，檢查是否需要清理
          const data = await redisConnection.get(key);
          if (data) {
            try {
              const parsedData = JSON.parse(data);
              if (parsedData.createdAt) {
                const createdAt = new Date(parsedData.createdAt);
                const now = new Date();
                const hoursSinceCreation = (now - createdAt) / (1000 * 60 * 60);

                // 如果超過 24 小時，清理
                if (hoursSinceCreation > 24) {
                  await redisConnection.del(key);
                  cleanedCount++;
                }
              }
            } catch (parseError) {
              // 如果解析失敗，可能是舊資料格式，清理掉
              await redisConnection.del(key);
              cleanedCount++;
            }
          }
        }
      }

      logger.info('MFA 過期資料清理完成', {
        uid: uid || 'all',
        cleanedCount,
      });

      return cleanedCount;
    } catch (error) {
      logger.error('清理 MFA 過期資料失敗', {
        uid,
        error: error.message,
      });
      throw new Error('清理 MFA 過期資料失敗');
    }
  }

  /**
   * 獲取用戶備用碼剩餘數量
   * @param {string} uid - 用戶 ID
   * @returns {Promise<number>} 剩餘備用碼數量
   */
  async getBackupCodesRemaining(uid) {
    try {
      const backupCodesKey = `${this.backupCodesPrefix}${uid}`;
      const backupCodesData = await redisConnection.get(backupCodesKey);

      if (!backupCodesData) {
        return 0;
      }

      const backupCodes = JSON.parse(backupCodesData);
      return backupCodes.codes.filter(code => !code.used).length;
    } catch (error) {
      logger.error('獲取備用碼剩餘數量失敗', {
        uid,
        error: error.message,
      });
      return 0;
    }
  }

  /**
   * 驗證 MFA 代碼的通用方法
   * @param {string} uid - 用戶 ID
   * @param {string} code - 驗證碼
   * @param {string} type - MFA 類型
   * @returns {Promise<Object>} 驗證結果
   */
  async verifyMFACode(uid, code, type) {
    try {
      // 檢查嘗試限制
      const isLimited = await this.isAttemptLimitExceeded(uid, type);
      if (isLimited) {
        return {
          success: false,
          result: this.VERIFICATION_RESULT.TOO_MANY_ATTEMPTS,
          message: '嘗試次數過多，請稍後再試',
        };
      }

      // 增加嘗試次數
      await this.incrementAttemptCounter(uid, type);

      // 根據類型調用相應的驗證方法
      let verificationResult;
      switch (type) {
        case this.MFA_TYPE.TOTP:
          verificationResult = await this.verifyTOTPCode(uid, code);
          break;
        case this.MFA_TYPE.SMS:
          verificationResult = await this.verifySMSCode(uid, code);
          break;
        case this.MFA_TYPE.BACKUP_CODE:
          verificationResult = await this.verifyBackupCode(uid, code);
          break;
        default:
          throw new Error('不支援的 MFA 類型');
      }

      // 驗證成功時重置嘗試計數器
      if (verificationResult.success) {
        await this.resetAttemptCounter(uid, type);
      }

      return verificationResult;
    } catch (error) {
      logger.error('MFA 代碼驗證失敗', {
        uid,
        type,
        error: error.message,
      });
      return {
        success: false,
        result: this.VERIFICATION_RESULT.INVALID_CODE,
        message: '驗證失敗，請重試',
      };
    }
  }

  /**
   * 驗證 TOTP 代碼
   * @param {string} uid - 用戶 ID
   * @param {string} code - TOTP 代碼
   * @returns {Promise<Object>} 驗證結果
   */
  async verifyTOTPCode(uid, code) {
    try {
      // 獲取用戶的 TOTP 秘鑰
      const secret = await this.getTOTPSecret(uid);
      if (!secret) {
        return {
          success: false,
          result: this.VERIFICATION_RESULT.INVALID_CODE,
          message: 'TOTP 未設置',
        };
      }

      // 配置 authenticator
      authenticator.options = {
        step: this.totpConfig.step,
        window: this.totpConfig.window,
        digits: this.totpConfig.digits,
        algorithm: this.totpConfig.algorithm,
      };

      // 驗證 TOTP 代碼
      const isValid = authenticator.verify({
        token: code.toString(),
        secret: secret,
      });

      if (isValid) {
        logger.info('TOTP 驗證成功', {
          uid,
          timestamp: new Date().toISOString(),
        });

        return {
          success: true,
          result: this.VERIFICATION_RESULT.SUCCESS,
          message: 'TOTP 驗證成功',
        };
      } else {
        logger.warn('TOTP 驗證失敗', {
          uid,
          code: '***',
          timestamp: new Date().toISOString(),
        });

        return {
          success: false,
          result: this.VERIFICATION_RESULT.INVALID_CODE,
          message: 'TOTP 驗證碼無效',
        };
      }
    } catch (error) {
      logger.error('TOTP 驗證過程發生錯誤', {
        uid,
        error: error.message,
        stack: error.stack,
      });

      return {
        success: false,
        result: this.VERIFICATION_RESULT.INVALID_CODE,
        message: 'TOTP 驗證失敗',
      };
    }
  }

  /**
   * 驗證 SMS 代碼 (待實作)
   * @param {string} uid - 用戶 ID
   * @param {string} code - SMS 驗證碼
   * @returns {Promise<Object>} 驗證結果
   */
  async verifySMSCode(uid, code) {
    // 待在任務 2.2.5.3.3 中實作
    logger.info('SMS 驗證功能待實作', { uid, code: '***' });
    return {
      success: false,
      result: this.VERIFICATION_RESULT.INVALID_CODE,
      message: 'SMS 驗證功能尚未實作',
    };
  }

  /**
   * 驗證備用碼 (待實作)
   * @param {string} uid - 用戶 ID
   * @param {string} code - 備用碼
   * @returns {Promise<Object>} 驗證結果
   */
  async verifyBackupCode(uid, code) {
    // 待在任務 2.2.5.3.4 中實作
    logger.info('備用碼驗證功能待實作', { uid, code: '***' });
    return {
      success: false,
      result: this.VERIFICATION_RESULT.INVALID_CODE,
      message: '備用碼驗證功能尚未實作',
    };
  }

  // ======================
  // TOTP 相關方法
  // ======================

  /**
   * 生成 TOTP 秘鑰
   * @returns {string} Base32 編碼的秘鑰
   */
  generateTOTPSecret() {
    try {
      return authenticator.generateSecret();
    } catch (error) {
      logger.error('生成 TOTP 秘鑰失敗', { error: error.message });
      throw new Error('生成 TOTP 秘鑰失敗');
    }
  }

  /**
   * 獲取用戶的 TOTP 秘鑰
   * @param {string} uid - 用戶 ID
   * @returns {Promise<string|null>} TOTP 秘鑰或 null
   */
  async getTOTPSecret(uid) {
    try {
      const secretKey = `${this.totpSecretPrefix}${uid}`;
      const secretData = await redisConnection.get(secretKey);

      if (!secretData) {
        return null;
      }

      const parsedData = JSON.parse(secretData);
      return parsedData.secret;
    } catch (error) {
      logger.error('獲取 TOTP 秘鑰失敗', {
        uid,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * 存儲用戶的 TOTP 秘鑰
   * @param {string} uid - 用戶 ID
   * @param {string} secret - TOTP 秘鑰
   * @returns {Promise<boolean>} 是否成功
   */
  async storeTOTPSecret(uid, secret) {
    try {
      const secretKey = `${this.totpSecretPrefix}${uid}`;
      const secretData = {
        secret: secret,
        createdAt: new Date().toISOString(),
        enabled: false, // 預設為未啟用，需要驗證後才啟用
      };

      await redisConnection.set(secretKey, JSON.stringify(secretData));

      logger.info('TOTP 秘鑰存儲成功', { uid });
      return true;
    } catch (error) {
      logger.error('存儲 TOTP 秘鑰失敗', {
        uid,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * 生成 TOTP QR 碼
   * @param {string} uid - 用戶 ID
   * @param {string} email - 用戶 Email
   * @param {string} secret - TOTP 秘鑰
   * @returns {Promise<string>} QR 碼 Data URL
   */
  async generateTOTPQRCode(uid, email, secret) {
    try {
      // 構建 TOTP URI
      const otpauth = authenticator.keyuri(
        email, // 帳號標識符
        this.totpConfig.issuer, // 發行者
        secret
      );

      // 生成 QR 碼
      const qrCodeDataURL = await QRCode.toDataURL(otpauth, {
        width: 200,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
      });

      logger.info('TOTP QR 碼生成成功', { uid, email });
      return qrCodeDataURL;
    } catch (error) {
      logger.error('生成 TOTP QR 碼失敗', {
        uid,
        email,
        error: error.message,
      });
      throw new Error('生成 QR 碼失敗');
    }
  }

  /**
   * 設置 TOTP（生成秘鑰並返回 QR 碼）
   * @param {string} uid - 用戶 ID
   * @param {string} email - 用戶 Email
   * @returns {Promise<Object>} 設置結果包含 QR 碼和秘鑰
   */
  async setupTOTP(uid, email) {
    try {
      // 檢查是否已經設置 TOTP
      const existingSecret = await this.getTOTPSecret(uid);
      if (existingSecret) {
        const secretData = await redisConnection.get(`${this.totpSecretPrefix}${uid}`);
        const parsedData = JSON.parse(secretData);

        if (parsedData.enabled) {
          return {
            success: false,
            message: 'TOTP 已經設置並啟用',
          };
        }
      }

      // 生成新的 TOTP 秘鑰
      const secret = this.generateTOTPSecret();

      // 存儲秘鑰
      const stored = await this.storeTOTPSecret(uid, secret);
      if (!stored) {
        throw new Error('存儲 TOTP 秘鑰失敗');
      }

      // 生成 QR 碼
      const qrCodeDataURL = await this.generateTOTPQRCode(uid, email, secret);

      // 更新 MFA 狀態為 pending
      const currentStatus = await this.getUserMFAStatus(uid);
      const pendingMethods = currentStatus.pendingMethods || [];
      if (!pendingMethods.includes(this.MFA_TYPE.TOTP)) {
        pendingMethods.push(this.MFA_TYPE.TOTP);
      }

      await this.setUserMFAStatus(uid, {
        ...currentStatus,
        status: this.MFA_STATUS.PENDING,
        pendingMethods: pendingMethods,
      });

      logger.info('TOTP 設置完成', { uid, email });

      return {
        success: true,
        secret: secret,
        qrCode: qrCodeDataURL,
        message: '請使用驗證器應用掃描 QR 碼並輸入驗證碼以啟用 TOTP',
      };
    } catch (error) {
      logger.error('TOTP 設置失敗', {
        uid,
        email,
        error: error.message,
      });

      return {
        success: false,
        message: 'TOTP 設置失敗',
      };
    }
  }

  /**
   * 啟用 TOTP（驗證用戶輸入的代碼後啟用）
   * @param {string} uid - 用戶 ID
   * @param {string} code - 用戶輸入的 TOTP 代碼
   * @returns {Promise<Object>} 啟用結果
   */
  async enableTOTP(uid, code) {
    try {
      // 檢查是否有待啟用的 TOTP
      const secretKey = `${this.totpSecretPrefix}${uid}`;
      const secretData = await redisConnection.get(secretKey);

      if (!secretData) {
        return {
          success: false,
          message: 'TOTP 尚未設置',
        };
      }

      const parsedData = JSON.parse(secretData);
      if (parsedData.enabled) {
        return {
          success: false,
          message: 'TOTP 已經啟用',
        };
      }

      // 驗證 TOTP 代碼
      const verificationResult = await this.verifyTOTPCode(uid, code);
      if (!verificationResult.success) {
        return {
          success: false,
          message: 'TOTP 驗證碼無效，無法啟用',
        };
      }

      // 啟用 TOTP
      parsedData.enabled = true;
      parsedData.enabledAt = new Date().toISOString();
      await redisConnection.set(secretKey, JSON.stringify(parsedData));

      // 更新 MFA 狀態
      const currentStatus = await this.getUserMFAStatus(uid);
      let enabledMethods = currentStatus.enabledMethods || [];
      let pendingMethods = currentStatus.pendingMethods || [];

      // 移動 TOTP 從 pending 到 enabled
      pendingMethods = pendingMethods.filter(method => method !== this.MFA_TYPE.TOTP);
      if (!enabledMethods.includes(this.MFA_TYPE.TOTP)) {
        enabledMethods.push(this.MFA_TYPE.TOTP);
      }

      await this.setUserMFAStatus(uid, {
        ...currentStatus,
        status: this.MFA_STATUS.ENABLED,
        enabledMethods: enabledMethods,
        pendingMethods: pendingMethods,
      });

      logger.info('TOTP 啟用成功', { uid });

      return {
        success: true,
        message: 'TOTP 啟用成功',
      };
    } catch (error) {
      logger.error('TOTP 啟用失敗', {
        uid,
        error: error.message,
      });

      return {
        success: false,
        message: 'TOTP 啟用失敗',
      };
    }
  }

  /**
   * 禁用 TOTP
   * @param {string} uid - 用戶 ID
   * @returns {Promise<Object>} 禁用結果
   */
  async disableTOTP(uid) {
    try {
      const secretKey = `${this.totpSecretPrefix}${uid}`;

      // 刪除 TOTP 秘鑰
      await redisConnection.del(secretKey);

      // 更新 MFA 狀態
      const currentStatus = await this.getUserMFAStatus(uid);
      let enabledMethods = currentStatus.enabledMethods || [];
      let pendingMethods = currentStatus.pendingMethods || [];

      // 移除 TOTP
      enabledMethods = enabledMethods.filter(method => method !== this.MFA_TYPE.TOTP);
      pendingMethods = pendingMethods.filter(method => method !== this.MFA_TYPE.TOTP);

      const newStatus =
        enabledMethods.length > 0 ? this.MFA_STATUS.ENABLED : this.MFA_STATUS.DISABLED;

      await this.setUserMFAStatus(uid, {
        ...currentStatus,
        status: newStatus,
        enabledMethods: enabledMethods,
        pendingMethods: pendingMethods,
      });

      logger.info('TOTP 禁用成功', { uid });

      return {
        success: true,
        message: 'TOTP 禁用成功',
      };
    } catch (error) {
      logger.error('TOTP 禁用失敗', {
        uid,
        error: error.message,
      });

      return {
        success: false,
        message: 'TOTP 禁用失敗',
      };
    }
  }

  /**
   * 檢查用戶是否啟用了 TOTP
   * @param {string} uid - 用戶 ID
   * @returns {Promise<boolean>} 是否啟用 TOTP
   */
  async isTOTPEnabled(uid) {
    try {
      const secretKey = `${this.totpSecretPrefix}${uid}`;
      const secretData = await redisConnection.get(secretKey);

      if (!secretData) {
        return false;
      }

      const parsedData = JSON.parse(secretData);
      return parsedData.enabled === true;
    } catch (error) {
      logger.error('檢查 TOTP 狀態失敗', {
        uid,
        error: error.message,
      });
      return false;
    }
  }
}

module.exports = MFAService;
