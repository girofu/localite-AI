const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class DevProgressTracker {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.appsPath = path.join(projectRoot, 'apps');
    this.packagesPath = path.join(projectRoot, 'packages');
    this.toolsPath = path.join(projectRoot, 'tools');
  }

  /**
   * 分析整體專案進度
   */
  async analyzeProjectProgress() {
    const progress = {
      timestamp: new Date().toISOString(),
      git: await this.analyzeGitProgress(),
      architecture: await this.analyzeArchitectureProgress(),
      codebase: await this.analyzeCodebaseProgress(),
      dependencies: await this.analyzeDependencies(),
      testing: await this.analyzeTestingProgress(),
      cicd: await this.analyzeCICDProgress(),
      deployment: await this.analyzeDeploymentProgress(),
      overall: {}
    };

    // 計算整體進度
    progress.overall = this.calculateOverallProgress(progress);
    return progress;
  }

  /**
   * 分析 Git 進度
   */
  async analyzeGitProgress() {
    try {
      const gitStats = {
        totalCommits: this.getGitCommitCount(),
        recentCommits: this.getRecentCommits(7), // 最近7天
        branches: this.getGitBranches(),
        contributors: this.getContributors(),
        codeChurn: this.getCodeChurn(),
        weeklyActivity: this.getWeeklyCommitActivity()
      };

      return {
        ...gitStats,
        progress: this.calculateGitProgress(gitStats)
      };
    } catch (error) {
      return { error: error.message, progress: 0 };
    }
  }

  /**
   * 分析架構進度
   */
  async analyzeArchitectureProgress() {
    const architectureChecks = {
      // 後端架構
      backend: {
        express:
          this.checkFileExists('apps/backend/src/app.js') ||
          this.checkFileExists('apps/backend/src/index.js'),
        routes: this.checkDirectoryExists('apps/backend/src/routes'),
        controllers: this.checkDirectoryExists('apps/backend/src/controllers'),
        models: this.checkDirectoryExists('apps/backend/src/models'),
        middleware: this.checkDirectoryExists('apps/backend/src/middleware'),
        config:
          this.checkDirectoryExists('apps/backend/src/config') ||
          this.checkDirectoryExists('apps/backend/config'),
        packageJson: this.checkFileExists('apps/backend/package.json')
      },

      // 前端架構
      web: {
        react:
          this.checkFileExists('apps/web/src/App.js') ||
          this.checkFileExists('apps/web/src/App.tsx'),
        components: this.checkDirectoryExists('apps/web/src/components'),
        pages:
          this.checkDirectoryExists('apps/web/src/pages') ||
          this.checkDirectoryExists('apps/web/src/views'),
        routes:
          this.checkFileExists('apps/web/src/routes.js') ||
          this.checkFileExists('apps/web/src/App.js'),
        packageJson: this.checkFileExists('apps/web/package.json')
      },

      // 行動端架構
      mobile: {
        reactNative:
          this.checkFileExists('apps/mobile/App.js') || this.checkFileExists('apps/mobile/App.tsx'),
        src: this.checkDirectoryExists('apps/mobile/src'),
        navigation:
          this.checkDirectoryExists('apps/mobile/src/navigation') ||
          this.searchForFiles('apps/mobile/src', /navigation|router/i),
        components: this.checkDirectoryExists('apps/mobile/src/components'),
        packageJson: this.checkFileExists('apps/mobile/package.json')
      },

      // 共享模組
      shared: {
        types: this.checkDirectoryExists('packages/shared/src/types'),
        utils:
          this.checkDirectoryExists('packages/shared/src/utils') ||
          this.checkDirectoryExists('packages/shared/src'),
        packageJson: this.checkFileExists('packages/shared/package.json')
      },

      // 工具和配置
      tools: {
        docker:
          this.checkFileExists('docker-compose.yml') || this.checkDirectoryExists('tools/docker'),
        scripts: this.checkDirectoryExists('tools/scripts'),
        projectTracker: this.checkDirectoryExists('tools/project-tracker')
      }
    };

    return {
      checks: architectureChecks,
      progress: this.calculateArchitectureProgress(architectureChecks)
    };
  }

  /**
   * 分析代碼庫進度
   */
  async analyzeCodebaseProgress() {
    const codeStats = {
      files: this.countFiles(),
      lines: this.countLines(),
      jstsFiles: this.countJSTSFiles(),
      components: this.countReactComponents(),
      apiEndpoints: this.countAPIEndpoints(),
      testFiles: this.countTestFiles()
    };

    return {
      ...codeStats,
      progress: this.calculateCodebaseProgress(codeStats)
    };
  }

  /**
   * 分析依賴和環境配置
   */
  async analyzeDependencies() {
    const deps = {
      root: this.analyzePkgJson('package.json'),
      backend: this.analyzePkgJson('apps/backend/package.json'),
      web: this.analyzePkgJson('apps/web/package.json'),
      mobile: this.analyzePkgJson('apps/mobile/package.json'),
      nodeModules: this.checkDirectoryExists('node_modules'),
      lockFile: this.checkFileExists('package-lock.json') || this.checkFileExists('yarn.lock')
    };

    return {
      ...deps,
      progress: this.calculateDependenciesProgress(deps)
    };
  }

  /**
   * 分析測試進度
   */
  async analyzeTestingProgress() {
    try {
      const testStats = {
        testFiles: this.findTestFiles(),
        jestConfig: this.checkFileExists('jest.config.js') || this.checkJestInPackageJson(),
        coverage: this.getCoverageInfo(),
        testScripts: this.getTestScripts()
      };

      return {
        ...testStats,
        progress: this.calculateTestingProgress(testStats)
      };
    } catch (error) {
      return { error: error.message, progress: 0 };
    }
  }

  /**
   * 分析 CI/CD 進度
   */
  async analyzeCICDProgress() {
    const cicd = {
      githubActions: this.checkDirectoryExists('.github/workflows'),
      husky: this.checkDirectoryExists('.husky'),
      eslint: this.checkFileExists('.eslintrc.js') || this.checkFileExists('.eslintrc.json'),
      prettier: this.checkFileExists('.prettierrc.js') || this.checkFileExists('.prettierrc'),
      gitignore: this.checkFileExists('.gitignore'),
      dockerfile: this.checkFileExists('Dockerfile') || this.findFiles('**/Dockerfile').length > 0
    };

    return {
      ...cicd,
      progress: this.calculateCICDProgress(cicd)
    };
  }

  /**
   * 分析部署進度
   */
  async analyzeDeploymentProgress() {
    const deployment = {
      firebase: this.checkFileExists('firebase.json'),
      docker: this.checkFileExists('docker-compose.yml'),
      env: this.checkFileExists('.env.example') || this.checkFileExists('.env.template'),
      scripts: this.getDeploymentScripts(),
      configs: this.getConfigFiles()
    };

    return {
      ...deployment,
      progress: this.calculateDeploymentProgress(deployment)
    };
  }

  // ============= Git 相關方法 =============
  getGitCommitCount() {
    try {
      const result = execSync('git rev-list --count HEAD', {
        cwd: this.projectRoot,
        encoding: 'utf8'
      });
      return parseInt(result.trim());
    } catch {
      return 0;
    }
  }

  getRecentCommits(days = 7) {
    try {
      const since = new Date();
      since.setDate(since.getDate() - days);
      const result = execSync(`git log --since="${since.toISOString()}" --oneline --no-merges`, {
        cwd: this.projectRoot,
        encoding: 'utf8'
      });
      return result
        .trim()
        .split('\n')
        .filter(line => line.length > 0);
    } catch {
      return [];
    }
  }

  getGitBranches() {
    try {
      const result = execSync('git branch -a', {
        cwd: this.projectRoot,
        encoding: 'utf8'
      });
      return result
        .trim()
        .split('\n')
        .map(branch => branch.trim());
    } catch {
      return [];
    }
  }

  getContributors() {
    try {
      const result = execSync('git log --format="%an" | sort | uniq', {
        cwd: this.projectRoot,
        encoding: 'utf8',
        shell: true
      });
      return result
        .trim()
        .split('\n')
        .filter(name => name.length > 0);
    } catch {
      return [];
    }
  }

  getCodeChurn() {
    try {
      const result = execSync(
        'git log --oneline --shortstat --no-merges | grep -E "file.*changed" | head -20',
        { cwd: this.projectRoot, encoding: 'utf8', shell: true }
      );

      const lines = result.trim().split('\n');
      let totalInsertions = 0;
      let totalDeletions = 0;

      lines.forEach(line => {
        const insertMatch = line.match(/(\d+) insertions?/);
        const deleteMatch = line.match(/(\d+) deletions?/);

        if (insertMatch) totalInsertions += parseInt(insertMatch[1]);
        if (deleteMatch) totalDeletions += parseInt(deleteMatch[1]);
      });

      return { insertions: totalInsertions, deletions: totalDeletions };
    } catch {
      return { insertions: 0, deletions: 0 };
    }
  }

  getWeeklyCommitActivity() {
    try {
      const weeks = [];
      for (let i = 0; i < 4; i++) {
        const since = new Date();
        const until = new Date();
        since.setDate(since.getDate() - (i + 1) * 7);
        until.setDate(until.getDate() - i * 7);

        const result = execSync(
          `git log --since="${since.toISOString()}" --until="${until.toISOString()}" --oneline --no-merges`,
          { cwd: this.projectRoot, encoding: 'utf8' }
        );

        weeks.unshift({
          week: i + 1,
          commits: result
            .trim()
            .split('\n')
            .filter(line => line.length > 0).length
        });
      }
      return weeks;
    } catch {
      return [];
    }
  }

  // ============= 檔案系統相關方法 =============
  checkFileExists(relativePath) {
    return fs.existsSync(path.join(this.projectRoot, relativePath));
  }

  checkDirectoryExists(relativePath) {
    const fullPath = path.join(this.projectRoot, relativePath);
    return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
  }

  searchForFiles(dir, pattern) {
    try {
      const fullPath = path.join(this.projectRoot, dir);
      if (!fs.existsSync(fullPath)) return false;

      const files = fs.readdirSync(fullPath, { recursive: true });
      return files.some(file => pattern.test(file));
    } catch {
      return false;
    }
  }

  findFiles(pattern) {
    try {
      const result = execSync(`find . -name "${pattern}" -type f`, {
        cwd: this.projectRoot,
        encoding: 'utf8'
      });
      return result
        .trim()
        .split('\n')
        .filter(line => line.length > 0);
    } catch {
      return [];
    }
  }

  countFiles() {
    try {
      const result = execSync(
        'find . -name "*.js" -o -name "*.ts" -o -name "*.jsx" -o -name "*.tsx" | wc -l',
        {
          cwd: this.projectRoot,
          encoding: 'utf8',
          shell: true
        }
      );
      return parseInt(result.trim());
    } catch {
      return 0;
    }
  }

  countLines() {
    try {
      const result = execSync(
        'find . -name "*.js" -o -name "*.ts" -o -name "*.jsx" -o -name "*.tsx" | xargs wc -l | tail -1',
        {
          cwd: this.projectRoot,
          encoding: 'utf8',
          shell: true
        }
      );
      const match = result.match(/(\d+)\s+total/);
      return match ? parseInt(match[1]) : 0;
    } catch {
      return 0;
    }
  }

  countJSTSFiles() {
    const extensions = ['.js', '.ts', '.jsx', '.tsx'];
    let count = 0;

    const countInDir = dir => {
      try {
        const items = fs.readdirSync(dir);
        items.forEach(item => {
          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);

          if (stat.isDirectory() && !item.includes('node_modules')) {
            count += countInDir(fullPath);
          } else if (stat.isFile() && extensions.some(ext => item.endsWith(ext))) {
            count++;
          }
        });
      } catch {}
      return count;
    };

    return countInDir(this.projectRoot);
  }

  countReactComponents() {
    try {
      const result = execSync(
        'grep -r "export.*component\\|function.*Component\\|class.*Component\\|const.*=.*=>" apps/ packages/ --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx" | wc -l',
        {
          cwd: this.projectRoot,
          encoding: 'utf8',
          shell: true
        }
      );
      return parseInt(result.trim());
    } catch {
      return 0;
    }
  }

  countAPIEndpoints() {
    try {
      const result = execSync(
        'grep -r "app\\.(get\\|post\\|put\\|delete)\\|router\\.(get\\|post\\|put\\|delete)\\|Route\\|endpoint" apps/backend/ --include="*.js" --include="*.ts" | wc -l',
        {
          cwd: this.projectRoot,
          encoding: 'utf8',
          shell: true
        }
      );
      return parseInt(result.trim());
    } catch {
      return 0;
    }
  }

  countTestFiles() {
    try {
      const result = execSync(
        'find . -name "*.test.js" -o -name "*.test.ts" -o -name "*.spec.js" -o -name "*.spec.ts" | wc -l',
        {
          cwd: this.projectRoot,
          encoding: 'utf8',
          shell: true
        }
      );
      return parseInt(result.trim());
    } catch {
      return 0;
    }
  }

  // ============= 依賴和配置分析 =============
  analyzePkgJson(relativePath) {
    try {
      const fullPath = path.join(this.projectRoot, relativePath);
      if (!fs.existsSync(fullPath)) return null;

      const pkg = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      return {
        name: pkg.name,
        version: pkg.version,
        dependencies: Object.keys(pkg.dependencies || {}).length,
        devDependencies: Object.keys(pkg.devDependencies || {}).length,
        scripts: Object.keys(pkg.scripts || {}).length,
        hasStart: !!pkg.scripts?.start,
        hasTest: !!pkg.scripts?.test,
        hasBuild: !!pkg.scripts?.build
      };
    } catch {
      return null;
    }
  }

  findTestFiles() {
    try {
      const result = execSync(
        'find . -name "*.test.*" -o -name "*.spec.*" -o -name "__tests__" -type f',
        {
          cwd: this.projectRoot,
          encoding: 'utf8'
        }
      );
      return result
        .trim()
        .split('\n')
        .filter(line => line.length > 0);
    } catch {
      return [];
    }
  }

  checkJestInPackageJson() {
    const pkgPath = path.join(this.projectRoot, 'package.json');
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      return !!(pkg.jest || pkg.devDependencies?.jest || pkg.dependencies?.jest);
    } catch {
      return false;
    }
  }

  getCoverageInfo() {
    const coveragePath = path.join(this.projectRoot, 'coverage');
    return {
      exists: fs.existsSync(coveragePath),
      reportPath: path.join(coveragePath, 'lcov-report', 'index.html')
    };
  }

  getTestScripts() {
    const scripts = [];
    [
      'package.json',
      'apps/backend/package.json',
      'apps/web/package.json',
      'apps/mobile/package.json'
    ].forEach(pkgPath => {
      const fullPath = path.join(this.projectRoot, pkgPath);
      try {
        const pkg = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        if (pkg.scripts) {
          Object.keys(pkg.scripts).forEach(script => {
            if (script.includes('test')) {
              scripts.push({ package: pkgPath, script, command: pkg.scripts[script] });
            }
          });
        }
      } catch {}
    });
    return scripts;
  }

  getDeploymentScripts() {
    const scripts = [];
    const pkgPath = path.join(this.projectRoot, 'package.json');
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.scripts) {
        Object.keys(pkg.scripts).forEach(script => {
          if (script.includes('deploy') || script.includes('build') || script.includes('docker')) {
            scripts.push({ script, command: pkg.scripts[script] });
          }
        });
      }
    } catch {}
    return scripts;
  }

  getConfigFiles() {
    const configs = [];
    const configFiles = [
      'firebase.json',
      'firestore.rules',
      'storage.rules',
      '.env.example',
      '.env.template',
      'docker-compose.yml',
      'tsconfig.json',
      '.eslintrc.js',
      '.prettierrc.js'
    ];

    configFiles.forEach(file => {
      if (this.checkFileExists(file)) {
        configs.push(file);
      }
    });

    return configs;
  }

  // ============= 進度計算方法 =============
  calculateGitProgress(gitStats) {
    let score = 0;
    const maxScore = 100;

    // 提交數量 (40分)
    if (gitStats.totalCommits > 50) score += 40;
    else if (gitStats.totalCommits > 20) score += 30;
    else if (gitStats.totalCommits > 10) score += 20;
    else if (gitStats.totalCommits > 0) score += 10;

    // 最近活動 (30分)
    if (gitStats.recentCommits.length > 10) score += 30;
    else if (gitStats.recentCommits.length > 5) score += 20;
    else if (gitStats.recentCommits.length > 0) score += 10;

    // 分支管理 (20分)
    if (gitStats.branches.length > 3) score += 20;
    else if (gitStats.branches.length > 1) score += 10;

    // 貢獻者 (10分)
    if (gitStats.contributors.length > 1) score += 10;
    else if (gitStats.contributors.length === 1) score += 5;

    return Math.min(score, maxScore);
  }

  calculateArchitectureProgress(checks) {
    let score = 0;
    let total = 0;

    // 計算每個模塊的分數
    Object.values(checks).forEach(module => {
      Object.values(module).forEach(check => {
        total += 1;
        if (check) score += 1;
      });
    });

    return total > 0 ? Math.round((score / total) * 100) : 0;
  }

  calculateCodebaseProgress(stats) {
    let score = 0;

    // 檔案數量 (30分)
    if (stats.files > 50) score += 30;
    else if (stats.files > 20) score += 20;
    else if (stats.files > 10) score += 15;
    else if (stats.files > 0) score += 10;

    // 代碼行數 (25分)
    if (stats.lines > 5000) score += 25;
    else if (stats.lines > 2000) score += 20;
    else if (stats.lines > 1000) score += 15;
    else if (stats.lines > 500) score += 10;
    else if (stats.lines > 0) score += 5;

    // React 組件 (25分)
    if (stats.components > 20) score += 25;
    else if (stats.components > 10) score += 20;
    else if (stats.components > 5) score += 15;
    else if (stats.components > 0) score += 10;

    // API 端點 (20分)
    if (stats.apiEndpoints > 15) score += 20;
    else if (stats.apiEndpoints > 10) score += 15;
    else if (stats.apiEndpoints > 5) score += 10;
    else if (stats.apiEndpoints > 0) score += 5;

    return Math.min(score, 100);
  }

  calculateDependenciesProgress(deps) {
    let score = 0;

    if (deps.nodeModules) score += 20;
    if (deps.lockFile) score += 15;
    if (deps.root) score += 20;
    if (deps.backend?.dependencies > 5) score += 15;
    if (deps.web?.dependencies > 5) score += 15;
    if (deps.mobile?.dependencies > 5) score += 15;

    return Math.min(score, 100);
  }

  calculateTestingProgress(stats) {
    let score = 0;

    if (stats.testFiles.length > 10) score += 40;
    else if (stats.testFiles.length > 5) score += 30;
    else if (stats.testFiles.length > 0) score += 20;

    if (stats.jestConfig) score += 20;
    if (stats.coverage.exists) score += 20;
    if (stats.testScripts.length > 0) score += 20;

    return Math.min(score, 100);
  }

  calculateCICDProgress(cicd) {
    let score = 0;

    if (cicd.githubActions) score += 25;
    if (cicd.husky) score += 15;
    if (cicd.eslint) score += 15;
    if (cicd.prettier) score += 15;
    if (cicd.gitignore) score += 15;
    if (cicd.dockerfile) score += 15;

    return Math.min(score, 100);
  }

  calculateDeploymentProgress(deployment) {
    let score = 0;

    if (deployment.firebase) score += 25;
    if (deployment.docker) score += 25;
    if (deployment.env) score += 20;
    if (deployment.scripts.length > 0) score += 15;
    if (deployment.configs.length > 5) score += 15;

    return Math.min(score, 100);
  }

  calculateOverallProgress(progress) {
    const weights = {
      git: 0.15,
      architecture: 0.25,
      codebase: 0.2,
      dependencies: 0.1,
      testing: 0.15,
      cicd: 0.1,
      deployment: 0.05
    };

    let totalScore = 0;
    let totalWeight = 0;

    Object.entries(weights).forEach(([key, weight]) => {
      if (progress[key] && typeof progress[key].progress === 'number') {
        totalScore += progress[key].progress * weight;
        totalWeight += weight;
      }
    });

    const overall = totalWeight > 0 ? Math.round(totalScore / totalWeight) : 0;

    return {
      score: overall,
      phase: this.determinePhase(overall, progress),
      recommendations: this.generateRecommendations(progress)
    };
  }

  determinePhase(score, progress) {
    if (score < 25) return '基礎架構與核心功能 (第1個月)';
    if (score < 65) return '核心功能開發 (第2個月)';
    if (score < 90) return '系統完善與部署 (第3個月)';
    return '專案完成';
  }

  generateRecommendations(progress) {
    const recommendations = [];

    if (progress.git.progress < 30) {
      recommendations.push('建議增加Git提交頻率，建立良好的版本控制習慣');
    }

    if (progress.architecture.progress < 50) {
      recommendations.push('優先完成基礎架構設置，包括專案結構和核心模組');
    }

    if (progress.testing.progress < 30) {
      recommendations.push('加強測試覆蓋率，建立自動化測試流程');
    }

    if (progress.cicd.progress < 50) {
      recommendations.push('設置CI/CD管道，包括代碼檢查和自動化部署');
    }

    if (progress.dependencies.progress < 70) {
      recommendations.push('完善依賴管理，確保所有必要套件已安裝');
    }

    return recommendations;
  }
}

module.exports = { DevProgressTracker };
