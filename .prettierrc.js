module.exports = {
  // 基本格式設定
  semi: true,
  trailingComma: 'es5',
  singleQuote: true,
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,

  // JSX 設定
  jsxSingleQuote: true,
  jsxBracketSameLine: false,

  // 其他設定
  bracketSpacing: true,
  arrowParens: 'avoid',
  endOfLine: 'lf',

  // 覆蓋特定檔案類型的設定
  overrides: [
    {
      files: '*.{js,jsx,ts,tsx}',
      options: {
        singleQuote: true,
        semi: true,
      },
    },
    {
      files: '*.{json,yaml,yml}',
      options: {
        tabWidth: 2,
      },
    },
    {
      files: '*.md',
      options: {
        printWidth: 80,
        proseWrap: 'always',
      },
    },
  ],
};
