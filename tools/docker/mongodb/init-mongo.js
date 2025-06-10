// MongoDB 初始化腳本
db = db.getSiblingDB('localite');

// 建立用戶
db.createUser({
  user: 'localite',
  pwd: 'localite123',
  roles: [
    {
      role: 'readWrite',
      db: 'localite'
    }
  ]
});

// 建立基礎集合
db.createCollection('users');
db.createCollection('tours');
db.createCollection('merchants');
db.createCollection('contents');

console.log('MongoDB 初始化完成');