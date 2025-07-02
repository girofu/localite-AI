const swaggerSetup = require('../config/swagger');

describe('Swagger 配置測試', () => {
  test('應該正確載入 Swagger 配置', () => {
    expect(swaggerSetup).toBeDefined();
    expect(swaggerSetup.specs).toBeDefined();
    expect(swaggerSetup.swaggerUi).toBeDefined();
  });

  test('應該包含基本的 API 資訊', () => {
    const { specs } = swaggerSetup;

    expect(specs.info).toBeDefined();
    expect(specs.info.title).toBe('Localite AI 導覽系統 API');
    expect(specs.info.version).toBe('1.0.0');
    expect(specs.info.description).toContain('Localite AI 導覽系統後端 API 服務');
  });

  test('應該包含伺服器配置', () => {
    const { specs } = swaggerSetup;

    expect(specs.servers).toBeDefined();
    expect(Array.isArray(specs.servers)).toBe(true);
    expect(specs.servers.length).toBeGreaterThan(0);

    const devServer = specs.servers.find((server) => server.description === '開發環境');
    expect(devServer).toBeDefined();
  });

  test('應該包含安全配置', () => {
    const { specs } = swaggerSetup;

    expect(specs.components).toBeDefined();
    expect(specs.components.securitySchemes).toBeDefined();
    expect(specs.components.securitySchemes.bearerAuth).toBeDefined();
    expect(specs.components.securitySchemes.bearerAuth.type).toBe('http');
    expect(specs.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
  });

  test('應該包含基本的 Schema 定義', () => {
    const { specs } = swaggerSetup;

    expect(specs.components.schemas).toBeDefined();

    // 檢查基本 Schema
    expect(specs.components.schemas.Error).toBeDefined();
    expect(specs.components.schemas.SuccessResponse).toBeDefined();
    expect(specs.components.schemas.User).toBeDefined();
    expect(specs.components.schemas.Tour).toBeDefined();

    // 檢查功能旗標 Schema
    expect(specs.components.schemas.FeatureFlag).toBeDefined();

    // 檢查監控 Schema
    expect(specs.components.schemas.PerformanceMetrics).toBeDefined();
    expect(specs.components.schemas.SystemHealth).toBeDefined();
  });

  test('應該包含路由路徑配置', () => {
    const { specs } = swaggerSetup;

    expect(specs.paths).toBeDefined();

    // 由於我們使用 swagger-jsdoc，路徑會從路由文件中解析
    // 這裡我們至少確認 paths 對象存在
    expect(typeof specs.paths).toBe('object');
  });

  test('應該包含所有標籤定義', () => {
    const { specs } = swaggerSetup;

    expect(specs.tags).toBeDefined();
    expect(Array.isArray(specs.tags)).toBe(true);

    const tagNames = specs.tags.map((tag) => tag.name);

    // 檢查主要標籤
    expect(tagNames).toContain('Feature Flags');
    expect(tagNames).toContain('Monitoring');
    expect(tagNames).toContain('Authentication');
    expect(tagNames).toContain('Tours');
    expect(tagNames).toContain('Merchants');
    expect(tagNames).toContain('Products');
    expect(tagNames).toContain('AI Services');
  });

  test('Swagger UI 配置應該正確', () => {
    expect(swaggerSetup.customOptions).toBeDefined();
    expect(swaggerSetup.customOptions.customCss).toBeDefined();
    expect(swaggerSetup.customOptions.customSiteTitle).toBe('Localite API 文檔');
    expect(swaggerSetup.customOptions.swaggerOptions).toBeDefined();
    expect(swaggerSetup.customOptions.swaggerOptions.persistAuthorization).toBe(true);
  });
});
