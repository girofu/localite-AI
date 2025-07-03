const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { redisConnection } = require('../config/redis');
const { logger } = require('../middleware/requestLogger');

/**
 * JWT Token 管理服務
 * 補充 Firebase token，提供系統內部 token 管理
 */
class JWTService {
  constructor() {
    this.secret = process.env.JWT_SECRET || 'localite-jwt-secret-key';
    this.refreshSecret = process.env.JWT_REFRESH_SECRET || 'localite-refresh-secret-key';

    // Token 配置
    this.accessTokenExpiry = process.env.JWT_ACCESS_EXPIRY || '15m';
    this.refreshTokenExpiry = process.env.JWT_REFRESH_EXPIRY || '7d';

    // Redis 鍵前綴
    this.tokenBlacklistPrefix = 'token_blacklist:';
    this.refreshTokenPrefix = 'refresh_token:';
    this.sessionPrefix = 'session:';
    this.userSessionsPrefix = 'user_sessions:'; // 用戶的活躍 session 列表
    this.deviceSessionsPrefix = 'device_sessions:'; // 設備 session 映射

    // Session 配置
    this.maxConcurrentSessions = parseInt(process.env.MAX_CONCURRENT_SESSIONS, 10) || 5;
    this.sessionInactivityTimeout = process.env.SESSION_INACTIVITY_TIMEOUT || '24h';
    this.enableDeviceTracking = process.env.ENABLE_DEVICE_TRACKING !== 'false';
    this.enableIPTracking = process.env.ENABLE_IP_TRACKING !== 'false';

    // 啟動 Session 清理定時器
    this.startSessionCleanupTimer();
  }

  /**
   * 生成 Access Token
   * @param {Object} payload - Token 載荷
   * @param {Object} options - Token 選項
   */
  generateAccessToken(payload, options = {}) {
    const tokenPayload = {
      ...payload,
      type: 'access',
      iat: Math.floor(Date.now() / 1000),
      jti: crypto.randomUUID(), // JWT ID，用於撤銷
    };

    const tokenOptions = {
      expiresIn: options.expiresIn || this.accessTokenExpiry,
      issuer: 'localite',
      audience: 'localite-users',
      ...options,
    };

    return jwt.sign(tokenPayload, this.secret, tokenOptions);
  }

  /**
   * 生成 Refresh Token
   * @param {Object} payload - Token 載荷
   */
  generateRefreshToken(payload) {
    const tokenPayload = {
      uid: payload.uid,
      email: payload.email,
      type: 'refresh',
      iat: Math.floor(Date.now() / 1000),
      jti: crypto.randomUUID(),
    };

    const tokenOptions = {
      expiresIn: this.refreshTokenExpiry,
      issuer: 'localite',
      audience: 'localite-users',
    };

    return jwt.sign(tokenPayload, this.refreshSecret, tokenOptions);
  }

  /**
   * 生成 Token 對（Access + Refresh）
   * @param {Object} user - 用戶資訊
   * @param {Object} context - 請求上下文（IP、設備指紋等）
   */
  async generateTokenPair(user, context = {}) {
    try {
      const payload = {
        uid: user.firebaseUid || user.uid,
        email: user.email,
        role: user.role,
        permissions: user.permissions || [],
        sessionId: crypto.randomUUID(),
      };

      const accessToken = this.generateAccessToken(payload);
      const refreshToken = this.generateRefreshToken(payload);

      // 解析 token 以獲取過期時間
      const decodedAccess = jwt.decode(accessToken);
      const decodedRefresh = jwt.decode(refreshToken);

      // 在 Redis 中存儲 refresh token
      await this.storeRefreshToken(decodedRefresh.jti, {
        uid: payload.uid,
        email: payload.email,
        sessionId: payload.sessionId,
        createdAt: new Date().toISOString(),
      });

      // 存儲增強的 session 資訊
      await this.createSession(payload.sessionId, {
        uid: payload.uid,
        email: payload.email,
        role: payload.role,
        accessTokenId: decodedAccess.jti,
        refreshTokenId: decodedRefresh.jti,
        // 上下文資訊
        ipAddress: context.ipAddress,
        deviceFingerprint: context.deviceFingerprint,
        userAgent: context.userAgent,
        loginMethod: context.loginMethod || 'jwt',
      });

      logger.info('Token 對生成成功', {
        uid: payload.uid,
        email: payload.email,
        sessionId: payload.sessionId,
        ipAddress: context.ipAddress || 'unknown',
        loginMethod: context.loginMethod || 'jwt',
      });

      return {
        accessToken,
        refreshToken,
        tokenType: 'Bearer',
        expiresIn: JWTService.parseExpiry(this.accessTokenExpiry),
        sessionId: payload.sessionId,
      };
    } catch (error) {
      logger.error('Token 對生成失敗', { error: error.message });
      throw new Error('Token 生成失敗');
    }
  }

  /**
   * 驗證 Access Token
   * @param {string} token - JWT Token
   */
  async verifyAccessToken(token) {
    try {
      // 首先檢查 token 是否在黑名單中
      const decoded = jwt.decode(token);
      if (!decoded || !decoded.jti) {
        throw new Error('無效的 token 格式');
      }

      const isBlacklisted = await this.isTokenBlacklisted(decoded.jti);
      if (isBlacklisted) {
        throw new Error('Token 已被撤銷');
      }

      // 驗證 token 簽名和有效性
      const verified = jwt.verify(token, this.secret, {
        issuer: 'localite',
        audience: 'localite-users',
      });

      if (verified.type !== 'access') {
        throw new Error('Token 類型錯誤');
      }

      // 更新 session 活動時間
      if (verified.sessionId) {
        await this.updateSessionActivity(verified.sessionId);
      }

      return verified;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error('Token 已過期');
      } else if (error instanceof jwt.NotBeforeError) {
        throw new Error('Token 尚未生效');
      } else if (error instanceof jwt.JsonWebTokenError) {
        throw new Error('Token 驗證失敗');
      }
      throw error;
    }
  }

  /**
   * 驗證 Refresh Token
   * @param {string} token - Refresh Token
   */
  async verifyRefreshToken(token) {
    try {
      const decoded = jwt.decode(token);
      if (!decoded || !decoded.jti) {
        throw new Error('無效的 refresh token 格式');
      }

      // 檢查 refresh token 是否存在於 Redis 中
      const storedToken = await this.getRefreshToken(decoded.jti);
      if (!storedToken) {
        throw new Error('Refresh token 不存在或已過期');
      }

      // 驗證 token 簽名
      const verified = jwt.verify(token, this.refreshSecret, {
        issuer: 'localite',
        audience: 'localite-users',
      });

      if (verified.type !== 'refresh') {
        throw new Error('Token 類型錯誤');
      }

      return verified;
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new Error('Refresh token 驗證失敗');
      } else if (error instanceof jwt.TokenExpiredError) {
        throw new Error('Refresh token 已過期');
      }
      throw error;
    }
  }

  /**
   * 刷新 Access Token
   * @param {string} refreshToken - Refresh Token
   */
  async refreshAccessToken(refreshToken) {
    try {
      const verified = await this.verifyRefreshToken(refreshToken);

      // 從 Redis 獲取完整的用戶資訊
      const storedToken = await this.getRefreshToken(verified.jti);
      if (!storedToken) {
        throw new Error('Refresh token 無效');
      }

      // 生成新的 access token
      const newPayload = {
        uid: verified.uid,
        email: verified.email,
        role: storedToken.role || 'user',
        sessionId: storedToken.sessionId,
      };

      const newAccessToken = this.generateAccessToken(newPayload);
      const decoded = jwt.decode(newAccessToken);

      // 更新 session 資訊
      await this.updateSession(storedToken.sessionId, {
        accessTokenId: decoded.jti,
        lastActivity: new Date().toISOString(),
      });

      logger.info('Access token 刷新成功', {
        uid: verified.uid,
        email: verified.email,
        sessionId: storedToken.sessionId,
      });

      return {
        accessToken: newAccessToken,
        tokenType: 'Bearer',
        expiresIn: JWTService.parseExpiry(this.accessTokenExpiry),
      };
    } catch (error) {
      logger.error('Token 刷新失敗', { error: error.message });
      throw error;
    }
  }

  /**
   * 撤銷 Token（加入黑名單）
   * @param {string} token - 要撤銷的 token
   */
  async revokeToken(token) {
    try {
      const decoded = jwt.decode(token);
      if (!decoded || !decoded.jti) {
        throw new Error('無效的 token 格式');
      }

      // 將 token 加入黑名單，設置過期時間為 token 的剩餘有效期
      const ttl = decoded.exp - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        await this.addToBlacklist(decoded.jti, ttl);
      }

      // 如果是 refresh token，從 Redis 中刪除
      if (decoded.type === 'refresh') {
        await this.deleteRefreshToken(decoded.jti);
      }

      // 如果有 sessionId，撤銷整個 session
      if (decoded.sessionId) {
        await this.revokeSession(decoded.sessionId);
      }

      logger.info('Token 撤銷成功', {
        jti: decoded.jti,
        type: decoded.type,
        sessionId: decoded.sessionId,
      });

      return true;
    } catch (error) {
      logger.error('Token 撤銷失敗', { error: error.message });
      throw error;
    }
  }

  /**
   * 撤銷所有用戶 Token
   * @param {string} uid - 用戶 ID
   */
  async revokeAllUserTokens(uid) {
    try {
      // 獲取用戶的所有 session
      const sessions = await this.getUserSessions(uid);

      // 撤銷所有 session
      await Promise.all(sessions.map(session => this.revokeSession(session.sessionId)));

      logger.info('撤銷用戶所有 token', { uid, sessionCount: sessions.length });
      return sessions.length;
    } catch (error) {
      logger.error('撤銷用戶所有 token 失敗', { error: error.message, uid });
      throw error;
    }
  }

  // --- Redis 相關方法 ---

  /**
   * 檢查 Token 是否在黑名單中
   */
  async isTokenBlacklisted(jti) {
    try {
      return await redisConnection.exists(`${this.tokenBlacklistPrefix}${jti}`);
    } catch (error) {
      logger.warn('檢查 token 黑名單失敗', { error: error.message, jti });
      return false; // 如果 Redis 不可用，不阻止正常流程
    }
  }

  /**
   * 將 Token 加入黑名單
   */
  async addToBlacklist(jti, ttl) {
    try {
      await redisConnection.set(
        `${this.tokenBlacklistPrefix}${jti}`,
        { revokedAt: new Date().toISOString() },
        { ttl }
      );
    } catch (error) {
      logger.error('添加 token 到黑名單失敗', { error: error.message, jti });
      throw error;
    }
  }

  /**
   * 存儲 Refresh Token
   */
  async storeRefreshToken(jti, tokenData) {
    try {
      const ttl = JWTService.parseExpiry(this.refreshTokenExpiry);
      await redisConnection.set(`${this.refreshTokenPrefix}${jti}`, tokenData, { ttl });
    } catch (error) {
      logger.error('存儲 refresh token 失敗', { error: error.message, jti });
      throw error;
    }
  }

  /**
   * 獲取 Refresh Token
   */
  async getRefreshToken(jti) {
    try {
      return await redisConnection.get(`${this.refreshTokenPrefix}${jti}`);
    } catch (error) {
      logger.warn('獲取 refresh token 失敗', { error: error.message, jti });
      return null;
    }
  }

  /**
   * 刪除 Refresh Token
   */
  async deleteRefreshToken(jti) {
    try {
      await redisConnection.delete(`${this.refreshTokenPrefix}${jti}`);
    } catch (error) {
      logger.error('刪除 refresh token 失敗', { error: error.message, jti });
    }
  }

  // --- Session 管理方法 ---

  /**
   * 創建 Session（增強版）
   */
  async createSession(sessionId, sessionData) {
    try {
      const { uid } = sessionData;
      const { deviceFingerprint } = sessionData;

      // 檢查並發 Session 限制
      await this.enforceConcurrentSessionLimit(uid);

      // 增強的 session 數據
      const enhancedSessionData = {
        ...sessionData,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        isActive: true,
        deviceFingerprint: deviceFingerprint || null,
        ipAddress: sessionData.ipAddress || null,
        userAgent: sessionData.userAgent || null,
        loginMethod: sessionData.loginMethod || 'unknown',
        securityFlags: {
          ipVerified: false,
          deviceVerified: false,
          anomalyDetected: false,
        },
      };

      const ttl = JWTService.parseExpiry(this.refreshTokenExpiry);

      // 存儲 session
      await redisConnection.set(`${this.sessionPrefix}${sessionId}`, enhancedSessionData, { ttl });

      // 將 session 添加到用戶的活躍 session 列表
      await this.addToUserSessions(uid, sessionId);

      // 如果啟用設備追蹤，記錄設備映射
      if (this.enableDeviceTracking && deviceFingerprint) {
        await this.recordDeviceSession(deviceFingerprint, sessionId, uid);
      }

      logger.info('增強 Session 創建成功', {
        sessionId,
        uid,
        deviceFingerprint: deviceFingerprint || 'none',
        ipAddress: sessionData.ipAddress || 'none',
      });
    } catch (error) {
      logger.error('創建 session 失敗', { error: error.message, sessionId });
      throw error;
    }
  }

  /**
   * 獲取 Session
   */
  async getSession(sessionId) {
    try {
      return await redisConnection.get(`${this.sessionPrefix}${sessionId}`);
    } catch (error) {
      logger.warn('獲取 session 失敗', { error: error.message, sessionId });
      return null;
    }
  }

  /**
   * 更新 Session
   */
  async updateSession(sessionId, updates) {
    try {
      const session = await this.getSession(sessionId);
      if (session) {
        const updatedSession = { ...session, ...updates };
        const ttl = JWTService.parseExpiry(this.refreshTokenExpiry);
        await redisConnection.set(`${this.sessionPrefix}${sessionId}`, updatedSession, { ttl });
      }
    } catch (error) {
      logger.error('更新 session 失敗', { error: error.message, sessionId });
    }
  }

  /**
   * 更新 Session 活動時間
   */
  async updateSessionActivity(sessionId) {
    try {
      await this.updateSession(sessionId, {
        lastActivity: new Date().toISOString(),
      });
    } catch (error) {
      logger.warn('更新 session 活動時間失敗', { error: error.message, sessionId });
    }
  }

  /**
   * 撤銷 Session（增強版）
   */
  async revokeSession(sessionId) {
    try {
      const session = await this.getSession(sessionId);
      if (session) {
        // 將相關 token 加入黑名單
        if (session.accessTokenId) {
          await this.addToBlacklist(session.accessTokenId, 3600); // 1 小時
        }
        if (session.refreshTokenId) {
          await this.deleteRefreshToken(session.refreshTokenId);
        }

        // 從用戶 session 列表中移除
        if (session.uid) {
          await this.removeFromUserSessions(session.uid, sessionId);
        }

        // 標記 session 為已撤銷（而不是直接刪除，保留審計記錄）
        await this.updateSession(sessionId, {
          isActive: false,
          revokedAt: new Date().toISOString(),
          revokedReason: 'user_revocation',
        });

        // 30 分鐘後完全刪除
        setTimeout(
          async () => {
            try {
              await redisConnection.delete(`${this.sessionPrefix}${sessionId}`);
            } catch (error) {
              logger.error('延遲刪除 session 失敗', { error: error.message, sessionId });
            }
          },
          30 * 60 * 1000
        );

        logger.info('Session 撤銷成功', {
          sessionId,
          uid: session.uid,
          accessTokenId: session.accessTokenId,
        });
      }
    } catch (error) {
      logger.error('撤銷 session 失敗', { error: error.message, sessionId });
      throw error;
    }
  }

  /**
   * 獲取用戶的所有 Session
   */
  async getUserSessions(uid) {
    try {
      // 優先從用戶 session 列表獲取（更高效）
      const sessionIds = await this.getUserSessionList(uid);
      const sessions = [];

      if (sessionIds && sessionIds.length > 0) {
        const sessionDataList = await Promise.all(
          sessionIds.map(async sessionId => {
            const sessionData = await this.getSession(sessionId);
            if (sessionData && sessionData.isActive) {
              return {
                sessionId,
                ...sessionData,
              };
            }
            return null;
          })
        );

        sessions.push(...sessionDataList.filter(Boolean));
      }

      return sessions;
    } catch (error) {
      logger.error('獲取用戶 sessions 失敗', { error: error.message, uid });
      return [];
    }
  }

  // --- 新增的 Session 管理方法 ---

  /**
   * 檢查並發 Session 限制
   */
  async enforceConcurrentSessionLimit(uid) {
    try {
      const activeSessions = await this.getUserSessions(uid);

      if (activeSessions.length >= this.maxConcurrentSessions) {
        // 找到最舊的 session 並撤銷
        const oldestSession = activeSessions.sort(
          (a, b) => new Date(a.lastActivity) - new Date(b.lastActivity)
        )[0];

        if (oldestSession) {
          await this.revokeSession(oldestSession.sessionId);
          logger.info('撤銷最舊 Session 以維持並發限制', {
            uid,
            revokedSessionId: oldestSession.sessionId,
            limit: this.maxConcurrentSessions,
          });
        }
      }
    } catch (error) {
      logger.error('檢查並發 Session 限制失敗', { error: error.message, uid });
      // 不要阻止 session 創建，只記錄錯誤
    }
  }

  /**
   * 添加 Session 到用戶列表
   */
  async addToUserSessions(uid, sessionId) {
    try {
      const key = `${this.userSessionsPrefix}${uid}`;
      const currentSessions = (await redisConnection.get(key)) || [];

      if (!currentSessions.includes(sessionId)) {
        currentSessions.push(sessionId);
        const ttl = JWTService.parseExpiry(this.refreshTokenExpiry);
        await redisConnection.set(key, currentSessions, { ttl });
      }
    } catch (error) {
      logger.error('添加 Session 到用戶列表失敗', { error: error.message, uid, sessionId });
    }
  }

  /**
   * 從用戶列表移除 Session
   */
  async removeFromUserSessions(uid, sessionId) {
    try {
      const key = `${this.userSessionsPrefix}${uid}`;
      const currentSessions = (await redisConnection.get(key)) || [];

      const updatedSessions = currentSessions.filter(id => id !== sessionId);

      if (updatedSessions.length > 0) {
        const ttl = JWTService.parseExpiry(this.refreshTokenExpiry);
        await redisConnection.set(key, updatedSessions, { ttl });
      } else {
        await redisConnection.delete(key);
      }
    } catch (error) {
      logger.error('從用戶列表移除 Session 失敗', { error: error.message, uid, sessionId });
    }
  }

  /**
   * 獲取用戶 Session 列表
   */
  async getUserSessionList(uid) {
    try {
      const key = `${this.userSessionsPrefix}${uid}`;
      return (await redisConnection.get(key)) || [];
    } catch (error) {
      logger.warn('獲取用戶 Session 列表失敗', { error: error.message, uid });
      return [];
    }
  }

  /**
   * 記錄設備 Session 映射
   */
  async recordDeviceSession(deviceFingerprint, sessionId, uid) {
    try {
      const key = `${this.deviceSessionsPrefix}${deviceFingerprint}`;
      const deviceData = {
        sessionId,
        uid,
        lastSeen: new Date().toISOString(),
        trustLevel: 'unknown',
      };

      const ttl = JWTService.parseExpiry(this.refreshTokenExpiry);
      await redisConnection.set(key, deviceData, { ttl });
    } catch (error) {
      logger.error('記錄設備 Session 映射失敗', { error: error.message, deviceFingerprint });
    }
  }

  /**
   * 驗證 Session 安全性
   */
  async validateSessionSecurity(sessionId, requestContext = {}) {
    try {
      const session = await this.getSession(sessionId);
      if (!session) {
        return { valid: false, reason: 'session_not_found' };
      }

      const validationResult = {
        valid: true,
        warnings: [],
        securityFlags: { ...session.securityFlags },
      };

      // IP 地址驗證
      if (this.enableIPTracking && requestContext.ipAddress) {
        if (session.ipAddress && session.ipAddress !== requestContext.ipAddress) {
          validationResult.warnings.push('ip_address_changed');
          logger.warn('Session IP 地址變更', {
            sessionId,
            originalIP: session.ipAddress,
            currentIP: requestContext.ipAddress,
          });
        } else if (!session.ipAddress) {
          // 首次設置 IP
          await this.updateSession(sessionId, { ipAddress: requestContext.ipAddress });
          validationResult.securityFlags.ipVerified = true;
        }
      }

      // 設備指紋驗證
      if (this.enableDeviceTracking && requestContext.deviceFingerprint) {
        if (
          session.deviceFingerprint &&
          session.deviceFingerprint !== requestContext.deviceFingerprint
        ) {
          validationResult.warnings.push('device_fingerprint_mismatch');
          logger.warn('Session 設備指紋不匹配', {
            sessionId,
            originalDevice: session.deviceFingerprint,
            currentDevice: requestContext.deviceFingerprint,
          });
        } else if (!session.deviceFingerprint) {
          // 首次設置設備指紋
          await this.updateSession(sessionId, {
            deviceFingerprint: requestContext.deviceFingerprint,
          });
          validationResult.securityFlags.deviceVerified = true;
        }
      }

      // 檢查 Session 閒置時間
      const lastActivity = new Date(session.lastActivity);
      const inactivityLimit = JWTService.parseExpiry(this.sessionInactivityTimeout) * 1000;
      const timeSinceLastActivity = Date.now() - lastActivity.getTime();

      if (timeSinceLastActivity > inactivityLimit) {
        validationResult.valid = false;
        validationResult.reason = 'session_inactive';
        logger.info('Session 因閒置過久被標記為無效', {
          sessionId,
          lastActivity: session.lastActivity,
          inactivityLimit: this.sessionInactivityTimeout,
        });
      }

      // 更新安全標記
      if (validationResult.securityFlags !== session.securityFlags) {
        await this.updateSession(sessionId, { securityFlags: validationResult.securityFlags });
      }

      return validationResult;
    } catch (error) {
      logger.error('Session 安全驗證失敗', { error: error.message, sessionId });
      return { valid: false, reason: 'validation_error' };
    }
  }

  /**
   * 撤銷用戶的其他所有 Session（保留當前）
   */
  async revokeOtherUserSessions(uid, currentSessionId) {
    try {
      const allSessions = await this.getUserSessions(uid);
      const otherSessions = allSessions.filter(session => session.sessionId !== currentSessionId);

      const revokePromises = otherSessions.map(session => this.revokeSession(session.sessionId));

      await Promise.all(revokePromises);

      logger.info('撤銷用戶其他所有 Session', {
        uid,
        currentSessionId,
        revokedCount: otherSessions.length,
      });

      return otherSessions.length;
    } catch (error) {
      logger.error('撤銷用戶其他 Session 失敗', { error: error.message, uid, currentSessionId });
      throw error;
    }
  }

  /**
   * 啟動 Session 清理定時器
   */
  startSessionCleanupTimer() {
    // 在測試環境中不啟動定時器
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    // 每小時執行一次清理
    const cleanupInterval = 60 * 60 * 1000; // 1 小時

    this.sessionCleanupTimer = setInterval(async () => {
      try {
        await this.cleanupExpiredSessions();
      } catch (error) {
        logger.error('Session 清理任務執行失敗', { error: error.message });
      }
    }, cleanupInterval);

    logger.info('Session 清理定時器已啟動', { interval: '1小時' });
  }

  /**
   * 清理過期的 Session
   */
  async cleanupExpiredSessions() {
    try {
      const client = redisConnection.getClient();
      const sessionKeys = await client.keys(`${this.sessionPrefix}*`);
      const inactivityLimit = JWTService.parseExpiry(this.sessionInactivityTimeout) * 1000;
      const cleanupResults = await Promise.all(
        sessionKeys.map(async key => {
          try {
            const sessionData = await redisConnection.get(key);
            if (sessionData && sessionData.lastActivity) {
              const lastActivity = new Date(sessionData.lastActivity);
              const timeSinceLastActivity = Date.now() - lastActivity.getTime();

              if (timeSinceLastActivity > inactivityLimit) {
                const sessionId = key.replace(this.sessionPrefix, '');
                await this.revokeSession(sessionId);
                return 1; // 返回清理計數
              }
            }
            return 0;
          } catch (error) {
            logger.error('清理單個 Session 失敗', { error: error.message, key });
            return 0;
          }
        })
      );

      const cleanedCount = cleanupResults.reduce((total, count) => total + count, 0);

      if (cleanedCount > 0) {
        logger.info('Session 清理完成', { cleanedCount });
      }

      return cleanedCount;
    } catch (error) {
      logger.error('清理過期 Session 失敗', { error: error.message });
      throw error;
    }
  }

  // --- 工具方法 ---

  /**
   * 解析過期時間字串為秒數
   */
  static parseExpiry(expiry) {
    if (typeof expiry === 'number') return expiry;

    const units = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
    };

    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) return 900; // 預設 15 分鐘

    const [, value, unit] = match;
    return parseInt(value, 10) * (units[unit] || 1);
  }

  /**
   * 生成安全的隨機字串
   */
  static generateSecureToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }
}

module.exports = new JWTService();
