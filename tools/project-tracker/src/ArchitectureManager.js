const fs = require('fs');
const path = require('path');

class ArchitectureManager {
  constructor(configPath) {
    this.configPath = configPath;
    this.architectureFile = path.join(configPath, 'architecture.json');
    this.techStackFile = path.join(configPath, 'tech-stack.json');

    this.defaultArchitecture = {
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      phases: {
        phase1: {
          name: '基礎架構與核心功能',
          duration: '第1個月',
          status: 'pending',
          completion: 0,
          components: {
            projectInit: {
              name: '專案初始化與基礎架構',
              status: 'pending',
              tasks: [
                'Google Cloud Project 建置',
                'Node.js + Express 基礎專案結構',
                'MongoDB Atlas 資料庫設定',
                'Firebase Authentication 配置',
                '基礎 CI/CD 管道（GitHub Actions）'
              ]
            },
            apiFramework: {
              name: 'API 基礎框架與認證系統',
              status: 'pending',
              tasks: [
                'RESTful API 路由結構',
                'Firebase Auth 中間件',
                '錯誤處理機制',
                'API 文檔（Swagger）',
                '基礎單元測試框架'
              ]
            },
            dataModel: {
              name: 'MongoDB 資料模型設計',
              status: 'pending',
              tasks: [
                '核心資料模型（User, Tour, Content, Merchant）',
                'Mongoose Schema 定義',
                '資料庫索引策略',
                '資料遷移腳本',
                '基礎 CRUD 操作'
              ]
            }
          }
        },
        phase2: {
          name: '核心功能開發',
          duration: '第2個月',
          status: 'pending',
          completion: 0,
          components: {
            aiService: {
              name: 'AI 導覽服務整合',
              status: 'pending',
              tasks: [
                'Google Vertex AI Gemini 整合',
                '導覽內容生成邏輯',
                '多語言翻譯服務',
                'Google Cloud Text-to-Speech 整合',
                '內容快取機制（Redis）'
              ]
            },
            merchantSystem: {
              name: '商戶管理系統',
              status: 'pending',
              tasks: [
                '商戶註冊/登入 API',
                '內容上傳管理',
                'Google Cloud Storage 檔案管理',
                '商戶權限控制',
                '基礎商戶後台 API'
              ]
            },
            webApp: {
              name: '前端 Web 應用開發',
              status: 'pending',
              tasks: [
                'React.js 基礎應用',
                '用戶認證介面',
                '導覽播放介面',
                '響應式設計實作',
                '基礎路由系統'
              ]
            }
          }
        },
        phase3: {
          name: '系統完善與部署',
          duration: '第3個月',
          status: 'pending',
          completion: 0,
          components: {
            mobileApp: {
              name: 'React Native 移動應用',
              status: 'pending',
              tasks: [
                'React Native 基礎應用',
                '原生功能整合（GPS、相機）',
                '推播通知（Firebase FCM）',
                '離線功能支援',
                '應用商店準備'
              ]
            },
            monitoring: {
              name: '監控與日誌系統',
              status: 'pending',
              tasks: [
                'Google Cloud Monitoring 設定',
                'Cloud Logging 配置',
                '錯誤追蹤（Google Cloud Error Reporting）',
                '效能監控指標',
                '告警通知設定'
              ]
            },
            payment: {
              name: '支付系統與最終整合',
              status: 'pending',
              tasks: [
                '綠界金流 API 整合',
                '訂單管理系統',
                '交易記錄管理',
                '全系統整合測試',
                '部署腳本與文檔'
              ]
            }
          }
        }
      }
    };

    this.defaultTechStack = {
      frontend: {
        mobile: {
          framework: 'React Native',
          stateManagement: 'Redux Toolkit',
          testing: 'Jest + React Testing Library',
          status: 'planned'
        },
        web: {
          framework: 'React.js',
          uiFramework: 'Material-UI / Ant Design',
          stateManagement: 'Redux Toolkit',
          testing: 'Jest + React Testing Library',
          status: 'planned'
        }
      },
      backend: {
        framework: 'Node.js + Express',
        apiDesign: 'RESTful API + OpenAPI',
        documentation: 'Swagger',
        messageQueue: 'RabbitMQ',
        cache: 'Redis',
        featureFlags: 'LaunchDarkly/PostHog',
        status: 'planned'
      },
      database: {
        primary: {
          type: 'MongoDB',
          purpose: '導覽內容、用戶資料',
          status: 'planned'
        },
        transaction: {
          type: 'MySQL',
          purpose: '訂單、付款紀錄',
          status: 'planned'
        },
        storage: {
          type: 'AWS S3 / GCP Storage',
          purpose: '照片、影片',
          status: 'planned'
        }
      },
      ai: {
        llm: {
          service: 'GPT API',
          purpose: '導覽內容生成',
          status: 'planned'
        },
        tts: {
          service: 'Azure Speech Service / Google Cloud TTS',
          purpose: '語音合成',
          status: 'planned'
        }
      },
      payment: {
        gateway: '綠界金流',
        methods: ['信用卡', 'Apple Pay', 'Line Pay'],
        status: 'planned'
      },
      cloud: {
        authentication: 'Firebase Authentication',
        messaging: 'Firebase Cloud Messaging',
        storage: 'Firebase Storage',
        status: 'planned'
      },
      monitoring: {
        metrics: 'Prometheus',
        alerting: 'Grafana Alert',
        logging: 'ELK Stack',
        status: 'planned'
      }
    };
  }

  async loadArchitecture() {
    if (!fs.existsSync(this.architectureFile)) {
      await this.saveArchitecture(this.defaultArchitecture);
    }

    if (!fs.existsSync(this.techStackFile)) {
      await this.saveTechStack(this.defaultTechStack);
    }

    this.architecture = JSON.parse(fs.readFileSync(this.architectureFile, 'utf8'));
    this.techStack = JSON.parse(fs.readFileSync(this.techStackFile, 'utf8'));
  }

  async saveArchitecture(architecture) {
    fs.writeFileSync(this.architectureFile, JSON.stringify(architecture, null, 2));
  }

  async saveTechStack(techStack) {
    fs.writeFileSync(this.techStackFile, JSON.stringify(techStack, null, 2));
  }

  async getStatus() {
    const totalComponents = Object.values(this.architecture.phases).reduce(
      (total, phase) => total + Object.keys(phase.components).length,
      0
    );

    const completedComponents = Object.values(this.architecture.phases).reduce((total, phase) => {
      return (
        total +
        Object.values(phase.components).filter(component => component.status === 'completed').length
      );
    }, 0);

    return {
      completion: Math.round((completedComponents / totalComponents) * 100),
      totalComponents,
      completedComponents,
      currentPhase: this.getCurrentPhase()
    };
  }

  async getFullStatus() {
    return {
      architecture: this.architecture,
      techStack: this.techStack,
      summary: await this.getStatus()
    };
  }

  getCurrentPhase() {
    for (const [key, phase] of Object.entries(this.architecture.phases)) {
      if (phase.status === 'in-progress' || phase.status === 'pending') {
        return phase.name;
      }
    }
    return '已完成';
  }

  async updateComponentStatus(phaseKey, componentKey, status, completion = null) {
    if (!this.architecture.phases[phaseKey]) {
      throw new Error(`階段 ${phaseKey} 不存在`);
    }

    if (!this.architecture.phases[phaseKey].components[componentKey]) {
      throw new Error(`元件 ${componentKey} 不存在於階段 ${phaseKey}`);
    }

    this.architecture.phases[phaseKey].components[componentKey].status = status;

    if (completion !== null) {
      this.architecture.phases[phaseKey].components[componentKey].completion = completion;
    }

    // 更新階段狀態
    this.updatePhaseStatus(phaseKey);

    this.architecture.lastUpdated = new Date().toISOString();
    await this.saveArchitecture(this.architecture);
  }

  updatePhaseStatus(phaseKey) {
    const phase = this.architecture.phases[phaseKey];
    const components = Object.values(phase.components);

    const completedCount = components.filter(c => c.status === 'completed').length;
    const inProgressCount = components.filter(c => c.status === 'in-progress').length;

    if (completedCount === components.length) {
      phase.status = 'completed';
      phase.completion = 100;
    } else if (inProgressCount > 0 || completedCount > 0) {
      phase.status = 'in-progress';
      phase.completion = Math.round((completedCount / components.length) * 100);
    } else {
      phase.status = 'pending';
      phase.completion = 0;
    }
  }

  async updateTechStackStatus(category, item, status) {
    const categories = category.split('.');
    let current = this.techStack;

    for (let i = 0; i < categories.length - 1; i++) {
      if (!current[categories[i]]) {
        throw new Error(`技術棧類別 ${categories.slice(0, i + 1).join('.')} 不存在`);
      }
      current = current[categories[i]];
    }

    const finalKey = categories[categories.length - 1];
    if (!current[finalKey]) {
      throw new Error(`技術棧項目 ${category} 不存在`);
    }

    current[finalKey].status = status;
    await this.saveTechStack(this.techStack);
  }

  async getArchitectureReport() {
    const status = await this.getStatus();
    const risks = this.identifyRisks();

    return {
      summary: status,
      phases: this.architecture.phases,
      techStack: this.techStack,
      risks,
      recommendations: this.generateRecommendations(risks)
    };
  }

  identifyRisks() {
    const risks = [];

    // 檢查是否有過期的任務
    Object.entries(this.architecture.phases).forEach(([phaseKey, phase]) => {
      Object.entries(phase.components).forEach(([componentKey, component]) => {
        if (component.status === 'pending' && phaseKey === 'phase1') {
          risks.push({
            type: 'schedule',
            severity: 'high',
            message: `基礎架構元件 ${component.name} 尚未開始，可能影響後續開發`,
            component: componentKey,
            phase: phaseKey
          });
        }
      });
    });

    // 檢查技術棧實作狀態
    Object.entries(this.techStack).forEach(([category, items]) => {
      if (typeof items === 'object' && items.status === 'planned') {
        risks.push({
          type: 'technical',
          severity: 'medium',
          message: `技術棧 ${category} 尚未實作`,
          category
        });
      }
    });

    return risks;
  }

  generateRecommendations(risks) {
    const recommendations = [];

    const highRisks = risks.filter(r => r.severity === 'high');
    if (highRisks.length > 0) {
      recommendations.push('立即處理高風險項目，確保專案進度不受影響');
    }

    const scheduleRisks = risks.filter(r => r.type === 'schedule');
    if (scheduleRisks.length > 0) {
      recommendations.push('重新評估時程安排，考慮調整任務優先級');
    }

    const technicalRisks = risks.filter(r => r.type === 'technical');
    if (technicalRisks.length > 2) {
      recommendations.push('建議進行技術選型review，確認實作細節');
    }

    return recommendations;
  }
}

module.exports = { ArchitectureManager };
