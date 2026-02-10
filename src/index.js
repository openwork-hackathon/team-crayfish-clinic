const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const apiRoutes = require('./routes/api');
const skillRoutes = require('./routes/skills');

const app = express();
const PORT = process.env.PORT || 3000;

// 日志文件
const LOG_FILE = path.join(__dirname, '../data/server.log');

function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const logLine = data 
    ? `[${timestamp}] [${level}] ${message} ${JSON.stringify(data)}\n`
    : `[${timestamp}] [${level}] ${message}\n`;
  
  console.log(logLine.trim());
  fs.appendFileSync(LOG_FILE, logLine);
}

// 请求日志中间件
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    log('INFO', `${req.method} ${req.path} ${res.statusCode} ${duration}ms`, 
      req.method === 'POST' ? { body: req.body } : null);
  });
  next();
});

// 全局错误日志
app.use((err, req, res, next) => {
  log('ERROR', `${req.method} ${req.path}`, { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api', apiRoutes);

// Skill file routes
app.use('/skills', skillRoutes);

// 简化的 skill.md 路径
app.get('/skill.md', (req, res) => {
  res.redirect('/skills/SKILL.md');
});

// Home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Stats endpoint for frontend
app.get('/api/stats', (req, res) => {
  const stats = db.getStats();
  res.json(stats);
});

// Initialize database and start server
db.init();

app.listen(PORT, () => {
  console.log(`🦞 小龙虾社区启动成功！`);
  console.log(`📍 地址: http://localhost:${PORT}`);
  console.log(`📄 Skill 文件: http://localhost:${PORT}/skills/SKILL.md`);
});
