import admin from 'firebase-admin';
import { ServiceAccount } from 'firebase-admin';

// 檢查是否已經初始化
if (admin.apps.length === 0) {
  let credential: admin.credential.Credential;

  if (process.env.NODE_ENV === 'production') {
    // 生產環境使用環境變數
    const serviceAccount = {
      projectId: process.env.FIREBASE_PROJECT_ID!,
      privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL!
    };
    
    credential = admin.credential.cert(serviceAccount);
  } else {
    // 開發環境使用服務帳戶 JSON 文件
    try {
      const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || './config/service-account.json';
      credential = admin.credential.cert(serviceAccountPath);
    } catch (error) {
      console.warn('無法載入 Firebase 服務帳戶文件，使用環境變數');
      const serviceAccount = {
        projectId: process.env.FIREBASE_PROJECT_ID!,
        privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL!
      };
      
      credential = admin.credential.cert(serviceAccount);
    }
  }

  admin.initializeApp({
    credential,
    databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}.firebaseio.com`
  });
}

export const auth = admin.auth();
export const firestore = admin.firestore();
export default admin; 