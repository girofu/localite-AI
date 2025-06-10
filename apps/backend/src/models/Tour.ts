import mongoose, { Document, Schema } from 'mongoose';

export interface ITour extends Document {
  title: string;
  description: string;
  category: string;
  merchantId: string;
  location: {
    address: string;
    coordinates: {
      lat: number;
      lng: number;
    };
    placeId?: string;
  };
  price: number;
  currency: string;
  duration: number; // 分鐘
  maxParticipants: number;
  languages: string[];
  content: {
    intro: string;
    highlights: string[];
    itinerary: Array<{
      stop: number;
      title: string;
      description: string;
      duration: number;
      location?: {
        lat: number;
        lng: number;
      };
    }>;
  };
  media: {
    coverImage?: string;
    images: string[];
    audioFiles: Array<{
      language: string;
      url: string;
      duration: number;
    }>;
  };
  settings: {
    isActive: boolean;
    isPublic: boolean;
    requiresBooking: boolean;
    instantConfirm: boolean;
    cancellationPolicy: string;
  };
  statistics: {
    viewCount: number;
    bookingCount: number;
    rating: number;
    reviewCount: number;
  };
  seo: {
    slug: string;
    metaTitle?: string;
    metaDescription?: string;
    keywords: string[];
  };
  createdAt: Date;
  updatedAt: Date;
}

const TourSchema = new Schema<ITour>({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    maxlength: 500
  },
  category: {
    type: String,
    required: true,
    index: true
  },
  merchantId: {
    type: String,
    required: true,
    index: true
  },
  location: {
    address: {
      type: String,
      required: true
    },
    coordinates: {
      lat: {
        type: Number,
        required: true,
        min: -90,
        max: 90
      },
      lng: {
        type: Number,
        required: true,
        min: -180,
        max: 180
      }
    },
    placeId: String
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'TWD'
  },
  duration: {
    type: Number,
    required: true,
    min: 1
  },
  maxParticipants: {
    type: Number,
    default: 10,
    min: 1
  },
  languages: [{
    type: String,
    required: true
  }],
  content: {
    intro: String,
    highlights: [String],
    itinerary: [{
      stop: {
        type: Number,
        required: true
      },
      title: {
        type: String,
        required: true
      },
      description: String,
      duration: {
        type: Number,
        required: true,
        min: 1
      },
      location: {
        lat: Number,
        lng: Number
      }
    }]
  },
  media: {
    coverImage: String,
    images: [String],
    audioFiles: [{
      language: {
        type: String,
        required: true
      },
      url: {
        type: String,
        required: true
      },
      duration: {
        type: Number,
        required: true,
        min: 1
      }
    }]
  },
  settings: {
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    isPublic: {
      type: Boolean,
      default: true
    },
    requiresBooking: {
      type: Boolean,
      default: true
    },
    instantConfirm: {
      type: Boolean,
      default: false
    },
    cancellationPolicy: {
      type: String,
      default: 'flexible'
    }
  },
  statistics: {
    viewCount: {
      type: Number,
      default: 0
    },
    bookingCount: {
      type: Number,
      default: 0
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    },
    reviewCount: {
      type: Number,
      default: 0
    }
  },
  seo: {
    slug: {
      type: String,
      unique: true,
      sparse: true,
      index: true
    },
    metaTitle: String,
    metaDescription: String,
    keywords: [String]
  }
}, {
  timestamps: true,
  versionKey: false
});

// 複合索引優化
TourSchema.index({ 'location.coordinates': '2dsphere' }); // 地理位置索引
TourSchema.index({ category: 1, 'settings.isActive': 1, 'settings.isPublic': 1 });
TourSchema.index({ merchantId: 1, 'settings.isActive': 1 });
TourSchema.index({ price: 1, currency: 1 });
TourSchema.index({ languages: 1 });
TourSchema.index({ 'statistics.rating': -1, 'statistics.reviewCount': -1 });

// 虛擬欄位
TourSchema.virtual('averageRating').get(function() {
  return this.statistics.reviewCount > 0 ? this.statistics.rating : 0;
});

TourSchema.virtual('isAvailable').get(function() {
  return this.settings.isActive && this.settings.isPublic;
});

// 方法
TourSchema.methods.incrementView = function() {
  this.statistics.viewCount += 1;
  return this.save();
};

TourSchema.methods.incrementBooking = function() {
  this.statistics.bookingCount += 1;
  return this.save();
};

TourSchema.methods.updateRating = function(newRating: number, isNewReview: boolean = false) {
  const { rating, reviewCount } = this.statistics;
  
  if (isNewReview) {
    this.statistics.reviewCount += 1;
    this.statistics.rating = ((rating * reviewCount) + newRating) / this.statistics.reviewCount;
  } else {
    this.statistics.rating = newRating;
  }
  
  return this.save();
};

// 靜態方法
TourSchema.statics.findAvailable = function(filters: any = {}) {
  return this.find({
    'settings.isActive': true,
    'settings.isPublic': true,
    ...filters
  });
};

TourSchema.statics.findByMerchant = function(merchantId: string, includeInactive: boolean = false) {
  const query: any = { merchantId };
  
  if (!includeInactive) {
    query['settings.isActive'] = true;
  }
  
  return this.find(query);
};

TourSchema.statics.findNearby = function(lat: number, lng: number, maxDistance: number = 5000) {
  return this.find({
    'location.coordinates': {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [lng, lat]
        },
        $maxDistance: maxDistance
      }
    },
    'settings.isActive': true,
    'settings.isPublic': true
  });
};

// Pre-save middleware
TourSchema.pre('save', function(next) {
  // 自動生成 SEO slug
  if (!this.seo.slug && this.title) {
    this.seo.slug = this.title
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      + '-' + this._id.toString().slice(-6);
  }
  
  next();
});

export const Tour = mongoose.model<ITour>('Tour', TourSchema); 