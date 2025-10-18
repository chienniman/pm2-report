module.exports = {
  apps: [
    {
      name: 'pm2-monitor',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 80
      },
      error_file: './logs/pm2-monitor-error.log',
      out_file: './logs/pm2-monitor-out.log',
      log_file: './logs/pm2-monitor-combined.log',
      time: true,
      merge_logs: true
    }
  ]
};