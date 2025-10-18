# PM2 監控伺服器 - 常駐執行指南

## 啟動常駐服務

```bash
# 使用 PM2 啟動監控伺服器（常駐模式）
pm2 start ecosystem.config.js

# 或者直接啟動單個檔案
pm2 start server.js --name "pm2-monitor"
```

## 管理服務

```bash
# 查看所有 PM2 進程狀態
pm2 list

# 查看監控伺服器狀態
pm2 show pm2-monitor

# 重新啟動
pm2 restart pm2-monitor

# 停止服務
pm2 stop pm2-monitor

# 完全刪除服務
pm2 delete pm2-monitor

# 查看即時日誌
pm2 logs pm2-monitor

# 查看最近 100 行日誌
pm2 logs pm2-monitor --lines 100
```

## 開機自動啟動（可選）

```bash
# 儲存當前 PM2 設定
pm2 save

# 產生開機啟動腳本（Windows）
pm2 startup

# 重新載入儲存的設定
pm2 resurrect
```

## 監控和維護

```bash
# 即時監控面板
pm2 monit

# 重載設定檔案
pm2 reload ecosystem.config.js

# 清空日誌
pm2 flush

# 更新 PM2
npm install pm2@latest -g
```

## 訪問監控面板

- 網址：http://localhost:80 （或 http://你的伺服器IP）
- 預設帳號：borisvpsserver
- 預設密碼：d9D153v9wzp1d9D153v9wzp

## 故障排除

```bash
# 檢查 PM2 進程
pm2 list

# 檢查日誌錯誤
pm2 logs pm2-monitor --err

# 重新啟動所有服務
pm2 restart all

# 檢查端口是否被佔用
netstat -ano | findstr :80
```