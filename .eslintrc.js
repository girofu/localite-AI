module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es2021: true,
    jest: true,
  },
  extends: ['eslint:recommended', 'airbnb-base'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  rules: {
    'no-console': process.env.NODE_ENV === 'production' ? 'error' : 'warn',
    'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'warn',
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'max-len': [
      'error',
      {
        code: 100,
        ignoreUrls: true,
        ignoreComments: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
      },
    ],
    'import/no-extraneous-dependencies': [
      'error',
      {
        devDependencies: [
          '**/*.test.js',
          '**/*.test.jsx',
          '**/*.spec.js',
          '**/*.spec.jsx',
          '**/test/**',
          '**/tests/**',
          'jest.config.js',
          '**/*.config.js',
        ],
      },
    ],
    'prefer-const': 'error',
    'no-var': 'error',
    'object-shorthand': 'error',
    'prefer-arrow-callback': 'error',
  },
  overrides: [
    // 後端特定配置
    {
      files: ['backend/**/*.js'],
      env: {
        node: true,
        browser: false,
      },
      rules: {
        'import/no-unresolved': 'off', // 後端可能有動態 imports
      },
    },
    // 前端 React 配置
    {
      files: ['frontend/web/**/*.{js,jsx}'],
      extends: ['plugin:react/recommended', 'plugin:react-hooks/recommended'],
      env: {
        browser: true,
        node: false,
      },
      settings: {
        react: {
          version: 'detect',
        },
      },
      rules: {
        'react/prop-types': 'warn',
        'react/jsx-uses-react': 'off',
        'react/react-in-jsx-scope': 'off', // React 17+ 不需要
        'jsx-a11y/anchor-is-valid': 'warn',
      },
    },
    // React Native 配置
    {
      files: ['frontend/mobile/**/*.{js,jsx}'],
      extends: [
        'plugin:react/recommended',
        'plugin:react-hooks/recommended',
        '@react-native-community',
      ],
      env: {
        'react-native/react-native': true,
      },
      rules: {
        'react-native/no-unused-styles': 'warn',
        'react-native/split-platform-components': 'warn',
        'react-native/no-inline-styles': 'warn',
      },
    },
    // 測試檔案配置
    {
      files: ['**/*.test.{js,jsx}', '**/*.spec.{js,jsx}'],
      env: {
        jest: true,
      },
      rules: {
        'no-console': 'off',
        'max-len': 'off',
      },
    },
  ],
};
