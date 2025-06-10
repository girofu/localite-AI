#!/usr/bin/env node

const { LocaliteProjectManager } = require('../index');

async function runExample() {
  console.log('🚀 在地人 AI 導覽系統 - 專案追蹤器使用範例\n');

  const manager = new LocaliteProjectManager();

  try {
    // 1. 初始化專案追蹤器
    console.log('📋 步驟 1: 初始化專案追蹤器');
    await manager.init();
    console.log('✅ 初始化完成\n');

    // 2. 顯示專案狀態概覽
    console.log('📊 步驟 2: 查看專案狀態概覽');
    await manager.showStatus();
    console.log('');

    // 3. 新增範例任務
    console.log('➕ 步驟 3: 新增範例任務');
    await manager.addTask({
      title: '建立 Node.js Express 基礎架構',
      description: '設置基本的 Express 伺服器和路由結構',
      priority: 'high',
      assignee: '後端工程師',
      week: 1,
      tags: ['backend', 'architecture']
    });

    await manager.addTask({
      title: '設計資料庫 Schema',
      description: '定義 MongoDB 資料模型結構',
      priority: 'high',
      assignee: '後端工程師',
      week: 2,
      tags: ['database', 'design']
    });

    await manager.addTask({
      title: '整合 Firebase Authentication',
      description: '實作用戶認證系統',
      priority: 'medium',
      assignee: '後端工程師',
      week: 3,
      tags: ['auth', 'firebase']
    });

    console.log('✅ 範例任務新增完成\n');

    // 4. 更新第一週進度
    console.log('🔄 步驟 4: 更新第一週進度');
    await manager.updateProgress(1, {
      status: 'in-progress',
      completion: 60,
      notes: '基礎架構搭建進行中，Express 伺服器已設置完成，正在實作 API 路由'
    });
    console.log('✅ 第一週進度更新完成\n');

    // 5. 更新架構元件狀態
    console.log('🏗️ 步驟 5: 更新架構元件狀態');
    await manager.architecture.updateComponentStatus('phase1', 'projectInit', 'in-progress', 70);
    console.log('✅ 專案初始化元件狀態更新完成\n');

    // 6. 更新技術棧狀態
    console.log('⚙️ 步驟 6: 更新技術棧狀態');
    await manager.architecture.updateTechStackStatus('backend', 'implementing');
    console.log('✅ 後端技術棧狀態更新完成\n');

    // 7. 生成週報告
    console.log('📝 步驟 7: 生成第一週報告');
    const weeklyReport = await manager.tracker.generateWeeklyReport(
      manager.architecture,
      manager.progress,
      1
    );
    console.log('✅ 週報告生成完成\n');

    // 8. 生成專案報告
    console.log('📋 步驟 8: 生成完整專案報告');
    const fullReport = await manager.generateReport();
    console.log('✅ 完整專案報告生成完成\n');

    // 9. 顯示最終狀態
    console.log('📊 步驟 9: 最終專案狀態');
    await manager.showStatus();

    console.log('\n🎉 範例執行完成！');
    console.log('📁 檢查 tools/project-tracker/data/ 目錄查看生成的資料');
    console.log('📋 檢查 tools/project-tracker/data/reports/ 目錄查看報告');
  } catch (error) {
    console.error('❌ 執行過程中發生錯誤:', error.message);
    console.error(error);
  }
}

// 進階範例：模擬一個完整的開發週期
async function advancedExample() {
  console.log('\n🚀 進階範例：模擬完整開發週期\n');

  const manager = new LocaliteProjectManager();
  await manager.init();

  try {
    // 模擬第一個月的進度
    console.log('📅 模擬第一個月進度...');

    for (let week = 1; week <= 4; week++) {
      console.log(`\n週 ${week} 進度更新:`);

      // 隨機生成進度
      const completion = Math.min(100, week * 20 + Math.random() * 20);
      const status = completion >= 90 ? 'completed' : 'in-progress';

      await manager.updateProgress(week, {
        status,
        completion: Math.round(completion),
        notes: `第${week}週目標${completion >= 90 ? '已完成' : '進行中'}`
      });

      console.log(`  進度: ${Math.round(completion)}%`);
      console.log(`  狀態: ${status}`);
    }

    // 更新架構元件
    console.log('\n🏗️ 更新架構元件狀態...');
    await manager.architecture.updateComponentStatus('phase1', 'projectInit', 'completed', 100);
    await manager.architecture.updateComponentStatus('phase1', 'apiFramework', 'in-progress', 70);
    await manager.architecture.updateComponentStatus('phase1', 'dataModel', 'in-progress', 50);

    // 生成月報告
    console.log('\n📋 生成第一個月報告...');
    const monthlyReport = await manager.tracker.generateMonthlyReport(
      manager.architecture,
      manager.progress,
      1
    );

    console.log('✅ 第一個月模擬完成');

    // 顯示進度趨勢
    console.log('\n📈 進度趨勢分析:');
    const progressData = await manager.progress.getFullStatus();
    console.log(`  總體完成度: ${progressData.summary.completion}%`);
    console.log(`  當前階段: ${progressData.summary.currentPhase}`);
    console.log(`  風險項目: ${progressData.summary.risks}個`);

    // 風險分析
    const risks = await manager.progress.getRisks();
    if (risks.length > 0) {
      console.log('\n⚠️ 識別的風險項目:');
      risks.forEach((risk, index) => {
        console.log(`  ${index + 1}. [${risk.severity}] ${risk.message}`);
      });
    }

    // 生成建議
    const recommendations = await manager.generateRecommendations();
    if (recommendations.length > 0) {
      console.log('\n💡 系統建議:');
      recommendations.forEach((rec, index) => {
        console.log(`  ${index + 1}. ${rec}`);
      });
    }
  } catch (error) {
    console.error('❌ 進階範例執行錯誤:', error.message);
  }
}

// 如果直接執行此腳本
if (require.main === module) {
  const mode = process.argv[2] || 'basic';

  if (mode === 'advanced') {
    advancedExample();
  } else {
    runExample();
  }
}

module.exports = { runExample, advancedExample };
