import { createClient } from "@libsql/client";

let client;

export function getDb() {
  if (!client) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL || "file:local.db",
      authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    });
    // Init tables on first access (runs once per cold start)
    initTables();
  }
  return client;
}

async function initTables() {
  const db = client;
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'visitor',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_heartbeat TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      visitor_id TEXT NOT NULL,
      counselor_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (visitor_id) REFERENCES agents(id),
      FOREIGN KEY (counselor_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      content TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (sender_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tx_hash TEXT NOT NULL UNIQUE,
      from_address TEXT NOT NULL,
      to_address TEXT NOT NULL,
      token_address TEXT NOT NULL,
      amount TEXT NOT NULL,
      purpose TEXT NOT NULL,
      session_id TEXT,
      agent_id TEXT,
      block_number INTEGER NOT NULL,
      verified_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );
  `);

  // Add payment columns to sessions (safe to run multiple times with IF NOT EXISTS pattern)
  try {
    await db.execute("ALTER TABLE sessions ADD COLUMN payment_tx TEXT");
  } catch (_) { /* column already exists */ }
  try {
    await db.execute("ALTER TABLE sessions ADD COLUMN payment_verified INTEGER DEFAULT 0");
  } catch (_) { /* column already exists */ }
  try {
    await db.execute("ALTER TABLE sessions ADD COLUMN payment_amount TEXT");
  } catch (_) { /* column already exists */ }
}

// Helper: run a query and return all rows
export async function queryAll(sql, args = []) {
  const db = getDb();
  const result = await db.execute({ sql, args });
  return result.rows;
}

// Helper: run a query and return first row
export async function queryOne(sql, args = []) {
  const db = getDb();
  const result = await db.execute({ sql, args });
  return result.rows[0] || null;
}

// Helper: run an insert/update/delete
export async function execute(sql, args = []) {
  const db = getDb();
  return db.execute({ sql, args });
}
