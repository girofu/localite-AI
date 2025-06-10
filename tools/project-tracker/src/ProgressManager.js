const fs = require('fs');
const path = require('path');

class ProgressManager {
  constructor(dataPath) {
    this.dataPath = dataPath;
    this.progressFile = path.join(dataPath, 'progress.json');
    this.tasksFile = path.join(dataPath, 'tasks.json');
    this.milestonesFile = path.join(dataPath, 'milestones.json');

    this.defaultProgress = {
      version: '1.0.0',
      startDate: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      currentWeek: 1,
      totalWeeks: 12,
      weeks: this.generateWeeklyPlan()
    };

    this.defaultTasks = {
      tasks: [],
      nextId: 1
    };

    this.defaultMilestones = {
      milestones: [
        {
          id: 1,
          name: '基礎架構完成',
          week: 4,
          description: '可以進行 API 測試',
          status: 'pending',
          criteria: [
            'Node.js + Express 框架運行',
            'MongoDB 資料庫連接',
            'Firebase 認證設置',
            '基礎 API 端點測試通過'
          ]
        },
        {
          id: 2,
          name: '核心功能完成',
          week: 8,
          description: '可以進行端到端測試',
          status: 'pending',
          criteria: ['AI 導覽服務運行', '商戶管理系統運行', 'Web 應用基本功能', '端到端測試通過']
        },
        {
          id: 3,
          name: '完整系統上線準備',
          week: 12,
          description: '準備生產環境部署',
          status: 'pending',
          criteria: ['移動應用完成', '支付系統整合', '監控系統設置', '部署文檔完成']
        }
      ]
    };
  }

  generateWeeklyPlan() {
    return {
      // 第一月：基礎架構與核心功能
      1: {
        phase: '基礎架構與核心功能',
        focus: '系統設計與架構確認',
        goals: ['確認需求規格書', '建立專案管理流程', '系統架構設計確認', '開發環境建置'],
        deliverables: ['架構設計文檔', 'API 規範文檔', '開發環境'],
        status: 'pending',
        completion: 0,
        notes: ''
      },
      2: {
        phase: '基礎架構與核心功能',
        focus: 'UI/UX設計',
        goals: ['用戶流程圖設計', '線框圖製作', '資料庫結構設計', '後端基礎建置'],
        deliverables: ['UI 設計稿', '資料庫 Schema', '後端框架'],
        status: 'pending',
        completion: 0,
        notes: ''
      },
      3: {
        phase: '基礎架構與核心功能',
        focus: '核心架構開發',
        goals: [
          'Node.js 後端框架搭建',
          'MongoDB 資料模型建立',
          'Firebase 認證整合',
          'Redis 快取環境設置'
        ],
        deliverables: ['後端 API 框架', '資料模型', '認證系統'],
        status: 'pending',
        completion: 0,
        notes: ''
      },
      4: {
        phase: '基礎架構與核心功能',
        focus: '前端初始化與API整合',
        goals: ['React Native 專案建置', 'React Web 專案建置', '基礎路由系統', 'CI/CD 管道設置'],
        deliverables: ['前端應用', 'API 客戶端', 'CI/CD 管道'],
        status: 'pending',
        completion: 0,
        notes: ''
      },
      // 第二月：核心功能開發
      5: {
        phase: '核心功能開發',
        focus: '用戶系統與認證',
        goals: ['用戶註冊/登入功能', '角色權限系統', 'Session 管理', '單元測試實現'],
        deliverables: ['用戶認證系統', '權限管理', '測試框架'],
        status: 'pending',
        completion: 0,
        notes: ''
      },
      6: {
        phase: '核心功能開發',
        focus: '廠商系統基礎',
        goals: ['廠商註冊/認證', '內容上傳介面', '文件存儲系統', '內容管理 API'],
        deliverables: ['廠商管理系統', '文件上傳功能', '內容管理'],
        status: 'pending',
        completion: 0,
        notes: ''
      },
      7: {
        phase: '核心功能開發',
        focus: 'AI 導覽核心功能',
        goals: ['GPT API 整合', '導覽內容生成邏輯', '語音合成整合', '多語言切換功能'],
        deliverables: ['AI 導覽服務', '語音合成', '多語言支援'],
        status: 'pending',
        completion: 0,
        notes: ''
      },
      8: {
        phase: '核心功能開發',
        focus: '導覽功能完善',
        goals: ['導覽流程實現', '內容快取機制', '離線功能', '效能優化'],
        deliverables: ['完整導覽功能', '快取系統', '效能報告'],
        status: 'pending',
        completion: 0,
        notes: ''
      },
      // 第三月：系統完善與部署
      9: {
        phase: '系統完善與部署',
        focus: '系統整合',
        goals: ['前後端功能整合', 'API 測試與調優', '錯誤處理機制', '監控告警系統'],
        deliverables: ['整合系統', '監控系統', 'API 文檔'],
        status: 'pending',
        completion: 0,
        notes: ''
      },
      10: {
        phase: '系統完善與部署',
        focus: '內部測試',
        goals: ['功能測試', '壓力測試', '安全性檢查', 'UI/UX 體驗測試'],
        deliverables: ['測試報告', '性能報告', '安全報告'],
        status: 'pending',
        completion: 0,
        notes: ''
      },
      11: {
        phase: '系統完善與部署',
        focus: '修復與優化',
        goals: ['修復測試問題', '性能優化', '程式碼重構', '文檔完善'],
        deliverables: ['修復報告', '優化報告', '完整文檔'],
        status: 'pending',
        completion: 0,
        notes: ''
      },
      12: {
        phase: '系統完善與部署',
        focus: '上線準備',
        goals: ['生產環境準備', 'CI/CD 流程建立', '監控系統設置', '上線計劃制定'],
        deliverables: ['生產環境', '部署文檔', '上線計劃'],
        status: 'pending',
        completion: 0,
        notes: ''
      }
    };
  }

  async loadProgress() {
    if (!fs.existsSync(this.progressFile)) {
      await this.saveProgress(this.defaultProgress);
    }

    if (!fs.existsSync(this.tasksFile)) {
      await this.saveTasks(this.defaultTasks);
    }

    if (!fs.existsSync(this.milestonesFile)) {
      await this.saveMilestones(this.defaultMilestones);
    }

    this.progress = JSON.parse(fs.readFileSync(this.progressFile, 'utf8'));
    this.tasks = JSON.parse(fs.readFileSync(this.tasksFile, 'utf8'));
    this.milestones = JSON.parse(fs.readFileSync(this.milestonesFile, 'utf8'));
  }

  async saveProgress(progress) {
    fs.writeFileSync(this.progressFile, JSON.stringify(progress, null, 2));
  }

  async saveTasks(tasks) {
    fs.writeFileSync(this.tasksFile, JSON.stringify(tasks, null, 2));
  }

  async saveMilestones(milestones) {
    fs.writeFileSync(this.milestonesFile, JSON.stringify(milestones, null, 2));
  }

  async getStatus() {
    const completedWeeks = Object.values(this.progress.weeks).filter(
      week => week.status === 'completed'
    ).length;

    const totalWeeks = Object.keys(this.progress.weeks).length;
    const completion = Math.round((completedWeeks / totalWeeks) * 100);

    const pendingTasks = this.tasks.tasks.filter(task => task.status === 'pending').length;
    const risks = this.identifyRisks().length;

    return {
      completion,
      currentWeek: this.progress.currentWeek,
      currentPhase: this.getCurrentPhase(),
      pendingTasks,
      risks,
      totalWeeks,
      completedWeeks
    };
  }

  async getFullStatus() {
    return {
      progress: this.progress,
      tasks: this.tasks,
      milestones: this.milestones,
      summary: await this.getStatus()
    };
  }

  getCurrentPhase() {
    const currentWeek = this.progress.currentWeek;
    if (currentWeek <= 4) return '基礎架構與核心功能';
    if (currentWeek <= 8) return '核心功能開發';
    if (currentWeek <= 12) return '系統完善與部署';
    return '已完成';
  }

  async updateWeek(weekNumber, updates) {
    if (!this.progress.weeks[weekNumber]) {
      throw new Error(`週 ${weekNumber} 不存在`);
    }

    const week = this.progress.weeks[weekNumber];

    // 更新週狀態
    if (updates.status) week.status = updates.status;
    if (updates.completion !== undefined) week.completion = updates.completion;
    if (updates.notes) week.notes = updates.notes;

    // 更新當前週
    if (weekNumber > this.progress.currentWeek && week.status === 'in-progress') {
      this.progress.currentWeek = weekNumber;
    }

    this.progress.lastUpdated = new Date().toISOString();
    await this.saveProgress(this.progress);

    // 檢查里程碑
    await this.checkMilestones();
  }

  async addTask(task) {
    const newTask = {
      id: this.tasks.nextId++,
      title: task.title,
      description: task.description || '',
      priority: task.priority || 'medium',
      assignee: task.assignee || '',
      week: task.week || this.progress.currentWeek,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags: task.tags || []
    };

    this.tasks.tasks.push(newTask);
    await this.saveTasks(this.tasks);
    return newTask;
  }

  async updateTask(taskId, updates) {
    const task = this.tasks.tasks.find(t => t.id === taskId);
    if (!task) {
      throw new Error(`任務 ${taskId} 不存在`);
    }

    Object.assign(task, updates);
    task.updatedAt = new Date().toISOString();

    await this.saveTasks(this.tasks);
    return task;
  }

  async checkMilestones() {
    for (const milestone of this.milestones.milestones) {
      if (milestone.status === 'pending' && milestone.week <= this.progress.currentWeek) {
        // 檢查里程碑條件
        const shouldComplete = this.shouldCompleteMilestone(milestone);
        if (shouldComplete) {
          milestone.status = 'completed';
          milestone.completedAt = new Date().toISOString();
        } else if (milestone.week < this.progress.currentWeek) {
          milestone.status = 'at-risk';
        }
      }
    }

    await this.saveMilestones(this.milestones);
  }

  shouldCompleteMilestone(milestone) {
    // 這裡可以加入更複雜的邏輯來檢查里程碑完成條件
    // 目前簡單檢查相關週的完成狀態
    const relevantWeeks = Object.values(this.progress.weeks).filter(
      week =>
        week.phase === milestone.name ||
        (milestone.week >= 1 && milestone.week <= 4 && week.phase === '基礎架構與核心功能') ||
        (milestone.week >= 5 && milestone.week <= 8 && week.phase === '核心功能開發') ||
        (milestone.week >= 9 && milestone.week <= 12 && week.phase === '系統完善與部署')
    );

    const completedWeeks = relevantWeeks.filter(week => week.status === 'completed').length;
    return completedWeeks / relevantWeeks.length >= 0.8; // 80% 完成率
  }

  identifyRisks() {
    const risks = [];
    const currentWeek = this.progress.currentWeek;

    // 檢查週進度風險
    Object.entries(this.progress.weeks).forEach(([weekNum, week]) => {
      const weekNumber = parseInt(weekNum);
      if (weekNumber < currentWeek && week.status === 'pending') {
        risks.push({
          type: 'schedule',
          severity: 'high',
          message: `第${weekNumber}週尚未完成，可能影響後續進度`,
          week: weekNumber,
          phase: week.phase
        });
      }

      if (weekNumber === currentWeek && week.completion < 50) {
        risks.push({
          type: 'schedule',
          severity: 'medium',
          message: `當前週（第${weekNumber}週）進度落後`,
          week: weekNumber,
          phase: week.phase
        });
      }
    });

    // 檢查任務風險
    const overdueTasks = this.tasks.tasks.filter(task => {
      const taskWeek = task.week || 1;
      return taskWeek < currentWeek && task.status === 'pending';
    });

    if (overdueTasks.length > 0) {
      risks.push({
        type: 'task',
        severity: 'medium',
        message: `有 ${overdueTasks.length} 個任務逾期未完成`,
        count: overdueTasks.length
      });
    }

    // 檢查里程碑風險
    const atRiskMilestones = this.milestones.milestones.filter(m => m.status === 'at-risk');
    if (atRiskMilestones.length > 0) {
      risks.push({
        type: 'milestone',
        severity: 'high',
        message: `有 ${atRiskMilestones.length} 個里程碑存在風險`,
        milestones: atRiskMilestones.map(m => m.name)
      });
    }

    return risks;
  }

  async getRisks() {
    return this.identifyRisks();
  }

  async getWeeklyReport(weekNumber) {
    const week = this.progress.weeks[weekNumber];
    if (!week) {
      throw new Error(`週 ${weekNumber} 不存在`);
    }

    const weekTasks = this.tasks.tasks.filter(task => task.week === weekNumber);
    const risks = this.identifyRisks().filter(risk => risk.week === weekNumber);

    return {
      week: weekNumber,
      details: week,
      tasks: weekTasks,
      risks,
      recommendations: this.generateWeeklyRecommendations(week, weekTasks, risks)
    };
  }

  generateWeeklyRecommendations(week, tasks, risks) {
    const recommendations = [];

    if (week.completion < 30) {
      recommendations.push('本週進度嚴重落後，建議重新評估任務優先級');
    }

    if (tasks.filter(t => t.status === 'pending').length > 5) {
      recommendations.push('待完成任務較多，建議分配更多資源或延後非關鍵任務');
    }

    if (risks.length > 0) {
      recommendations.push('存在風險項目，建議立即處理避免影響後續進度');
    }

    if (week.status === 'completed' && week.completion === 100) {
      recommendations.push('本週目標已達成，可以考慮提前開始下週任務');
    }

    return recommendations;
  }

  async getProjectSummary() {
    const status = await this.getStatus();
    const risks = this.identifyRisks();
    const nextMilestone = this.milestones.milestones.find(
      m => m.status === 'pending' && m.week >= this.progress.currentWeek
    );

    return {
      currentStatus: status,
      nextMilestone,
      risks,
      recommendations: this.generateProjectRecommendations(status, risks)
    };
  }

  generateProjectRecommendations(status, risks) {
    const recommendations = [];

    if (status.completion < 25 && status.currentWeek > 3) {
      recommendations.push('專案進度明顯落後，建議重新評估時程或增加資源');
    }

    if (risks.filter(r => r.severity === 'high').length > 2) {
      recommendations.push('高風險項目過多，建議召開緊急會議討論對策');
    }

    if (status.pendingTasks > 15) {
      recommendations.push('待辦任務累積過多，建議重新整理任務清單');
    }

    const currentPhaseWeeks = this.getCurrentPhaseWeeks();
    const completedInPhase = currentPhaseWeeks.filter(w => w.status === 'completed').length;
    if (completedInPhase / currentPhaseWeeks.length > 0.8) {
      recommendations.push('當前階段接近完成，可以開始準備下一階段工作');
    }

    return recommendations;
  }

  getCurrentPhaseWeeks() {
    const currentPhase = this.getCurrentPhase();
    return Object.values(this.progress.weeks).filter(week => week.phase === currentPhase);
  }
}

module.exports = { ProgressManager };
