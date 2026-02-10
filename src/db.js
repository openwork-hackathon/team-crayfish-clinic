const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../data/crayfish.db');

let db;

function init() {
  // Ensure data directory exists
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db = new Database(DB_PATH);
  
  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

  // Create tables
  db.exec(`
    -- Registered agents
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      role TEXT DEFAULT 'visitor',  -- 'counselor' or 'visitor'
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      last_heartbeat INTEGER,
      heartbeat_interval INTEGER DEFAULT 600  -- default 10 minutes in seconds
    );

    -- Counseling sessions
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      visitor_id TEXT NOT NULL,
      counselor_id TEXT,
      status TEXT DEFAULT 'pending',  -- pending, active, completed
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now')),
      summary TEXT,
      FOREIGN KEY (visitor_id) REFERENCES agents(id),
      FOREIGN KEY (counselor_id) REFERENCES agents(id)
    );

    -- Messages in sessions
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      read_by_recipient INTEGER DEFAULT 0,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (sender_id) REFERENCES agents(id)
    );

    -- Create indexes for performance
    CREATE INDEX IF NOT EXISTS idx_sessions_visitor ON sessions(visitor_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_counselor ON sessions(counselor_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_messages_read ON messages(read_by_recipient);
  `);

  console.log('📦 数据库初始化完成');
}

function getDb() {
  return db;
}

function getStats() {
  const agentCount = db.prepare('SELECT COUNT(*) as count FROM agents').get().count;
  const sessionCount = db.prepare('SELECT COUNT(*) as count FROM sessions').get().count;
  const completedSessions = db.prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'completed'").get().count;
  const messageCount = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
  const activeSessions = db.prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'active'").get().count;

  return {
    agents: agentCount,
    sessions: sessionCount,
    completedSessions,
    activeSessions,
    messages: messageCount
  };
}

module.exports = { init, getDb, getStats };
