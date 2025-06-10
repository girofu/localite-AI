const fs = require('fs');
const path = require('path');

class ProjectTracker {
  constructor(dataPath) {
    this.dataPath = dataPath;
    this.reportsPath = path.join(dataPath, 'reports');
    this.configFile = path.join(dataPath, 'tracker-config.json');

    // 確保報告目錄存在
    if (!fs.existsSync(this.reportsPath)) {
      fs.mkdirSync(this.reportsPath, { recursive: true });
    }

    this.defaultConfig = {
      projectName: '在地人 AI 導覽系統',
      version: '3.0.0',
      startDate: new Date().toISOString(),
      team: {
        projectManager: '',
        engineer: '',
        designer: '',
        consultant: ''
      },
      settings: {
        reportFrequency: 'weekly',
        alertThresholds: {
          riskCount: 3,
          delayWeeks: 1,
          taskOverdue: 5
        },
        autoSave: true,
        backupRetention: 30
      }
    };
  }

  async init() {
    if (!fs.existsSync(this.configFile)) {
      await this.saveConfig(this.defaultConfig);
    }

    this.config = JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
  }

  async saveConfig(config) {
    fs.writeFileSync(this.configFile, JSON.stringify(config, null, 2));
  }

  async generateDashboardData(architectureManager, progressManager) {
    const architectureStatus = await architectureManager.getStatus();
    const progressStatus = await progressManager.getStatus();
    const risks = await progressManager.getRisks();

    return {
      overview: {
        projectName: this.config.projectName,
        version: this.config.version,
        currentWeek: progressStatus.currentWeek,
        totalWeeks: progressStatus.totalWeeks,
        overallProgress: Math.round(
          (architectureStatus.completion + progressStatus.completion) / 2
        ),
        currentPhase: progressStatus.currentPhase
      },
      progress: {
        architecture: architectureStatus,
        development: progressStatus,
        combined: this.calculateCombinedProgress(architectureStatus, progressStatus)
      },
      risks: {
        total: risks.length,
        high: risks.filter(r => r.severity === 'high').length,
        medium: risks.filter(r => r.severity === 'medium').length,
        low: risks.filter(r => r.severity === 'low').length,
        items: risks
      },
      upcomingTasks: await this.getUpcomingTasks(progressManager),
      milestones: await this.getUpcomingMilestones(progressManager)
    };
  }

  calculateCombinedProgress(architectureStatus, progressStatus) {
    return {
      completion: Math.round((architectureStatus.completion + progressStatus.completion) / 2),
      weeklyVelocity: this.calculateWeeklyVelocity(progressStatus),
      estimatedCompletion: this.estimateCompletion(progressStatus),
      efficiency: this.calculateEfficiency(architectureStatus, progressStatus)
    };
  }

  calculateWeeklyVelocity(progressStatus) {
    // 計算過去4週的平均完成速度
    const currentWeek = progressStatus.currentWeek;
    const weeks = Math.min(4, currentWeek - 1);

    if (weeks <= 0) return 0;

    return Math.round((progressStatus.completion / currentWeek) * 100) / 100;
  }

  estimateCompletion(progressStatus) {
    const velocity = this.calculateWeeklyVelocity(progressStatus);
    if (velocity <= 0) return null;

    const remainingWork = 100 - progressStatus.completion;
    const estimatedWeeks = Math.ceil(remainingWork / velocity);

    const completionDate = new Date();
    completionDate.setDate(completionDate.getDate() + estimatedWeeks * 7);

    return {
      estimatedWeeks,
      estimatedDate: completionDate.toISOString(),
      confidence: this.calculateConfidence(velocity, progressStatus)
    };
  }

  calculateConfidence(velocity, progressStatus) {
    // 基於進度穩定性計算信心度
    if (progressStatus.risks > 3) return 'low';
    if (velocity > 8 && progressStatus.risks <= 1) return 'high';
    return 'medium';
  }

  calculateEfficiency(architectureStatus, progressStatus) {
    // 架構完成度 vs 開發進度的比例
    if (architectureStatus.completion === 0) return 0;

    const ratio = progressStatus.completion / architectureStatus.completion;

    if (ratio > 0.8) return 'high';
    if (ratio > 0.6) return 'medium';
    return 'low';
  }

  async getUpcomingTasks(progressManager) {
    const currentWeek = progressStatus.currentWeek;
    const tasks = progressManager.tasks.tasks || [];

    return tasks
      .filter(task => task.week >= currentWeek && task.week <= currentWeek + 2)
      .filter(task => task.status === 'pending' || task.status === 'in-progress')
      .sort((a, b) => a.week - b.week)
      .slice(0, 10);
  }

  async getUpcomingMilestones(progressManager) {
    const currentWeek = progressStatus.currentWeek;
    const milestones = progressManager.milestones.milestones || [];

    return milestones
      .filter(milestone => milestone.week >= currentWeek)
      .filter(milestone => milestone.status === 'pending')
      .sort((a, b) => a.week - b.week)
      .slice(0, 3);
  }

  async generateWeeklyReport(architectureManager, progressManager, weekNumber) {
    const weekData = await progressManager.getWeeklyReport(weekNumber);
    const architectureStatus = await architectureManager.getStatus();
    const projectSummary = await progressManager.getProjectSummary();

    const report = {
      reportType: 'weekly',
      week: weekNumber,
      generatedAt: new Date().toISOString(),
      summary: {
        weekStatus: weekData.details,
        overallProgress: Math.round(
          (architectureStatus.completion + projectSummary.currentStatus.completion) / 2
        ),
        phase: projectSummary.currentStatus.currentPhase
      },
      achievements: this.identifyAchievements(weekData),
      challenges: this.identifyWeeklyChallenges(weekData),
      tasks: weekData.tasks,
      risks: weekData.risks,
      nextWeekPlan: await this.generateNextWeekPlan(progressManager, weekNumber),
      recommendations: weekData.recommendations,
      metrics: {
        tasksCompleted: weekData.tasks.filter(t => t.status === 'completed').length,
        tasksInProgress: weekData.tasks.filter(t => t.status === 'in-progress').length,
        tasksPending: weekData.tasks.filter(t => t.status === 'pending').length,
        riskCount: weekData.risks.length
      }
    };

    await this.saveReport(report, `weekly-${weekNumber}`);
    return report;
  }

  identifyAchievements(weekData) {
    const achievements = [];

    if (weekData.details.completion >= 100) {
      achievements.push('週目標完成度達100%');
    }

    const completedTasks = weekData.tasks.filter(t => t.status === 'completed');
    if (completedTasks.length >= 5) {
      achievements.push(`完成 ${completedTasks.length} 項任務`);
    }

    if (weekData.risks.length === 0) {
      achievements.push('本週無風險項目');
    }

    return achievements;
  }

  identifyWeeklyChallenges(weekData) {
    const challenges = [];

    if (weekData.details.completion < 50) {
      challenges.push('週進度明顯落後');
    }

    const pendingTasks = weekData.tasks.filter(t => t.status === 'pending');
    if (pendingTasks.length > 3) {
      challenges.push(`有 ${pendingTasks.length} 項任務尚未開始`);
    }

    const highRisks = weekData.risks.filter(r => r.severity === 'high');
    if (highRisks.length > 0) {
      challenges.push(`存在 ${highRisks.length} 項高風險`);
    }

    return challenges;
  }

  async generateNextWeekPlan(progressManager, currentWeek) {
    const nextWeek = currentWeek + 1;
    const nextWeekData = progressManager.progress.weeks[nextWeek];

    if (!nextWeekData) {
      return { message: '已到達專案結束' };
    }

    return {
      week: nextWeek,
      phase: nextWeekData.phase,
      focus: nextWeekData.focus,
      primaryGoals: nextWeekData.goals.slice(0, 3),
      preparationItems: ['檢查前置任務完成狀況', '確認所需資源可用性', '與團隊成員同步進度']
    };
  }

  async generateMonthlyReport(architectureManager, progressManager, month) {
    const startWeek = (month - 1) * 4 + 1;
    const endWeek = Math.min(month * 4, 12);

    const monthlyData = {
      reportType: 'monthly',
      month,
      period: `Week ${startWeek} - ${endWeek}`,
      generatedAt: new Date().toISOString(),
      summary: await this.generateMonthlySummary(progressManager, startWeek, endWeek),
      achievements: [],
      challenges: [],
      metrics: await this.generateMonthlyMetrics(progressManager, startWeek, endWeek),
      trends: await this.analyzeTrends(progressManager, startWeek, endWeek),
      recommendations: []
    };

    await this.saveReport(monthlyData, `monthly-${month}`);
    return monthlyData;
  }

  async generateMonthlySummary(progressManager, startWeek, endWeek) {
    const weeks = [];
    for (let week = startWeek; week <= endWeek; week++) {
      if (progressManager.progress.weeks[week]) {
        weeks.push(progressManager.progress.weeks[week]);
      }
    }

    const completedWeeks = weeks.filter(w => w.status === 'completed').length;
    const avgCompletion = weeks.reduce((sum, w) => sum + w.completion, 0) / weeks.length;

    return {
      totalWeeks: weeks.length,
      completedWeeks,
      averageCompletion: Math.round(avgCompletion),
      phase: weeks[0]?.phase || 'Unknown',
      status: completedWeeks === weeks.length ? 'completed' : 'in-progress'
    };
  }

  async generateMonthlyMetrics(progressManager, startWeek, endWeek) {
    let totalTasks = 0;
    let completedTasks = 0;
    let totalRisks = 0;

    for (let week = startWeek; week <= endWeek; week++) {
      const weekTasks = progressManager.tasks.tasks.filter(t => t.week === week);
      totalTasks += weekTasks.length;
      completedTasks += weekTasks.filter(t => t.status === 'completed').length;
    }

    return {
      taskCompletionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      totalTasksManaged: totalTasks,
      averageRisksPerWeek: Math.round(totalRisks / (endWeek - startWeek + 1)),
      velocity: Math.round((completedTasks / (endWeek - startWeek + 1)) * 100) / 100
    };
  }

  async analyzeTrends(progressManager, startWeek, endWeek) {
    const weeklyCompletions = [];

    for (let week = startWeek; week <= endWeek; week++) {
      const weekData = progressManager.progress.weeks[week];
      if (weekData) {
        weeklyCompletions.push(weekData.completion);
      }
    }

    const trend = this.calculateTrend(weeklyCompletions);

    return {
      progressTrend: trend,
      isImproving: trend > 0,
      trendDescription: this.describeTrend(trend),
      weeklyCompletions
    };
  }

  calculateTrend(values) {
    if (values.length < 2) return 0;

    const n = values.length;
    const sumX = (n * (n + 1)) / 2;
    const sumY = values.reduce((sum, val) => sum + val, 0);
    const sumXY = values.reduce((sum, val, i) => sum + val * (i + 1), 0);
    const sumX2 = (n * (n + 1) * (2 * n + 1)) / 6;

    return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  }

  describeTrend(trend) {
    if (trend > 5) return '顯著改善';
    if (trend > 2) return '穩定改善';
    if (trend > -2) return '穩定';
    if (trend > -5) return '輕微下降';
    return '需要關注';
  }

  async saveReport(report, filename) {
    const reportPath = path.join(this.reportsPath, `${filename}-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    // 同時保存最新版本（不帶時間戳）
    const latestPath = path.join(this.reportsPath, `${filename}-latest.json`);
    fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));

    return reportPath;
  }

  async getReportHistory(type = 'all') {
    const files = fs.readdirSync(this.reportsPath);
    const reports = [];

    for (const file of files) {
      if (file.endsWith('.json') && !file.includes('latest')) {
        if (type === 'all' || file.includes(type)) {
          const reportData = JSON.parse(fs.readFileSync(path.join(this.reportsPath, file), 'utf8'));
          reports.push({
            filename: file,
            type: reportData.reportType,
            generatedAt: reportData.generatedAt,
            week: reportData.week,
            month: reportData.month
          });
        }
      }
    }

    return reports.sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));
  }

  async cleanupOldReports() {
    const retentionDays = this.config.settings.backupRetention;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const files = fs.readdirSync(this.reportsPath);
    let cleanedCount = 0;

    for (const file of files) {
      if (file.endsWith('.json') && !file.includes('latest')) {
        const filePath = path.join(this.reportsPath, file);
        const stats = fs.statSync(filePath);

        if (stats.mtime < cutoffDate) {
          fs.unlinkSync(filePath);
          cleanedCount++;
        }
      }
    }

    return { cleanedCount, retentionDays };
  }

  async exportData(architectureManager, progressManager) {
    const exportData = {
      exportedAt: new Date().toISOString(),
      config: this.config,
      architecture: await architectureManager.getFullStatus(),
      progress: await progressManager.getFullStatus(),
      reports: await this.getReportHistory()
    };

    const exportPath = path.join(this.dataPath, `export-${Date.now()}.json`);
    fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2));

    return exportPath;
  }

  async importData(importPath) {
    if (!fs.existsSync(importPath)) {
      throw new Error(`導入檔案不存在: ${importPath}`);
    }

    const importData = JSON.parse(fs.readFileSync(importPath, 'utf8'));

    // 備份當前資料
    const backupPath = await this.exportData();
    console.log(`資料已備份至: ${backupPath}`);

    // 導入新資料
    if (importData.config) {
      await this.saveConfig(importData.config);
      this.config = importData.config;
    }

    return {
      backupPath,
      importedAt: new Date().toISOString(),
      dataKeys: Object.keys(importData)
    };
  }
}

module.exports = { ProjectTracker };
