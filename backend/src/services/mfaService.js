const crypto = require('crypto');
const { redisConnection } = require('../config/redis');
const { logger } = require('../middleware/requestLogger');
const { authenticator } = require('otplib');
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
      maxAttempts: 3, // 最多嘗試 3 次
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

      const maxAttempts = (() => {
        switch (type) {
          case this.MFA_TYPE.SMS:
            return this.smsConfig.maxAttempts;
          case this.MFA_TYPE.TOTP:
            return this.totpConfig.maxAttempts;
          default:
            return this.backupCodeConfig.usageLimit;
        }
      })();

      const maxDailyAttempts = type === this.MFA_TYPE.SMS ? this.smsConfig.maxDailyAttempts : 20; // 其他類型的每日限制

      return (
        parseInt(currentAttempts, 10) >= maxAttempts ||
        parseInt(dailyAttempts, 10) >= maxDailyAttempts
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
   * 驗證 SMS 驗證碼
   * @param {string} uid - 用戶 ID
   * @param {string} code - SMS 驗證碼
   * @returns {Promise<Object>} 驗證結果
   */
  async verifySMSCode(uid, code) {
    try {
      // 驗證輸入
      if (!uid || !code) {
        return {
          success: false,
          result: this.VERIFICATION_RESULT.INVALID_CODE,
          message: '用戶 ID 和驗證碼不能為空',
        };
      }

      // 檢查嘗試次數限制
      const isExceeded = await this.isAttemptLimitExceeded(uid, this.MFA_TYPE.SMS);
      if (isExceeded) {
        return {
          success: false,
          result: this.VERIFICATION_RESULT.TOO_MANY_ATTEMPTS,
          message: '嘗試次數過多，請稍後再試',
        };
      }

      // 獲取存儲的 SMS 驗證碼
      const smsCodeKey = `${this.smsCodePrefix}${uid}`;
      const storedCodeData = await redisConnection.get(smsCodeKey);

      if (!storedCodeData) {
        await this.incrementAttemptCounter(uid, this.MFA_TYPE.SMS);
        return {
          success: false,
          result: this.VERIFICATION_RESULT.EXPIRED,
          message: '驗證碼已過期或不存在',
        };
      }

      const codeData = JSON.parse(storedCodeData);
      const currentTime = Date.now();

      // 檢查是否已過期
      if (currentTime > codeData.expiresAt) {
        await redisConnection.del(smsCodeKey);
        await this.incrementAttemptCounter(uid, this.MFA_TYPE.SMS);
        return {
          success: false,
          result: this.VERIFICATION_RESULT.EXPIRED,
          message: '驗證碼已過期',
        };
      }

      // 檢查嘗試次數
      if (codeData.attempts >= this.smsConfig.maxAttempts) {
        await redisConnection.del(smsCodeKey);
        return {
          success: false,
          result: this.VERIFICATION_RESULT.TOO_MANY_ATTEMPTS,
          message: '此驗證碼嘗試次數已達上限',
        };
      }

      // 驗證碼比對
      if (codeData.code !== code) {
        // 增加此驗證碼的嘗試次數
        codeData.attempts += 1;
        await redisConnection.set(smsCodeKey, JSON.stringify(codeData));
        await this.incrementAttemptCounter(uid, this.MFA_TYPE.SMS);

        return {
          success: false,
          result: this.VERIFICATION_RESULT.INVALID_CODE,
          message: '驗證碼不正確',
        };
      }

      // 驗證成功，清除驗證碼
      await redisConnection.del(smsCodeKey);
      await this.resetAttemptCounter(uid, this.MFA_TYPE.SMS);

      logger.info('SMS 驗證碼驗證成功', { uid, phone: codeData.phone });

      return {
        success: true,
        result: this.VERIFICATION_RESULT.SUCCESS,
        message: '驗證成功',
      };
    } catch (error) {
      logger.error('SMS 驗證碼驗證失敗', {
        uid,
        error: error.message,
        stack: error.stack,
      });

      return {
        success: false,
        result: this.VERIFICATION_RESULT.INVALID_CODE,
        message: '驗證失敗',
      };
    }
  }

  /**
   * 驗證備用碼
   * @param {string} uid - 用戶 ID
   * @param {string} code - 備用碼
   * @returns {Promise<Object>} 驗證結果
   */
  async verifyBackupCode(uid, code) {
    try {
      // 驗證輸入
      if (!uid || !code) {
        return {
          success: false,
          result: this.VERIFICATION_RESULT.INVALID_CODE,
          message: '用戶 ID 和備用碼不能為空',
        };
      }

      // 標準化備用碼格式（移除空格和轉為大寫）
      const normalizedCode = code.toString().replace(/\s+/g, '').toUpperCase();

      // 獲取用戶的備用碼
      const backupCodesKey = `${this.backupCodesPrefix}${uid}`;
      const backupCodesData = await redisConnection.get(backupCodesKey);

      if (!backupCodesData) {
        return {
          success: false,
          result: this.VERIFICATION_RESULT.INVALID_CODE,
          message: '備用碼不存在或已過期',
        };
      }

      const backupCodes = JSON.parse(backupCodesData);

      // 查找匹配的備用碼
      const matchingCodeIndex = backupCodes.codes.findIndex(
        codeObj => codeObj.code === normalizedCode && !codeObj.used
      );

      if (matchingCodeIndex === -1) {
        logger.warn('備用碼驗證失敗：未找到匹配的有效備用碼', {
          uid,
          code: '***',
          timestamp: new Date().toISOString(),
        });

        return {
          success: false,
          result: this.VERIFICATION_RESULT.INVALID_CODE,
          message: '備用碼無效或已使用',
        };
      }

      // 標記備用碼為已使用
      backupCodes.codes[matchingCodeIndex].used = true;
      backupCodes.codes[matchingCodeIndex].usedAt = new Date().toISOString();
      backupCodes.lastUsedAt = new Date().toISOString();

      // 更新 Redis 中的備用碼數據
      await redisConnection.set(backupCodesKey, JSON.stringify(backupCodes));

      logger.info('備用碼驗證成功', {
        uid,
        code: '***',
        remainingCodes: backupCodes.codes.filter(c => !c.used).length,
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        result: this.VERIFICATION_RESULT.SUCCESS,
        message: '備用碼驗證成功',
        remainingCodes: backupCodes.codes.filter(c => !c.used).length,
      };
    } catch (error) {
      logger.error('備用碼驗證過程發生錯誤', {
        uid,
        error: error.message,
        stack: error.stack,
      });

      return {
        success: false,
        result: this.VERIFICATION_RESULT.INVALID_CODE,
        message: '備用碼驗證失敗',
      };
    }
  }

  // ======================
  // SMS 相關方法
  // ======================

  /**
   * 生成 SMS 驗證碼
   * @returns {string} 數字驗證碼
   */
  generateSMSCode() {
    return this.generateSecureCode(this.smsConfig.codeLength);
  }

  /**
   * 模擬 SMS 發送服務
   * @param {string} phone - 手機號碼
   * @param {string} code - 驗證碼
   * @returns {Promise<Object>} 發送結果
   */
  async simulateSMSService(phone, _code) {
    try {
      // 在生產環境中，這裡會整合真正的 SMS 服務
      // 如 AWS SNS、Twilio、阿里雲短信等

      // 模擬發送延遲
      await new Promise(resolve => setTimeout(resolve, 500));

      // 模擬 10% 的發送失敗率（用於測試）
      const shouldFail = Math.random() < 0.1;

      if (shouldFail) {
        throw new Error('SMS 服務暫時不可用');
      }

      logger.info('SMS 驗證碼模擬發送', {
        phone,
        code: '***',
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        messageId: `sim_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        message: '驗證碼發送成功',
      };
    } catch (error) {
      logger.error('SMS 發送失敗', {
        phone,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        message: 'SMS 發送失敗',
      };
    }
  }

  /**
   * 檢查 SMS 重送間隔
   * @param {string} uid - 用戶 ID
   * @returns {Promise<Object>} 重送檢查結果
   */
  async checkSMSResendInterval(uid) {
    try {
      const resendKey = `${this.resendCounterPrefix}${uid}`;
      const lastSentTime = await redisConnection.get(resendKey);

      if (!lastSentTime) {
        return {
          canResend: true,
          remainingTime: 0,
        };
      }

      const currentTime = Date.now();
      const lastSent = parseInt(lastSentTime, 10);
      const remainingTime = Math.max(
        0,
        this.smsConfig.resendInterval * 1000 - (currentTime - lastSent)
      );

      return {
        canResend: remainingTime === 0,
        remainingTime: Math.ceil(remainingTime / 1000),
      };
    } catch (error) {
      logger.error('檢查 SMS 重送間隔失敗', {
        uid,
        error: error.message,
      });

      return {
        canResend: false,
        remainingTime: this.smsConfig.resendInterval,
      };
    }
  }

  /**
   * 發送 SMS 驗證碼
   * @param {string} uid - 用戶 ID
   * @param {string} phone - 手機號碼
   * @param {boolean} isResend - 是否為重送
   * @returns {Promise<Object>} 發送結果
   */
  async sendSMSCode(uid, phone, isResend = false) {
    try {
      // 驗證輸入
      if (!uid || !phone) {
        return {
          success: false,
          message: '用戶 ID 和手機號碼不能為空',
        };
      }

      // 檢查手機號碼格式
      const phoneRegex = /^[+]?[0-9]{10,15}$/;
      if (!phoneRegex.test(phone)) {
        return {
          success: false,
          message: '手機號碼格式不正確',
        };
      }

      // 檢查每日發送限制
      const dailyCounterKey = `${this.dailyAttemptCounterPrefix}${uid}:${
        this.MFA_TYPE.SMS
      }:${this.getDateString()}`;
      const dailyAttempts = await redisConnection.get(dailyCounterKey);

      if (dailyAttempts && parseInt(dailyAttempts, 10) >= this.smsConfig.maxDailyAttempts) {
        return {
          success: false,
          message: '今日發送次數已達上限',
        };
      }

      // 檢查重送間隔
      if (isResend) {
        const resendCheck = await this.checkSMSResendInterval(uid);
        if (!resendCheck.canResend) {
          return {
            success: false,
            message: `請等待 ${resendCheck.remainingTime} 秒後再重送`,
          };
        }
      }

      // 生成驗證碼
      const code = this.generateSMSCode();
      const currentTime = Date.now();
      const expiresAt = currentTime + this.smsConfig.expiry * 1000;

      // 存儲驗證碼
      const smsCodeKey = `${this.smsCodePrefix}${uid}`;
      const codeData = {
        code: code,
        phone: phone,
        createdAt: currentTime,
        expiresAt: expiresAt,
        attempts: 0,
        isResend: isResend,
      };

      await redisConnection.set(smsCodeKey, JSON.stringify(codeData));

      // 發送 SMS
      const sendResult = await this.simulateSMSService(phone, code);

      if (!sendResult.success) {
        // 發送失敗，清除驗證碼
        await redisConnection.del(smsCodeKey);
        return {
          success: false,
          message: sendResult.message,
        };
      }

      // 更新重送計數器
      const resendKey = `${this.resendCounterPrefix}${uid}`;
      await redisConnection.set(resendKey, currentTime.toString());
      await redisConnection.expire(resendKey, this.smsConfig.resendInterval);

      // 更新每日發送計數器
      await redisConnection.incr(dailyCounterKey);
      await redisConnection.expire(dailyCounterKey, 86400);

      logger.info('SMS 驗證碼發送成功', {
        uid,
        phone,
        messageId: sendResult.messageId,
        expiresAt: new Date(expiresAt).toISOString(),
        isResend,
      });

      return {
        success: true,
        message: '驗證碼已發送',
        messageId: sendResult.messageId,
        expiresIn: this.smsConfig.expiry,
      };
    } catch (error) {
      logger.error('SMS 驗證碼發送失敗', {
        uid,
        phone,
        error: error.message,
        stack: error.stack,
      });

      return {
        success: false,
        message: '發送失敗',
      };
    }
  }

  /**
   * 設置 SMS 驗證
   * @param {string} uid - 用戶 ID
   * @param {string} phone - 手機號碼
   * @returns {Promise<Object>} 設置結果
   */
  async setupSMS(uid, phone) {
    try {
      // 檢查是否已經設置並啟用了 SMS
      const currentStatus = await this.getUserMFAStatus(uid);
      if (currentStatus.enabledMethods.includes(this.MFA_TYPE.SMS)) {
        return {
          success: false,
          message: 'SMS 驗證已經設置並啟用',
        };
      }

      // 發送驗證碼
      const sendResult = await this.sendSMSCode(uid, phone);

      if (!sendResult.success) {
        return sendResult;
      }

      // 更新 MFA 狀態為 pending
      const pendingMethods = currentStatus.pendingMethods || [];
      if (!pendingMethods.includes(this.MFA_TYPE.SMS)) {
        pendingMethods.push(this.MFA_TYPE.SMS);
      }

      await this.setUserMFAStatus(uid, {
        ...currentStatus,
        status: this.MFA_STATUS.PENDING,
        pendingMethods: pendingMethods,
      });

      logger.info('SMS 驗證設置開始', { uid, phone });

      return {
        success: true,
        message: '驗證碼已發送，請輸入驗證碼以完成設置',
        expiresIn: this.smsConfig.expiry,
      };
    } catch (error) {
      logger.error('SMS 驗證設置失敗', {
        uid,
        phone,
        error: error.message,
      });

      return {
        success: false,
        message: 'SMS 驗證設置失敗',
      };
    }
  }

  /**
   * 啟用 SMS 驗證
   * @param {string} uid - 用戶 ID
   * @param {string} code - 驗證碼
   * @returns {Promise<Object>} 啟用結果
   */
  async enableSMS(uid, code) {
    try {
      // 驗證 SMS 驗證碼
      const verifyResult = await this.verifySMSCode(uid, code);

      if (!verifyResult.success) {
        return verifyResult;
      }

      // 更新 MFA 狀態
      const currentStatus = await this.getUserMFAStatus(uid);
      const enabledMethods = currentStatus.enabledMethods || [];
      const pendingMethods = currentStatus.pendingMethods || [];

      // 添加到啟用列表
      if (!enabledMethods.includes(this.MFA_TYPE.SMS)) {
        enabledMethods.push(this.MFA_TYPE.SMS);
      }

      // 從待處理列表移除
      const updatedPendingMethods = pendingMethods.filter(method => method !== this.MFA_TYPE.SMS);

      // 決定整體狀態
      const newStatus =
        enabledMethods.length > 0 ? this.MFA_STATUS.ENABLED : this.MFA_STATUS.DISABLED;

      await this.setUserMFAStatus(uid, {
        ...currentStatus,
        status: newStatus,
        enabledMethods: enabledMethods,
        pendingMethods: updatedPendingMethods,
      });

      logger.info('SMS 驗證啟用成功', { uid, enabledMethods });

      return {
        success: true,
        message: 'SMS 驗證已成功啟用',
        enabledMethods: enabledMethods,
      };
    } catch (error) {
      logger.error('SMS 驗證啟用失敗', {
        uid,
        error: error.message,
      });

      return {
        success: false,
        message: '啟用失敗',
      };
    }
  }

  /**
   * 禁用 SMS 驗證
   * @param {string} uid - 用戶 ID
   * @returns {Promise<Object>} 禁用結果
   */
  async disableSMS(uid) {
    try {
      // 獲取當前狀態
      const currentStatus = await this.getUserMFAStatus(uid);
      const enabledMethods = currentStatus.enabledMethods || [];
      const pendingMethods = currentStatus.pendingMethods || [];

      // 從啟用列表移除
      const updatedEnabledMethods = enabledMethods.filter(method => method !== this.MFA_TYPE.SMS);

      // 從待處理列表移除
      const updatedPendingMethods = pendingMethods.filter(method => method !== this.MFA_TYPE.SMS);

      // 決定整體狀態
      const newStatus =
        updatedEnabledMethods.length > 0 ? this.MFA_STATUS.ENABLED : this.MFA_STATUS.DISABLED;

      await this.setUserMFAStatus(uid, {
        ...currentStatus,
        status: newStatus,
        enabledMethods: updatedEnabledMethods,
        pendingMethods: updatedPendingMethods,
      });

      // 清除相關的 SMS 驗證碼
      const smsCodeKey = `${this.smsCodePrefix}${uid}`;
      await redisConnection.del(smsCodeKey);

      logger.info('SMS 驗證禁用成功', { uid, enabledMethods: updatedEnabledMethods });

      return {
        success: true,
        message: 'SMS 驗證已禁用',
        enabledMethods: updatedEnabledMethods,
      };
    } catch (error) {
      logger.error('SMS 驗證禁用失敗', {
        uid,
        error: error.message,
      });

      return {
        success: false,
        message: '禁用失敗',
      };
    }
  }

  /**
   * 檢查是否已啟用 SMS 驗證
   * @param {string} uid - 用戶 ID
   * @returns {Promise<boolean>} 是否已啟用
   */
  async isSMSEnabled(uid) {
    try {
      const status = await this.getUserMFAStatus(uid);
      return status.enabledMethods.includes(this.MFA_TYPE.SMS);
    } catch (error) {
      logger.error('檢查 SMS 狀態失敗', { uid, error: error.message });
      return false;
    }
  }

  // ======================
  // 備用碼相關方法
  // ======================

  /**
   * 生成備用碼數組
   * @returns {Array<string>} 備用碼數組
   */
  generateBackupCodes() {
    try {
      const codes = [];
      for (let i = 0; i < this.backupCodeConfig.totalCodes; i++) {
        const code = this.generateSecureAlphanumericCode(this.backupCodeConfig.codeLength);
        codes.push(code);
      }

      logger.info('備用碼生成成功', {
        totalCodes: this.backupCodeConfig.totalCodes,
        codeLength: this.backupCodeConfig.codeLength,
      });

      return codes;
    } catch (error) {
      logger.error('生成備用碼失敗', { error: error.message });
      throw new Error('生成備用碼失敗');
    }
  }

  /**
   * 存儲備用碼到 Redis
   * @param {string} uid - 用戶 ID
   * @param {Array<string>} codes - 備用碼數組
   * @returns {Promise<boolean>} 是否成功
   */
  async storeBackupCodes(uid, codes) {
    try {
      const backupCodesKey = `${this.backupCodesPrefix}${uid}`;
      const backupCodesData = {
        codes: codes.map(code => ({
          code: code,
          used: false,
          usedAt: null,
        })),
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
        enabled: false, // 預設為未啟用，需要用戶確認後才啟用
      };

      await redisConnection.set(backupCodesKey, JSON.stringify(backupCodesData));

      logger.info('備用碼存儲成功', {
        uid,
        totalCodes: codes.length,
      });

      return true;
    } catch (error) {
      logger.error('存儲備用碼失敗', {
        uid,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * 設置備用碼（用戶首次生成）
   * @param {string} uid - 用戶 ID
   * @returns {Promise<Object>} 設置結果包含備用碼
   */
  async setupBackupCodes(uid) {
    try {
      // 檢查是否已經設置備用碼
      const existingCodes = await this.getBackupCodes(uid);
      if (existingCodes.success && existingCodes.enabled) {
        return {
          success: false,
          message: '備用碼已經設置並啟用',
        };
      }

      // 生成備用碼
      const codes = this.generateBackupCodes();

      // 存儲備用碼
      const stored = await this.storeBackupCodes(uid, codes);
      if (!stored) {
        throw new Error('存儲備用碼失敗');
      }

      // 更新 MFA 狀態為 pending
      const currentStatus = await this.getUserMFAStatus(uid);
      const pendingMethods = currentStatus.pendingMethods || [];

      if (!pendingMethods.includes(this.MFA_TYPE.BACKUP_CODE)) {
        pendingMethods.push(this.MFA_TYPE.BACKUP_CODE);
      }

      await this.setUserMFAStatus(uid, {
        ...currentStatus,
        pendingMethods: pendingMethods,
      });

      logger.info('備用碼設置成功', { uid });

      return {
        success: true,
        message: '備用碼設置成功',
        codes: codes,
        warning: '請安全保存這些備用碼，它們只會顯示一次',
      };
    } catch (error) {
      logger.error('設置備用碼失敗', {
        uid,
        error: error.message,
      });

      return {
        success: false,
        message: '設置備用碼失敗',
      };
    }
  }

  /**
   * 重新生成備用碼
   * @param {string} uid - 用戶 ID
   * @returns {Promise<Object>} 重新生成結果包含新備用碼
   */
  async regenerateBackupCodes(uid) {
    try {
      // 生成新的備用碼
      const codes = this.generateBackupCodes();

      // 存儲新的備用碼
      const stored = await this.storeBackupCodes(uid, codes);
      if (!stored) {
        throw new Error('存儲新備用碼失敗');
      }

      // 如果之前已啟用，自動啟用新的備用碼
      const currentStatus = await this.getUserMFAStatus(uid);
      const wasEnabled = currentStatus.enabledMethods.includes(this.MFA_TYPE.BACKUP_CODE);

      if (wasEnabled) {
        await this.enableBackupCodes(uid);
      }

      logger.info('備用碼重新生成成功', { uid, wasEnabled });

      return {
        success: true,
        message: '備用碼重新生成成功',
        codes: codes,
        warning: '舊的備用碼已失效，請安全保存這些新的備用碼',
      };
    } catch (error) {
      logger.error('重新生成備用碼失敗', {
        uid,
        error: error.message,
      });

      return {
        success: false,
        message: '重新生成備用碼失敗',
      };
    }
  }

  /**
   * 獲取備用碼（用於顯示給用戶）
   * @param {string} uid - 用戶 ID
   * @param {boolean} includeUsed - 是否包含已使用的備用碼
   * @returns {Promise<Object>} 備用碼信息
   */
  async getBackupCodes(uid, includeUsed = false) {
    try {
      const backupCodesKey = `${this.backupCodesPrefix}${uid}`;
      const backupCodesData = await redisConnection.get(backupCodesKey);

      if (!backupCodesData) {
        return {
          success: false,
          message: '備用碼不存在',
          codes: [],
          enabled: false,
        };
      }

      const backupCodes = JSON.parse(backupCodesData);

      // 過濾備用碼
      const filteredCodes = backupCodes.codes.filter(codeObj => {
        if (includeUsed) {
          return true;
        }
        return !codeObj.used;
      });

      return {
        success: true,
        codes: filteredCodes,
        enabled: backupCodes.enabled,
        totalCodes: backupCodes.codes.length,
        usedCodes: backupCodes.codes.filter(c => c.used).length,
        remainingCodes: backupCodes.codes.filter(c => !c.used).length,
        createdAt: backupCodes.createdAt,
        lastUsedAt: backupCodes.lastUsedAt,
      };
    } catch (error) {
      logger.error('獲取備用碼失敗', {
        uid,
        error: error.message,
      });

      return {
        success: false,
        message: '獲取備用碼失敗',
        codes: [],
        enabled: false,
      };
    }
  }

  /**
   * 啟用備用碼
   * @param {string} uid - 用戶 ID
   * @returns {Promise<Object>} 啟用結果
   */
  async enableBackupCodes(uid) {
    try {
      // 檢查備用碼是否存在
      const backupCodesKey = `${this.backupCodesPrefix}${uid}`;
      const backupCodesData = await redisConnection.get(backupCodesKey);

      if (!backupCodesData) {
        return {
          success: false,
          message: '備用碼不存在，請先設置備用碼',
        };
      }

      // 更新備用碼狀態為啟用
      const backupCodes = JSON.parse(backupCodesData);
      backupCodes.enabled = true;
      backupCodes.enabledAt = new Date().toISOString();

      await redisConnection.set(backupCodesKey, JSON.stringify(backupCodes));

      // 更新 MFA 狀態
      const currentStatus = await this.getUserMFAStatus(uid);
      const enabledMethods = currentStatus.enabledMethods || [];
      const pendingMethods = currentStatus.pendingMethods || [];

      // 從待處理列表移除並添加到啟用列表
      const updatedPendingMethods = pendingMethods.filter(
        method => method !== this.MFA_TYPE.BACKUP_CODE
      );

      if (!enabledMethods.includes(this.MFA_TYPE.BACKUP_CODE)) {
        enabledMethods.push(this.MFA_TYPE.BACKUP_CODE);
      }

      await this.setUserMFAStatus(uid, {
        ...currentStatus,
        status: this.MFA_STATUS.ENABLED,
        enabledMethods: enabledMethods,
        pendingMethods: updatedPendingMethods,
      });

      logger.info('備用碼啟用成功', { uid, enabledMethods });

      return {
        success: true,
        message: '備用碼已啟用',
        enabledMethods: enabledMethods,
      };
    } catch (error) {
      logger.error('啟用備用碼失敗', {
        uid,
        error: error.message,
      });

      return {
        success: false,
        message: '啟用備用碼失敗',
      };
    }
  }

  /**
   * 禁用備用碼
   * @param {string} uid - 用戶 ID
   * @returns {Promise<Object>} 禁用結果
   */
  async disableBackupCodes(uid) {
    try {
      const currentStatus = await this.getUserMFAStatus(uid);
      const enabledMethods = currentStatus.enabledMethods || [];
      const pendingMethods = currentStatus.pendingMethods || [];

      // 從啟用列表移除
      const updatedEnabledMethods = enabledMethods.filter(
        method => method !== this.MFA_TYPE.BACKUP_CODE
      );

      // 從待處理列表移除
      const updatedPendingMethods = pendingMethods.filter(
        method => method !== this.MFA_TYPE.BACKUP_CODE
      );

      // 決定整體狀態
      const newStatus =
        updatedEnabledMethods.length > 0 ? this.MFA_STATUS.ENABLED : this.MFA_STATUS.DISABLED;

      await this.setUserMFAStatus(uid, {
        ...currentStatus,
        status: newStatus,
        enabledMethods: updatedEnabledMethods,
        pendingMethods: updatedPendingMethods,
      });

      // 清除備用碼數據
      const backupCodesKey = `${this.backupCodesPrefix}${uid}`;
      await redisConnection.del(backupCodesKey);

      logger.info('備用碼禁用成功', { uid, enabledMethods: updatedEnabledMethods });

      return {
        success: true,
        message: '備用碼已禁用',
        enabledMethods: updatedEnabledMethods,
      };
    } catch (error) {
      logger.error('禁用備用碼失敗', {
        uid,
        error: error.message,
      });

      return {
        success: false,
        message: '禁用備用碼失敗',
      };
    }
  }

  /**
   * 檢查是否已啟用備用碼
   * @param {string} uid - 用戶 ID
   * @returns {Promise<boolean>} 是否已啟用
   */
  async isBackupCodeEnabled(uid) {
    try {
      const status = await this.getUserMFAStatus(uid);
      return status.enabledMethods.includes(this.MFA_TYPE.BACKUP_CODE);
    } catch (error) {
      logger.error('檢查備用碼狀態失敗', { uid, error: error.message });
      return false;
    }
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
