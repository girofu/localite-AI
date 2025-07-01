// Mock Firebase config first
const mockBucket = {
  file: jest.fn(),
  name: "test-bucket.appspot.com",
  getFiles: jest.fn(),
};

const mockFile = {
  createWriteStream: jest.fn(),
  exists: jest.fn(),
  getSignedUrl: jest.fn(),
  download: jest.fn(),
  getMetadata: jest.fn(),
  delete: jest.fn(),
  makePublic: jest.fn(),
  name: "test-file.jpg",
  bucket: mockBucket,
  generation: "12345",
};

const mockGetStorage = jest.fn(() => ({
  bucket: jest.fn(() => mockBucket),
}));

jest.mock("../config/firebase", () => ({
  getStorage: mockGetStorage,
}));

// Mock logger
jest.mock("../middleware/requestLogger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const { storageService, StorageService } = require("./storageService");

describe("StorageService", () => {
  let service;

  beforeEach(() => {
    service = new StorageService();

    // 重置所有 mocks
    jest.clearAllMocks();

    // 重置環境變數
    process.env.GOOGLE_CLOUD_PROJECT_ID = "test-project";
    process.env.FIREBASE_STORAGE_BUCKET = "test-bucket.appspot.com";

    // 設定基本的 mock 行為
    mockBucket.file.mockReturnValue(mockFile);
  });

  describe("initialize", () => {
    it("應該成功初始化 Firebase Storage", () => {
      const bucket = service.initialize();

      expect(mockGetStorage).toHaveBeenCalled();
      expect(bucket).toBe(mockBucket);
      expect(service.initialized).toBe(true);
    });

    it("應該使用快取的實例", () => {
      // 第一次初始化
      service.initialize();
      // 第二次初始化
      const bucket = service.initialize();

      expect(mockGetStorage).toHaveBeenCalledTimes(1); // 只調用一次
      expect(bucket).toBe(mockBucket);
    });

    it("應該在初始化失敗時拋出錯誤", () => {
      mockGetStorage.mockImplementationOnce(() => {
        throw new Error("Storage initialization failed");
      });

      service.initialized = false; // 重置狀態

      expect(() => service.initialize()).toThrow("儲存服務不可用");
    });
  });

  describe("validateFileType", () => {
    it("應該接受有效的檔案類型", () => {
      expect(() => service.validateFileType("image/jpeg")).not.toThrow();
      expect(() => service.validateFileType("video/mp4")).not.toThrow();
      expect(() => service.validateFileType("audio/mp3")).not.toThrow();
      expect(() => service.validateFileType("application/pdf")).not.toThrow();
    });

    it("應該拒絕無效的檔案類型", () => {
      expect(() => service.validateFileType("text/html")).toThrow(
        "不支援的檔案類型"
      );
      expect(() =>
        service.validateFileType("application/x-executable")
      ).toThrow("不支援的檔案類型");
    });

    it("應該根據允許的類型過濾", () => {
      expect(() => service.validateFileType("video/mp4", ["image"])).toThrow(
        "不允許的檔案類別"
      );
      expect(() =>
        service.validateFileType("image/jpeg", ["image"])
      ).not.toThrow();
    });
  });

  describe("validateFileSize", () => {
    it("應該接受符合大小限制的檔案", () => {
      expect(() => service.validateFileSize(1024 * 1024)).not.toThrow(); // 1MB
      expect(() => service.validateFileSize(10 * 1024 * 1024)).not.toThrow(); // 10MB
    });

    it("應該拒絕超過大小限制的檔案", () => {
      const maxSize = 5 * 1024 * 1024; // 5MB
      const largeFileSize = 10 * 1024 * 1024; // 10MB

      expect(() => service.validateFileSize(largeFileSize, maxSize)).toThrow(
        "檔案大小超過限制，最大允許 5MB"
      );
    });
  });

  describe("generateFileName", () => {
    it("應該生成唯一的檔案名稱", () => {
      const fileName1 = service.generateFileName(
        "test.jpg",
        "avatar",
        "user123"
      );
      const fileName2 = service.generateFileName(
        "test.jpg",
        "avatar",
        "user123"
      );

      expect(fileName1).toMatch(/^avatar-user123-\d+-[a-z0-9]+-test\.jpg$/);
      expect(fileName1).not.toBe(fileName2); // 應該不同
    });

    it("應該清理檔案名稱中的特殊字元", () => {
      const fileName = service.generateFileName("test file (1).jpg", "docs");

      expect(fileName).toMatch(/^docs-\d+-[a-z0-9]+-test-file--1-\.jpg$/);
    });

    it("應該處理沒有副檔名的檔案", () => {
      const fileName = service.generateFileName("README");

      expect(fileName).toMatch(/^\d+-[a-z0-9]+-readme$/);
    });
  });

  describe("uploadFile", () => {
    let mockStream;
    let testFile;

    beforeEach(() => {
      mockStream = {
        on: jest.fn(),
        end: jest.fn(),
      };

      mockFile.createWriteStream.mockReturnValue(mockStream);
      mockFile.makePublic.mockResolvedValue();

      testFile = {
        originalname: "test.jpg",
        buffer: Buffer.from("test file content"),
        size: 1024,
        mimetype: "image/jpeg",
      };
    });

    it("應該成功上傳檔案", async () => {
      // 模擬 stream 成功完成
      mockStream.on.mockImplementation((event, callback) => {
        if (event === "finish") {
          setTimeout(() => callback(), 10);
        }
      });

      // Mock getDownloadUrl 方法
      service.getDownloadUrl = jest
        .fn()
        .mockResolvedValue("https://example.com/download-url");

      const result = await service.uploadFile(testFile, {
        folder: "test-uploads",
        userId: "user123",
        prefix: "image",
      });

      expect(result).toMatchObject({
        fileName: expect.stringMatching(
          /^image-user123-\d+-[a-z0-9]+-test\.jpg$/
        ),
        filePath: expect.stringMatching(
          /^test-uploads\/image-user123-\d+-[a-z0-9]+-test\.jpg$/
        ),
        downloadUrl: "https://example.com/download-url",
        size: 1024,
        mimetype: "image/jpeg",
        folder: "test-uploads",
      });

      expect(mockFile.createWriteStream).toHaveBeenCalledWith({
        metadata: {
          contentType: "image/jpeg",
          metadata: {
            originalName: "test.jpg",
            uploadedBy: "user123",
            uploadedAt: expect.any(String),
            folder: "test-uploads",
          },
        },
        resumable: false,
      });
    });

    it("應該在公開模式下設定檔案為公開", async () => {
      mockStream.on.mockImplementation((event, callback) => {
        if (event === "finish") {
          setTimeout(() => callback(), 10);
        }
      });

      await service.uploadFile(testFile, { makePublic: true });

      expect(mockFile.makePublic).toHaveBeenCalled();
    });

    it("應該在檔案驗證失敗時拋出錯誤", async () => {
      const invalidFile = {
        ...testFile,
        mimetype: "text/html", // 不支援的類型
      };

      await expect(service.uploadFile(invalidFile)).rejects.toThrow(
        "不支援的檔案類型"
      );
    });

    it("應該在上傳失敗時拋出錯誤", async () => {
      mockStream.on.mockImplementation((event, callback) => {
        if (event === "error") {
          setTimeout(() => callback(new Error("Upload failed")), 10);
        }
      });

      await expect(service.uploadFile(testFile)).rejects.toThrow(
        "檔案上傳失敗"
      );
    });
  });

  describe("getDownloadUrl", () => {
    it("應該成功獲取下載 URL", async () => {
      mockFile.exists.mockResolvedValue([true]);
      mockFile.getSignedUrl.mockResolvedValue([
        "https://example.com/signed-url",
      ]);

      const url = await service.getDownloadUrl("test/file.jpg");

      expect(url).toBe("https://example.com/signed-url");
      expect(mockFile.getSignedUrl).toHaveBeenCalledWith({
        action: "read",
        expires: expect.any(Number),
      });
    });

    it("應該在檔案不存在時拋出錯誤", async () => {
      mockFile.exists.mockResolvedValue([false]);

      await expect(service.getDownloadUrl("nonexistent.jpg")).rejects.toThrow(
        "檔案不存在"
      );
    });

    it("應該使用自定義過期時間", async () => {
      mockFile.exists.mockResolvedValue([true]);
      mockFile.getSignedUrl.mockResolvedValue([
        "https://example.com/signed-url",
      ]);

      const customExpiry = 7200; // 2小時
      await service.getDownloadUrl("test/file.jpg", customExpiry);

      expect(mockFile.getSignedUrl).toHaveBeenCalledWith({
        action: "read",
        expires: expect.any(Number),
      });
    });
  });

  describe("downloadFile", () => {
    it("應該成功下載檔案", async () => {
      const fileContent = Buffer.from("test file content");
      const metadata = {
        contentType: "image/jpeg",
        size: "1024",
        name: "test.jpg",
        updated: "2024-01-01T00:00:00.000Z",
      };

      mockFile.exists.mockResolvedValue([true]);
      mockFile.download.mockResolvedValue([fileContent]);
      mockFile.getMetadata.mockResolvedValue([metadata]);

      const result = await service.downloadFile("test/file.jpg");

      expect(result.contents).toBe(fileContent);
      expect(result.metadata).toEqual(metadata);
    });

    it("應該在檔案不存在時拋出錯誤", async () => {
      mockFile.exists.mockResolvedValue([false]);

      await expect(service.downloadFile("nonexistent.jpg")).rejects.toThrow(
        "檔案不存在"
      );
    });
  });

  describe("deleteFile", () => {
    it("應該成功刪除存在的檔案", async () => {
      mockFile.exists.mockResolvedValue([true]);
      mockFile.delete.mockResolvedValue();

      const result = await service.deleteFile("test/file.jpg");

      expect(result).toBe(true);
      expect(mockFile.delete).toHaveBeenCalled();
    });

    it("應該在檔案不存在時返回 false", async () => {
      mockFile.exists.mockResolvedValue([false]);

      const result = await service.deleteFile("nonexistent.jpg");

      expect(result).toBe(false);
      expect(mockFile.delete).not.toHaveBeenCalled();
    });

    it("應該在刪除失敗時拋出錯誤", async () => {
      mockFile.exists.mockResolvedValue([true]);
      mockFile.delete.mockRejectedValue(new Error("Delete failed"));

      await expect(service.deleteFile("test/file.jpg")).rejects.toThrow(
        "刪除失敗"
      );
    });
  });

  describe("listFiles", () => {
    it("應該成功列出檔案", async () => {
      const mockFiles = [
        { name: "folder/file1.jpg", bucket: mockBucket, generation: "123" },
        { name: "folder/file2.jpg", bucket: mockBucket, generation: "456" },
      ];

      mockBucket.getFiles.mockResolvedValue([mockFiles, {}, {}]);

      const result = await service.listFiles("folder/");

      expect(result.files).toHaveLength(2);
      expect(result.files[0]).toEqual({
        name: "folder/file1.jpg",
        bucket: mockBucket.name,
        generation: "123",
      });
    });

    it("應該包含元數據（當 includeMetadata 為 true）", async () => {
      const mockFiles = [
        {
          name: "folder/file1.jpg",
          bucket: mockBucket,
          generation: "123",
          getMetadata: jest.fn().mockResolvedValue([
            {
              size: "1024",
              contentType: "image/jpeg",
              updated: "2024-01-01T00:00:00.000Z",
              timeCreated: "2024-01-01T00:00:00.000Z",
            },
          ]),
        },
      ];

      mockBucket.getFiles.mockResolvedValue([mockFiles, {}, {}]);

      const result = await service.listFiles("folder/", {
        includeMetadata: true,
      });

      expect(result.files[0]).toEqual({
        name: "folder/file1.jpg",
        bucket: mockBucket.name,
        generation: "123",
        size: "1024",
        contentType: "image/jpeg",
        updated: "2024-01-01T00:00:00.000Z",
        created: "2024-01-01T00:00:00.000Z",
      });
    });
  });

  describe("getFileMetadata", () => {
    it("應該成功獲取檔案元數據", async () => {
      const metadata = {
        name: "test.jpg",
        size: "1024",
        contentType: "image/jpeg",
        timeCreated: "2024-01-01T00:00:00.000Z",
        updated: "2024-01-01T00:00:00.000Z",
        etag: "abc123",
        metadata: { customField: "value" },
      };

      mockFile.exists.mockResolvedValue([true]);
      mockFile.getMetadata.mockResolvedValue([metadata]);

      const result = await service.getFileMetadata("test.jpg");

      expect(result).toEqual({
        name: "test.jpg",
        size: "1024",
        contentType: "image/jpeg",
        created: "2024-01-01T00:00:00.000Z",
        updated: "2024-01-01T00:00:00.000Z",
        etag: "abc123",
        customMetadata: { customField: "value" },
      });
    });

    it("應該在檔案不存在時拋出錯誤", async () => {
      mockFile.exists.mockResolvedValue([false]);

      await expect(service.getFileMetadata("nonexistent.jpg")).rejects.toThrow(
        "檔案不存在"
      );
    });
  });

  describe("createMulterConfig", () => {
    it("應該建立正確的 multer 配置", () => {
      const config = service.createMulterConfig({
        maxSize: 10 * 1024 * 1024,
        allowedTypes: ["image"],
      });

      expect(config).toBeDefined();
      // 這裡我們主要驗證配置對象的存在，實際的 multer 測試會比較複雜
    });
  });

  describe("單例實例", () => {
    it("應該導出單例實例", () => {
      expect(storageService).toBeInstanceOf(StorageService);
    });
  });
});
