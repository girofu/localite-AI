import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { join } from 'path';

export const initializeFirebase = (): void => {
  try {
    // 檢查是否已初始化
    if (admin.apps.length > 0) {
      console.log('✅ Firebase Admin 已經初始化');
      return;
    }

    const projectId = process.env.FIREBASE_PROJECT_ID;
    const privateKeyPath = process.env.FIREBASE_PRIVATE_KEY_PATH || 
                           join(process.cwd(), 'config', 'service-account.json');

    if (!projectId) {
      console.warn('⚠️ 缺少 FIREBASE_PROJECT_ID 環境變數，使用開發模式');
      // 在開發模式下使用假的配置，讓系統可以啟動
      admin.initializeApp({
        projectId: 'localite-dev-fake'
      });
      console.log('✅ Firebase Admin 初始化成功 (開發模式)');
      return;
    }

    let serviceAccount: any;

    // 嘗試從文件讀取服務帳戶金鑰
    try {
      const serviceAccountFile = readFileSync(privateKeyPath, 'utf8');
      serviceAccount = JSON.parse(serviceAccountFile);
    } catch (fileError) {
      // 如果文件不存在，嘗試從環境變數讀取
      const privateKey = process.env.FIREBASE_PRIVATE_KEY;
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

      if (!privateKey || !clientEmail) {
        throw new Error('無法找到 Firebase 服務帳戶金鑰文件或環境變數');
      }

      serviceAccount = {
        type: 'service_account',
        project_id: projectId,
        private_key: privateKey.replace(/\\n/g, '\n'),
        client_email: clientEmail,
      };
    }

    // 初始化 Firebase Admin
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: projectId,
      storageBucket: `${projectId}.appspot.com`
    });

    console.log('✅ Firebase Admin 初始化成功');

  } catch (error) {
    console.error('❌ Firebase Admin 初始化失敗:', error);
    process.exit(1);
  }
};

// 導出常用的 Firebase 服務 - 使用 getter 函數避免在初始化前調用
export const getAuth = () => admin.auth();
export const getFirestore = () => admin.firestore();
export const getStorage = () => admin.storage();

// 工具函數
export const verifyIdToken = async (idToken: string) => {
  try {
    const decodedToken = await getAuth().verifyIdToken(idToken);
    return { success: true, user: decodedToken };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
};

export const createCustomToken = async (uid: string, additionalClaims?: object) => {
  try {
    const customToken = await getAuth().createCustomToken(uid, additionalClaims);
    return { success: true, token: customToken };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
};

export const getUserByEmail = async (email: string) => {
  try {
    const userRecord = await getAuth().getUserByEmail(email);
    return { success: true, user: userRecord };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
};

export const setCustomUserClaims = async (uid: string, customClaims: object) => {
  try {
    await getAuth().setCustomUserClaims(uid, customClaims);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}; 