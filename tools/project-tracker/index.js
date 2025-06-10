#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { ProjectTracker } = require('./src/ProjectTracker');
const { ArchitectureManager } = require('./src/ArchitectureManager');
const { ProgressManager } = require('./src/ProgressManager');
const { DevProgressTracker } = require('./src/DevProgressTracker');

class LocaliteProjectManager {
  constructor() {
    this.projectRoot = path.resolve(__dirname, '../..');
    this.configPath = path.join(__dirname, 'config');
    this.dataPath = path.join(__dirname, 'data');

    // 確保必要目錄存在
    this.ensureDirectories();

    this.tracker = new ProjectTracker(this.dataPath);
    this.architecture = new ArchitectureManager(this.configPath);
    this.progress = new ProgressManager(this.dataPath);
    this.devTracker = new DevProgressTracker(this.projectRoot);
  }

  ensureDirectories() {
    [this.configPath, this.dataPath].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  async init() {
    console.log('🚀 初始化在地人 AI 導覽系統專案追蹤器...\n');

    try {
      await this.architecture.loadArchitecture();
      await this.progress.loadProgress();
      console.log('✅ 專案追蹤器初始化完成');
    } catch (error) {
      console.error('❌ 初始化失敗:', error.message);
      process.exit(1);
    }
  }

  async showStatus() {
    console.log('\n📊 專案狀態概覽');
    console.log('='.repeat(50));

    // 獲取真實開發進度
    const realProgress = await this.devTracker.analyzeProjectProgress();
    const architectureStatus = await this.architecture.getStatus();
    const progressStatus = await this.progress.getStatus();

    console.log(`🏗️  架構完成度: ${realProgress.architecture.progress}%`);
    console.log(`💻 代碼庫進度: ${realProgress.codebase.progress}%`);
    console.log(`🔧 CI/CD設置: ${realProgress.cicd.progress}%`);
    console.log(`🧪 測試覆蓋: ${realProgress.testing.progress}%`);
    console.log(`📦 依賴管理: ${realProgress.dependencies.progress}%`);
    console.log(`🚀 整體進度: ${realProgress.overall.score}%`);
    console.log(`⏰ 當前階段: ${realProgress.overall.phase}`);
    console.log(`📋 待辦任務: ${progressStatus.pendingTasks}項`);
    console.log(`⚠️  風險項目: ${progressStatus.risks}項`);

    // 顯示 Git 統計
    if (realProgress.git.totalCommits > 0) {
      console.log('\n📈 Git 活動統計');
      console.log(`   總提交數: ${realProgress.git.totalCommits}`);
      console.log(`   最近7天提交: ${realProgress.git.recentCommits.length}`);
      console.log(`   貢獻者: ${realProgress.git.contributors.length}人`);
    }

    // 顯示代碼統計
    console.log('\n💻 代碼庫統計');
    console.log(`   檔案數量: ${realProgress.codebase.files}`);
    console.log(`   代碼行數: ${realProgress.codebase.lines.toLocaleString()}`);
    console.log(`   React組件: ${realProgress.codebase.components}`);
    console.log(`   API端點: ${realProgress.codebase.apiEndpoints}`);
    console.log(`   測試檔案: ${realProgress.codebase.testFiles}`);

    // 顯示建議
    if (realProgress.overall.recommendations.length > 0) {
      console.log('\n💡 系統建議');
      realProgress.overall.recommendations.forEach((rec, index) => {
        console.log(`   ${index + 1}. ${rec}`);
      });
    }
  }

  async updateProgress(week, status) {
    console.log(`\n🔄 更新第${week}週進度...`);
    await this.progress.updateWeek(week, status);
    console.log('✅ 進度更新完成');
  }

  async addTask(task) {
    console.log(`\n➕ 新增任務: ${task.title}`);
    await this.progress.addTask(task);
    console.log('✅ 任務新增完成');
  }

  async generateReport() {
    console.log('\n📝 生成專案報告...');

    const report = {
      timestamp: new Date().toISOString(),
      architecture: await this.architecture.getFullStatus(),
      progress: await this.progress.getFullStatus(),
      risks: await this.progress.getRisks(),
      recommendations: await this.generateRecommendations()
    };

    const reportPath = path.join(this.dataPath, `report-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log(`✅ 報告已生成: ${reportPath}`);
    return report;
  }

  async analyzeRealProgress() {
    console.log('\n🔍 實際開發進度分析');
    console.log('='.repeat(50));

    const realProgress = await this.devTracker.analyzeProjectProgress();

    // Git 進度分析
    console.log('\n📈 Git 版本控制分析');
    console.log(`   總提交數: ${realProgress.git.totalCommits}`);
    console.log(`   最近7天提交: ${realProgress.git.recentCommits.length}`);
    console.log(`   分支數量: ${realProgress.git.branches.length}`);
    console.log(`   貢獻者: ${realProgress.git.contributors.join(', ') || '無'}`);
    console.log(`   進度評分: ${realProgress.git.progress}%`);

    // 架構進度分析
    console.log('\n🏗️  專案架構分析');
    const arch = realProgress.architecture;
    console.log(
      `   後端架構: ${Object.values(arch.checks.backend).filter(Boolean).length}/${Object.keys(arch.checks.backend).length} 完成`
    );
    console.log(
      `   Web前端: ${Object.values(arch.checks.web).filter(Boolean).length}/${Object.keys(arch.checks.web).length} 完成`
    );
    console.log(
      `   移動端: ${Object.values(arch.checks.mobile).filter(Boolean).length}/${Object.keys(arch.checks.mobile).length} 完成`
    );
    console.log(
      `   共享模組: ${Object.values(arch.checks.shared).filter(Boolean).length}/${Object.keys(arch.checks.shared).length} 完成`
    );
    console.log(
      `   工具配置: ${Object.values(arch.checks.tools).filter(Boolean).length}/${Object.keys(arch.checks.tools).length} 完成`
    );
    console.log(`   整體進度: ${arch.progress}%`);

    // 代碼庫分析
    console.log('\n💻 代碼庫開發分析');
    const code = realProgress.codebase;
    console.log(`   檔案總數: ${code.files} 個`);
    console.log(`   代碼行數: ${code.lines.toLocaleString()} 行`);
    console.log(`   JS/TS檔案: ${code.jstsFiles} 個`);
    console.log(`   React組件: ${code.components} 個`);
    console.log(`   API端點: ${code.apiEndpoints} 個`);
    console.log(`   測試檔案: ${code.testFiles} 個`);
    console.log(`   進度評分: ${code.progress}%`);

    // 依賴管理分析
    console.log('\n📦 依賴管理分析');
    const deps = realProgress.dependencies;
    console.log(
      `   Root套件: ${deps.root?.dependencies || 0} dependencies, ${deps.root?.devDependencies || 0} devDependencies`
    );
    if (deps.backend) console.log(`   Backend套件: ${deps.backend.dependencies} dependencies`);
    if (deps.web) console.log(`   Web套件: ${deps.web.dependencies} dependencies`);
    if (deps.mobile) console.log(`   Mobile套件: ${deps.mobile.dependencies} dependencies`);
    console.log(`   node_modules: ${deps.nodeModules ? '✅' : '❌'}`);
    console.log(`   lock檔案: ${deps.lockFile ? '✅' : '❌'}`);
    console.log(`   進度評分: ${deps.progress}%`);

    // 測試分析
    console.log('\n🧪 測試設置分析');
    const test = realProgress.testing;
    console.log(`   測試檔案: ${test.testFiles.length} 個`);
    console.log(`   Jest配置: ${test.jestConfig ? '✅' : '❌'}`);
    console.log(`   覆蓋率報告: ${test.coverage.exists ? '✅' : '❌'}`);
    console.log(`   測試腳本: ${test.testScripts.length} 個`);
    console.log(`   進度評分: ${test.progress}%`);

    // CI/CD 分析
    console.log('\n🔧 CI/CD設置分析');
    const cicd = realProgress.cicd;
    console.log(`   GitHub Actions: ${cicd.githubActions ? '✅' : '❌'}`);
    console.log(`   Husky Hook: ${cicd.husky ? '✅' : '❌'}`);
    console.log(`   ESLint: ${cicd.eslint ? '✅' : '❌'}`);
    console.log(`   Prettier: ${cicd.prettier ? '✅' : '❌'}`);
    console.log(`   .gitignore: ${cicd.gitignore ? '✅' : '❌'}`);
    console.log(`   Dockerfile: ${cicd.dockerfile ? '✅' : '❌'}`);
    console.log(`   進度評分: ${cicd.progress}%`);

    // 部署分析
    console.log('\n🚀 部署設置分析');
    const deploy = realProgress.deployment;
    console.log(`   Firebase配置: ${deploy.firebase ? '✅' : '❌'}`);
    console.log(`   Docker配置: ${deploy.docker ? '✅' : '❌'}`);
    console.log(`   環境變數範本: ${deploy.env ? '✅' : '❌'}`);
    console.log(`   部署腳本: ${deploy.scripts.length} 個`);
    console.log(`   配置檔案: ${deploy.configs.length} 個`);
    console.log(`   進度評分: ${deploy.progress}%`);

    // 整體評估
    console.log('\n🎯 整體評估');
    console.log(`   總體進度: ${realProgress.overall.score}%`);
    console.log(`   當前階段: ${realProgress.overall.phase}`);

    // 建議
    if (realProgress.overall.recommendations.length > 0) {
      console.log('\n💡 改善建議');
      realProgress.overall.recommendations.forEach((rec, index) => {
        console.log(`   ${index + 1}. ${rec}`);
      });
    }

    // 保存分析結果
    const analysisPath = path.join(this.dataPath, `real-progress-${Date.now()}.json`);
    fs.writeFileSync(analysisPath, JSON.stringify(realProgress, null, 2));
    console.log(`\n📄 詳細分析結果已保存至: ${analysisPath}`);
  }

  async generateRecommendations() {
    const progressStatus = await this.progress.getStatus();
    const recommendations = [];

    if (progressStatus.completion < 30) {
      recommendations.push('建議加強基礎架構建置，確保後續開發順利');
    }

    if (progressStatus.risks > 3) {
      recommendations.push('風險項目較多，建議召開風險評估會議');
    }

    if (progressStatus.pendingTasks > 10) {
      recommendations.push('待辦任務較多，建議重新評估優先級');
    }

    return recommendations;
  }

  async help() {
    console.log('\n📖 在地人 AI 導覽系統 - 專案追蹤器');
    console.log('='.repeat(50));
    console.log('使用方式:');
    console.log('  node tools/project-tracker/index.js [命令]');
    console.log('');
    console.log('可用命令:');
    console.log('  init              初始化專案追蹤器');
    console.log('  status            顯示專案狀態概覽');
    console.log('  update <week>     更新指定週的進度');
    console.log('  add-task          新增開發任務');
    console.log('  report            生成詳細報告');
    console.log('  architecture      查看架構狀態');
    console.log('  analyze           分析實際開發進度');
    console.log('  help              顯示此說明');
  }
}

// CLI 處理
async function main() {
  const manager = new LocaliteProjectManager();
  const command = process.argv[2];

  switch (command) {
    case 'init':
      await manager.init();
      break;
    case 'status':
      await manager.init();
      await manager.showStatus();
      break;
    case 'update':
      const week = process.argv[3];
      if (!week) {
        console.error('❌ 請指定週數');
        process.exit(1);
      }
      await manager.init();
      await manager.updateProgress(week, {});
      break;
    case 'add-task':
      await manager.init();
      // 可以擴展為互動式輸入
      console.log('ℹ️  請使用互動模式新增任務');
      break;
    case 'report':
      await manager.init();
      await manager.generateReport();
      break;
    case 'architecture':
      await manager.init();
      console.log(await manager.architecture.getFullStatus());
      break;
    case 'analyze':
      await manager.init();
      await manager.analyzeRealProgress();
      break;
    case 'help':
    default:
      await manager.help();
      break;
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { LocaliteProjectManager };
