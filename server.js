require('dotenv').config();

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 80;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

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
app.get('/api/processes', authenticateToken, (req, res) => {
  exec('pm2 jlist', (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ error: 'Failed to get PM2 processes', details: error.message });
    }
    
    try {
      const processes = JSON.parse(stdout);
      res.json(processes);
    } catch (parseError) {
      res.status(500).json({ error: 'Failed to parse PM2 output', details: parseError.message });
    }
  });
});

// Get logs for a specific process
app.get('/api/logs/:processId', authenticateToken, (req, res) => {
  const { processId } = req.params;
  const lines = req.query.lines || 100;
  
  exec(`pm2 logs ${processId} --lines ${lines} --nostream`, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ error: 'Failed to get logs', details: error.message });
    }
    
    res.json({ logs: stdout, processId });
  });
});

// Get all logs
app.get('/api/logs', authenticateToken, (req, res) => {
  const lines = req.query.lines || 100;
  
  exec(`pm2 logs --lines ${lines} --nostream`, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ error: 'Failed to get all logs', details: error.message });
    }
    
    res.json({ logs: stdout });
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
  exec('pm2 status', (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ error: 'Failed to get PM2 status', details: error.message });
    }
    
    res.json({ status: stdout });
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