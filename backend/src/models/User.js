const mongoose = require('mongoose');
const { logger } = require('../middleware/requestLogger');

/**
 * 用戶偏好設定 Schema
 */
const UserPreferencesSchema = new mongoose.Schema(
  {
    language: {
      type: String,
      enum: ['zh-TW', 'zh-CN', 'en-US'],
      default: 'zh-TW',
    },
    notifications: {
      email: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      marketing: { type: Boolean, default: false },
    },
    tourPreferences: {
      voiceEnabled: { type: Boolean, default: true },
      autoPlay: { type: Boolean, default: false },
      playbackSpeed: {
        type: Number,
        min: 0.5,
        max: 2.0,
        default: 1.0,
      },
    },
    privacy: {
      shareProfile: { type: Boolean, default: false },
      shareLocation: { type: Boolean, default: true },
      dataCollection: { type: Boolean, default: true },
    },
  },
  { _id: false },
);

/**
 * 用戶個人檔案 Schema
 */
const UserProfileSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      trim: true,
      maxlength: 50,
    },
    lastName: {
      type: String,
      trim: true,
      maxlength: 50,
    },
    displayName: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    avatar: {
      type: String,
      validate: {
        validator(url) {
          if (!url) return true;
          // 基本 URL 格式驗證
          return /^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)$/i.test(url);
        },
        message: '頭像必須是有效的圖片 URL',
      },
    },
    phoneNumber: {
      type: String,
      validate: {
        validator(phone) {
          if (!phone) return true;
          // 台灣手機號碼格式
          return /^(\+886|0)?9\d{8}$/.test(phone);
        },
        message: '請輸入有效的台灣手機號碼',
      },
    },
    dateOfBirth: {
      type: Date,
      validate: {
        validator(date) {
          if (!date) return true;
          const now = new Date();
          const age = (now - date) / (365.25 * 24 * 60 * 60 * 1000);
          return age >= 13 && age <= 120;
        },
        message: '年齡必須在 13-120 歲之間',
      },
    },
    location: {
      city: String,
      country: { type: String, default: 'TW' },
    },
  },
  { _id: false },
);

/**
 * 用戶主要 Schema
 */
const UserSchema = new mongoose.Schema(
  {
    // Firebase 相關資訊
    firebaseUid: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // 基本用戶資訊
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      validate: {
        validator(email) {
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        },
        message: '請輸入有效的 Email 地址',
      },
      index: true,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },

    // 角色權限
    role: {
      type: String,
      enum: ['user', 'merchant', 'admin'],
      default: 'user',
      index: true,
    },

    // 帳戶狀態
    status: {
      type: String,
      enum: ['active', 'inactive', 'suspended', 'pending'],
      default: 'active',
      index: true,
    },

    // 用戶個人檔案
    profile: UserProfileSchema,

    // 用戶偏好設定
    preferences: {
      type: UserPreferencesSchema,
      default: () => ({}),
    },

    // 登入資訊
    providers: [
      {
        providerId: {
          type: String,
          enum: ['password', 'google.com', 'facebook.com', 'apple.com'],
          required: true,
        },
        providerUid: String,
        connectedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // 商戶相關資訊（僅商戶用戶）
    merchantInfo: {
      businessName: String,
      businessType: {
        type: String,
        enum: ['restaurant', 'hotel', 'attraction', 'retail', 'service', 'other'],
      },
      registrationNumber: String,
      verificationStatus: {
        type: String,
        enum: ['pending', 'verified', 'rejected'],
        default: 'pending',
      },
      verifiedAt: Date,
      description: String,
      website: String,
      address: {
        street: String,
        city: String,
        postalCode: String,
        country: { type: String, default: 'TW' },
      },
    },

    // 統計資訊
    stats: {
      loginCount: { type: Number, default: 0 },
      lastLoginAt: Date,
      toursCompleted: { type: Number, default: 0 },
      totalTimeSpent: { type: Number, default: 0 }, // 分鐘
    },

    // 同意條款
    agreements: {
      termsAcceptedAt: Date,
      privacyAcceptedAt: Date,
      marketingConsentAt: Date,
    },

    // 時間戳記
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },

    // 軟刪除
    deletedAt: {
      type: Date,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      // eslint-disable-next-line func-names, no-underscore-dangle
      transform(doc, ret) {
        // 移除敏感資訊
        // eslint-disable-next-line no-param-reassign, no-underscore-dangle
        delete ret.__v;
        // eslint-disable-next-line no-param-reassign, no-underscore-dangle
        delete ret._id;
        return ret;
      },
    },
    toObject: { virtuals: true },
  },
);

// 複合索引
UserSchema.index({ role: 1, status: 1 });
UserSchema.index(
  { 'merchantInfo.verificationStatus': 1 },
  {
    sparse: true,
    partialFilterExpression: { role: 'merchant' },
  },
);
UserSchema.index({ createdAt: -1 });
UserSchema.index({ 'stats.lastLoginAt': -1 });

// 虛擬欄位
// eslint-disable-next-line func-names
UserSchema.virtual('fullName').get(function getFullName() {
  if (this.profile?.firstName && this.profile?.lastName) {
    return `${this.profile.firstName} ${this.profile.lastName}`;
  }
  return this.profile?.displayName || this.email.split('@')[0];
});

// eslint-disable-next-line func-names
UserSchema.virtual('isMerchant').get(function getIsMerchant() {
  return this.role === 'merchant';
});

// eslint-disable-next-line func-names
UserSchema.virtual('isVerifiedMerchant').get(function getIsVerifiedMerchant() {
  return this.role === 'merchant' && this.merchantInfo?.verificationStatus === 'verified';
});

// 實例方法
// eslint-disable-next-line func-names
UserSchema.methods.updateLoginStats = function updateLoginStats() {
  this.stats.loginCount += 1;
  this.stats.lastLoginAt = new Date();
  return this.save();
};

// eslint-disable-next-line func-names
UserSchema.methods.addProvider = function addProvider(providerId, providerUid = null) {
  const existing = this.providers.find((p) => p.providerId === providerId);
  if (!existing) {
    this.providers.push({
      providerId,
      providerUid,
      connectedAt: new Date(),
    });
  }
  return this.save();
};

// eslint-disable-next-line func-names
UserSchema.methods.removeProvider = function removeProvider(providerId) {
  this.providers = this.providers.filter((p) => p.providerId !== providerId);
  return this.save();
};

// eslint-disable-next-line func-names
UserSchema.methods.softDelete = function softDelete() {
  this.deletedAt = new Date();
  this.status = 'inactive';
  return this.save();
};

// 靜態方法
// eslint-disable-next-line func-names
UserSchema.statics.findActiveUsers = function findActiveUsers() {
  return this.find({
    status: 'active',
    deletedAt: { $exists: false },
  });
};

// eslint-disable-next-line func-names
UserSchema.statics.findByFirebaseUid = function findByFirebaseUid(firebaseUid) {
  return this.findOne({
    firebaseUid,
    deletedAt: { $exists: false },
  });
};

// eslint-disable-next-line func-names
UserSchema.statics.findMerchants = function findMerchants(verificationStatus = null) {
  const query = {
    role: 'merchant',
    deletedAt: { $exists: false },
  };

  if (verificationStatus) {
    query['merchantInfo.verificationStatus'] = verificationStatus;
  }

  return this.find(query);
};

// 資料驗證中間件
// eslint-disable-next-line func-names
UserSchema.pre('save', function validateUser(next) {
  // 更新 updatedAt
  this.updatedAt = new Date();

  // 商戶角色必須有商戶資訊
  if (this.role === 'merchant' && !this.merchantInfo?.businessName) {
    return next(new Error('商戶用戶必須提供商戶資訊'));
  }

  // 確保至少有一個登入提供者
  if (this.providers.length === 0) {
    return next(new Error('用戶必須至少有一個登入提供者'));
  }

  return next();
});

// 查詢中間件 - 預設排除已刪除的用戶
// eslint-disable-next-line func-names
UserSchema.pre(/^find/, function excludeDeleted() {
  this.where({ deletedAt: { $exists: false } });
});

// 後置中間件 - 記錄用戶操作
// eslint-disable-next-line func-names
UserSchema.post('save', function logUserSave(doc) {
  if (this.isNew) {
    logger.info('新用戶註冊', {
      uid: doc.firebaseUid,
      email: doc.email,
      role: doc.role,
    });
  }
});

UserSchema.post('findOneAndUpdate', (doc) => {
  if (doc) {
    logger.info('用戶資料更新', {
      uid: doc.firebaseUid,
      email: doc.email,
    });
  }
});

const User = mongoose.model('User', UserSchema);

module.exports = User;
