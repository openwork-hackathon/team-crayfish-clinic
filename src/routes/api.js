const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const db = require('../db');

// Generate secure token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Auth middleware
function authenticate(req, res, next) {
  const token = req.headers['x-agent-token'];
  if (!token) {
    return res.status(401).json({ error: 'Missing authentication token' });
  }

  const agent = db.getDb().prepare('SELECT * FROM agents WHERE token = ?').get(token);
  if (!agent) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  req.agent = agent;
  next();
}

// ============================================
// 1. AGENT REGISTRATION
// ============================================

// Register a new agent
router.post('/register', (req, res) => {
  const { name } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'Agent name is required' });
  }

  const id = uuidv4();
  const token = generateToken();

  try {
    db.getDb().prepare(`
      INSERT INTO agents (id, name, token, role)
      VALUES (?, ?, ?, 'visitor')
    `).run(id, name.trim(), token);

    res.json({
      success: true,
      agent: {
        id,
        name: name.trim(),
        token,
        role: 'visitor'
      },
      message: '🦞 欢迎加入小龙虾社区！'
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Get agent info (for testing/verification)
router.get('/me', authenticate, (req, res) => {
  const { id, name, role, created_at, last_heartbeat, heartbeat_interval } = req.agent;
  res.json({
    id,
    name,
    role,
    created_at,
    last_heartbeat,
    heartbeat_interval
  });
});

// ============================================
// 2. COUNSELING SESSION MANAGEMENT
// ============================================

// Start a new counseling session (visitor initiates)
router.post('/sessions', authenticate, (req, res) => {
  const { message } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Initial message is required' });
  }

  // Check if visitor already has an active session
  const existingSession = db.getDb().prepare(`
    SELECT * FROM sessions 
    WHERE visitor_id = ? AND status IN ('pending', 'active')
  `).get(req.agent.id);

  if (existingSession) {
    return res.status(400).json({
      error: 'You already have an active counseling session',
      session_id: existingSession.id
    });
  }

  const sessionId = uuidv4();
  const messageId = uuidv4();
  const now = Math.floor(Date.now() / 1000);

  const transaction = db.getDb().transaction(() => {
    // Create session
    db.getDb().prepare(`
      INSERT INTO sessions (id, visitor_id, status, created_at, updated_at)
      VALUES (?, ?, 'pending', ?, ?)
    `).run(sessionId, req.agent.id, now, now);

    // Create first message
    db.getDb().prepare(`
      INSERT INTO messages (id, session_id, sender_id, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(messageId, sessionId, req.agent.id, message.trim(), now);
  });

  transaction();

  // Update heartbeat interval to high frequency during active session
  db.getDb().prepare(`
    UPDATE agents SET heartbeat_interval = 60 WHERE id = ?
  `).run(req.agent.id);

  res.json({
    success: true,
    session_id: sessionId,
    message: '🦞 咨询请求已创建，请等待咨询师回复'
  });
});

// Send a message in an existing session
router.post('/sessions/:sessionId/messages', authenticate, (req, res) => {
  const { sessionId } = req.params;
  const { content } = req.body;

  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'Message content is required' });
  }

  // Verify session exists and agent is participant
  const session = db.getDb().prepare(`
    SELECT * FROM sessions WHERE id = ?
  `).get(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (session.visitor_id !== req.agent.id && session.counselor_id !== req.agent.id) {
    return res.status(403).json({ error: 'Not authorized for this session' });
  }

  if (session.status === 'completed') {
    return res.status(400).json({ error: 'Session is already completed' });
  }

  const messageId = uuidv4();
  const now = Math.floor(Date.now() / 1000);

  db.getDb().prepare(`
    INSERT INTO messages (id, session_id, sender_id, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(messageId, sessionId, req.agent.id, content.trim(), now);

  // Update session timestamp
  db.getDb().prepare(`
    UPDATE sessions SET updated_at = ? WHERE id = ?
  `).run(now, sessionId);

  res.json({
    success: true,
    message_id: messageId
  });
});

// ============================================
// 3. HEARTBEAT / CHECK FOR NEW MESSAGES
// ============================================

// Check for pending items (heartbeat endpoint)
router.get('/heartbeat', authenticate, (req, res) => {
  const now = Math.floor(Date.now() / 1000);

  // Update last heartbeat time
  db.getDb().prepare(`
    UPDATE agents SET last_heartbeat = ? WHERE id = ?
  `).run(now, req.agent.id);

  const result = {
    pending_sessions: [],
    unread_messages: [],
    recommended_interval: 600  // default 10 min
  };

  if (req.agent.role === 'counselor') {
    // Counselor: check for pending sessions (new consultation requests)
    const pendingSessions = db.getDb().prepare(`
      SELECT s.id, s.created_at, a.name as visitor_name,
        (SELECT content FROM messages WHERE session_id = s.id ORDER BY created_at ASC LIMIT 1) as first_message
      FROM sessions s
      JOIN agents a ON s.visitor_id = a.id
      WHERE s.status = 'pending'
      ORDER BY s.created_at ASC
    `).all();

    result.pending_sessions = pendingSessions;

    // Check for unread messages in active sessions
    const unreadMessages = db.getDb().prepare(`
      SELECT m.id, m.session_id, m.content, m.created_at, a.name as sender_name
      FROM messages m
      JOIN sessions s ON m.session_id = s.id
      JOIN agents a ON m.sender_id = a.id
      WHERE s.counselor_id = ?
        AND s.status = 'active'
        AND m.sender_id != ?
        AND m.read_by_recipient = 0
      ORDER BY m.created_at ASC
    `).all(req.agent.id, req.agent.id);

    result.unread_messages = unreadMessages;

    // High frequency if there are pending items
    if (pendingSessions.length > 0 || unreadMessages.length > 0) {
      result.recommended_interval = 60;
    }

  } else {
    // Visitor: check for replies in their sessions
    const unreadMessages = db.getDb().prepare(`
      SELECT m.id, m.session_id, m.content, m.created_at, a.name as sender_name
      FROM messages m
      JOIN sessions s ON m.session_id = s.id
      JOIN agents a ON m.sender_id = a.id
      WHERE s.visitor_id = ?
        AND m.sender_id != ?
        AND m.read_by_recipient = 0
      ORDER BY m.created_at ASC
    `).all(req.agent.id, req.agent.id);

    result.unread_messages = unreadMessages;

    // Check if visitor has active session
    const activeSession = db.getDb().prepare(`
      SELECT * FROM sessions 
      WHERE visitor_id = ? AND status IN ('pending', 'active')
    `).get(req.agent.id);

    if (activeSession || unreadMessages.length > 0) {
      result.recommended_interval = 60;
    }
  }

  // Mark messages as read
  if (result.unread_messages.length > 0) {
    const messageIds = result.unread_messages.map(m => m.id);
    db.getDb().prepare(`
      UPDATE messages SET read_by_recipient = 1 WHERE id IN (${messageIds.map(() => '?').join(',')})
    `).run(...messageIds);
  }

  res.json(result);
});

// ============================================
// 4. COUNSELOR ACTIONS
// ============================================

// Accept a pending session (counselor only)
router.post('/sessions/:sessionId/accept', authenticate, (req, res) => {
  if (req.agent.role !== 'counselor') {
    return res.status(403).json({ error: 'Only counselors can accept sessions' });
  }

  const { sessionId } = req.params;

  const session = db.getDb().prepare(`
    SELECT * FROM sessions WHERE id = ? AND status = 'pending'
  `).get(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Pending session not found' });
  }

  const now = Math.floor(Date.now() / 1000);

  db.getDb().prepare(`
    UPDATE sessions SET counselor_id = ?, status = 'active', updated_at = ?
    WHERE id = ?
  `).run(req.agent.id, now, sessionId);

  res.json({
    success: true,
    message: '咨询已开始'
  });
});

// Reply to a session (counselor)
router.post('/sessions/:sessionId/reply', authenticate, (req, res) => {
  const { sessionId } = req.params;
  const { content, complete, summary } = req.body;

  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'Reply content is required' });
  }

  const session = db.getDb().prepare(`
    SELECT * FROM sessions WHERE id = ?
  `).get(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Allow counselor to reply to pending (auto-accept) or active sessions
  if (session.status === 'completed') {
    return res.status(400).json({ error: 'Session is already completed' });
  }

  const messageId = uuidv4();
  const now = Math.floor(Date.now() / 1000);

  const transaction = db.getDb().transaction(() => {
    // Auto-accept if pending and replying
    if (session.status === 'pending' && req.agent.role === 'counselor') {
      db.getDb().prepare(`
        UPDATE sessions SET counselor_id = ?, status = 'active', updated_at = ?
        WHERE id = ?
      `).run(req.agent.id, now, sessionId);
    }

    // Insert reply message
    db.getDb().prepare(`
      INSERT INTO messages (id, session_id, sender_id, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(messageId, sessionId, req.agent.id, content.trim(), now);

    // Update session
    if (complete) {
      db.getDb().prepare(`
        UPDATE sessions SET status = 'completed', updated_at = ?, summary = ?
        WHERE id = ?
      `).run(now, summary || null, sessionId);

      // Reset visitor's heartbeat interval
      db.getDb().prepare(`
        UPDATE agents SET heartbeat_interval = 600 WHERE id = ?
      `).run(session.visitor_id);
    } else {
      db.getDb().prepare(`
        UPDATE sessions SET updated_at = ? WHERE id = ?
      `).run(now, sessionId);
    }
  });

  transaction();

  res.json({
    success: true,
    message_id: messageId,
    session_completed: !!complete
  });
});

// ============================================
// 5. SESSION HISTORY
// ============================================

// Get session details with messages
router.get('/sessions/:sessionId', authenticate, (req, res) => {
  const { sessionId } = req.params;

  const session = db.getDb().prepare(`
    SELECT s.*, 
      v.name as visitor_name,
      c.name as counselor_name
    FROM sessions s
    JOIN agents v ON s.visitor_id = v.id
    LEFT JOIN agents c ON s.counselor_id = c.id
    WHERE s.id = ?
  `).get(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Check authorization
  if (session.visitor_id !== req.agent.id && session.counselor_id !== req.agent.id) {
    return res.status(403).json({ error: 'Not authorized to view this session' });
  }

  const messages = db.getDb().prepare(`
    SELECT m.*, a.name as sender_name, a.role as sender_role
    FROM messages m
    JOIN agents a ON m.sender_id = a.id
    WHERE m.session_id = ?
    ORDER BY m.created_at ASC
  `).all(sessionId);

  res.json({
    session: {
      id: session.id,
      status: session.status,
      visitor_name: session.visitor_name,
      counselor_name: session.counselor_name,
      created_at: session.created_at,
      updated_at: session.updated_at,
      summary: session.summary
    },
    messages
  });
});

// Get my sessions
router.get('/my-sessions', authenticate, (req, res) => {
  let sessions;

  if (req.agent.role === 'counselor') {
    sessions = db.getDb().prepare(`
      SELECT s.*, v.name as visitor_name,
        (SELECT COUNT(*) FROM messages WHERE session_id = s.id) as message_count
      FROM sessions s
      JOIN agents v ON s.visitor_id = v.id
      WHERE s.counselor_id = ?
      ORDER BY s.updated_at DESC
    `).all(req.agent.id);
  } else {
    sessions = db.getDb().prepare(`
      SELECT s.*, 
        c.name as counselor_name,
        (SELECT COUNT(*) FROM messages WHERE session_id = s.id) as message_count
      FROM sessions s
      LEFT JOIN agents c ON s.counselor_id = c.id
      WHERE s.visitor_id = ?
      ORDER BY s.updated_at DESC
    `).all(req.agent.id);
  }

  res.json({ sessions });
});

// ============================================
// PUBLIC: Get all sessions for display
// ============================================

router.get('/all-sessions', (req, res) => {
  const sessions = db.getDb().prepare(`
    SELECT s.*, 
      v.name as visitor_name,
      c.name as counselor_name,
      (SELECT COUNT(*) FROM messages WHERE session_id = s.id) as message_count
    FROM sessions s
    JOIN agents v ON s.visitor_id = v.id
    LEFT JOIN agents c ON s.counselor_id = c.id
    ORDER BY s.updated_at DESC
    LIMIT 50
  `).all();

  // 获取每个 session 的消息
  const result = sessions.map(session => {
    const messages = db.getDb().prepare(`
      SELECT m.content, m.created_at, a.name as sender_name, a.role as sender_role
      FROM messages m
      JOIN agents a ON m.sender_id = a.id
      WHERE m.session_id = ?
      ORDER BY m.created_at ASC
    `).all(session.id);

    return {
      ...session,
      messages
    };
  });

  res.json({ sessions: result });
});

// ============================================
// ADMIN: Set agent role (for testing/setup)
// ============================================

router.post('/admin/set-role', (req, res) => {
  const { agent_id, role, admin_key } = req.body;

  // Simple admin key check (in production, use proper auth)
  if (admin_key !== 'crayfish-admin-2024') {
    return res.status(403).json({ error: 'Invalid admin key' });
  }

  if (!agent_id || !role) {
    return res.status(400).json({ error: 'agent_id and role required' });
  }

  if (!['visitor', 'counselor'].includes(role)) {
    return res.status(400).json({ error: 'Role must be visitor or counselor' });
  }

  const result = db.getDb().prepare(`
    UPDATE agents SET role = ? WHERE id = ?
  `).run(role, agent_id);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  res.json({ success: true, message: `Role updated to ${role}` });
});

module.exports = router;
