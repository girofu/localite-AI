const crypto = require('crypto');
const { redisConnection } = require('../config/redis');
const { logger } = require('../config/logger');

/**
 * 安全增強中間件
 * 提供帳號鎖定、登入失敗記錄、風險分析等安全功能
 */
class SecurityEnhancement {
  constructor() {
    // 配置常數
    this.MAX_LOGIN_ATTEMPTS = 5; // 最大登入嘗試次數
    this.LOCKOUT_DURATION = 30 * 60; // 鎖定時間（秒）30分鐘
    this.PROGRESSIVE_LOCKOUT = {
      3: 5 * 60, // 3次失敗：鎖定5分鐘
      5: 30 * 60, // 5次失敗：鎖定30分鐘
      10: 2 * 60 * 60, // 10次失敗：鎖定2小時
    };

    // Redis 鍵值前綴
    this.REDIS_PREFIX = {
      LOGIN_FAILURES: 'login_failures:',
      ACCOUNT_LOCK: 'account_lock:',
      SECURITY_EVENTS: 'security_events:',
      LOGIN_PATTERNS: 'login_patterns:',
    };

    // 風險評估配置
    this.RISK_FACTORS = {
      NEW_IP: 10,
      NEW_DEVICE: 15,
      RAPID_ATTEMPTS: 20,
      MULTIPLE_FAILURES: 25,
      SUSPICIOUS_TIMING: 10,
      GEOGRAPHIC_ANOMALY: 30,
    };
  }

  /**
   * 檢查帳號是否被鎖定
   * @param {string} userIdentifier - 用戶標識（firebaseUid 或 email）
   * @returns {Promise<{locked: boolean, reason?: string, lockedUntil?: Date}>}
   */
  async checkAccountLock(userIdentifier) {
    try {
      const lockKey = this.REDIS_PREFIX.ACCOUNT_LOCK + userIdentifier;
      const lockInfo = await this.getRedisData(lockKey);

      if (!lockInfo) {
        return { locked: false };
      }

      // 檢查鎖定是否已過期
      const now = Date.now();
      if (lockInfo.lockedUntil && now >= lockInfo.lockedUntil) {
        // 鎖定已過期，清除記錄
        await this.clearRedisData(lockKey);
        return { locked: false };
      }

      return {
        locked: true,
        reason: lockInfo.reason || '多次登入失敗',
        lockedUntil: lockInfo.lockedUntil ? new Date(lockInfo.lockedUntil) : null,
        attempts: lockInfo.attempts || 0,
      };
    } catch (error) {
      logger.error('檢查帳號鎖定狀態失敗', {
        error: error.message,
        userIdentifier,
      });
      // 發生錯誤時假設帳號未鎖定，避免誤鎖
      return { locked: false };
    }
  }

  /**
   * 記錄登入失敗並檢查是否需要鎖定帳號
   * @param {string} userIdentifier - 用戶標識
   * @param {Object} context - 請求上下文
   * @returns {Promise<{locked: boolean, attempts: number}>}
   */
  async recordLoginFailure(userIdentifier, context = {}) {
    try {
      const failureKey = this.REDIS_PREFIX.LOGIN_FAILURES + userIdentifier;
      const lockKey = this.REDIS_PREFIX.ACCOUNT_LOCK + userIdentifier;

      // 獲取當前失敗次數
      const currentFailures = (await this.getRedisData(failureKey)) || {
        attempts: 0,
        failures: [],
      };
      const newAttempts = currentFailures.attempts + 1;

      // 記錄失敗詳情
      const failureRecord = {
        timestamp: Date.now(),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        deviceFingerprint: context.deviceFingerprint,
        reason: context.reason || 'authentication_failed',
      };

      // 更新失敗記錄
      const updatedFailures = {
        attempts: newAttempts,
        failures: [...(currentFailures.failures || []), failureRecord].slice(-20), // 保留最近20條
        lastFailure: failureRecord,
      };

      await this.setRedisData(failureKey, updatedFailures, 24 * 60 * 60); // 24小時過期

      // 記錄安全事件
      await this.recordSecurityEvent(userIdentifier, 'login_failure', {
        ...context,
        attempts: newAttempts,
      });

      // 檢查是否需要鎖定帳號
      const shouldLock = this.shouldLockAccount(newAttempts, currentFailures.failures);

      if (shouldLock.lock) {
        await this.lockAccount(userIdentifier, shouldLock.duration, shouldLock.reason);

        logger.warn('帳號已鎖定', {
          userIdentifier,
          attempts: newAttempts,
          duration: shouldLock.duration,
          reason: shouldLock.reason,
        });

        return { locked: true, attempts: newAttempts };
      }

      return { locked: false, attempts: newAttempts };
    } catch (error) {
      logger.error('記錄登入失敗錯誤', {
        error: error.message,
        userIdentifier,
        context,
      });
      return { locked: false, attempts: 0 };
    }
  }

  /**
   * 分析登入模式並評估風險
   * @param {string} userIdentifier - 用戶標識
   * @param {Object} context - 請求上下文
   * @returns {Promise<{suspicious: boolean, riskScore: number, reasons: string[]}>}
   */
  async analyzeLoginPattern(userIdentifier, context = {}) {
    try {
      const patternKey = this.REDIS_PREFIX.LOGIN_PATTERNS + userIdentifier;
      const recentPatterns = (await this.getRedisData(patternKey)) || { logins: [] };

      let riskScore = 0;
      const reasons = [];

      // 建立當前登入記錄
      const currentLogin = {
        timestamp: Date.now(),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        deviceFingerprint: context.deviceFingerprint,
        providerId: context.providerId,
      };

      // 分析風險因素
      const riskAnalysis = await this.analyzeRiskFactors(currentLogin, recentPatterns.logins);
      riskScore += riskAnalysis.score;
      reasons.push(...riskAnalysis.reasons);

      // 更新登入模式記錄
      const updatedPatterns = {
        logins: [...recentPatterns.logins, currentLogin].slice(-50), // 保留最近50次登入
        lastAnalysis: {
          timestamp: Date.now(),
          riskScore,
          reasons,
        },
      };

      await this.setRedisData(patternKey, updatedPatterns, 30 * 24 * 60 * 60); // 30天過期

      const suspicious = riskScore >= 30; // 風險分數閾值

      if (suspicious) {
        await this.recordSecurityEvent(userIdentifier, 'suspicious_login_pattern', {
          ...context,
          riskScore,
          reasons,
        });
      }

      return {
        suspicious,
        riskScore,
        reasons,
      };
    } catch (error) {
      logger.error('分析登入模式失敗', {
        error: error.message,
        userIdentifier,
        context,
      });
      return { suspicious: false, riskScore: 0, reasons: [] };
    }
  }

  /**
   * 記錄安全事件
   * @param {string} userIdentifier - 用戶標識
   * @param {string} eventType - 事件類型
   * @param {Object} eventData - 事件數據
   */
  async recordSecurityEvent(userIdentifier, eventType, eventData = {}) {
    try {
      const eventKey = this.REDIS_PREFIX.SECURITY_EVENTS + userIdentifier;
      const eventId = this.generateEventId();

      const securityEvent = {
        id: eventId,
        type: eventType,
        timestamp: Date.now(),
        userIdentifier,
        data: eventData,
        severity: this.getEventSeverity(eventType),
      };

      // 獲取現有事件
      const existingEvents = (await this.getRedisData(eventKey)) || { events: [] };

      // 添加新事件並保留最近100個
      const updatedEvents = {
        events: [...existingEvents.events, securityEvent].slice(-100),
        lastEvent: securityEvent,
      };

      await this.setRedisData(eventKey, updatedEvents, 30 * 24 * 60 * 60); // 30天過期

      // 記錄到日誌
      logger.info('安全事件記錄', {
        eventId,
        eventType,
        userIdentifier,
        severity: securityEvent.severity,
        data: eventData,
      });
    } catch (error) {
      logger.error('記錄安全事件失敗', {
        error: error.message,
        userIdentifier,
        eventType,
        eventData,
      });
    }
  }

  /**
   * 清除用戶的登入失敗記錄
   * @param {string} userIdentifier - 用戶標識
   */
  async clearLoginFailures(userIdentifier) {
    try {
      const failureKey = this.REDIS_PREFIX.LOGIN_FAILURES + userIdentifier;
      const lockKey = this.REDIS_PREFIX.ACCOUNT_LOCK + userIdentifier;

      // 清除失敗記錄和鎖定狀態
      await Promise.all([this.clearRedisData(failureKey), this.clearRedisData(lockKey)]);

      logger.info('登入失敗記錄已清除', { userIdentifier });
    } catch (error) {
      logger.error('清除登入失敗記錄失敗', {
        error: error.message,
        userIdentifier,
      });
    }
  }

  /**
   * 解鎖帳號（管理員功能）
   * @param {string} userIdentifier - 用戶標識
   * @param {string} adminUser - 執行解鎖的管理員
   * @param {string} reason - 解鎖原因
   * @returns {Promise<boolean>}
   */
  async unlockAccount(userIdentifier, adminUser = 'system', reason = '管理員解鎖') {
    try {
      const failureKey = this.REDIS_PREFIX.LOGIN_FAILURES + userIdentifier;
      const lockKey = this.REDIS_PREFIX.ACCOUNT_LOCK + userIdentifier;

      // 檢查是否真的被鎖定
      const lockInfo = await this.getRedisData(lockKey);
      if (!lockInfo) {
        logger.warn('嘗試解鎖未鎖定的帳號', { userIdentifier, adminUser });
        return false;
      }

      // 清除鎖定狀態和失敗記錄
      await Promise.all([this.clearRedisData(failureKey), this.clearRedisData(lockKey)]);

      // 記錄解鎖事件
      await this.recordSecurityEvent(userIdentifier, 'account_unlocked', {
        adminUser,
        reason,
        previousLockInfo: lockInfo,
      });

      logger.info('帳號已解鎖', {
        userIdentifier,
        adminUser,
        reason,
        previousLockInfo: lockInfo,
      });

      return true;
    } catch (error) {
      logger.error('解鎖帳號失敗', {
        error: error.message,
        userIdentifier,
        adminUser,
        reason,
      });
      return false;
    }
  }

  /**
   * 手動鎖定帳號（管理員功能）
   * @param {string} userIdentifier - 用戶標識
   * @param {number} duration - 鎖定時間（秒）
   * @param {string} reason - 鎖定原因
   * @param {string} adminUser - 執行鎖定的管理員
   * @returns {Promise<boolean>}
   */
  async manualLockAccount(userIdentifier, duration, reason, adminUser = 'system') {
    try {
      const lockKey = this.REDIS_PREFIX.ACCOUNT_LOCK + userIdentifier;

      // 檢查是否已經鎖定
      const existingLock = await this.getRedisData(lockKey);
      if (existingLock) {
        logger.warn('帳號已經鎖定', { userIdentifier, existingLock });
        return false;
      }

      const lockInfo = {
        lockedAt: Date.now(),
        lockedUntil: Date.now() + duration * 1000,
        reason,
        adminUser,
        duration,
        manual: true,
      };

      await this.setRedisData(lockKey, lockInfo, duration);

      // 記錄鎖定事件
      await this.recordSecurityEvent(userIdentifier, 'account_manually_locked', {
        adminUser,
        reason,
        duration,
        lockedUntil: lockInfo.lockedUntil,
      });

      logger.info('帳號已手動鎖定', {
        userIdentifier,
        adminUser,
        reason,
        duration,
        lockedUntil: new Date(lockInfo.lockedUntil),
      });

      return true;
    } catch (error) {
      logger.error('手動鎖定帳號失敗', {
        error: error.message,
        userIdentifier,
        adminUser,
        reason,
        duration,
      });
      return false;
    }
  }

  /**
   * 獲取用戶的登入失敗記錄
   * @param {string} userIdentifier - 用戶標識
   * @returns {Promise<Object|null>}
   */
  async getLoginFailures(userIdentifier) {
    try {
      const failureKey = this.REDIS_PREFIX.LOGIN_FAILURES + userIdentifier;
      const failures = await this.getRedisData(failureKey);

      if (!failures) {
        return null;
      }

      return {
        userIdentifier,
        attempts: failures.attempts || 0,
        lastFailure: failures.lastFailure || null,
        recentFailures: failures.failures || [],
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error('獲取登入失敗記錄失敗', {
        error: error.message,
        userIdentifier,
      });
      return null;
    }
  }

  /**
   * 獲取用戶的安全事件記錄
   * @param {string} userIdentifier - 用戶標識
   * @param {Object} options - 選項
   * @returns {Promise<Object|null>}
   */
  async getSecurityEvents(userIdentifier, options = {}) {
    try {
      const eventKey = this.REDIS_PREFIX.SECURITY_EVENTS + userIdentifier;
      const events = await this.getRedisData(eventKey);

      if (!events) {
        return null;
      }

      const { limit = 50, eventType = null, severityLevel = null } = options;
      let filteredEvents = events.events || [];

      // 篩選事件類型
      if (eventType) {
        filteredEvents = filteredEvents.filter(event => event.type === eventType);
      }

      // 篩選嚴重程度
      if (severityLevel) {
        filteredEvents = filteredEvents.filter(event => event.severity === severityLevel);
      }

      // 限制數量
      filteredEvents = filteredEvents.slice(-limit);

      return {
        userIdentifier,
        events: filteredEvents,
        totalEvents: filteredEvents.length,
        lastEvent: events.lastEvent || null,
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error('獲取安全事件記錄失敗', {
        error: error.message,
        userIdentifier,
      });
      return null;
    }
  }

  /**
   * 獲取帳號安全狀態總覽
   * @param {string} userIdentifier - 用戶標識
   * @returns {Promise<Object>}
   */
  async getAccountSecurityStatus(userIdentifier) {
    try {
      const [lockInfo, failureInfo, securityEvents] = await Promise.all([
        this.checkAccountLock(userIdentifier),
        this.getLoginFailures(userIdentifier),
        this.getSecurityEvents(userIdentifier, { limit: 10 }),
      ]);

      return {
        userIdentifier,
        lockStatus: lockInfo,
        failureHistory: failureInfo,
        recentEvents: securityEvents,
        riskAssessment: this.assessAccountRisk(lockInfo, failureInfo, securityEvents),
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error('獲取帳號安全狀態失敗', {
        error: error.message,
        userIdentifier,
      });
      return {
        userIdentifier,
        lockStatus: { locked: false },
        failureHistory: null,
        recentEvents: null,
        riskAssessment: { level: 'unknown', score: 0 },
        timestamp: Date.now(),
      };
    }
  }

  /**
   * 評估帳號風險等級
   * @param {Object} lockInfo - 鎖定信息
   * @param {Object} failureInfo - 失敗信息
   * @param {Object} securityEvents - 安全事件
   * @returns {Object}
   */
  assessAccountRisk(lockInfo, failureInfo, securityEvents) {
    let riskScore = 0;
    let riskLevel = 'low';
    const factors = [];

    // 檢查鎖定狀態
    if (lockInfo.locked) {
      riskScore += 30;
      factors.push('account_locked');
    }

    // 檢查失敗記錄
    if (failureInfo && failureInfo.attempts > 0) {
      riskScore += Math.min(failureInfo.attempts * 5, 25);
      factors.push(`${failureInfo.attempts}_failed_attempts`);
    }

    // 檢查安全事件
    if (securityEvents && securityEvents.events.length > 0) {
      const recentEvents = securityEvents.events.filter(
        event => Date.now() - event.timestamp < 24 * 60 * 60 * 1000
      );

      const criticalEvents = recentEvents.filter(event => event.severity === 'critical');
      const highEvents = recentEvents.filter(event => event.severity === 'high');

      riskScore += criticalEvents.length * 20;
      riskScore += highEvents.length * 10;

      if (criticalEvents.length > 0) factors.push('critical_events');
      if (highEvents.length > 0) factors.push('high_risk_events');
    }

    // 確定風險等級
    if (riskScore >= 60) {
      riskLevel = 'critical';
    } else if (riskScore >= 40) {
      riskLevel = 'high';
    } else if (riskScore >= 20) {
      riskLevel = 'medium';
    }

    return {
      level: riskLevel,
      score: riskScore,
      factors,
      timestamp: Date.now(),
    };
  }

  /**
   * 鎖定帳號
   * @private
   */
  async lockAccount(userIdentifier, duration, reason) {
    const lockKey = this.REDIS_PREFIX.ACCOUNT_LOCK + userIdentifier;
    const lockInfo = {
      lockedAt: Date.now(),
      lockedUntil: Date.now() + duration * 1000,
      reason,
      duration,
    };

    await this.setRedisData(lockKey, lockInfo, duration);

    await this.recordSecurityEvent(userIdentifier, 'account_locked', {
      reason,
      duration,
      lockedUntil: lockInfo.lockedUntil,
    });
  }

  /**
   * 判斷是否應該鎖定帳號
   * @private
   */
  shouldLockAccount(attempts, recentFailures = []) {
    // 漸進式鎖定策略
    for (const [threshold, duration] of Object.entries(this.PROGRESSIVE_LOCKOUT)) {
      if (attempts >= parseInt(threshold)) {
        return {
          lock: true,
          duration,
          reason: `連續${attempts}次登入失敗`,
        };
      }
    }

    // 快速連續失敗檢測
    const now = Date.now();
    const recentFailuresCount = recentFailures.filter(
      f => now - f.timestamp < 5 * 60 * 1000 // 5分鐘內
    ).length;

    if (recentFailuresCount >= 3) {
      return {
        lock: true,
        duration: 15 * 60, // 15分鐘
        reason: '短時間內多次登入失敗',
      };
    }

    return { lock: false };
  }

  /**
   * 分析風險因素
   * @private
   */
  async analyzeRiskFactors(currentLogin, recentLogins = []) {
    let score = 0;
    const reasons = [];

    if (recentLogins.length === 0) {
      return { score, reasons };
    }

    // 檢查新 IP 地址
    const knownIPs = new Set(recentLogins.map(l => l.ipAddress));
    if (currentLogin.ipAddress && !knownIPs.has(currentLogin.ipAddress)) {
      score += this.RISK_FACTORS.NEW_IP;
      reasons.push('新 IP 地址');
    }

    // 檢查新設備
    const knownDevices = new Set(recentLogins.map(l => l.deviceFingerprint));
    if (currentLogin.deviceFingerprint && !knownDevices.has(currentLogin.deviceFingerprint)) {
      score += this.RISK_FACTORS.NEW_DEVICE;
      reasons.push('新設備');
    }

    // 檢查快速連續登入
    const lastLogin = recentLogins[recentLogins.length - 1];
    if (lastLogin && currentLogin.timestamp - lastLogin.timestamp < 60 * 1000) {
      score += this.RISK_FACTORS.RAPID_ATTEMPTS;
      reasons.push('快速連續登入');
    }

    // 檢查異常時間
    const hour = new Date(currentLogin.timestamp).getHours();
    if (hour < 6 || hour > 23) {
      score += this.RISK_FACTORS.SUSPICIOUS_TIMING;
      reasons.push('異常時間登入');
    }

    return { score, reasons };
  }

  /**
   * 產生事件 ID
   * @private
   */
  generateEventId() {
    return `sec_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * 獲取事件嚴重程度
   * @private
   */
  getEventSeverity(eventType) {
    const severityMap = {
      login_failure: 'low',
      account_locked: 'medium',
      suspicious_login_pattern: 'high',
      high_risk_login: 'high',
      security_breach: 'critical',
    };

    return severityMap[eventType] || 'medium';
  }

  /**
   * Redis 操作輔助方法
   * @private
   */
  async getRedisData(key) {
    try {
      if (!redisConnection.isConnected) {
        return null;
      }
      return await redisConnection.get(key);
    } catch (error) {
      logger.error('Redis 讀取失敗', { key, error: error.message });
      return null;
    }
  }

  /**
   * @private
   */
  async setRedisData(key, value, ttl = null) {
    try {
      if (!redisConnection.isConnected) {
        return false;
      }

      if (ttl) {
        await redisConnection.set(key, value, { ttl });
      } else {
        await redisConnection.set(key, value);
      }
      return true;
    } catch (error) {
      logger.error('Redis 寫入失敗', { key, error: error.message });
      return false;
    }
  }

  /**
   * @private
   */
  async clearRedisData(key) {
    try {
      if (!redisConnection.isConnected) {
        return false;
      }
      return await redisConnection.delete(key);
    } catch (error) {
      logger.error('Redis 刪除失敗', { key, error: error.message });
      return false;
    }
  }
}

// 創建單例實例
const securityEnhancement = new SecurityEnhancement();

module.exports = { securityEnhancement };
