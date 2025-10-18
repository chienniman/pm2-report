require('dotenv').config();

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const https = require('node:https');

const app = express();
const PORT = process.env.PORT || 80;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// 配置常數
const config = {
  server: {
    PORT,
    JWT_SECRET
  },
  environment: {
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/snap/bin',
    HOME: '/home/ubuntu',
    USER: 'ubuntu',
    PM2_HOME: '/home/ubuntu/.pm2'
  },
  validation: {
    MAX_LINES: 1000,
    MIN_LINES: 1,
    DEFAULT_LINES: 100,
    PROCESS_ID_PATTERN: /^[0-9a-zA-Z\-_]+$/
  },
  timeouts: {
    PM2_COMMAND: 10000,
    ARCHIVE_TIMEOUT: 5000
  }
};

// 安全的 PM2 命令執行函數
function executePM2Command(args, options = {}) {
    return new Promise((resolve, reject) => {
        const env = {
            ...process.env,
            ...config.environment
        };
        
        console.log(`Executing PM2 command: ${config.pm2.binary} ${args.join(' ')}`);
        
        const child = spawn(config.pm2.binary, args, {
            env,
            cwd: config.environment.HOME,
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: config.pm2.timeout,
            ...options
        });
        
        let stdout = '';
        let stderr = '';
        
        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        child.on('close', (code) => {
            if (code !== 0) {
                console.log(`PM2 command failed with code: ${code}`);
                if (stderr) console.log('Error:', stderr.substring(0, 200));
            }
            
            if (code === 0) {
                resolve({ stdout, stderr });
            } else {
                reject(new Error(`PM2 command failed with code ${code}: ${stderr}`));
            }
        });
        
        child.on('error', (error) => {
            console.error('PM2 command error:', error);
            reject(error);
        });
        
        // 設置超時
        setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error('PM2 command timeout'));
        }, options.timeout || config.pm2.timeout);
    });
}

// 讀取單個進程的日誌
function readProcessLog(proc, logPath, logType, linesPerProcess) {
    if (!logPath || !fs.existsSync(logPath)) {
        return '';
    }
    
    try {
        const content = fs.readFileSync(logPath, 'utf8');
        const lines = content.split('\n').slice(-linesPerProcess).join('\n');
        if (lines.trim()) {
            return `\n=== ${proc.name} (${proc.pm_id}) - ${logType} ===\n${lines}`;
        }
    } catch (error) {
        return `\n=== ${proc.name} (${proc.pm_id}) - ${logType} ===\nError reading log: ${error.message}`;
    }
    
    return '';
}

// 獲取合併的日誌內容
async function getCombinedLogs(processes, lines) {
    const linesPerProcess = Math.max(Math.floor(lines / processes.length), 10);
    let combinedLogs = '';
    
    for (const proc of processes) {
        const logPath = proc.pm2_env?.pm_out_log_path;
        const errPath = proc.pm2_env?.pm_err_log_path;
        
        combinedLogs += readProcessLog(proc, logPath, 'OUTPUT', linesPerProcess);
        
        if (errPath && errPath !== logPath) {
            combinedLogs += readProcessLog(proc, errPath, 'ERROR', linesPerProcess);
        }
    }
    
    return combinedLogs || 'No log content available';
}

// 輸入驗證函數
function validateProcessId(processId) {
    if (!processId) return null;
    
    const sanitized = String(processId).replaceAll(/[^0-9a-zA-Z\-_]/g, '');
    
    // 確保 processId 長度合理且不包含危險字符
    if (sanitized.length === 0 || sanitized.length > config.validation.maxProcessIdLength) {
        return null;
    }
    
    return sanitized === String(processId) ? sanitized : null;
}

function validateLines(lines) {
    if (!lines) return config.validation.defaultLines;
    
    const parsed = Number.parseInt(lines, 10);
    if (Number.isNaN(parsed)) return config.validation.defaultLines;
    
    return Math.min(Math.max(parsed, config.validation.minLines), config.validation.maxLines);
}

// 安全的錯誤回應函數
function createErrorResponse(message, details = null, statusCode = 500) {
    const response = {
        error: message,
        timestamp: new Date().toISOString()
    };
    
    if (details && process.env.NODE_ENV !== 'production') {
        response.details = details;
    }
    
    return { response, statusCode };
}

// Initialize users from environment variables
async function initializeUsers() {
  const users = {};
  
  if (process.env.ADMIN_USERNAME) {
    let passwordHash;
    
    if (process.env.ADMIN_PASSWORD_HASH) {
      // Use pre-hashed password from env
      passwordHash = process.env.ADMIN_PASSWORD_HASH;
    } else if (process.env.ADMIN_PASSWORD) {
      // Hash plain text password from env
      passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
      console.log(`Generated hash for admin password: ${passwordHash}`);
    } else {
      // Fallback to default password
      passwordHash = await bcrypt.hash('admin123', 10);
      console.log('Using default password: admin123');
      console.log(`Generated hash: ${passwordHash}`);
    }
    
    users[process.env.ADMIN_USERNAME] = {
      username: process.env.ADMIN_USERNAME,
      password: passwordHash
    };
  } else {
    // Fallback to default admin user
    users.admin = {
      username: 'admin',
      password: await bcrypt.hash('admin123', 10)
    };
    console.log('Using default admin credentials: admin / admin123');
  }
  
  return users;
}

let users = {};

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Authentication middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Login endpoint
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = users[username];
  if (!user || !await bcrypt.compare(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, username: user.username });
});

// Get PM2 process list
app.get('/api/processes', authenticateToken, async (req, res) => {
  try {
    console.log('=== Getting PM2 Process List ===');
    
    // 首先嘗試使用 jlist 命令
    const result = await executePM2Command(['jlist']);
    
    if (!result.stdout || result.stdout.trim() === '') {
      console.log('Empty jlist output, trying list --json');
      const listResult = await executePM2Command(['list', '--json']);
      const processes = JSON.parse(listResult.stdout);
      return res.json(processes);
    }
    
    const processes = JSON.parse(result.stdout);
    console.log(`Successfully parsed ${processes.length} PM2 processes`);
    res.json(processes);
  } catch (error) {
    console.error('PM2 processes error:', error.message);
    
    // 嘗試直接讀取 PM2 檔案作為後備方案
    try {
      const pm2ProcessesFile = '/home/ubuntu/.pm2/dump.pm2';
      if (fs.existsSync(pm2ProcessesFile)) {
        const processData = fs.readFileSync(pm2ProcessesFile, 'utf8');
        console.log('Using PM2 dump file as fallback');
        return res.json(JSON.parse(processData));
      }
    } catch (fsError) {
      console.error('Fallback file read error:', fsError.message);
    }
    
    res.status(500).json({ 
      error: 'Failed to get PM2 processes', 
      details: error.message 
    });
  }
});

// Get logs for a specific process
app.get('/api/logs/:processId', authenticateToken, async (req, res) => {
  const { processId } = req.params;
  const lines = req.query.lines || 100;
  
  // 輸入驗證和消毒
  const sanitizedProcessId = validateProcessId(processId);
  const sanitizedLines = validateLines(lines);
  
  if (!sanitizedProcessId) {
    return res.status(400).json(createErrorResponse('Invalid process ID format', null, 400).response);
  }
  
  try {
    console.log(`Getting logs for process: ${sanitizedProcessId}, lines: ${sanitizedLines}`);
    
    // 使用安全的 spawn 方式執行 PM2 logs 命令
    const result = await executePM2Command(['logs', sanitizedProcessId, '--lines', sanitizedLines.toString()]);
    
    if (result.stdout) {
      return res.json({ 
        logs: result.stdout, 
        processId: sanitizedProcessId,
        source: 'pm2-logs'
      });
    }
    
    // 如果沒有輸出，嘗試獲取進程資訊並直接讀取日誌檔案
    const showResult = await executePM2Command(['show', sanitizedProcessId, '--json']);
    const processInfo = JSON.parse(showResult.stdout);
    
    if (processInfo.length > 0) {
      const logPath = processInfo[0]?.pm2_env?.pm_out_log_path;
      if (logPath && fs.existsSync(logPath)) {
        const logContent = fs.readFileSync(logPath, 'utf8');
        const logLines = logContent.split('\n').slice(-sanitizedLines).join('\n');
        return res.json({ 
          logs: logLines, 
          processId: sanitizedProcessId,
          source: 'log-file'
        });
      }
    }
    
    res.json({ 
      logs: 'No logs available', 
      processId: sanitizedProcessId,
      source: 'none'
    });
  } catch (error) {
    console.error(`PM2 logs error for process ${sanitizedProcessId}:`, error.message);
    res.status(500).json({ 
      error: 'Failed to get logs', 
      details: error.message,
      processId: sanitizedProcessId
    });
  }
});

// Get all logs
app.get('/api/logs', authenticateToken, async (req, res) => {
  const lines = validateLines(req.query.lines);
  
  try {
    console.log(`Getting all logs with ${lines} lines`);
    
    // 方法 1: 嘗試 PM2 logs 命令
    try {
      const result = await executePM2Command(['logs', '--lines', lines.toString()]);
      if (result.stdout) {
        return res.json({ 
          logs: result.stdout, 
          method: 'pm2-logs',
          lines,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.log('PM2 logs command failed, trying alternative method:', error.message);
    }
    
    // 方法 2: 獲取進程列表並讀取各個日誌檔案
    const processResult = await executePM2Command(['jlist']);
    const processes = JSON.parse(processResult.stdout);
    
    if (processes.length === 0) {
      return res.json({ 
        logs: 'No PM2 processes running', 
        method: 'empty',
        lines: 0,
        timestamp: new Date().toISOString()
      });
    }
    
    const combinedLogs = await getCombinedLogs(processes, lines);
    res.json({ 
      logs: combinedLogs, 
      method: 'log-files',
      processes: processes.length,
      lines,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Get all logs error:', error.message);
    res.status(500).json({ 
      error: 'Failed to get logs', 
      details: error.message 
    });
  }
});

// Flush logs - 完全清空日誌檔案
app.post('/api/logs/flush', authenticateToken, async (req, res) => {
  try {
    await executePM2Command(['flush']);
    res.json({ 
      message: 'All log files have been cleared and reset',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Flush logs error:', error.message);
    res.status(500).json({ 
      error: 'Failed to flush logs', 
      details: error.message 
    });
  }
});

// Archive logs - 備份後清空日誌
app.post('/api/logs/archive', authenticateToken, async (req, res) => {
  try {
    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
    const archiveDir = `./logs-archive/${timestamp}`;
    
    // 創建歸檔目錄
    fs.mkdirSync(archiveDir, { recursive: true });
    
    // 獲取當前日誌並寫入歸檔檔案
    const logsResult = await executePM2Command(['logs', '--lines', '0']);
    fs.writeFileSync(`${archiveDir}/all-logs.txt`, logsResult.stdout || 'No logs available');
    
    // 清空日誌
    await executePM2Command(['flush']);
    
    res.json({ 
      message: 'Logs archived and cleared successfully',
      archiveLocation: archiveDir,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Archive logs error:', error.message);
    res.status(500).json({ 
      error: 'Failed to archive logs', 
      details: error.message 
    });
  }
});

// Get PM2 status
app.get('/api/status', authenticateToken, (req, res) => {
  exec('pm2 jlist', (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ error: 'Failed to get PM2 status', details: error.message });
    }
    
    try {
      const processes = JSON.parse(stdout);
      res.json({ 
        status: 'success', 
        processes: processes,
        count: processes.length,
        timestamp: new Date().toISOString()
      });
    } catch (parseError) {
      // 如果 JSON 解析失敗，回傳原始輸出
      res.json({ 
        status: 'raw', 
        raw_output: stdout,
        error: parseError.message 
      });
    }
  });
});

// 新增：測試 PM2 連接和調試
app.get('/api/pm2/test', authenticateToken, async (req, res) => {
  const commands = [
    ['--version'],
    ['ping'],
    ['list'],
    ['jlist']
  ];
  
  const results = {};
  
  try {
    for (const cmd of commands) {
      try {
        const result = await executePM2Command(cmd);
        results[cmd.join(' ')] = {
          success: true,
          stdout: result.stdout,
          stderr: result.stderr
        };
      } catch (error) {
        results[cmd.join(' ')] = {
          success: false,
          error: error.message
        };
      }
    }
    
    res.json({
      pm2_test: results,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      error: 'PM2 test failed',
      details: error.message
    });
  }
});

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize and start server
async function startServer() {
  try {
    users = await initializeUsers();
    
    // Check if HTTPS certificates exist
    const useHTTPS = fs.existsSync('./ssl/cert.pem') && fs.existsSync('./ssl/key.pem');
    
    if (useHTTPS && PORT === 443) {
      const httpsOptions = {
        key: fs.readFileSync('./ssl/key.pem'),
        cert: fs.readFileSync('./ssl/cert.pem')
      };
      
      https.createServer(httpsOptions, app).listen(PORT, () => {
        console.log(`PM2 Report Server running on https://localhost:${PORT}`);
        printAdminCredentials();
      });
    } else {
      app.listen(PORT, () => {
        const protocol = 'http';
        const portDisplay = PORT === 80 ? '' : `:${PORT}`;
        console.log(`PM2 Report Server running on ${protocol}://localhost${portDisplay}`);
        printAdminCredentials();
      });
    }
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

function printAdminCredentials() {
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  if (process.env.ADMIN_PASSWORD) {
    console.log(`Admin credentials: ${adminUser} / ${process.env.ADMIN_PASSWORD}`);
  } else {
    console.log(`Admin credentials: ${adminUser} / admin123 (default)`);
  }
}

// 啟動伺服器
startServer().catch(console.error);