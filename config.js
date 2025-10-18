// 應用程式配置
const config = {
  // PM2 相關設定
  pm2: {
    binary: '/usr/bin/pm2',
    home: '/home/ubuntu/.pm2',
    user: 'ubuntu',
    timeout: 10000,
    maxBuffer: 1024 * 1024 * 5 // 5MB
  },
  
  // 伺服器設定
  server: {
    port: process.env.PORT || 80,
    jwtSecret: process.env.JWT_SECRET || 'your-secret-key-change-this'
  },
  
  // 驗證限制
  validation: {
    maxProcessIdLength: 50,
    maxLines: 1000,
    minLines: 1,
    defaultLines: 100
  },
  
  // 環境變數
  environment: {
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/snap/bin',
    HOME: '/home/ubuntu',
    USER: 'ubuntu',
    PM2_HOME: '/home/ubuntu/.pm2'
  }
};

module.exports = config;