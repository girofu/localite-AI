const request = require('supertest');
const User = require('../models/User');
const { setupTestApp, teardownTestApp } = require('../test/testApp');

describe('Auth Routes', () => {
  let app;
  let testUser;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  afterAll(async () => {
    await teardownTestApp();
  });

  beforeEach(async () => {
    // 清理測試數據
    await User.deleteMany({});

    // 建立測試用戶
    testUser = {
      firebaseUid: 'test-user-123',
      email: 'test@example.com',
      emailVerified: true,
      role: 'user',
      profile: {
        firstName: 'Test',
        lastName: 'User',
        displayName: 'Test User',
      },
      providers: [
        {
          providerId: 'password',
          providerUid: 'test-user-123',
          connectedAt: new Date(),
        },
      ],
    };
  });

  describe('POST /api/v1/auth/register', () => {
    it('should register a new user successfully', async () => {
      const registerData = {
        firebaseUid: 'new-user-123',
        email: 'newuser@example.com',
        role: 'user',
        profile: {
          firstName: 'New',
          lastName: 'User',
          displayName: 'New User',
        },
        agreementAccepted: true,
        marketingConsent: false,
      };

      const response = await request(app)
        .post('/api/v1/auth/register')
        .set('x-test-user', 'test-user')
        .send(registerData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('用戶註冊成功');
      expect(response.body.data.user.email).toBe('newuser@example.com');
      expect(response.body.data.user.role).toBe('user');

      // 確認用戶已儲存到資料庫
      const savedUser = await User.findByFirebaseUid('new-user-123');
      expect(savedUser).toBeTruthy();
      expect(savedUser.email).toBe('newuser@example.com');
    });

    it('should register a merchant user successfully', async () => {
      const merchantData = {
        firebaseUid: 'merchant-123',
        email: 'merchant@example.com',
        role: 'merchant',
        profile: {
          firstName: 'Test',
          lastName: 'Merchant',
        },
        merchantInfo: {
          businessName: 'Test Business',
          businessType: 'restaurant',
          registrationNumber: '12345678',
          description: 'A test restaurant',
          address: {
            street: '123 Test St',
            city: 'Taipei',
            postalCode: '10001',
            country: 'TW',
          },
        },
        agreementAccepted: true,
      };

      const response = await request(app)
        .post('/api/v1/auth/register')
        .set('x-test-user', 'test-user')
        .send(merchantData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.role).toBe('merchant');
      expect(response.body.data.user.merchantInfo.businessName).toBe('Test Business');
      expect(response.body.data.user.isMerchant).toBe(true);
    });

    it('should fail when firebaseUid is missing', async () => {
      const invalidData = {
        email: 'test@example.com',
        role: 'user',
      };

      const response = await request(app)
        .post('/api/v1/auth/register')
        .set('x-test-user', 'test-user')
        .send(invalidData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('MISSING_REQUIRED_FIELDS');
    });

    it('should fail when email is missing', async () => {
      const invalidData = {
        firebaseUid: 'test-123',
        role: 'user',
      };

      const response = await request(app)
        .post('/api/v1/auth/register')
        .set('x-test-user', 'test-user')
        .send(invalidData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('MISSING_REQUIRED_FIELDS');
    });

    it('should fail when user already exists', async () => {
      // 先建立一個用戶
      await new User(testUser).save();

      const duplicateData = {
        firebaseUid: 'test-user-123',
        email: 'test@example.com',
        role: 'user',
      };

      const response = await request(app)
        .post('/api/v1/auth/register')
        .set('x-test-user', 'test-user')
        .send(duplicateData)
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('USER_ALREADY_EXISTS');
    });

    it('should fail when merchant role without merchant info', async () => {
      const invalidMerchantData = {
        firebaseUid: 'merchant-123',
        email: 'merchant@example.com',
        role: 'merchant',
      };

      const response = await request(app)
        .post('/api/v1/auth/register')
        .set('x-test-user', 'test-user')
        .send(invalidMerchantData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('MERCHANT_INFO_REQUIRED');
    });

    it('should fail without authentication', async () => {
      const registerData = {
        firebaseUid: 'new-user-123',
        email: 'newuser@example.com',
        role: 'user',
      };

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(registerData)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });
  });

  describe('GET /api/v1/auth/profile', () => {
    beforeEach(async () => {
      await new User(testUser).save();
    });

    it('should get user profile successfully', async () => {
      const response = await request(app)
        .get('/api/v1/auth/profile')
        .set('x-test-user', 'test-user')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe('test@example.com');
      expect(response.body.data.user.firebaseUid).toBe('test-user-123');
      expect(response.body.data.user.fullName).toBe('Test User');
    });

    it('should fail when user not found', async () => {
      // 清除所有用戶
      await User.deleteMany({});

      const response = await request(app)
        .get('/api/v1/auth/profile')
        .set('x-test-user', 'test-user')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('USER_NOT_FOUND');
    });

    it('should fail without authentication', async () => {
      const response = await request(app).get('/api/v1/auth/profile').expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    beforeEach(async () => {
      await new User(testUser).save();
    });

    it('should login successfully', async () => {
      const loginData = {
        firebaseUid: 'test-user-123',
        providerId: 'password',
      };

      const response = await request(app)
        .post('/api/v1/auth/login')
        .set('x-test-user', 'test-user')
        .send(loginData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('登入成功');
      expect(response.body.data.user.email).toBe('test@example.com');

      // 檢查登入統計是否更新
      const updatedUser = await User.findByFirebaseUid('test-user-123');
      expect(updatedUser.stats.loginCount).toBe(1);
      expect(updatedUser.stats.lastLoginAt).toBeTruthy();
    });

    it('should fail when user not found', async () => {
      const loginData = {
        firebaseUid: 'nonexistent-user',
      };

      const response = await request(app)
        .post('/api/v1/auth/login')
        .set('x-test-user', 'test-user')
        .send(loginData)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('USER_NOT_FOUND');
    });

    it('should fail when account is suspended', async () => {
      // 建立被暫停的用戶
      const suspendedUser = new User({
        ...testUser,
        firebaseUid: 'suspended-user-123',
        email: 'suspended@example.com',
        status: 'suspended',
      });
      await suspendedUser.save();

      const loginData = {
        firebaseUid: 'suspended-user-123',
      };

      const response = await request(app)
        .post('/api/v1/auth/login')
        .set('x-test-user', 'test-user')
        .send(loginData)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('ACCOUNT_SUSPENDED');
    });

    it('should fail when account is inactive', async () => {
      // 建立未啟用的用戶
      const inactiveUser = new User({
        ...testUser,
        firebaseUid: 'inactive-user-123',
        email: 'inactive@example.com',
        status: 'inactive',
      });
      await inactiveUser.save();

      const loginData = {
        firebaseUid: 'inactive-user-123',
      };

      const response = await request(app)
        .post('/api/v1/auth/login')
        .set('x-test-user', 'test-user')
        .send(loginData)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('ACCOUNT_INACTIVE');
    });
  });

  describe('POST /api/v1/auth/verify-email', () => {
    it('should handle email verification request', async () => {
      // 建立未驗證的用戶
      const unverifiedUser = new User({
        ...testUser,
        emailVerified: false,
      });
      await unverifiedUser.save();

      const response = await request(app)
        .post('/api/v1/auth/verify-email')
        .set('x-test-user', 'test-user')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('驗證信件已發送');
    });

    it('should fail when email already verified', async () => {
      await new User(testUser).save();

      const response = await request(app)
        .post('/api/v1/auth/verify-email')
        .set('x-test-user', 'test-user')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('EMAIL_ALREADY_VERIFIED');
    });

    it('should fail when user not found', async () => {
      const response = await request(app)
        .post('/api/v1/auth/verify-email')
        .set('x-test-user', 'test-user')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('USER_NOT_FOUND');
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('should logout successfully', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('x-test-user', 'test-user')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('登出成功');
    });

    it('should fail without authentication', async () => {
      const response = await request(app).post('/api/v1/auth/logout').expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });
  });
});

describe('User Model', () => {
  beforeAll(async () => {
    await setupTestApp();
  });

  afterAll(async () => {
    await teardownTestApp();
  });

  beforeEach(async () => {
    await User.deleteMany({});
  });

  describe('User Creation', () => {
    it('should create user with default values', async () => {
      const userData = {
        firebaseUid: 'test-123',
        email: 'test@example.com',
        providers: [
          {
            providerId: 'password',
            connectedAt: new Date(),
          },
        ],
      };

      const user = new User(userData);
      await user.save();

      expect(user.role).toBe('user');
      expect(user.status).toBe('active');
      expect(user.emailVerified).toBe(false);
      expect(user.preferences.language).toBe('zh-TW');
      expect(user.preferences.notifications.email).toBe(true);
      expect(user.stats.loginCount).toBe(0);
    });

    it('should validate email format', async () => {
      const userData = {
        firebaseUid: 'test-123',
        email: 'invalid-email',
        providers: [
          {
            providerId: 'password',
          },
        ],
      };

      const user = new User(userData);

      await expect(user.save()).rejects.toThrow();
    });

    it('should validate phone number format', async () => {
      const userData = {
        firebaseUid: 'test-123',
        email: 'test@example.com',
        profile: {
          phoneNumber: '0912345678', // 有效的台灣手機號碼
        },
        providers: [
          {
            providerId: 'password',
          },
        ],
      };

      const user = new User(userData);
      await user.save();

      expect(user.profile.phoneNumber).toBe('0912345678');
    });

    it('should reject invalid phone number', async () => {
      const userData = {
        firebaseUid: 'test-123',
        email: 'test@example.com',
        profile: {
          phoneNumber: '123456', // 無效的電話號碼
        },
        providers: [
          {
            providerId: 'password',
          },
        ],
      };

      const user = new User(userData);

      await expect(user.save()).rejects.toThrow();
    });

    it('should enforce unique firebaseUid', async () => {
      const userData = {
        firebaseUid: 'test-123',
        email: 'test1@example.com',
        providers: [
          {
            providerId: 'password',
          },
        ],
      };

      await new User(userData).save();

      // 嘗試建立相同 firebaseUid 的用戶
      const duplicateUser = new User({
        ...userData,
        email: 'test2@example.com',
      });

      await expect(duplicateUser.save()).rejects.toThrow();
    });

    it('should enforce unique email', async () => {
      const userData = {
        firebaseUid: 'test-123',
        email: 'test@example.com',
        providers: [
          {
            providerId: 'password',
          },
        ],
      };

      await new User(userData).save();

      // 嘗試建立相同 email 的用戶
      const duplicateUser = new User({
        ...userData,
        firebaseUid: 'test-456',
      });

      await expect(duplicateUser.save()).rejects.toThrow();
    });

    it('should require merchant info for merchant role', async () => {
      const merchantData = {
        firebaseUid: 'merchant-123',
        email: 'merchant@example.com',
        role: 'merchant',
        providers: [
          {
            providerId: 'password',
          },
        ],
        // 缺少 merchantInfo
      };

      const user = new User(merchantData);

      await expect(user.save()).rejects.toThrow('商戶用戶必須提供商戶資訊');
    });
  });

  describe('Virtual Properties', () => {
    it('should compute fullName correctly', async () => {
      const user = new User({
        firebaseUid: 'test-123',
        email: 'test@example.com',
        profile: {
          firstName: 'John',
          lastName: 'Doe',
        },
        providers: [
          {
            providerId: 'password',
          },
        ],
      });

      expect(user.fullName).toBe('John Doe');
    });

    it('should fallback to displayName for fullName', async () => {
      const user = new User({
        firebaseUid: 'test-123',
        email: 'test@example.com',
        profile: {
          displayName: 'Test User',
        },
        providers: [
          {
            providerId: 'password',
          },
        ],
      });

      expect(user.fullName).toBe('Test User');
    });

    it('should fallback to email prefix for fullName', async () => {
      const user = new User({
        firebaseUid: 'test-123',
        email: 'testuser@example.com',
        providers: [
          {
            providerId: 'password',
          },
        ],
      });

      expect(user.fullName).toBe('testuser');
    });

    it('should identify merchant correctly', async () => {
      const user = new User({
        firebaseUid: 'test-123',
        email: 'test@example.com',
        role: 'merchant',
        merchantInfo: {
          businessName: 'Test Business',
        },
        providers: [
          {
            providerId: 'password',
          },
        ],
      });

      expect(user.isMerchant).toBe(true);
    });

    it('should identify verified merchant correctly', async () => {
      const user = new User({
        firebaseUid: 'test-123',
        email: 'test@example.com',
        role: 'merchant',
        merchantInfo: {
          businessName: 'Test Business',
          verificationStatus: 'verified',
        },
        providers: [
          {
            providerId: 'password',
          },
        ],
      });

      expect(user.isVerifiedMerchant).toBe(true);
    });
  });

  describe('Instance Methods', () => {
    it('should update login stats', async () => {
      const user = new User({
        firebaseUid: 'test-123',
        email: 'test@example.com',
        providers: [
          {
            providerId: 'password',
          },
        ],
      });
      await user.save();

      await user.updateLoginStats();

      expect(user.stats.loginCount).toBe(1);
      expect(user.stats.lastLoginAt).toBeTruthy();
    });

    it('should add provider', async () => {
      const user = new User({
        firebaseUid: 'test-123',
        email: 'test@example.com',
        providers: [
          {
            providerId: 'password',
          },
        ],
      });
      await user.save();

      await user.addProvider('google.com', 'google-uid-123');

      expect(user.providers).toHaveLength(2);
      expect(user.providers[1].providerId).toBe('google.com');
      expect(user.providers[1].providerUid).toBe('google-uid-123');
    });

    it('should not add duplicate provider', async () => {
      const user = new User({
        firebaseUid: 'test-123',
        email: 'test@example.com',
        providers: [
          {
            providerId: 'password',
          },
        ],
      });
      await user.save();

      await user.addProvider('password');

      expect(user.providers).toHaveLength(1);
    });

    it('should remove provider', async () => {
      const user = new User({
        firebaseUid: 'test-123',
        email: 'test@example.com',
        providers: [{ providerId: 'password' }, { providerId: 'google.com' }],
      });
      await user.save();

      await user.removeProvider('google.com');

      expect(user.providers).toHaveLength(1);
      expect(user.providers[0].providerId).toBe('password');
    });

    it('should soft delete user', async () => {
      const user = new User({
        firebaseUid: 'test-123',
        email: 'test@example.com',
        providers: [
          {
            providerId: 'password',
          },
        ],
      });
      await user.save();

      await user.softDelete();

      expect(user.deletedAt).toBeTruthy();
      expect(user.status).toBe('inactive');
    });
  });

  describe('Static Methods', () => {
    beforeEach(async () => {
      // 建立測試用戶
      await User.create([
        {
          firebaseUid: 'active-1',
          email: 'active1@example.com',
          status: 'active',
          providers: [{ providerId: 'password' }],
        },
        {
          firebaseUid: 'inactive-1',
          email: 'inactive1@example.com',
          status: 'inactive',
          providers: [{ providerId: 'password' }],
        },
        {
          firebaseUid: 'merchant-1',
          email: 'merchant1@example.com',
          role: 'merchant',
          merchantInfo: {
            businessName: 'Business 1',
            verificationStatus: 'verified',
          },
          providers: [{ providerId: 'password' }],
        },
        {
          firebaseUid: 'deleted-1',
          email: 'deleted1@example.com',
          deletedAt: new Date(),
          providers: [{ providerId: 'password' }],
        },
      ]);
    });

    it('should find active users only', async () => {
      const activeUsers = await User.findActiveUsers();
      expect(activeUsers).toHaveLength(2); // active-1 和 merchant-1
      expect(activeUsers.every(user => user.status === 'active')).toBe(true);
    });

    it('should find user by firebase uid', async () => {
      const user = await User.findByFirebaseUid('active-1');
      expect(user).toBeTruthy();
      expect(user.email).toBe('active1@example.com');
    });

    it('should not find deleted user', async () => {
      const user = await User.findByFirebaseUid('deleted-1');
      expect(user).toBeNull();
    });

    it('should find all merchants', async () => {
      const merchants = await User.findMerchants();
      expect(merchants).toHaveLength(1);
      expect(merchants[0].role).toBe('merchant');
    });

    it('should find verified merchants only', async () => {
      const verifiedMerchants = await User.findMerchants('verified');
      expect(verifiedMerchants).toHaveLength(1);
      expect(verifiedMerchants[0].merchantInfo.verificationStatus).toBe('verified');
    });
  });
});
