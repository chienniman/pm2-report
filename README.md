# PM2 監控面板

一個精美的前端界面，用於查詢和監控本機的 PM2 日誌，提供 HTTP 服務和簡單的身份驗證。

## 功能特色

- 🎨 **精美的現代化界面** - 響應式設計，支援各種設備
- 📊 **實時進程監控** - 顯示 PM2 進程狀態、CPU、內存使用率
- 📋 **日誌查看** - 實時查看和搜索 PM2 日誌
- 🔍 **智能搜索** - 支援關鍵詞高亮和過濾
- 🔐 **簡單認證** - JWT 令牌認證保護
- ⚡ **自動刷新** - 可設置自動刷新監控數據
- 🧹 **日誌管理** - 支援清空日誌功能

## 系統要求

- Node.js >= 14.0.0
- PM2 (已安装並運行)
- Windows/Linux/macOS

## 快速開始

### 1. 安裝依賴

```bash
npm install
```

### 2. 啟動服務

```bash
npm start
```

或者使用 nodemon 進行開發：

```bash
npm run dev
```

### 3. 訪問界面

打開瀏覽器，訪問：`http://localhost` (端口 80) 或 `http://localhost:443` (如使用 HTTPS)

### 4. 登入

- **使用者名稱**: `admin`
- **密碼**: `admin123`

## 配置說明

### 環境變量配置

創建 `.env` 檔案來自定義配置：

```bash
# 服務端口 (默認: 80，HTTPS 使用 443)
PORT=80

# JWT 密鑰 (請在生產環境中修改)
JWT_SECRET=your-secret-key-change-this-in-production

# 管理員帳號設定
ADMIN_USERNAME=admin

# 方式一：使用預先雜湊的密碼 (推薦)
ADMIN_PASSWORD_HASH=$2a$10$LGkAvbd8tLdHiVt.7Ej6hO13ByvfzwHj2Pn3T5e1UIiqutpSmzEPq

# 方式二：使用明文密碼 (伺服器會自動雜湊)
# ADMIN_PASSWORD=your_secure_password
```

### 修改登入密碼

**方式一：使用預先雜湊的密碼 (推薦)**

1. 運行密碼生成工具：
```bash
node generate-hash.js
```

2. 將生成的雜湊值設定到 `.env` 檔案中的 `ADMIN_PASSWORD_HASH`

**方式二：使用明文密碼**

直接在 `.env` 檔案中設定 `ADMIN_PASSWORD=您的密碼`，伺服器會自動進行雜湊處理。

### 用戶管理

當前版本使用內存存儲用戶信息。在生產環境中，建議：

1. 使用數據庫存儲用戶信息
2. 實現用戶註冊功能
3. 添加角色權限管理

## API 接口

### 認證接口

- `POST /api/login` - 用戶登入

### PM2 監控接口

- `GET /api/processes` - 獲取進程列表
- `GET /api/logs` - 獲取所有日誌
- `GET /api/logs/:processId` - 獲取特定進程日誌
- `POST /api/logs/flush` - 清空日誌
- `GET /api/status` - 獲取 PM2 狀態

所有監控接口都需要 JWT 令牌認證。

## 界面功能

### 統計卡片
- 顯示運行中、已停止、錯誤和總進程數量

### 進程列表
- 顯示進程 ID、名稱、狀態、CPU、內存使用率等
- 彩色狀態指示器

### 日誌查看器
- 語法高亮 (錯誤、警告、信息)
- 關鍵詞搜索和高亮
- 自動滾動到最新日誌
- 支援不同行數顯示 (50/100/200/500)

### 控制功能
- 進程選擇器 (查看特定進程或所有進程)
- 自動刷新開關 (5秒間隔)
- 日誌清空功能
- 手動刷新按鈕

## 開發說明

### 項目結構

```
pm2-report/
├── server.js              # Express 服務器
├── package.json           # 依賴配置
├── generate-hash.js       # 密碼哈希生成工具
├── README.md             # 說明文檔
└── public/               # 前端文件
    ├── index.html        # 主頁面
    ├── style.css         # 樣式文件
    └── script.js         # JavaScript 功能
```

### 技術棧

**後端**:
- Express.js - Web 框架
- JWT - 身份認證
- bcryptjs - 密碼加密
- PM2 - 進程管理 (通過 CLI 調用)

**前端**:
- 原生 HTML/CSS/JavaScript
- Font Awesome - 圖標
- 響應式設計

### 安全注意事項

1. 修改默認 JWT 密鑰
2. 使用 HTTPS (生產環境)
3. 設置強密碼
4. 定期更新依賴包
5. 限制網絡訪問 (僅內網使用)

## 常見問題

**Q: PM2 進程為空？**
A: 確保 PM2 已正確安裝並有運行的進程。運行 `pm2 list` 檢查。

**Q: 認證失效？**
A: JWT 令牌有 24 小時有效期，過期後需要重新登入。

**Q: 日誌不更新？**
A: 檢查 PM2 進程是否正在產生日誌，或嘗試手動刷新。

**Q: 無法訪問服務？**
A: 檢查防火牆設置和端口是否被佔用。

## 許可證

MIT License

## 貢獻

歡迎提交 Issue 和 Pull Request 來改善這個項目！