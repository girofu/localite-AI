const { getStorage } = require("../config/firebase");
const { logger } = require("../middleware/requestLogger");
const path = require("path");
const multer = require("multer");

/**
 * Firebase Storage 服務類別
 * 提供檔案上傳、下載、刪除和管理功能
 */
class StorageService {
  constructor() {
    this.storage = null;
    this.bucket = null;
    this.initialized = false;
  }

  /**
   * 初始化 Firebase Storage（懶加載）
   */
  initialize() {
    if (this.initialized) {
      return this.bucket;
    }

    try {
      this.storage = getStorage();
      const bucketName =
        process.env.FIREBASE_STORAGE_BUCKET ||
        `${process.env.GOOGLE_CLOUD_PROJECT_ID}.appspot.com`;
      this.bucket = this.storage.bucket(bucketName);
      this.initialized = true;

      logger.info("Firebase Storage 初始化成功", { bucket: bucketName });
      return this.bucket;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "未知錯誤";
      logger.error("Firebase Storage 初始化失敗", { error: errorMessage });
      throw new Error("儲存服務不可用");
    }
  }

  /**
   * 驗證檔案類型
   */
  validateFileType(
    mimetype,
    allowedTypes = ["image", "video", "audio", "application"]
  ) {
    const fileType = mimetype.split("/")[0];
    const allowedMimeTypes = [
      // 圖片類型
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/svg+xml",
      // 影片類型
      "video/mp4",
      "video/avi",
      "video/mov",
      "video/wmv",
      "video/webm",
      // 音訊類型
      "audio/mp3",
      "audio/wav",
      "audio/aac",
      "audio/ogg",
      "audio/mpeg",
      // 文件類型
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/json",
      "text/plain",
      "text/csv",
    ];

    if (!allowedMimeTypes.includes(mimetype)) {
      throw new Error(`不支援的檔案類型: ${mimetype}`);
    }

    if (!allowedTypes.includes(fileType) && fileType !== "text") {
      throw new Error(`不允許的檔案類別: ${fileType}`);
    }

    return true;
  }

  /**
   * 驗證檔案大小
   */
  validateFileSize(size, maxSize = 50 * 1024 * 1024) {
    // 預設 50MB
    if (size > maxSize) {
      const maxSizeMB = Math.round(maxSize / (1024 * 1024));
      throw new Error(`檔案大小超過限制，最大允許 ${maxSizeMB}MB`);
    }
    return true;
  }

  /**
   * 生成唯一檔案名稱
   */
  generateFileName(originalName, prefix = "", userId = "") {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const ext = path.extname(originalName);
    const baseName = path
      .basename(originalName, ext)
      .replace(/[^a-zA-Z0-9]/g, "-");

    const parts = [prefix, userId, timestamp, random, baseName].filter(Boolean);
    return `${parts.join("-")}${ext}`.toLowerCase();
  }

  /**
   * 上傳檔案到 Firebase Storage
   */
  async uploadFile(file, options = {}) {
    try {
      const bucket = this.initialize();

      const {
        folder = "uploads",
        userId = "",
        prefix = "",
        maxSize = 50 * 1024 * 1024,
        allowedTypes = ["image", "video", "audio", "application"],
        makePublic = false,
      } = options;

      // 驗證檔案
      this.validateFileType(file.mimetype, allowedTypes);
      this.validateFileSize(file.size, maxSize);

      // 生成檔案路徑
      const fileName = this.generateFileName(file.originalname, prefix, userId);
      const filePath = folder ? `${folder}/${fileName}` : fileName;

      // 創建檔案引用
      const fileRef = bucket.file(filePath);

      // 上傳檔案
      const stream = fileRef.createWriteStream({
        metadata: {
          contentType: file.mimetype,
          metadata: {
            originalName: file.originalname,
            uploadedBy: userId,
            uploadedAt: new Date().toISOString(),
            folder: folder,
          },
        },
        resumable: false, // 對於小檔案使用非恢復上傳
      });

      return new Promise((resolve, reject) => {
        stream.on("error", (error) => {
          logger.error("檔案上傳失敗", {
            error: error.message,
            filePath,
            fileSize: file.size,
          });
          reject(new Error("檔案上傳失敗"));
        });

        stream.on("finish", async () => {
          try {
            // 設定檔案為公開可讀（如果需要）
            if (makePublic) {
              await fileRef.makePublic();
            }

            // 生成下載 URL
            const downloadUrl = makePublic
              ? `https://storage.googleapis.com/${bucket.name}/${filePath}`
              : await this.getDownloadUrl(filePath);

            const result = {
              fileName: fileName,
              filePath: filePath,
              downloadUrl: downloadUrl,
              size: file.size,
              mimetype: file.mimetype,
              folder: folder,
              uploadedAt: new Date().toISOString(),
            };

            logger.info("檔案上傳成功", {
              fileName,
              filePath,
              size: file.size,
              userId,
            });

            resolve(result);
          } catch (error) {
            logger.error("檔案後處理失敗", { error: error.message, filePath });
            reject(new Error("檔案處理失敗"));
          }
        });

        // 寫入檔案數據
        stream.end(file.buffer);
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "上傳失敗";
      logger.error("檔案上傳錯誤", { error: errorMessage });
      throw error;
    }
  }

  /**
   * 獲取檔案下載 URL（簽名 URL，有時效性）
   */
  async getDownloadUrl(filePath, expiresIn = 3600) {
    // 預設1小時過期
    try {
      const bucket = this.initialize();
      const file = bucket.file(filePath);

      // 檢查檔案是否存在
      const [exists] = await file.exists();
      if (!exists) {
        throw new Error("檔案不存在");
      }

      // 生成簽名 URL
      const [url] = await file.getSignedUrl({
        action: "read",
        expires: Date.now() + expiresIn * 1000,
      });

      return url;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "獲取下載連結失敗";
      logger.error("獲取下載 URL 失敗", {
        error: errorMessage,
        filePath,
      });
      throw new Error(errorMessage);
    }
  }

  /**
   * 下載檔案內容
   */
  async downloadFile(filePath) {
    try {
      const bucket = this.initialize();
      const file = bucket.file(filePath);

      // 檢查檔案是否存在
      const [exists] = await file.exists();
      if (!exists) {
        throw new Error("檔案不存在");
      }

      // 獲取檔案內容
      const [contents] = await file.download();

      // 獲取檔案元數據
      const [metadata] = await file.getMetadata();

      logger.info("檔案下載成功", { filePath });

      return {
        contents,
        metadata: {
          contentType: metadata.contentType,
          size: metadata.size,
          name: metadata.name,
          updated: metadata.updated,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "下載失敗";
      logger.error("檔案下載失敗", {
        error: errorMessage,
        filePath,
      });
      throw new Error(errorMessage);
    }
  }

  /**
   * 刪除檔案
   */
  async deleteFile(filePath) {
    try {
      const bucket = this.initialize();
      const file = bucket.file(filePath);

      // 檢查檔案是否存在
      const [exists] = await file.exists();
      if (!exists) {
        logger.warn("嘗試刪除不存在的檔案", { filePath });
        return false;
      }

      // 刪除檔案
      await file.delete();

      logger.info("檔案刪除成功", { filePath });
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "未知錯誤";
      logger.error("檔案刪除失敗", {
        error: errorMessage,
        filePath,
      });
      throw new Error("刪除失敗");
    }
  }

  /**
   * 列出資料夾中的檔案
   */
  async listFiles(folder = "", options = {}) {
    try {
      const bucket = this.initialize();

      const {
        maxResults = 100,
        pageToken = null,
        includeMetadata = false,
      } = options;

      const [files, , metadata] = await bucket.getFiles({
        prefix: folder,
        maxResults,
        pageToken,
      });

      const fileList = await Promise.all(
        files.map(async (file) => {
          const basicInfo = {
            name: file.name,
            bucket: file.bucket.name,
            generation: file.generation,
          };

          if (includeMetadata) {
            try {
              const [fileMetadata] = await file.getMetadata();
              return {
                ...basicInfo,
                size: fileMetadata.size,
                contentType: fileMetadata.contentType,
                updated: fileMetadata.updated,
                created: fileMetadata.timeCreated,
              };
            } catch (error) {
              logger.warn("無法獲取檔案元數據", { fileName: file.name });
              return basicInfo;
            }
          }

          return basicInfo;
        })
      );

      return {
        files: fileList,
        nextPageToken: metadata?.nextPageToken || null,
        totalResults: files.length,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "列表查詢失敗";
      logger.error("列出檔案失敗", {
        error: errorMessage,
        folder,
      });
      throw new Error(errorMessage);
    }
  }

  /**
   * 獲取檔案元數據
   */
  async getFileMetadata(filePath) {
    try {
      const bucket = this.initialize();
      const file = bucket.file(filePath);

      const [exists] = await file.exists();
      if (!exists) {
        throw new Error("檔案不存在");
      }

      const [metadata] = await file.getMetadata();

      return {
        name: metadata.name,
        size: metadata.size,
        contentType: metadata.contentType,
        created: metadata.timeCreated,
        updated: metadata.updated,
        etag: metadata.etag,
        customMetadata: metadata.metadata || {},
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "獲取元數據失敗";
      logger.error("獲取檔案元數據失敗", {
        error: errorMessage,
        filePath,
      });
      throw new Error(errorMessage);
    }
  }

  /**
   * 創建 Multer 中間件配置
   */
  createMulterConfig(options = {}) {
    const {
      maxSize = 50 * 1024 * 1024, // 50MB
      allowedTypes = ["image", "video", "audio", "application"],
    } = options;

    return multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: maxSize,
      },
      fileFilter: (req, file, cb) => {
        try {
          this.validateFileType(file.mimetype, allowedTypes);
          cb(null, true);
        } catch (error) {
          cb(error, false);
        }
      },
    });
  }
}

// 建立單例實例
const storageService = new StorageService();

module.exports = {
  storageService,
  StorageService, // 導出類別以便測試
};
