import mongoose, { Document, Schema } from 'mongoose';

export interface IUser extends Document {
  firebaseUid: string;
  email: string;
  displayName: string;
  avatar?: string;
  role: 'user' | 'merchant' | 'admin';
  preferences: {
    language: string;
    currency: string;
    notifications: {
      email: boolean;
      push: boolean;
    };
  };
  profile?: {
    bio?: string;
    location?: string;
    website?: string;
  };
  merchantInfo?: {
    businessName?: string;
    businessAddress?: string;
    businessPhone?: string;
    businessEmail?: string;
    verificationStatus: 'pending' | 'verified' | 'rejected';
    verificationDate?: Date;
  };
  isActive: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  
  // 實例方法
  updateLastLogin(): Promise<IUser>;
}

const UserSchema = new Schema<IUser>({
  firebaseUid: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    index: true
  },
  displayName: {
    type: String,
    required: true,
    trim: true
  },
  avatar: {
    type: String,
    validate: {
      validator: function(v: string) {
        return !v || /^https?:\/\/.+/.test(v);
      },
      message: '頭像必須是有效的 URL'
    }
  },
  role: {
    type: String,
    enum: ['user', 'merchant', 'admin'],
    default: 'user',
    index: true
  },
  preferences: {
    language: {
      type: String,
      default: 'zh-TW'
    },
    currency: {
      type: String,
      default: 'TWD'
    },
    notifications: {
      email: {
        type: Boolean,
        default: true
      },
      push: {
        type: Boolean,
        default: true
      }
    }
  },
  profile: {
    bio: String,
    location: String,
    website: {
      type: String,
      validate: {
        validator: function(v: string) {
          return !v || /^https?:\/\/.+/.test(v);
        },
        message: '網站必須是有效的 URL'
      }
    }
  },
  merchantInfo: {
    businessName: String,
    businessAddress: String,
    businessPhone: String,
    businessEmail: {
      type: String,
      lowercase: true
    },
    verificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'pending'
    },
    verificationDate: Date
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  lastLoginAt: Date
}, {
  timestamps: true,
  versionKey: false
});

// 索引優化
UserSchema.index({ email: 1, isActive: 1 });
UserSchema.index({ role: 1, isActive: 1 });
UserSchema.index({ 'merchantInfo.verificationStatus': 1 });

// 虛擬欄位
UserSchema.virtual('isMerchant').get(function() {
  return this.role === 'merchant' || this.role === 'admin';
});

UserSchema.virtual('isVerifiedMerchant').get(function() {
  const isMerchant = this.role === 'merchant' || this.role === 'admin';
  return isMerchant && this.merchantInfo?.verificationStatus === 'verified';
});

// 方法
UserSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.firebaseUid; // 不返回敏感資訊
  return user;
};

UserSchema.methods.updateLastLogin = function() {
  this.lastLoginAt = new Date();
  return this.save();
};

// 介面擴展 - 添加靜態方法
interface IUserModel extends mongoose.Model<IUser> {
  findByFirebaseUid(firebaseUid: string): Promise<IUser | null>;
  findMerchants(verificationStatus?: string): Promise<IUser[]>;
}

// 靜態方法
UserSchema.statics.findByFirebaseUid = function(firebaseUid: string) {
  return this.findOne({ firebaseUid, isActive: true });
};

UserSchema.statics.findMerchants = function(verificationStatus?: string) {
  const query: any = { 
    role: { $in: ['merchant', 'admin'] },
    isActive: true 
  };
  
  if (verificationStatus) {
    query['merchantInfo.verificationStatus'] = verificationStatus;
  }
  
  return this.find(query);
};

export const User = mongoose.model<IUser, IUserModel>('User', UserSchema); 