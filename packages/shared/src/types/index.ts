/**
 * 在地人 AI 導覽系統 - 共用類型定義
 * 基於 Google 開發者風格指南和 TypeScript 最佳實踐
 */

// =================== 基礎類型 ===================

export interface BaseEntity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginationParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  items: T[];
  totalItems: number;
  totalPages: number;
  currentPage: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

// =================== 用戶相關 ===================

export interface User extends BaseEntity {
  email: string;
  displayName: string;
  photoURL?: string;
  role: UserRole;
  isActive: boolean;
  preferences: UserPreferences;
  lastLoginAt?: Date;
}

export enum UserRole {
  USER = 'user',
  MERCHANT = 'merchant', 
  ADMIN = 'admin'
}

export interface UserPreferences {
  language: SupportedLanguage;
  currency: SupportedCurrency;
  notifications: NotificationPreferences;
  accessibility: AccessibilityPreferences;
}

export interface NotificationPreferences {
  email: boolean;
  push: boolean;
  sms: boolean;
  marketing: boolean;
}

export interface AccessibilityPreferences {
  fontSize: 'small' | 'medium' | 'large';
  highContrast: boolean;
  screenReader: boolean;
}

// =================== 語言和地區 ===================

export enum SupportedLanguage {
  ZH_TW = 'zh-TW',
  ZH_CN = 'zh-CN', 
  EN = 'en',
  JA = 'ja',
  KO = 'ko'
}

export enum SupportedCurrency {
  TWD = 'TWD',
  USD = 'USD',
  CNY = 'CNY',
  JPY = 'JPY',
  KRW = 'KRW'
}

// =================== 地理位置 ===================

export interface Location {
  latitude: number;
  longitude: number;
  accuracy?: number;
  address?: string;
  city?: string;
  country?: string;
}

export interface GeoBounds {
  northEast: Location;
  southWest: Location;
}

// =================== 商戶相關 ===================

export interface Merchant extends BaseEntity {
  userId: string;
  businessName: string;
  businessType: BusinessType;
  description: string;
  location: Location;
  contactInfo: ContactInfo;
  businessHours: BusinessHours[];
  isVerified: boolean;
  rating: number;
  reviewCount: number;
  media: MediaFile[];
  settings: MerchantSettings;
}

export enum BusinessType {
  RESTAURANT = 'restaurant',
  SHOP = 'shop',
  ATTRACTION = 'attraction',
  HOTEL = 'hotel',
  SERVICE = 'service',
  OTHER = 'other'
}

export interface ContactInfo {
  phone?: string;
  email?: string;
  website?: string;
  socialMedia?: SocialMediaLinks;
}

export interface SocialMediaLinks {
  facebook?: string;
  instagram?: string;
  line?: string;
  twitter?: string;
}

export interface BusinessHours {
  dayOfWeek: number; // 0-6 (Sunday-Saturday)
  openTime: string;  // HH:mm format
  closeTime: string; // HH:mm format
  isClosed: boolean;
}

export interface MerchantSettings {
  autoReply: boolean;
  showAnalytics: boolean;
  allowReviews: boolean;
  featuredProducts: string[];
}

// =================== 導覽相關 ===================

export interface Tour extends BaseEntity {
  merchantId: string;
  title: string;
  description: string;
  category: TourCategory;
  difficulty: TourDifficulty;
  duration: number; // minutes
  price: number;
  maxParticipants?: number;
  languages: SupportedLanguage[];
  highlights: string[];
  route: TourRoute;
  media: MediaFile[];
  isActive: boolean;
  tags: string[];
  rating: number;
  reviewCount: number;
}

export enum TourCategory {
  CULTURE = 'culture',
  FOOD = 'food',
  NATURE = 'nature',
  HISTORY = 'history',
  ART = 'art',
  SHOPPING = 'shopping',
  NIGHTLIFE = 'nightlife',
  ADVENTURE = 'adventure'
}

export enum TourDifficulty {
  EASY = 'easy',
  MODERATE = 'moderate',
  HARD = 'hard'
}

export interface TourRoute {
  startPoint: Location;
  endPoint: Location;
  waypoints: TourWaypoint[];
  estimatedDistance: number; // meters
}

export interface TourWaypoint extends Location {
  id: string;
  name: string;
  description: string;
  audioContent?: AudioContent;
  estimatedDuration: number; // minutes
  order: number;
  pointsOfInterest: PointOfInterest[];
}

export interface PointOfInterest {
  id: string;
  name: string;
  description: string;
  type: POIType;
  location: Location;
  media: MediaFile[];
}

export enum POIType {
  HISTORICAL = 'historical',
  CULTURAL = 'cultural',
  RESTAURANT = 'restaurant',
  SHOP = 'shop',
  VIEWPOINT = 'viewpoint',
  LANDMARK = 'landmark'
}

// =================== AI 內容相關 ===================

export interface AIContent extends BaseEntity {
  type: AIContentType;
  prompt: string;
  generatedText: string;
  language: SupportedLanguage;
  parameters: AIGenerationParameters;
  version: number;
  isApproved: boolean;
  feedbackScore?: number;
}

export enum AIContentType {
  TOUR_DESCRIPTION = 'tour_description',
  POI_DESCRIPTION = 'poi_description',
  MERCHANT_INTRO = 'merchant_intro',
  RECOMMENDATION = 'recommendation'
}

export interface AIGenerationParameters {
  model: string;
  temperature: number;
  maxTokens: number;
  customInstructions?: string;
}

export interface AudioContent {
  id: string;
  text: string;
  audioUrl: string;
  language: SupportedLanguage;
  voice: TTSVoiceSettings;
  duration: number; // seconds
  fileSize: number; // bytes
}

export interface TTSVoiceSettings {
  name: string;
  gender: 'male' | 'female' | 'neutral';
  speed: number;
  pitch: number;
}

// =================== 媒體文件 ===================

export interface MediaFile {
  id: string;
  type: MediaType;
  url: string;
  filename: string;
  fileSize: number;
  mimeType: string;
  alt?: string;
  caption?: string;
  metadata?: MediaMetadata;
  uploadedAt: Date;
}

export enum MediaType {
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  DOCUMENT = 'document'
}

export interface MediaMetadata {
  width?: number;
  height?: number;
  duration?: number; // for video/audio
  location?: Location;
  camera?: string;
  tags?: string[];
}

// =================== 訂單和支付 ===================

export interface Order extends BaseEntity {
  userId: string;
  tourId: string;
  merchantId: string;
  participants: number;
  scheduledDate: Date;
  totalAmount: number;
  currency: SupportedCurrency;
  status: OrderStatus;
  paymentId?: string;
  notes?: string;
}

export enum OrderStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded'
}

export interface Payment extends BaseEntity {
  orderId: string;
  amount: number;
  currency: SupportedCurrency;
  method: PaymentMethod;
  gateway: PaymentGateway;
  gatewayTransactionId?: string;
  status: PaymentStatus;
  paidAt?: Date;
  refundedAt?: Date;
  refundAmount?: number;
}

export enum PaymentMethod {
  CREDIT_CARD = 'credit_card',
  APPLE_PAY = 'apple_pay',
  LINE_PAY = 'line_pay',
  BANK_TRANSFER = 'bank_transfer'
}

export enum PaymentGateway {
  ECPAY = 'ecpay',
  STRIPE = 'stripe',
  PAYPAL = 'paypal'
}

export enum PaymentStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SUCCESS = 'success',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded'
}

// =================== 評論和評分 ===================

export interface Review extends BaseEntity {
  userId: string;
  targetId: string; // Tour ID or Merchant ID
  targetType: ReviewTargetType;
  rating: number; // 1-5
  title?: string;
  content: string;
  media: MediaFile[];
  isVerified: boolean;
  helpfulCount: number;
  reportCount: number;
  merchantReply?: MerchantReply;
}

export enum ReviewTargetType {
  TOUR = 'tour',
  MERCHANT = 'merchant'
}

export interface MerchantReply {
  content: string;
  repliedAt: Date;
  updatedAt?: Date;
}

// =================== API 響應格式 ===================

export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: APIError[];
  meta?: ResponseMeta;
}

export interface APIError {
  code: string;
  message: string;
  field?: string;
  details?: any;
}

export interface ResponseMeta {
  timestamp: string;
  requestId: string;
  version: string;
  pagination?: PaginationMeta;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

// =================== 功能旗標 ===================

export interface FeatureFlag {
  key: string;
  name: string;
  description: string;
  isEnabled: boolean;
  conditions?: FeatureFlagCondition[];
  rolloutPercentage: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface FeatureFlagCondition {
  type: 'user_role' | 'user_id' | 'location' | 'device_type';
  operator: 'equals' | 'not_equals' | 'in' | 'not_in';
  value: string | string[];
}

// =================== 系統配置 ===================

export interface SystemConfig {
  maintenance: MaintenanceConfig;
  rateLimit: RateLimitConfig;
  file: FileConfig;
  ai: AIConfig;
}

export interface MaintenanceConfig {
  isEnabled: boolean;
  message: string;
  startTime?: Date;
  endTime?: Date;
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  skipSuccessfulRequests: boolean;
}

export interface FileConfig {
  maxFileSize: number;
  allowedTypes: string[];
  uploadPath: string;
}

export interface AIConfig {
  vertexAI: VertexAIConfig;
  tts: TTSConfig;
  translation: TranslationConfig;
}

export interface VertexAIConfig {
  projectId: string;
  location: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface TTSConfig {
  languageCode: string;
  voiceName: string;
  voiceGender: string;
  audioEncoding: string;
}

export interface TranslationConfig {
  projectId: string;
  location: string;
  supportedLanguages: SupportedLanguage[];
} 