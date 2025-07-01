const { getMessaging } = require('../config/firebase');
const { logger } = require('../middleware/requestLogger');

/**
 * Firebase Cloud Messaging 服務類別
 * 提供推播通知發送、主題管理和通知模板功能
 */
class MessagingService {
  constructor() {
    this.messaging = null;
    this.initialized = false;
    this.notificationHistory = new Map(); // 簡單的內存存儲，生產環境應使用資料庫
  }

  /**
   * 初始化 Firebase Messaging（懶加載）
   */
  initialize() {
    if (this.initialized) {
      return this.messaging;
    }

    try {
      this.messaging = getMessaging();
      this.initialized = true;

      logger.info('Firebase Cloud Messaging 初始化成功');
      return this.messaging;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      logger.error('Firebase Cloud Messaging 初始化失敗', {
        error: errorMessage,
      });
      throw new Error('推播服務不可用');
    }
  }

  /**
   * 驗證設備 token 格式
   */
  validateToken(token) {
    if (!token || typeof token !== 'string') {
      throw new Error('設備 token 不能為空');
    }

    // FCM token 通常很長且包含特定字符
    if (token.length < 50) {
      throw new Error('設備 token 格式不正確');
    }

    return true;
  }

  /**
   * 驗證通知內容
   */
  validateNotification(notification) {
    if (!notification) {
      throw new Error('通知內容不能為空');
    }

    if (!notification.title && !notification.body) {
      throw new Error('通知必須包含標題或內容');
    }

    // 檢查字符限制
    if (notification.title && notification.title.length > 200) {
      throw new Error('通知標題過長，最多 200 字符');
    }

    if (notification.body && notification.body.length > 4000) {
      throw new Error('通知內容過長，最多 4000 字符');
    }

    return true;
  }

  /**
   * 生成通知 ID
   */
  generateNotificationId() {
    return `notif_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * 記錄通知歷史
   */
  recordNotification(notificationId, data) {
    this.notificationHistory.set(notificationId, {
      ...data,
      createdAt: new Date().toISOString(),
      status: 'sent',
    });

    // 限制歷史記錄數量（防止內存溢出）
    if (this.notificationHistory.size > 1000) {
      const firstKey = this.notificationHistory.keys().next().value;
      this.notificationHistory.delete(firstKey);
    }
  }

  /**
   * 發送通知到單一設備
   */
  async sendToDevice(token, notification, data = {}, options = {}) {
    try {
      const messaging = this.initialize();

      // 驗證輸入
      this.validateToken(token);
      this.validateNotification(notification);

      const {
        priority = 'high',
        timeToLive = 3600, // 1小時
        collapseKey = null,
        dryRun = false,
      } = options;

      // 構建消息對象
      const message = {
        token,
        notification: {
          title: notification.title,
          body: notification.body,
          ...(notification.imageUrl && { imageUrl: notification.imageUrl }),
        },
        ...(Object.keys(data).length > 0 && { data }),
        android: {
          priority,
          ttl: timeToLive * 1000, // Android 使用毫秒
          ...(collapseKey && { collapseKey }),
          notification: {
            icon: notification.icon || 'ic_notification',
            color: notification.color || '#2196F3',
            sound: notification.sound || 'default',
            clickAction:
              notification.clickAction || 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        apns: {
          headers: {
            'apns-priority': priority === 'high' ? '10' : '5',
            'apns-expiration': Math.floor(Date.now() / 1000) + timeToLive,
          },
          payload: {
            aps: {
              alert: {
                title: notification.title,
                body: notification.body,
              },
              badge: notification.badge || 1,
              sound: notification.sound || 'default',
            },
          },
        },
        webpush: {
          headers: {
            TTL: timeToLive.toString(),
          },
          notification: {
            title: notification.title,
            body: notification.body,
            icon: notification.icon || '/icon-192x192.png',
            image: notification.imageUrl,
            requireInteraction: notification.requireInteraction || false,
            actions: notification.actions || [],
          },
        },
      };

      // 發送消息
      const response = await messaging.send(message, dryRun);

      // 記錄成功
      const notificationId = this.generateNotificationId();
      this.recordNotification(notificationId, {
        type: 'single',
        token,
        notification,
        data,
        messageId: response,
        dryRun,
      });

      logger.info('推播通知發送成功', {
        notificationId,
        messageId: response,
        token: `${token.substring(0, 20)}...`,
        dryRun,
      });

      return {
        success: true,
        messageId: response,
        notificationId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '發送失敗';

      // 記錄錯誤類型
      let errorType = 'unknown';
      if (error.code === 'messaging/registration-token-not-registered') {
        errorType = 'invalid_token';
      } else if (error.code === 'messaging/invalid-argument') {
        errorType = 'invalid_argument';
      } else if (error.code === 'messaging/quota-exceeded') {
        errorType = 'quota_exceeded';
      }

      logger.error('推播通知發送失敗', {
        error: errorMessage,
        errorType,
        token: token ? `${token.substring(0, 20)}...` : 'unknown',
      });

      throw new Error(`通知發送失敗: ${errorMessage}`);
    }
  }

  /**
   * 發送通知到多個設備（批量發送）
   */
  async sendToMultipleDevices(tokens, notification, data = {}, options = {}) {
    try {
      const messaging = this.initialize();

      // 驗證輸入
      if (!Array.isArray(tokens) || tokens.length === 0) {
        throw new Error('設備 token 列表不能為空');
      }

      if (tokens.length > 500) {
        throw new Error('批量發送最多支持 500 個設備');
      }

      // 驗證每個 token
      tokens.forEach((token) => this.validateToken(token));
      this.validateNotification(notification);

      const { priority = 'high', timeToLive = 3600, dryRun = false } = options;

      // 構建多播消息
      const message = {
        tokens,
        notification: {
          title: notification.title,
          body: notification.body,
          ...(notification.imageUrl && { imageUrl: notification.imageUrl }),
        },
        ...(Object.keys(data).length > 0 && { data }),
        android: {
          priority,
          ttl: timeToLive * 1000,
          notification: {
            icon: notification.icon || 'ic_notification',
            color: notification.color || '#2196F3',
            sound: notification.sound || 'default',
          },
        },
        apns: {
          headers: {
            'apns-priority': priority === 'high' ? '10' : '5',
            'apns-expiration': Math.floor(Date.now() / 1000) + timeToLive,
          },
          payload: {
            aps: {
              alert: {
                title: notification.title,
                body: notification.body,
              },
              badge: notification.badge || 1,
              sound: notification.sound || 'default',
            },
          },
        },
      };

      // 發送多播消息
      const response = await messaging.sendEachForMulticast(message, dryRun);

      // 處理結果
      const results = {
        successCount: response.successCount,
        failureCount: response.failureCount,
        responses: response.responses.map((resp, index) => ({
          token: `${tokens[index].substring(0, 20)}...`,
          success: resp.success,
          messageId: resp.messageId,
          error: resp.error,
        })),
      };

      // 記錄批量發送結果
      const notificationId = this.generateNotificationId();
      this.recordNotification(notificationId, {
        type: 'multicast',
        tokenCount: tokens.length,
        notification,
        data,
        results,
        dryRun,
      });

      logger.info('批量推播通知發送完成', {
        notificationId,
        successCount: response.successCount,
        failureCount: response.failureCount,
        totalTokens: tokens.length,
        dryRun,
      });

      return {
        success: response.failureCount === 0,
        notificationId,
        ...results,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '批量發送失敗';
      logger.error('批量推播通知發送失敗', {
        error: errorMessage,
        tokenCount: tokens ? tokens.length : 0,
      });
      throw new Error(`批量通知發送失敗: ${errorMessage}`);
    }
  }

  /**
   * 發送通知到主題
   */
  async sendToTopic(topic, notification, data = {}, options = {}) {
    try {
      const messaging = this.initialize();

      // 先解構配置以獲取 condition
      const {
        priority = 'high',
        timeToLive = 3600,
        condition = null,
        dryRun = false,
      } = options;

      // 驗證主題名稱
      if (!topic || typeof topic !== 'string') {
        throw new Error('主題名稱不能為空');
      }

      // 如果是條件表達式，跳過格式驗證
      if (!condition && !/^[a-zA-Z0-9-_.~%]+$/.test(topic)) {
        throw new Error('主題名稱格式不正確');
      }

      this.validateNotification(notification);

      // 構建主題消息
      const message = {
        topic: condition || topic,
        notification: {
          title: notification.title,
          body: notification.body,
          ...(notification.imageUrl && { imageUrl: notification.imageUrl }),
        },
        ...(Object.keys(data).length > 0 && { data }),
        android: {
          priority,
          ttl: timeToLive * 1000,
          notification: {
            icon: notification.icon || 'ic_notification',
            color: notification.color || '#2196F3',
            sound: notification.sound || 'default',
          },
        },
        apns: {
          headers: {
            'apns-priority': priority === 'high' ? '10' : '5',
            'apns-expiration': Math.floor(Date.now() / 1000) + timeToLive,
          },
          payload: {
            aps: {
              alert: {
                title: notification.title,
                body: notification.body,
              },
              sound: notification.sound || 'default',
            },
          },
        },
      };

      // 發送主題消息
      const response = await messaging.send(message, dryRun);

      // 記錄主題發送
      const notificationId = this.generateNotificationId();
      this.recordNotification(notificationId, {
        type: 'topic',
        topic: condition || topic,
        notification,
        data,
        messageId: response,
        dryRun,
      });

      logger.info('主題推播通知發送成功', {
        notificationId,
        messageId: response,
        topic: condition || topic,
        dryRun,
      });

      return {
        success: true,
        messageId: response,
        notificationId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '主題發送失敗';
      logger.error('主題推播通知發送失敗', {
        error: errorMessage,
        topic,
      });
      throw new Error(`主題通知發送失敗: ${errorMessage}`);
    }
  }

  /**
   * 訂閱主題
   */
  async subscribeToTopic(tokens, topic) {
    try {
      const messaging = this.initialize();

      if (!Array.isArray(tokens)) {
        tokens = [tokens];
      }

      // 驗證輸入
      tokens.forEach((token) => this.validateToken(token));

      if (!topic || typeof topic !== 'string') {
        throw new Error('主題名稱不能為空');
      }

      // 訂閱主題
      const response = await messaging.subscribeToTopic(tokens, topic);

      logger.info('主題訂閱成功', {
        topic,
        tokenCount: tokens.length,
        successCount: response.successCount,
        failureCount: response.failureCount,
      });

      return {
        success: response.failureCount === 0,
        successCount: response.successCount,
        failureCount: response.failureCount,
        errors: response.errors,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '訂閱失敗';
      logger.error('主題訂閱失敗', {
        error: errorMessage,
        topic,
        tokenCount: Array.isArray(tokens) ? tokens.length : 1,
      });
      throw new Error(`主題訂閱失敗: ${errorMessage}`);
    }
  }

  /**
   * 取消訂閱主題
   */
  async unsubscribeFromTopic(tokens, topic) {
    try {
      const messaging = this.initialize();

      if (!Array.isArray(tokens)) {
        tokens = [tokens];
      }

      // 驗證輸入
      tokens.forEach((token) => this.validateToken(token));

      if (!topic || typeof topic !== 'string') {
        throw new Error('主題名稱不能為空');
      }

      // 取消訂閱
      const response = await messaging.unsubscribeFromTopic(tokens, topic);

      logger.info('取消主題訂閱成功', {
        topic,
        tokenCount: tokens.length,
        successCount: response.successCount,
        failureCount: response.failureCount,
      });

      return {
        success: response.failureCount === 0,
        successCount: response.successCount,
        failureCount: response.failureCount,
        errors: response.errors,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '取消訂閱失敗';
      logger.error('取消主題訂閱失敗', {
        error: errorMessage,
        topic,
        tokenCount: Array.isArray(tokens) ? tokens.length : 1,
      });
      throw new Error(`取消主題訂閱失敗: ${errorMessage}`);
    }
  }

  /**
   * 創建通知模板
   */
  createNotificationTemplate(templateName, template) {
    const templates = {
      welcome: {
        title: '歡迎加入 Localite！',
        body: '開始您的個人化導覽之旅',
        icon: 'ic_welcome',
        color: '#2196F3',
      },
      tour_ready: {
        title: '導覽準備就緒',
        body: '您的個人化導覽已生成完成',
        icon: 'ic_tour',
        color: '#4CAF50',
      },
      payment_success: {
        title: '付款成功',
        body: '感謝您的購買，訂單已確認',
        icon: 'ic_payment',
        color: '#FF9800',
      },
      reminder: {
        title: '別忘了完成您的導覽',
        body: '您還有未完成的精彩導覽等著您',
        icon: 'ic_reminder',
        color: '#9C27B0',
      },
    };

    if (templateName && template) {
      // 自定義模板（這裡可以實作資料庫存儲）
      return template;
    }

    return templates[templateName] || templates.reminder;
  }

  /**
   * 使用模板發送通知
   */
  async sendWithTemplate(target, templateName, variables = {}, options = {}) {
    try {
      const template = this.createNotificationTemplate(templateName);

      // 替換模板變數
      const notification = {
        title: this.replaceVariables(template.title, variables),
        body: this.replaceVariables(template.body, variables),
        icon: template.icon,
        color: template.color,
        ...options.notification,
      };

      // 根據目標類型發送
      if (typeof target === 'string') {
        if (
          target.startsWith('/topics/')
          || target.includes('&&')
          || target.includes('||')
        ) {
          // 主題或條件
          const topicOrCondition = target.replace('/topics/', '');
          const sendOptions = { ...options };

          // 如果包含條件運算符，作為條件處理
          if (target.includes('&&') || target.includes('||')) {
            sendOptions.condition = topicOrCondition;
            // 使用一個簡單的主題名稱作為基礎
            return await this.sendToTopic(
              'condition-based',
              notification,
              options.data,
              sendOptions,
            );
          }
          return await this.sendToTopic(
            topicOrCondition,
            notification,
            options.data,
            sendOptions,
          );
        }
        // 單一設備
        return await this.sendToDevice(
          target,
          notification,
          options.data,
          options,
        );
      } if (Array.isArray(target)) {
        // 多個設備
        return await this.sendToMultipleDevices(
          target,
          notification,
          options.data,
          options,
        );
      }
      throw new Error('無效的目標類型');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '模板發送失敗';
      logger.error('模板通知發送失敗', {
        error: errorMessage,
        templateName,
        targetType: typeof target,
      });
      throw new Error(`模板通知發送失敗: ${errorMessage}`);
    }
  }

  /**
   * 替換模板變數
   */
  replaceVariables(text, variables) {
    return text.replace(/\{\{(\w+)\}\}/g, (match, key) => variables[key] || match);
  }

  /**
   * 獲取通知歷史
   */
  getNotificationHistory(limit = 50) {
    const entries = Array.from(this.notificationHistory.entries())
      .sort(([, a], [, b]) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);

    return entries.map(([id, data]) => ({
      id,
      ...data,
    }));
  }

  /**
   * 獲取特定通知詳情
   */
  getNotificationDetails(notificationId) {
    return this.notificationHistory.get(notificationId) || null;
  }

  /**
   * 清理過期的通知歷史
   */
  cleanupNotificationHistory(maxAge = 7 * 24 * 3600 * 1000) {
    // 預設 7 天
    const cutoffTime = Date.now() - maxAge;

    for (const [id, data] of this.notificationHistory.entries()) {
      if (new Date(data.createdAt).getTime() < cutoffTime) {
        this.notificationHistory.delete(id);
      }
    }

    logger.info('通知歷史清理完成', {
      remainingCount: this.notificationHistory.size,
    });
  }
}

// 建立單例實例
const messagingService = new MessagingService();

module.exports = {
  messagingService,
  MessagingService, // 導出類別以便測試
};
