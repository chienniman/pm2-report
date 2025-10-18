class PM2Dashboard {
    constructor() {
        this.token = localStorage.getItem('pm2_token');
        this.currentUser = localStorage.getItem('pm2_user');
        this.autoRefreshInterval = null;
        this.isAutoRefreshing = false;
        
        this.init();
    }

    init() {
        this.bindEvents();
        this.checkAuth();
    }

    bindEvents() {
        // Login form
        document.getElementById('loginForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.login();
        });

        // Dashboard controls
        document.getElementById('logoutBtn').addEventListener('click', () => this.logout());
        document.getElementById('refreshBtn').addEventListener('click', () => this.refresh());
        document.getElementById('processSelect').addEventListener('change', () => this.loadLogs());
        document.getElementById('linesSelect').addEventListener('change', () => this.loadLogs());
        document.getElementById('searchBtn').addEventListener('click', () => this.searchLogs());
        document.getElementById('searchInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.searchLogs();
        });
        document.getElementById('archiveLogsBtn').addEventListener('click', () => this.archiveLogs());
        document.getElementById('flushLogsBtn').addEventListener('click', () => this.flushLogs());
        document.getElementById('autoRefreshToggle').addEventListener('click', () => this.toggleAutoRefresh());
    }

    checkAuth() {
        if (this.token && this.currentUser) {
            this.showDashboard();
            this.loadDashboard();
        } else {
            this.showLogin();
        }
    }

    showLogin() {
        document.getElementById('loginModal').classList.remove('hidden');
        document.getElementById('dashboard').classList.add('hidden');
    }

    showDashboard() {
        document.getElementById('loginModal').classList.add('hidden');
        document.getElementById('dashboard').classList.remove('hidden');
        document.getElementById('currentUser').textContent = this.currentUser;
    }

    async login() {
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const errorDiv = document.getElementById('loginError');

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password }),
            });

            const data = await response.json();

            if (response.ok) {
                this.token = data.token;
                this.currentUser = data.username;
                localStorage.setItem('pm2_token', this.token);
                localStorage.setItem('pm2_user', this.currentUser);
                
                this.showDashboard();
                this.loadDashboard();
                this.showToast('登入成功', 'success');
            } else {
                errorDiv.textContent = data.error || '登入失敗';
                errorDiv.classList.add('show');
            }
        } catch (error) {
            errorDiv.textContent = '連接服務器失敗';
            errorDiv.classList.add('show');
            console.error('Login error:', error);
        }
    }

    logout() {
        this.token = null;
        this.currentUser = null;
        localStorage.removeItem('pm2_token');
        localStorage.removeItem('pm2_user');
        
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
            this.autoRefreshInterval = null;
            this.isAutoRefreshing = false;
        }
        
        this.showLogin();
        this.showToast('已登出', 'info');
    }

    async apiRequest(url, options = {}) {
        const defaultOptions = {
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Content-Type': 'application/json',
            },
        };

        const response = await fetch(url, { ...defaultOptions, ...options });
        
        if (response.status === 401) {
            this.logout();
            throw new Error('認證失效');
        }

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || '請求失敗');
        }

        return data;
    }

    async loadDashboard() {
        try {
            await Promise.all([
                this.loadProcesses(),
                this.loadLogs()
            ]);
        } catch (error) {
            this.showToast(`載入失敗: ${error.message}`, 'error');
        }
    }

    async loadProcesses() {
        try {
            const processes = await this.apiRequest('/api/processes');
            this.updateProcessStats(processes);
            this.updateProcessTable(processes);
            this.updateProcessSelect(processes);
        } catch (error) {
            console.error('Failed to load processes:', error);
            this.showToast(`載入進程失敗: ${error.message}`, 'error');
        }
    }

    updateProcessStats(processes) {
        const stats = {
            running: 0,
            stopped: 0,
            errored: 0,
            total: processes.length
        };

        processes.forEach(process => {
            const status = process.pm2_env.status;
            if (status === 'online') {
                stats.running++;
            } else if (status === 'stopped') {
                stats.stopped++;
            } else if (status === 'errored') {
                stats.errored++;
            }
        });

        document.getElementById('runningCount').textContent = stats.running;
        document.getElementById('stoppedCount').textContent = stats.stopped;
        document.getElementById('erroredCount').textContent = stats.errored;
        document.getElementById('totalCount').textContent = stats.total;
    }

    updateProcessTable(processes) {
        const container = document.getElementById('processTable');
        
        if (processes.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: #666; padding: 2rem;">沒有找到 PM2 進程</p>';
            return;
        }

        const table = document.createElement('table');
        table.className = 'process-table';
        
        table.innerHTML = `
            <thead>
                <tr>
                    <th>ID</th>
                    <th>名稱</th>
                    <th>狀態</th>
                    <th>CPU</th>
                    <th>內存</th>
                    <th>重啟次數</th>
                    <th>運行時間</th>
                </tr>
            </thead>
            <tbody>
                ${processes.map(process => `
                    <tr>
                        <td>${process.pm_id}</td>
                        <td><strong>${process.name}</strong></td>
                        <td><span class="status-badge ${process.pm2_env.status}">${this.getStatusText(process.pm2_env.status)}</span></td>
                        <td>${process.monit ? process.monit.cpu + '%' : 'N/A'}</td>
                        <td>${process.monit ? this.formatMemory(process.monit.memory) : 'N/A'}</td>
                        <td>${process.pm2_env.restart_time}</td>
                        <td>${this.formatUptime(process.pm2_env.pm_uptime)}</td>
                    </tr>
                `).join('')}
            </tbody>
        `;
        
        container.innerHTML = '';
        container.appendChild(table);
    }

    updateProcessSelect(processes) {
        const select = document.getElementById('processSelect');
        const currentValue = select.value;
        
        select.innerHTML = '<option value="">所有進程</option>';
        
        processes.forEach(process => {
            const option = document.createElement('option');
            option.value = process.pm_id;
            option.textContent = `${process.name} (${process.pm_id})`;
            select.appendChild(option);
        });
        
        if (currentValue) {
            select.value = currentValue;
        }
    }

    async loadLogs() {
        const processId = document.getElementById('processSelect').value;
        const lines = document.getElementById('linesSelect').value;
        const container = document.getElementById('logsContainer');
        
        try {
            container.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i>載入日誌中...</div>';
            
            const url = processId ? 
                `/api/logs/${processId}?lines=${lines}` : 
                `/api/logs?lines=${lines}`;
                
            const data = await this.apiRequest(url);
            
            // 顯示調試信息（如果有的話）
            if (data.method) {
                console.log(`Logs loaded using method: ${data.method}`);
            }
            
            this.displayLogs(data.logs);
            this.updateLastUpdate();
            
            // 如果沒有日誌內容，顯示調試按鈕
            if (!data.logs || data.logs.trim() === '' || data.logs === 'No logs available') {
                this.showDebugOptions(container);
            }
        } catch (error) {
            console.error('Load logs error:', error);
            container.innerHTML = `
                <div style="color: #f44336; text-align: center; padding: 2rem;">
                    載入日誌失敗: ${error.message}
                    <br><br>
                    <button onclick="window.pm2Dashboard.testPM2Connection()" style="background: #2196f3; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer;">
                        測試 PM2 連接
                    </button>
                </div>
            `;
        }
    }

    showDebugOptions(container) {
        const debugHtml = `
            <div style="color: #999; text-align: center; padding: 2rem;">
                沒有找到日誌內容
                <br><br>
                <button onclick="window.pm2Dashboard.testPM2Connection()" style="background: #ff9800; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; margin-right: 0.5rem;">
                    測試 PM2 連接
                </button>
                <button onclick="window.pm2Dashboard.loadLogs()" style="background: #4caf50; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer;">
                    重新載入
                </button>
            </div>
        `;
        container.innerHTML += debugHtml;
    }

    async testPM2Connection() {
        try {
            const result = await this.apiRequest('/api/pm2/test');
            console.log('PM2 Test Results:', result);
            
            let message = 'PM2 連接測試結果：\n\n';
            for (const [cmd, res] of Object.entries(result.pm2_test)) {
                message += `${cmd}: ${res.success ? '✓' : '✗'}\n`;
                if (res.stdout) message += `  輸出: ${res.stdout.substring(0, 100)}...\n`;
                if (res.error) message += `  錯誤: ${res.error}\n`;
                message += '\n';
            }
            
            alert(message);
            
        } catch (error) {
            alert(`PM2 測試失敗: ${error.message}`);
        }
    }

    displayLogs(logs) {
        const container = document.getElementById('logsContainer');
        const searchTerm = document.getElementById('searchInput').value.toLowerCase();
        
        if (!logs || logs.trim() === '') {
            container.innerHTML = '<div style="text-align: center; color: #999; padding: 2rem;">沒有日誌數據</div>';
            return;
        }

        const lines = logs.split('\n').filter(line => line.trim());
        const processedLines = lines.map(line => {
            let className = 'log-line';
            
            // Add error/warning/info classes
            const lowerLine = line.toLowerCase();
            if (lowerLine.includes('error') || lowerLine.includes('err')) {
                className += ' error';
            } else if (lowerLine.includes('warn') || lowerLine.includes('warning')) {
                className += ' warn';
            } else if (lowerLine.includes('info')) {
                className += ' info';
            }
            
            // Highlight search terms
            let displayLine = this.escapeHtml(line);
            if (searchTerm && line.toLowerCase().includes(searchTerm)) {
                className += ' highlight';
                const regex = new RegExp(`(${this.escapeRegex(searchTerm)})`, 'gi');
                displayLine = displayLine.replace(regex, '<mark>$1</mark>');
            }
            
            return `<div class="${className}">${displayLine}</div>`;
        });
        
        container.innerHTML = processedLines.join('');
        container.scrollTop = container.scrollHeight; // Auto scroll to bottom
    }

    searchLogs() {
        this.loadLogs(); // Reload logs with current search term
    }

    async archiveLogs() {
        if (!confirm('確定要備份並清空所有日誌嗎？日誌將會被保存到備份資料夾中。')) {
            return;
        }
        
        try {
            const result = await this.apiRequest('/api/logs/archive', { method: 'POST' });
            this.showToast(`日誌已備份並清空 (備份位置: ${result.archiveLocation})`, 'success');
            this.loadLogs();
        } catch (error) {
            this.showToast(`備份日誌失敗: ${error.message}`, 'error');
        }
    }

    async flushLogs() {
        if (!confirm('確定要直接清空所有日誌嗎？此操作會永久刪除日誌內容且無法恢復！')) {
            return;
        }
        
        try {
            await this.apiRequest('/api/logs/flush', { method: 'POST' });
            this.showToast('日誌已完全清空', 'success');
            this.loadLogs();
        } catch (error) {
            this.showToast(`清空日誌失敗: ${error.message}`, 'error');
        }
    }

    toggleAutoRefresh() {
        const button = document.getElementById('autoRefreshToggle');
        const icon = button.querySelector('i');
        
        if (this.isAutoRefreshing) {
            // Stop auto refresh
            clearInterval(this.autoRefreshInterval);
            this.autoRefreshInterval = null;
            this.isAutoRefreshing = false;
            
            button.classList.remove('paused');
            icon.className = 'fas fa-play';
            button.innerHTML = '<i class="fas fa-play"></i> 自動重新整理';
            
            this.showToast('自動重新整理已停止', 'info');
        } else {
            // Start auto refresh
            this.autoRefreshInterval = setInterval(() => {
                this.refresh();
            }, 5000); // Refresh every 5 seconds
            
            this.isAutoRefreshing = true;
            button.classList.add('paused');
            icon.className = 'fas fa-pause';
            button.innerHTML = '<i class="fas fa-pause"></i> 停止自動重新整理';
            
            this.showToast('自動重新整理已啟動 (5秒間隔)', 'success');
        }
    }

    async refresh() {
        const refreshBtn = document.getElementById('refreshBtn');
        const icon = refreshBtn.querySelector('i');
        
        icon.style.animation = 'spin 1s linear infinite';
        
        try {
            await this.loadDashboard();
            this.showToast('數據已重新整理', 'success');
        } catch (error) {
            this.showToast(`重新整理失敗: ${error.message}`, 'error');
        } finally {
            setTimeout(() => {
                icon.style.animation = '';
            }, 1000);
        }
    }

    updateLastUpdate() {
        const now = new Date();
        const timeString = now.toLocaleTimeString('zh-TW');
        document.getElementById('lastUpdate').textContent = `最後更新: ${timeString}`;
    }

    getStatusText(status) {
        const statusMap = {
            'online': '運行中',
            'stopped': '已停止',
            'errored': '錯誤',
            'launching': '啟動中',
            'stopping': '停止中'
        };
        return statusMap[status] || status;
    }

    formatMemory(bytes) {
        if (!bytes) return 'N/A';
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
    }

    formatUptime(timestamp) {
        if (!timestamp) return 'N/A';
        const uptime = Date.now() - timestamp;
        const seconds = Math.floor(uptime / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) return `${days}天 ${hours % 24}小時`;
        if (hours > 0) return `${hours}小時 ${minutes % 60}分鐘`;
        if (minutes > 0) return `${minutes}分鐘`;
        return `${seconds}秒`;
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        const iconMap = {
            success: 'fas fa-check-circle',
            error: 'fas fa-exclamation-circle',
            info: 'fas fa-info-circle'
        };
        
        toast.innerHTML = `
            <i class="${iconMap[type]}"></i>
            <span>${message}</span>
        `;
        
        container.appendChild(toast);
        
        // Auto remove after 3 seconds
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 3000);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    escapeRegex(text) {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.pm2Dashboard = new PM2Dashboard();
});