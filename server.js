require('dotenv').config();

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { exec, spawn } = require('node:child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 80;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// 安全的 PM2 命令執行函數
function executePM2Command(args, options = {}) {
    return new Promise((resolve, reject) => {
        const pm2Binary = '/usr/bin/pm2';
        const env = {
            ...process.env,
            PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/snap/bin',
            HOME: '/home/ubuntu',
            USER: 'ubuntu',
            PM2_HOME: '/home/ubuntu/.pm2'
        };
        
        console.log(`Executing PM2 command: ${pm2Binary}`, args);
        
        const child = spawn(pm2Binary, args, {
            env,
            cwd: '/home/ubuntu',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 10000,
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
            console.log(`PM2 command finished with code: ${code}`);
            if (stdout) console.log('STDOUT:', stdout.substring(0, 500));
            if (stderr) console.log('STDERR:', stderr.substring(0, 500));
            
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
        }, options.timeout || 10000);
    });
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
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

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
  const sanitizedProcessId = String(processId).replace(/[^0-9a-zA-Z\-_]/g, '');
  const sanitizedLines = Math.min(Math.max(parseInt(lines) || 100, 1), 1000);
  
  if (!sanitizedProcessId || sanitizedProcessId !== processId) {
    return res.status(400).json({ error: 'Invalid process ID format' });
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
app.get('/api/logs', authenticateToken, (req, res) => {
  const lines = req.query.lines || 100;
  
  // 使用多種方法嘗試獲取日誌
  const tryGetLogs = async () => {
    const options = {
      timeout: 15000, // 15 秒超時
      maxBuffer: 1024 * 1024 * 10, // 10MB buffer
      cwd: '/home/ubuntu',
      env: { 
        ...process.env, 
        PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/snap/bin',
        HOME: '/home/ubuntu',
        USER: 'ubuntu',
        PM2_HOME: '/home/ubuntu/.pm2'
      }
    };

    // 方法 1: 嘗試使用 --raw 參數
    return new Promise((resolve) => {
      exec(`/usr/bin/pm2 logs --lines ${lines} --raw`, options, (error, stdout, stderr) => {
        if (!error && stdout) {
          resolve({ success: true, logs: stdout, method: 'raw' });
          return;
        }
        
        // 方法 2: 不使用 --raw 參數
        exec(`/usr/bin/pm2 logs --lines ${lines}`, options, (error2, stdout2, stderr2) => {
          if (!error2 && (stdout2 || stderr2)) {
            resolve({ success: true, logs: stdout2 || stderr2, method: 'standard' });
            return;
          }
          
          // 方法 3: 使用 pm2 jlist 獲取進程信息，然後讀取各個日誌檔案
          exec('/usr/bin/pm2 jlist', options, (error3, stdout3) => {
            if (error3) {
              resolve({ success: false, error: 'All methods failed', details: [error?.message, error2?.message, error3?.message] });
              return;
            }
            
            try {
              const processes = JSON.parse(stdout3);
              if (processes.length === 0) {
                resolve({ success: true, logs: 'No PM2 processes running', method: 'empty' });
                return;
              }
              
              // 讀取所有進程的日誌
              let combinedLogs = '';
              let completed = 0;
              
              processes.forEach((proc) => {
                const logPath = proc.pm2_env?.pm_out_log_path;
                const errPath = proc.pm2_env?.pm_err_log_path;
                
                if (logPath) {
                  exec(`tail -n ${Math.floor(lines/processes.length) || 20} "${logPath}" 2>/dev/null || echo "Cannot read ${logPath}"`, (tailError, tailStdout) => {
                    if (tailStdout) {
                      combinedLogs += `\n=== ${proc.name} (${proc.pm_id}) - OUTPUT ===\n${tailStdout}`;
                    }
                    
                    if (errPath && errPath !== logPath) {
                      exec(`tail -n ${Math.floor(lines/processes.length) || 20} "${errPath}" 2>/dev/null || echo "Cannot read ${errPath}"`, (errTailError, errTailStdout) => {
                        if (errTailStdout) {
                          combinedLogs += `\n=== ${proc.name} (${proc.pm_id}) - ERROR ===\n${errTailStdout}`;
                        }
                        
                        completed++;
                        if (completed === processes.length) {
                          resolve({ success: true, logs: combinedLogs || 'No log content available', method: 'files' });
                        }
                      });
                    } else {
                      completed++;
                      if (completed === processes.length) {
                        resolve({ success: true, logs: combinedLogs || 'No log content available', method: 'files' });
                      }
                    }
                  });
                } else {
                  completed++;
                  if (completed === processes.length) {
                    resolve({ success: true, logs: combinedLogs || 'No log files found', method: 'files' });
                  }
                }
              });
              
              // 防止無限等待
              setTimeout(() => {
                if (completed < processes.length) {
                  resolve({ success: true, logs: combinedLogs || 'Partial log data (timeout)', method: 'files-partial' });
                }
              }, 5000);
              
            } catch (parseError) {
              resolve({ success: false, error: 'Failed to parse process list', details: parseError.message });
            }
          });
        });
      });
    });
  };
  
  tryGetLogs().then(result => {
    if (result.success) {
      res.json({ 
        logs: result.logs, 
        method: result.method,
        timestamp: new Date().toISOString()
      });
    } else {
      console.error('PM2 logs error:', result);
      res.status(500).json({ 
        error: result.error || 'Failed to get all logs', 
        details: result.details 
      });
    }
  }).catch(err => {
    console.error('Unexpected error in tryGetLogs:', err);
    res.status(500).json({ error: 'Unexpected error', details: err.message });
  });
});

// Flush logs - 完全清空日誌檔案
app.post('/api/logs/flush', authenticateToken, (req, res) => {
  exec('pm2 flush', (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ error: 'Failed to flush logs', details: error.message });
    }
    
    res.json({ message: 'All log files have been cleared and reset' });
  });
});

// Archive logs - 備份後清空日誌
app.post('/api/logs/archive', authenticateToken, (req, res) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archiveDir = `./logs-archive/${timestamp}`;
  
  // Create archive directory and copy current logs
  exec(`mkdir -p "${archiveDir}" && pm2 logs --lines 0 --raw > "${archiveDir}/all-logs.txt" && pm2 flush`, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ error: 'Failed to archive logs', details: error.message });
    }
    
    res.json({ 
      message: 'Logs archived and cleared successfully',
      archiveLocation: archiveDir
    });
  });
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
app.get('/api/pm2/test', authenticateToken, (req, res) => {
  const commands = [
    'which pm2',
    'pm2 --version',
    'pm2 ping',
    'pm2 list',
    'pm2 jlist'
  ];
  
  const results = {};
  let completed = 0;
  
  commands.forEach((cmd) => {
    exec(cmd, { timeout: 5000 }, (error, stdout, stderr) => {
      results[cmd] = {
        success: !error,
        stdout: stdout,
        stderr: stderr,
        error: error?.message
      };
      
      completed++;
      if (completed === commands.length) {
        res.json({
          pm2_test: results,
          timestamp: new Date().toISOString()
        });
      }
    });
  });
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

startServer();