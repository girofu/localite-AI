module.exports = {
  // 支援 monorepo 的專案配置
  projects: [
    {
      displayName: 'backend',
      testMatch: ['<rootDir>/backend/**/*.test.js'],
      testEnvironment: 'node',
      setupFilesAfterEnv: ['<rootDir>/backend/src/test/setup.js'],
      collectCoverageFrom: [
        '<rootDir>/backend/src/**/*.js',
        '!<rootDir>/backend/src/server.js',
        '!<rootDir>/backend/src/test/**',
      ],
      coverageDirectory: '<rootDir>/coverage/backend',
      rootDir: '.',
    },
    {
      displayName: 'web',
      testMatch: ['<rootDir>/frontend/web/**/*.test.{js,jsx}'],
      testEnvironment: 'jsdom',
      setupFilesAfterEnv: ['@testing-library/jest-dom'],
      collectCoverageFrom: [
        '<rootDir>/frontend/web/src/**/*.{js,jsx}',
        '!<rootDir>/frontend/web/src/index.js',
        '!<rootDir>/frontend/web/src/reportWebVitals.js',
      ],
      coverageDirectory: '<rootDir>/coverage/web',
      transform: {
        '^.+\\.(js|jsx)$': 'babel-jest',
      },
      moduleNameMapping: {
        '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
      },
      rootDir: '.',
    },
    {
      displayName: 'mobile',
      testMatch: ['<rootDir>/frontend/mobile/**/*.test.{js,jsx}'],
      testEnvironment: 'node',
      preset: 'react-native',
      collectCoverageFrom: [
        '<rootDir>/frontend/mobile/**/*.{js,jsx}',
        '!<rootDir>/frontend/mobile/node_modules/**',
        '!<rootDir>/frontend/mobile/App.js',
      ],
      coverageDirectory: '<rootDir>/coverage/mobile',
      rootDir: '.',
    },
  ],
  // 全域覆蓋率設定
  collectCoverage: true,
  coverageReporters: ['text', 'lcov', 'html'],
  coverageDirectory: '<rootDir>/coverage',
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
  // 忽略的檔案和目錄
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/dist/',
    '<rootDir>/build/',
  ],
  // 測試超時設定 (10 秒)
  testTimeout: 10000,
};
