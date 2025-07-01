const { MessagingService } = require("./messagingService");

// Mock Firebase getMessaging
const mockSend = jest.fn();
const mockSendEachForMulticast = jest.fn();
const mockSubscribeToTopic = jest.fn();
const mockUnsubscribeFromTopic = jest.fn();

const mockMessaging = {
  send: mockSend,
  sendEachForMulticast: mockSendEachForMulticast,
  subscribeToTopic: mockSubscribeToTopic,
  unsubscribeFromTopic: mockUnsubscribeFromTopic,
};

// Mock Firebase config
jest.mock("../config/firebase", () => ({
  getMessaging: jest.fn(() => mockMessaging),
}));

// Mock logger
jest.mock("../middleware/requestLogger", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

describe("MessagingService", () => {
  let messagingService;

  beforeEach(() => {
    // 為每個測試創建新的服務實例
    messagingService = new MessagingService();

    // 清理所有 mock
    jest.clearAllMocks();

    // 重置模擬回應
    mockSend.mockResolvedValue("mock-message-id");
    mockSendEachForMulticast.mockResolvedValue({
      successCount: 2,
      failureCount: 0,
      responses: [
        { success: true, messageId: "msg1" },
        { success: true, messageId: "msg2" },
      ],
    });
    mockSubscribeToTopic.mockResolvedValue({
      successCount: 1,
      failureCount: 0,
      errors: [],
    });
    mockUnsubscribeFromTopic.mockResolvedValue({
      successCount: 1,
      failureCount: 0,
      errors: [],
    });
  });

  describe("初始化", () => {
    test("應該正確初始化服務", () => {
      const messaging = messagingService.initialize();
      expect(messaging).toBe(mockMessaging);
      expect(messagingService.initialized).toBe(true);
    });

    test("應該只初始化一次", () => {
      const { getMessaging } = require("../config/firebase");

      messagingService.initialize();
      messagingService.initialize();

      expect(getMessaging).toHaveBeenCalledTimes(1);
    });

    test("初始化失敗時應該拋出錯誤", () => {
      const { getMessaging } = require("../config/firebase");
      getMessaging.mockImplementationOnce(() => {
        throw new Error("Firebase 配置錯誤");
      });

      const newService = new MessagingService();
      expect(() => newService.initialize()).toThrow("推播服務不可用");
    });
  });

  describe("驗證功能", () => {
    describe("validateToken", () => {
      test("應該接受有效的 token", () => {
        const validToken = "a".repeat(100); // 模擬長 token
        expect(() => messagingService.validateToken(validToken)).not.toThrow();
      });

      test("應該拒絕空的 token", () => {
        expect(() => messagingService.validateToken("")).toThrow(
          "設備 token 不能為空"
        );
        expect(() => messagingService.validateToken(null)).toThrow(
          "設備 token 不能為空"
        );
        expect(() => messagingService.validateToken(undefined)).toThrow(
          "設備 token 不能為空"
        );
      });

      test("應該拒絕非字符串的 token", () => {
        expect(() => messagingService.validateToken(123)).toThrow(
          "設備 token 不能為空"
        );
        expect(() => messagingService.validateToken({})).toThrow(
          "設備 token 不能為空"
        );
      });

      test("應該拒絕過短的 token", () => {
        expect(() => messagingService.validateToken("short")).toThrow(
          "設備 token 格式不正確"
        );
      });
    });

    describe("validateNotification", () => {
      test("應該接受有效的通知", () => {
        const validNotification = {
          title: "測試標題",
          body: "測試內容",
        };
        expect(() =>
          messagingService.validateNotification(validNotification)
        ).not.toThrow();
      });

      test("應該接受只有標題的通知", () => {
        const notification = { title: "只有標題" };
        expect(() =>
          messagingService.validateNotification(notification)
        ).not.toThrow();
      });

      test("應該接受只有內容的通知", () => {
        const notification = { body: "只有內容" };
        expect(() =>
          messagingService.validateNotification(notification)
        ).not.toThrow();
      });

      test("應該拒絕空的通知", () => {
        expect(() => messagingService.validateNotification(null)).toThrow(
          "通知內容不能為空"
        );
        expect(() => messagingService.validateNotification(undefined)).toThrow(
          "通知內容不能為空"
        );
      });

      test("應該拒絕沒有標題和內容的通知", () => {
        expect(() => messagingService.validateNotification({})).toThrow(
          "通知必須包含標題或內容"
        );
      });

      test("應該拒絕過長的標題", () => {
        const notification = {
          title: "a".repeat(201),
          body: "內容",
        };
        expect(() =>
          messagingService.validateNotification(notification)
        ).toThrow("通知標題過長，最多 200 字符");
      });

      test("應該拒絕過長的內容", () => {
        const notification = {
          title: "標題",
          body: "a".repeat(4001),
        };
        expect(() =>
          messagingService.validateNotification(notification)
        ).toThrow("通知內容過長，最多 4000 字符");
      });
    });
  });

  describe("通知 ID 生成", () => {
    test("應該生成唯一的通知 ID", () => {
      const id1 = messagingService.generateNotificationId();
      const id2 = messagingService.generateNotificationId();

      expect(id1).toMatch(/^notif_\d+_[a-z0-9]{6}$/);
      expect(id2).toMatch(/^notif_\d+_[a-z0-9]{6}$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe("通知歷史記錄", () => {
    test("應該記錄通知歷史", () => {
      const notificationId = "test-id";
      const data = {
        type: "single",
        token: "test-token",
        notification: { title: "測試" },
      };

      messagingService.recordNotification(notificationId, data);

      const recorded = messagingService.getNotificationDetails(notificationId);
      expect(recorded).toMatchObject(data);
      expect(recorded.createdAt).toBeDefined();
      expect(recorded.status).toBe("sent");
    });

    test("應該限制歷史記錄數量", () => {
      // 添加超過限制的記錄
      for (let i = 0; i < 1005; i++) {
        messagingService.recordNotification(`id-${i}`, { type: "test" });
      }

      expect(messagingService.notificationHistory.size).toBe(1000);
    });

    test("應該獲取通知歷史列表", async () => {
      messagingService.recordNotification("id1", { type: "test1" });
      // 確保時間不同
      await new Promise((resolve) => setTimeout(resolve, 2));
      messagingService.recordNotification("id2", { type: "test2" });

      const history = messagingService.getNotificationHistory(10);
      expect(history).toHaveLength(2);
      expect(history[0].id).toBe("id2"); // 最新的在前
      expect(history[1].id).toBe("id1");
    });

    test("應該清理過期的通知歷史", () => {
      const oldTime = Date.now() - 8 * 24 * 3600 * 1000; // 8天前

      // 手動添加過期記錄
      messagingService.notificationHistory.set("old-id", {
        createdAt: new Date(oldTime).toISOString(),
      });
      messagingService.recordNotification("new-id", { type: "test" });

      messagingService.cleanupNotificationHistory();

      expect(messagingService.getNotificationDetails("old-id")).toBeNull();
      expect(messagingService.getNotificationDetails("new-id")).not.toBeNull();
    });
  });

  describe("發送到單一設備", () => {
    const validToken = "a".repeat(100);
    const validNotification = {
      title: "測試標題",
      body: "測試內容",
    };

    test("應該成功發送通知到單一設備", async () => {
      const result = await messagingService.sendToDevice(
        validToken,
        validNotification
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBe("mock-message-id");
      expect(result.notificationId).toBeDefined();
      expect(mockSend).toHaveBeenCalledTimes(1);

      const sentMessage = mockSend.mock.calls[0][0];
      expect(sentMessage.token).toBe(validToken);
      expect(sentMessage.notification.title).toBe("測試標題");
      expect(sentMessage.notification.body).toBe("測試內容");
    });

    test("應該包含完整的訊息配置", async () => {
      const notification = {
        title: "測試",
        body: "內容",
        imageUrl: "https://example.com/image.jpg",
        icon: "custom-icon",
        color: "#FF0000",
      };

      await messagingService.sendToDevice(validToken, notification);

      const sentMessage = mockSend.mock.calls[0][0];
      expect(sentMessage.notification.imageUrl).toBe(
        "https://example.com/image.jpg"
      );
      expect(sentMessage.android.notification.icon).toBe("custom-icon");
      expect(sentMessage.android.notification.color).toBe("#FF0000");
    });

    test("應該支援自定義選項", async () => {
      const options = {
        priority: "normal",
        timeToLive: 7200,
        collapseKey: "test-key",
        dryRun: true,
      };

      await messagingService.sendToDevice(
        validToken,
        validNotification,
        {},
        options
      );

      const sentMessage = mockSend.mock.calls[0][0];
      const dryRun = mockSend.mock.calls[0][1];

      expect(sentMessage.android.priority).toBe("normal");
      expect(sentMessage.android.ttl).toBe(7200000);
      expect(sentMessage.android.collapseKey).toBe("test-key");
      expect(dryRun).toBe(true);
    });

    test("應該包含數據負載", async () => {
      const data = {
        key1: "value1",
        key2: "value2",
      };

      await messagingService.sendToDevice(validToken, validNotification, data);

      const sentMessage = mockSend.mock.calls[0][0];
      expect(sentMessage.data).toEqual(data);
    });

    test("發送失敗時應該拋出錯誤", async () => {
      mockSend.mockRejectedValueOnce(new Error("網路錯誤"));

      await expect(
        messagingService.sendToDevice(validToken, validNotification)
      ).rejects.toThrow("通知發送失敗: 網路錯誤");
    });

    test("應該處理特定的 Firebase 錯誤類型", async () => {
      const firebaseError = new Error("Token 無效");
      firebaseError.code = "messaging/registration-token-not-registered";
      mockSend.mockRejectedValueOnce(firebaseError);

      await expect(
        messagingService.sendToDevice(validToken, validNotification)
      ).rejects.toThrow("通知發送失敗: Token 無效");
    });
  });

  describe("發送到多個設備", () => {
    const validTokens = ["a".repeat(100), "b".repeat(100)];
    const validNotification = {
      title: "測試標題",
      body: "測試內容",
    };

    test("應該成功發送通知到多個設備", async () => {
      const result = await messagingService.sendToMultipleDevices(
        validTokens,
        validNotification
      );

      expect(result.success).toBe(true);
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(0);
      expect(result.notificationId).toBeDefined();
      expect(mockSendEachForMulticast).toHaveBeenCalledTimes(1);
    });

    test("應該處理部分失敗的情況", async () => {
      mockSendEachForMulticast.mockResolvedValueOnce({
        successCount: 1,
        failureCount: 1,
        responses: [
          { success: true, messageId: "msg1" },
          { success: false, error: { code: "invalid-token" } },
        ],
      });

      const result = await messagingService.sendToMultipleDevices(
        validTokens,
        validNotification
      );

      expect(result.success).toBe(false);
      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(1);
    });

    test("應該拒絕空的 token 列表", async () => {
      await expect(
        messagingService.sendToMultipleDevices([], validNotification)
      ).rejects.toThrow("設備 token 列表不能為空");
    });

    test("應該拒絕過多的 token", async () => {
      const tooManyTokens = Array(501).fill("a".repeat(100));

      await expect(
        messagingService.sendToMultipleDevices(tooManyTokens, validNotification)
      ).rejects.toThrow("批量發送最多支持 500 個設備");
    });

    test("應該驗證所有 token", async () => {
      const invalidTokens = ["valid".repeat(20), "short"];

      await expect(
        messagingService.sendToMultipleDevices(invalidTokens, validNotification)
      ).rejects.toThrow("設備 token 格式不正確");
    });
  });

  describe("發送到主題", () => {
    const validNotification = {
      title: "測試標題",
      body: "測試內容",
    };

    test("應該成功發送通知到主題", async () => {
      const result = await messagingService.sendToTopic(
        "news",
        validNotification
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBe("mock-message-id");
      expect(result.notificationId).toBeDefined();
      expect(mockSend).toHaveBeenCalledTimes(1);

      const sentMessage = mockSend.mock.calls[0][0];
      expect(sentMessage.topic).toBe("news");
    });

    test("應該支援條件表達式", async () => {
      const condition = "'news' in topics && 'zh' in topics";

      await messagingService.sendToTopic(
        "news",
        validNotification,
        {},
        { condition }
      );

      const sentMessage = mockSend.mock.calls[0][0];
      expect(sentMessage.topic).toBe(condition);
    });

    test("應該拒絕無效的主題名稱", async () => {
      await expect(
        messagingService.sendToTopic("", validNotification)
      ).rejects.toThrow("主題名稱不能為空");

      await expect(
        messagingService.sendToTopic("invalid@topic", validNotification)
      ).rejects.toThrow("主題名稱格式不正確");
    });
  });

  describe("主題訂閱管理", () => {
    const validToken = "a".repeat(100);

    test("應該成功訂閱主題", async () => {
      const result = await messagingService.subscribeToTopic(
        validToken,
        "news"
      );

      expect(result.success).toBe(true);
      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(0);
      expect(mockSubscribeToTopic).toHaveBeenCalledWith([validToken], "news");
    });

    test("應該支援多個 token 訂閱", async () => {
      const tokens = ["a".repeat(100), "b".repeat(100)];

      await messagingService.subscribeToTopic(tokens, "news");

      expect(mockSubscribeToTopic).toHaveBeenCalledWith(tokens, "news");
    });

    test("應該成功取消訂閱主題", async () => {
      const result = await messagingService.unsubscribeFromTopic(
        validToken,
        "news"
      );

      expect(result.success).toBe(true);
      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(0);
      expect(mockUnsubscribeFromTopic).toHaveBeenCalledWith(
        [validToken],
        "news"
      );
    });

    test("應該拒絕無效的主題名稱", async () => {
      await expect(
        messagingService.subscribeToTopic(validToken, "")
      ).rejects.toThrow("主題名稱不能為空");

      await expect(
        messagingService.unsubscribeFromTopic(validToken, "")
      ).rejects.toThrow("主題名稱不能為空");
    });
  });

  describe("通知模板", () => {
    test("應該獲取預設模板", () => {
      const welcomeTemplate =
        messagingService.createNotificationTemplate("welcome");
      expect(welcomeTemplate.title).toBe("歡迎加入 Localite！");
      expect(welcomeTemplate.color).toBe("#2196F3");

      const tourTemplate =
        messagingService.createNotificationTemplate("tour_ready");
      expect(tourTemplate.title).toBe("導覽準備就緒");
      expect(tourTemplate.color).toBe("#4CAF50");
    });

    test("應該獲取自定義模板", () => {
      const customTemplate = {
        title: "自定義標題",
        body: "自定義內容",
        color: "#000000",
      };

      const result = messagingService.createNotificationTemplate(
        "custom",
        customTemplate
      );
      expect(result).toEqual(customTemplate);
    });

    test("應該返回預設模板當模板不存在時", () => {
      const defaultTemplate =
        messagingService.createNotificationTemplate("non-existent");
      expect(defaultTemplate.title).toBe("別忘了完成您的導覽");
    });

    test("應該替換模板變數", () => {
      const text = "您好 {{name}}，歡迎來到 {{place}}！";
      const variables = { name: "小明", place: "台北" };

      const result = messagingService.replaceVariables(text, variables);
      expect(result).toBe("您好 小明，歡迎來到 台北！");
    });

    test("應該保留未匹配的變數", () => {
      const text = "您好 {{name}}，{{unknown}} 變數";
      const variables = { name: "小明" };

      const result = messagingService.replaceVariables(text, variables);
      expect(result).toBe("您好 小明，{{unknown}} 變數");
    });
  });

  describe("使用模板發送通知", () => {
    const validToken = "a".repeat(100);

    test("應該使用模板發送到單一設備", async () => {
      const variables = { name: "用戶" };

      const result = await messagingService.sendWithTemplate(
        validToken,
        "welcome",
        variables
      );

      expect(result.success).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);

      const sentMessage = mockSend.mock.calls[0][0];
      expect(sentMessage.notification.title).toBe("歡迎加入 Localite！");
    });

    test("應該使用模板發送到多個設備", async () => {
      const tokens = ["a".repeat(100), "b".repeat(100)];

      const result = await messagingService.sendWithTemplate(
        tokens,
        "tour_ready"
      );

      expect(result.success).toBe(true);
      expect(mockSendEachForMulticast).toHaveBeenCalledTimes(1);
    });

    test("應該使用模板發送到主題", async () => {
      const result = await messagingService.sendWithTemplate(
        "/topics/news",
        "reminder"
      );

      expect(result.success).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);

      const sentMessage = mockSend.mock.calls[0][0];
      expect(sentMessage.topic).toBe("news");
    });

    test("應該處理條件主題", async () => {
      const condition = "'news' in topics && 'zh' in topics";

      await messagingService.sendWithTemplate(condition, "welcome");

      const sentMessage = mockSend.mock.calls[0][0];
      expect(sentMessage.topic).toBe(condition);
    });

    test("應該拒絕無效的目標類型", async () => {
      await expect(
        messagingService.sendWithTemplate(123, "welcome")
      ).rejects.toThrow("無效的目標類型");
    });
  });
});
